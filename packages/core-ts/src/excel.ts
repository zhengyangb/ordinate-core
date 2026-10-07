import { DocumentState, SheetState } from "./incremental";
import { cloneDocumentState } from "./document_clone";
import { configureImportedDocument, ImportHeaderError, type ImportSheetHeaders } from "./import_layout";
import { escapeCellText, parseHierarchyLabel } from "./parser";
import { stripCellDisplayMetadata } from "./runtime/parse";
import type { RefSelector, RuntimeValue } from "./runtime/types";
import { encodeNumberLiteral } from "./number_encoding";
import { encodeStringLiteral } from "./text_encoding";
import { ExcelFailure, ExcelReport, excelLimits, excelExportOptions, type ExcelLimits, type ExcelOptions, type ExcelExportOptions, type ExcelResult, type UnsupportedContent } from "./excel/contracts";
import { readXlsx, writeXlsx, type WorkbookCell, type WorkbookScalar, type DecodedWorkbook } from "./excel/workbookCodec";
import { parseExcelFormula } from "./excel/formulaParser";
import type { ExcelExpression } from "./excel/formulaAst";
import { nameResolver } from "./excel/definedNames";
import { exportFormula } from "./excel/exportFormula";
import { importFormula } from "./excel/importFormula";
import type { FormulaLocation } from "./excel/referenceTranslation";
import { resolveDocumentPresentation } from "./presentation";
import { resolveSheetRowStructure } from "./row_structure";
import { importNumberFormat, importCalendarDisplayFormat, exportNumberFormat } from "./excel/formatTranslation";
import { calendarCellKind, importDateLiteral, serialToNativeDate, type CalendarValueKind } from "./excel/temporalValues";
import { exportTemporalValue, temporalNumberFormats, warnTemporalPresentation } from "./excel/temporalExport";
import { analyzeNoteCandidates, extractWorkbookNotes, type ExcelNoteChoice } from "./excel/noteImport";
import type { ExcelDisplayCell } from "./excel/exportPresentation";

export { DEFAULT_EXCEL_LIMITS } from "./excel/contracts";
export type { ExcelLimits, ExcelOptions, ExcelExportOptions, ExcelResult, ExcelDiagnostic, ExcelDiagnosticCode } from "./excel/contracts";

function checkDimensions(dimensions: Array<{ name: string; rows: number; columns: number }>, limits: Readonly<ExcelLimits>): void {
  if (dimensions.length === 0 || dimensions.length > limits.maxSheets) throw new ExcelFailure("limit_exceeded", "Invalid sheet count.");
  let cells = 0;
  for (const sheet of dimensions) {
    cells += sheet.rows * sheet.columns;
    if (sheet.rows > Math.min(limits.maxRows, 1_048_576) || sheet.columns > Math.min(limits.maxColumns, 16_384) || cells > limits.maxCells) {
      throw new ExcelFailure("limit_exceeded", "Workbook dimensions or referenced blank cells exceed the conversion budget.", { sheetName: sheet.name });
    }
  }
}

function nativeLiteral(value: WorkbookScalar, report: ExcelReport, at: FormulaLocation): string {
  if (value === null) return "";
  if (typeof value === "string") return encodeStringLiteral(value);
  if (typeof value === "number") return encodeNumberLiteral(value);
  if (typeof value === "boolean") return String(value);
  report.warn("semantic_difference", "Excel-specific error detail is mapped to a native error category.", at);
  return value.error === "#DIV/0!" ? "error[div_by_zero]" : value.error === "#REF!" ? "error[unresolved_reference]" : "error[type_error]";
}

function excelValue(value: RuntimeValue, report: ExcelReport, at: FormulaLocation): WorkbookScalar {
  switch (value.kind) {
    case "blank": return null;
    case "null":
      report.warn("semantic_difference", "Excel cannot distinguish native null from an empty cell.", at);
      return null;
    case "string": case "boolean": return value.value;
    case "date": case "datetime": case "time": case "duration": return exportTemporalValue(value, report, at);
    case "number":
      if (!Number.isFinite(value.value)) throw new ExcelFailure("unrepresentable_value", "Excel cannot represent a non-finite result.", at);
      return value.value;
    case "error":
      report.warn("semantic_difference", "Native error details are reduced to an Excel error tag.", at);
      return { error: value.errorKind === "div_by_zero" ? "#DIV/0!" : value.errorKind === "unresolved_reference" ? "#REF!" : "#VALUE!" };
    default: throw new Error("Unrecognized runtime value at Excel export boundary.");
  }
}

/** Core-only import. Formula sources are translated and evaluated, never replaced by caches. */
export type ExcelImportResult = ExcelResult<DocumentState>;
export interface ExcelImportOptions extends ExcelOptions {
  headers?: ImportSheetHeaders[];
  unsupportedContent?: UnsupportedContent;
  notes?: ExcelNoteChoice[];
}
export type { ExcelNoteChoice, ExcelNoteCandidate } from "./excel/noteImport";
function validateImportOptions(options: ExcelImportOptions): void {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => !["limits", "headers", "unsupportedContent", "notes"].includes(key))
    || (options.headers !== undefined && !Array.isArray(options.headers))
    || (options.notes !== undefined && !Array.isArray(options.notes))
    || (options.unsupportedContent !== undefined && !["reject", "preserve-text"].includes(options.unsupportedContent))) {
    throw new ExcelFailure("invalid_options", "Expected limits, per-sheet headers, note choices and unsupportedContent: reject or preserve-text.");
  }
}
export interface PreparedExcelImport { workbook: DecodedWorkbook; diagnostics: import("./excel/contracts").ExcelDiagnostic[] }
export async function prepareExcelImport(bytes: Uint8Array, options: ExcelOptions & {unsupportedContent?: UnsupportedContent} = {}): Promise<ExcelResult<PreparedExcelImport>> {
  const report = new ExcelReport(true);
  return report.run(async () => {
    validateImportOptions(options);
    const workbook = await readXlsx(bytes, excelLimits({limits:options.limits}), report, options.unsupportedContent ?? "reject");
    return {workbook, diagnostics:report.diagnostics};
  });
}
export function excelImportNoteCandidates(prepared: PreparedExcelImport, options: ExcelOptions = {}) {
  return analyzeNoteCandidates(prepared.workbook, excelLimits(options));
}

export async function importExcelWorkbook(bytes: Uint8Array, options: ExcelImportOptions = {}): Promise<ExcelImportResult> {
  const prepared = await prepareExcelImport(bytes, options);
  if (!prepared.ok) return prepared;
  return importPreparedExcelWorkbook(prepared.value, options);
}

/** Reuse validated/decompressed input while the user adjusts the import preview. */
export async function importPreparedExcelWorkbook(prepared: PreparedExcelImport, options: ExcelImportOptions = {}): Promise<ExcelImportResult> {
  const report = new ExcelReport(true);
  report.merge(prepared.diagnostics);
  const result = await report.run(async () => {
    validateImportOptions(options);
    const limits = excelLimits({limits: options.limits});
    const policy = options.unsupportedContent ?? "reject";
    const {workbook, notes} = extractWorkbookNotes(prepared.workbook, options.notes ?? [], limits);
    const names = workbook.sheets.map(sheet => sheet.name);
    const expandNames = nameResolver(workbook.definedNames, limits);
    const calendars = workbook.sheets.map(sheet => sheet.rows.map(row => row.map(cell => {
      const kind = calendarCellKind(cell.numberFormat);
      if (!kind || (cell.formula ? cell.value !== null && typeof cell.value !== "number" : typeof cell.value !== "number")) return null;
      return kind === "date" && cell.formula !== undefined ? "date-or-datetime" as const
        : kind === "date" && typeof cell.value === "number" && !Number.isInteger(cell.value) ? "datetime" : kind;
    })));
    const dimensions = workbook.sheets.map(sheet => ({ name: sheet.name, rows: sheet.rows.length, columns: sheet.rows[0]?.length ?? 0 }));
    const preserved = new Set<WorkbookCell>();
    const parsed = workbook.sheets.map((sheet, s) => sheet.rows.map((row, r) => row.map((cell, c) => {
      if (cell.formula === undefined) return null;
      const at = { sheetName: sheet.name, rowIndex: r, colIndex: c, formula: cell.formula };
      try {
        const expression = cell.importExpression ?? expandNames(parseExcelFormula(cell.formula, limits), s);
        const referenceCalendar = (node: Extract<ExcelExpression, {kind: "reference"}>): CalendarValueKind | "range" | null => {
          const target = node.sheet === undefined ? s : names.findIndex(name => name.toLowerCase() === node.sheet!.toLowerCase());
          // importReference validates the sheet before asking for calendar units.
          const axis = (selector: RefSelector, size: number): [number, number] => selector.kind === "all" ? [0, size - 1]
            : selector.kind === "range" ? (selector.value as RefSelector[]).map(item => Number(item.value)).sort((a,b) => a-b) as [number, number]
            : [Number(selector.value), Number(selector.value)];
          const [r0,r1] = axis(node.reference.rowSelector, dimensions[target].rows);
          const [c0,c1] = axis(node.reference.colSelector, dimensions[target].columns);
          for (let row = r0; row <= Math.min(r1, calendars[target].length - 1); row++) {
            for (let col = c0; col <= Math.min(c1, (calendars[target][row]?.length ?? 0) - 1); col++) {
              const kind = calendars[target][row]?.[col];
              if (kind) return r0 === r1 && c0 === c1 ? kind : "range";
            }
          }
          return null;
        };
        const cellReport = new ExcelReport();
        let formula = importFormula(expression, names, at, limits, cellReport, workbook.dateSystem, referenceCalendar);
        const kind = calendars[s][r]?.[c];
        if (kind) formula = serialToNativeDate(formula, kind === "date-or-datetime" ? "date" : kind, workbook.dateSystem);
        if (formula.length > limits.maxFormulaLength * 8) throw new ExcelFailure("limit_exceeded", "Converted date formula exceeds the conversion budget.", at);
        if (cell.value !== null) report.warn("cached_value_ignored", "Formula cache is ignored; the imported formula will be recalculated.", at);
        report.merge(cellReport.diagnostics);
        return { expression, formula };
      }
      catch (error) {
        if (error instanceof ExcelFailure) {
          Object.assign(error.diagnostic, at);
          if (policy === "preserve-text" && ["unsupported_formula", "formula_syntax", "invalid_reference"].includes(error.diagnostic.code)) {
            preserved.add(cell);
            report.warn("formula_preserved_as_text", `${error.message} Kept as text, not calculated. Dependent results may change.`, at);
            return null;
          }
        }
        throw error;
      }
    })));
    // A1 may refer to an empty cell beyond the file's used range. Materialize that
    // coordinate before constructing native sheets; never turn it into #REF!.
    const visit = (node: ExcelExpression, current: number, at: FormulaLocation): void => {
      if (node.kind === "reference") {
        const target = node.sheet === undefined ? current : names.findIndex(name => name.toLowerCase() === node.sheet!.toLowerCase());
        if (target < 0) throw new ExcelFailure("invalid_reference", "Referenced worksheet is missing.", at);
        const extent = (selector: RefSelector): number => selector.kind === "range"
          ? Math.max(...(selector.value as RefSelector[]).map(extent)) : selector.kind === "absolute" ? Number(selector.value) + 1 : 0;
        dimensions[target].rows = Math.max(dimensions[target].rows, extent(node.reference.rowSelector));
        dimensions[target].columns = Math.max(dimensions[target].columns, extent(node.reference.colSelector));
      } else if (node.kind === "binary") { visit(node.left, current, at); visit(node.right, current, at); }
      else if (node.kind === "unary") visit(node.operand, current, at);
      else if (node.kind === "call") node.args.forEach(arg => visit(arg, current, at));
      else if (node.kind === "array") node.rows.forEach(row => row.forEach(arg => visit(arg, current, at)));
    };
    parsed.forEach((rows, s) => rows.forEach((row, r) => row.forEach((node, c) => {
      if (node) visit(node.expression, s, { sheetName: names[s], rowIndex: r, colIndex: c, formula: workbook.sheets[s].rows[r][c].formula });
    })));
    checkDimensions(dimensions, limits);
    const sheets = workbook.sheets.map((sheet, s) => {
      const rows = Array.from({ length: dimensions[s].rows }, (_, r) => {
        const fields = Array.from({ length: dimensions[s].columns }, (_, c) => {
          const cell = sheet.rows[r]?.[c];
          const at = { sheetName: sheet.name, rowIndex: r, colIndex: c, ...(cell?.formula === undefined ? {} : { formula: cell.formula }) };
          if (cell && preserved.has(cell)) return escapeCellText(encodeStringLiteral(cell.formula!.startsWith("=") ? cell.formula! : `=${cell.formula}`));
          const expression = parsed[s][r]?.[c];
          if (expression) {
            return escapeCellText(`= ${expression.formula}`);
          }
          const kind = calendars[s][r]?.[c];
          if (kind && typeof cell?.value === "number") return escapeCellText(importDateLiteral(cell.value, workbook.dateSystem, kind === "date-or-datetime" ? "date" : kind, at));
          return escapeCellText(nativeLiteral(cell?.value ?? null, report, at));
        });
        return `| ${fields.join(" | ")} |`;
      });
      const imported = SheetState.fromTableRows(sheet.name, rows);
      const note = notes.get(sheet.name);
      if (note?.beforeTable) imported.setSheetNote("beforeTable", note.beforeTable);
      if (note?.afterTable) imported.setSheetNote("afterTable", note.afterTable);
      sheet.rows.forEach((row, r) => row.forEach((cell, c) => {
        if (cell.style) imported.setCellLocalStyleByIndex(r, c, cell.style);
        if (!preserved.has(cell) && (typeof cell.value === "number" || cell.formula)) {
          const kind = calendars[s][r]?.[c];
          const displayKind = kind && calendarCellKind(cell.numberFormat);
          const format = displayKind
            ? importCalendarDisplayFormat(displayKind, kind === "datetime" || cell.formula !== undefined)
            : importNumberFormat(cell.numberFormat, report, { sheetName: sheet.name, rowIndex: r, colIndex: c });
          if (format) imported.setCellLocalFormatByIndex(r, c, format);
        }
      }));
      if (imported.cells.some(row => row.some(cell => !cell.body.valid))) {
        throw new Error("Excel translator generated invalid native syntax.");
      }
      return imported;
    });
    const overrides = options.headers ?? [];
    const defaults = workbook.sheets
      .filter(sheet => !overrides.some(choice => choice?.sheetName === sheet.name))
      .map(sheet => ({ sheetName: sheet.name, headerRows: sheet.headers?.headerRows ?? 0, headerColumns: 0 }));
    try {
      return configureImportedDocument(new DocumentState(sheets), [...defaults, ...overrides]);
    } catch (error) {
      if (error instanceof ImportHeaderError) throw new ExcelFailure("invalid_options", error.message);
      throw error;
    }
  });
  return result;
}

/** Exports readable Excel formulas without native result caches; Excel recalculates. */
export async function exportExcelWorkbook(document: DocumentState, options: ExcelExportOptions = {}): Promise<ExcelResult<Uint8Array>> {
  const report = new ExcelReport();
  return report.run(async () => {
    const { limits, cellErrors, unsupportedFormulas, freezeHeaders } = excelExportOptions(options);
    checkDimensions(document.sheets.map(sheet => ({ name: sheet.name, rows: sheet.rowCount, columns: sheet.colCount })), limits);
    const snapshot = cloneDocumentState(document);
    const evaluated = snapshot.evaluate();
    const presentation = resolveDocumentPresentation(snapshot);
    if (snapshot.sheets.some(sheet => sheet.cells.some(row => row.some(cell => cell.body.valid && cell.body.kind === "formula")))) {
      report.warn("semantic_difference", "Formulas recalculate using Excel's rules; results may differ.");
    }
    if (document.frontMatter !== null) report.warn("metadata_omitted", "ORD front matter has no Excel representation.");
    const sheets = snapshot.sheets.map((sheet, s) => {
      if (sheet.sourceBlocks.filter(block => block.kind === "table").length > 1) throw new ExcelFailure("unsupported_feature", "Multiple native table blocks cannot be silently omitted.", { sheetName: sheet.name });
      if (sheet.sourceBlocks.some(block => block.kind === "note" || (block.kind === "unparsed" && block.lines.some(line => line.trim())))) report.warn("metadata_omitted", "Sheet notes and non-table content are not exported.", { sheetName: sheet.name });
      if ([...sheet.rowDisplayMetadata, ...sheet.columnDisplayMetadata].some(meta => meta && !meta.valid)) report.warn("presentation_omitted", "Invalid row/column formatting is omitted.", { sheetName: sheet.name });
      const rowStructure = resolveSheetRowStructure(sheet);
      if (sheet.headerColCount > 0 && rowStructure.some(row => row.depth > 0)) report.warn("presentation_approximated",
        "Hierarchy becomes two-space indentation in Excel; expand/collapse is not retained.", { sheetName: sheet.name });
      const rows: WorkbookCell[][] = sheet.cells.map((row, r) => row.map((cell, c) => {
        const at = { sheetName: sheet.name, rowIndex: r, colIndex: c };
        if (cell.localDisplay && !cell.localDisplay.valid) report.warn("presentation_omitted", "Invalid cell formatting is omitted.", at);
        if (r < sheet.headerRowCount || c < sheet.headerColCount) {
          let value = stripCellDisplayMetadata(sheet.logicalRows[r].cells[c] ?? "").trim();
          if (r >= sheet.bodyStart && c === 0) {
            const label = parseHierarchyLabel(value);
            value = "  ".repeat(rowStructure[r - sheet.bodyStart].depth) + label.content;
          }
          return { value };
        }
        const runtimeValue = evaluated.sheets[s].values[r - sheet.bodyStart][c];
        const numberFormat = runtimeValue.kind in temporalNumberFormats ? temporalNumberFormats[runtimeValue.kind as keyof typeof temporalNumberFormats] : undefined;
        const literalCell = ():WorkbookCell => ({value:excelValue(runtimeValue,report,at),...(numberFormat ? {numberFormat} : {})});
        if (cellErrors === "blank" && runtimeValue.kind === "error") {
          report.warn("cell_omitted", `Cell left blank (${runtimeValue.errorKind.replaceAll("_", " ")}).`, at);
          return { value: null };
        }
        try {
          if (!cell.body.valid) throw new ExcelFailure("unsupported_formula", "Invalid native input cannot be exported as an editable formula.", at);
          if (cell.body.kind === "formula") {
            let translated;
            // Only retain notices for the representation actually written. A
            // failed serial translation must not claim timezone loss when the
            // final exported static text still includes its original offset.
            const translationReport = new ExcelReport();
            try {
              translated = exportFormula(cell.body.expression, snapshot, sheet, { ...at, formula: cell.body.inputText }, limits, translationReport);
            } catch (error) {
              // Translation loss and value loss are different boundaries. A
              // calendar operand may be unrepresentable while the final text
              // is perfectly valid. Project only declared compatibility losses
              // and successful fresh results; limits/invariants still fail.
              if (unsupportedFormulas !== "value" || runtimeValue.kind === "error" || !(error instanceof ExcelFailure)
                || !["unsupported_formula", "unrepresentable_value"].includes(error.diagnostic.code)) throw error;
              const projected = literalCell();
              report.warn("formula_exported_as_value", `Formula exported as its calculated value; it will not recalculate. ${error.message}`, {...at,formula:cell.body.inputText});
              return projected;
            }
            warnTemporalPresentation(runtimeValue, translationReport, at);
            report.merge(translationReport.diagnostics);
            return { value: null, ...translated, ...(numberFormat ? {numberFormat} : {}) };
          }
          return literalCell();
        } catch (error) {
          // Only cell-local compatibility failures are omittable. Resource limits,
          // workbook structure failures and programmer errors still fail early.
          if (cellErrors !== "blank" || !(error instanceof ExcelFailure)
            || !["unsupported_formula", "formula_syntax", "invalid_reference", "unrepresentable_value", "unsupported_feature"].includes(error.diagnostic.code)) throw error;
          report.warn("cell_omitted", `Cell left blank: ${error.message}`, { ...at, formula: error.diagnostic.formula });
          return { value: null };
        }
      }));
      const displayCells: ExcelDisplayCell[][] = rows.map(row => row.map(cell => ({ text: cell.value === null ? "" : typeof cell.value === "object" ? cell.value.error : String(cell.value), numeric: typeof cell.value === "number" })));
      for (const row of presentation.sheets[s].cells) for (const cell of row) {
        if (cell.styleLayer.effective) rows[cell.rowIndex][cell.colIndex].style = cell.styleLayer.effective;
        const format = cell.formatLayer.effective;
        if (format) {
          const translated = exportNumberFormat(format);
          if (translated) rows[cell.rowIndex][cell.colIndex].numberFormat = translated;
          else report.warn("presentation_omitted", "Display format cannot be represented in this workbook; the value is retained.", { sheetName: sheet.name, rowIndex: cell.rowIndex, colIndex: cell.colIndex });
        }
        const value = evaluated.sheets[s].values[cell.rowIndex - sheet.bodyStart][cell.colIndex];
        // Omitted cells stay blank. Header labels use the exported plain label;
        // data and formulas use the existing formatter, never formula source.
        if (rows[cell.rowIndex][cell.colIndex].value === null && !rows[cell.rowIndex][cell.colIndex].formula) continue;
        if (cell.colIndex < sheet.headerColCount) continue;
        displayCells[cell.rowIndex][cell.colIndex] = { text: cell.displayText, numeric: ["number", "date", "datetime"].includes(value.kind) };
      }
      return { name: sheet.name, rows, presentation: { headerRows: sheet.headerRowCount, headerColumns: sheet.headerColCount, cells: displayCells, freezeHeaders } };
    });
    return writeXlsx({ sheets, dateSystem: 1900 }, limits);
  });
}
