import { DocumentState, SheetState } from "./incremental";
import { cloneDocumentState } from "./document_clone";
import { escapeCellText, hasNonFormatFrontMatter, parseHierarchyLabel } from "./parser";
import { stripCellDisplayMetadata } from "./runtime/parse";
import type { RuntimeValue } from "./runtime/types";
import { encodeStringLiteral } from "./text_encoding";
import { encodeNumberLiteral } from "./number_encoding";
import {
  assertOptions, checkDelimitedLimit, DelimitedFailure, delimiterFor,
  encodeDelimitedRecords, parseDelimitedRecords, resolveDelimitedLimits,
  type DelimitedDiagnostic, type DelimitedDiagnosticCode, type DelimitedFormat,
  type DelimitedLimits, type DelimitedResult,
} from "./delimited_text";

export { DEFAULT_DELIMITED_LIMITS } from "./delimited_text";
export type { DelimitedDiagnostic, DelimitedDiagnosticCode, DelimitedFormat, DelimitedLimits, DelimitedResult } from "./delimited_text";

export interface DelimitedImportOptions {
  format: DelimitedFormat;
  sheetName: string;
  valueMode?: "text" | "infer";
  limits?: Partial<DelimitedLimits>;
}

export interface DelimitedExportOptions {
  format: DelimitedFormat;
  sheetName: string;
  formulaLikeText?: "reject" | "preserve";
  lineEnding?: "\r\n" | "\n";
  bom?: boolean;
  limits?: Partial<DelimitedLimits>;
}

export interface DelimitedSheetExport {
  text: string;
  format: DelimitedFormat;
  sheetName: string;
  rowCount: number;
  columnCount: number;
}

type CellLocation = { sheetName: string; rowIndex: number; colIndex: number };
type WarningLocation = Partial<CellLocation>;

class ConversionReport {
  private warnings = new Map<DelimitedDiagnosticCode, DelimitedDiagnostic & { count: number }>();

  warn(code: DelimitedDiagnosticCode, message: string, location: WarningLocation = {}): void {
    const prior = this.warnings.get(code);
    if (prior) {
      prior.count += 1;
    } else {
      this.warnings.set(code, { code, severity: "warning", message, count: 1, ...location });
    }
  }

  run<T>(operation: () => T): DelimitedResult<T> {
    try {
      const value = operation();
      return { ok: true, value, diagnostics: [...this.warnings.values()] };
    } catch (error) {
      if (!(error instanceof DelimitedFailure)) throw error;
      return { ok: false, diagnostics: [...this.warnings.values(), error.diagnostic] };
    }
  }
}

/** Import one rectangular file into a new sheet; never interpret fields as formulas. */
export function importDelimitedDocument(text: string, options: DelimitedImportOptions): DelimitedResult<DocumentState> {
  const report = new ConversionReport();
  return report.run(() => {
    assertOptions(options, ["format", "sheetName", "valueMode", "limits"]);
    delimiterFor(options.format);
    assertImportSheetName(options.sheetName);
    const mode = options.valueMode === undefined ? "text" : options.valueMode;
    if (mode !== "text" && mode !== "infer") throw new DelimitedFailure("invalid_options", "valueMode must be text or infer.");
    const limits = resolveDelimitedLimits(options.limits);
    const records = parseDelimitedRecords(text, options.format, limits);
    const rows = records.map((row, r) => {
      const cells = row.map((field, c) => {
        const location = { sheetName: options.sheetName, rowIndex: r, colIndex: c };
        const literal = mode === "infer" ? inferLiteral(field, report, location) : encodeStringLiteral(field);
        // Transport quoting and .ord quoting/escaping are separate layers.
        return escapeCellText(literal);
      });
      return `| ${cells.join(" | ")} |`;
    });
    return new DocumentState([SheetState.fromTableRows(options.sheetName, rows)]);
  });
}

const INFER_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function inferLiteral(field: string, report: ConversionReport, location: CellLocation): string {
  if (field === "true" || field === "false") {
    report.warn("types_inferred", "Fields were converted from text to numbers or booleans by explicit inference.", location);
    return field;
  }
  if (INFER_NUMBER.test(field)) {
    const value = Number(field);
    const underflow = value === 0 && /[1-9]/.test(field.split(/[eE]/, 1)[0]);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)) || underflow) {
      report.warn("numeric_text_preserved", "Numeric-looking text was retained to avoid overflow, underflow or an unsafe integer.", location);
    } else {
      report.warn("types_inferred", "Fields were converted from text to numbers or booleans by explicit inference.", location);
      return encodeNumberLiteral(value);
    }
  }
  return encodeStringLiteral(field);
}

function assertImportSheetName(name: string): void {
  if (typeof name !== "string" || name.length === 0 || name.trim() !== name || /[\u0000-\u001f\u007f\u2028\u2029]/.test(name)) {
    throw new DelimitedFailure("invalid_options", "sheetName must be nonempty, trimmed, and contain no control characters or line separators.");
  }
}

/** Export one explicitly selected sheet as evaluated data, without mutating it. */
export function exportDelimitedSheet(document: DocumentState, options: DelimitedExportOptions): DelimitedResult<DelimitedSheetExport> {
  const report = new ConversionReport();
  return report.run(() => {
    assertOptions(options, ["format", "sheetName", "formulaLikeText", "lineEnding", "bom", "limits"]);
    delimiterFor(options.format);
    if (typeof options.sheetName !== "string" || options.sheetName.length === 0) {
      throw new DelimitedFailure("invalid_options", "An exact sheetName is required.");
    }
    const policy = options.formulaLikeText === undefined ? "reject" : options.formulaLikeText;
    if (policy !== "reject" && policy !== "preserve") throw new DelimitedFailure("invalid_options", "formulaLikeText must be reject or preserve.");
    const lineEnding = options.lineEnding === undefined ? "\r\n" : options.lineEnding;
    if (lineEnding !== "\r\n" && lineEnding !== "\n") throw new DelimitedFailure("invalid_options", "lineEnding must be CRLF or LF.");
    const bom = options.bom === undefined ? false : options.bom;
    if (typeof bom !== "boolean") throw new DelimitedFailure("invalid_options", "bom must be a boolean.");
    const limits = resolveDelimitedLimits(options.limits);
    const matches = document.sheets.map((sheet, index) => ({ sheet, index })).filter(({ sheet }) => sheet.name === options.sheetName);
    if (matches.length === 0) throw new DelimitedFailure("sheet_not_found", "The selected sheet does not exist.", { sheetName: options.sheetName });
    if (matches.length !== 1) throw new DelimitedFailure("ambiguous_sheet", "The selected sheet name is not unique.", { sheetName: options.sheetName });
    const { sheet, index } = matches[0];
    const sheetLocation = { sheetName: sheet.name };
    checkDelimitedLimit(sheet.rowCount, "maxRows", limits, sheetLocation);
    checkDelimitedLimit(sheet.colCount, "maxColumns", limits, sheetLocation);
    let totalCells = 0;
    for (const dependencySheet of document.sheets) {
      totalCells += dependencySheet.rowCount * dependencySheet.colCount;
      checkDelimitedLimit(totalCells, "maxCells", limits, sheetLocation);
    }
    if (sheet.sourceBlocks.filter(block => block.kind === "table").length > 1) {
      throw new DelimitedFailure("multiple_tables", "The selected sheet contains additional table blocks that cannot be silently omitted.", sheetLocation);
    }
    if (hasNonFormatFrontMatter(document.frontMatter)) report.warn("front_matter_omitted", "Document front matter is not represented in delimited text.", sheetLocation);
    for (const block of sheet.sourceBlocks) {
      if (block.kind === "note" || (block.kind === "unparsed" && block.lines.some(line => line.trim() !== ""))) {
        report.warn("sheet_content_omitted", "Sheet notes and non-table content are omitted.", sheetLocation);
      }
    }
    for (const metadata of [...sheet.columnDisplayMetadata, ...sheet.rowDisplayMetadata]) {
      if (metadata !== null) report.warn("display_metadata_omitted", "Display metadata is omitted; values are not rounded or formatted.", sheetLocation);
    }

    const evaluation = cloneDocumentState(document).evaluate().sheets[index];
    const rows: string[][] = [];
    for (let r = 0; r < sheet.rowCount; r += 1) {
      const row: string[] = [];
      for (let c = 0; c < sheet.colCount; c += 1) {
        const location = { sheetName: sheet.name, rowIndex: r, colIndex: c };
        const cell = sheet.cells[r][c];
        if (cell.localDisplay !== null) report.warn("display_metadata_omitted", "Display metadata is omitted; values are not rounded or formatted.", location);
        let text: string;
        let isText: boolean;
        if (r < sheet.headerRowCount || c < sheet.headerColCount) {
          const raw = c < sheet.logicalRows[r].cells.length ? sheet.logicalRows[r].cells[c] : "";
          text = stripCellDisplayMetadata(raw).trim();
          if (r >= sheet.bodyStart && c === 0) {
            const label = parseHierarchyLabel(text);
            if (label.depth > 0) report.warn("hierarchy_omitted", "Hierarchy markers are removed from labels; all parent and child rows are retained.", location);
            text = label.content;
          }
          isText = true;
        } else {
          if (cell.body.valid && cell.body.kind === "formula") {
            report.warn("formulas_as_values", "Formulas are exported as freshly evaluated results, not executable formulas.", location);
          }
          const value = evaluation.values[r - sheet.bodyStart][c];
          text = exportValue(value, report, location);
          isText = value.kind === "string";
        }
        if (isText && isFormulaLikeText(text)) {
          if (policy === "reject") {
            throw new DelimitedFailure("formula_like_text", "Text may be interpreted as a formula by a spreadsheet application. Explicitly choose preserve to export it unchanged.", location);
          }
          report.warn("formula_like_text", "Formula-looking text is preserved unchanged and may execute in another spreadsheet application.", location);
        }
        checkDelimitedLimit(text.length, "maxFieldLength", limits, location);
        row.push(text);
      }
      rows.push(row);
    }
    return {
      text: encodeDelimitedRecords(rows, options.format, lineEnding, bom, limits),
      format: options.format,
      sheetName: sheet.name,
      rowCount: sheet.rowCount,
      columnCount: sheet.colCount,
    };
  });
}

function isFormulaLikeText(text: string): boolean {
  const whitespace = /^\s*/.exec(text)![0];
  return /[\t\r\n]/.test(whitespace) || /^[=+\-@＝＋－＠]/.test(text.slice(whitespace.length));
}

function exportValue(value: RuntimeValue, report: ConversionReport, location: CellLocation): string {
  if (value.kind !== "string") report.warn("types_not_preserved", "Delimited text does not retain value type tags or distinguish blank, null and empty text.", location);
  switch (value.kind) {
    case "string": return value.value;
    case "number":
      if (!Number.isFinite(value.value)) throw new DelimitedFailure("non_finite_number", "Non-finite numbers cannot be exported as data.", location);
      return Object.is(value.value, -0) ? "-0" : String(value.value);
    case "boolean": return value.value ? "true" : "false";
    case "blank": return "";
    case "null":
      report.warn("null_as_empty", "Null is represented as an empty field and cannot be distinguished from blank or empty text.", location);
      return "";
    case "date":
    case "time":
    case "datetime":
    case "duration": return value.value;
    case "error":
      report.warn("errors_as_text", "Cell errors are kept as text.", location);
      return exportErrorText(value.errorKind);
    default: return assertUnhandledValue(value);
  }
}

/** Stable English interchange labels; custom error kinds retain their identity. */
function exportErrorText(kind: string): string {
  switch (kind) {
    case "type_error": return "Type Error";
    case "parse_error": return "Parse Error";
    case "div_by_zero": return "Divide by Zero";
    case "unresolved_reference": return "Unresolved Reference";
    case "ambiguous_reference": return "Ambiguous Reference";
    case "cycle": return "Cycle";
    case "generic": return "Generic Error";
    default: return `error[${kind}]`;
  }
}

function assertUnhandledValue(value: never): never {
  throw new Error(`Unclassified runtime value in delimited export: ${JSON.stringify(value)}`);
}
