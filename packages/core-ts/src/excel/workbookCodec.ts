import type { Cell, CellErrorValue, CellValue, Workbook } from "exceljs";
import { EXCEL_GRID_LIMITS, ExcelFailure, type ExcelLimits, type ExcelReport, type ExcelLocation, type UnsupportedContent } from "./contracts";
import { isExternalDataPart, isExternalDataType, isExecutablePart, isExecutableType, sanitizeXlsxImport } from "./sanitizeImport";
import { decodeXstring, encodeXstring } from "./stringEncoding";
import type { ExcelDateSystem } from "./dateTranslation";
import type { StyleSpec } from "../runtime/types";
import { exportCellStyle, importCellStyle, THEME_COLOR_NAMES } from "./styleTranslation";
import { analyzeHeaders, type HeaderAnalysis, type ExcelTableHeader } from "./headerAnalysis";
import { applyExcelCellPresentation, applyExcelHeaderMerges, applyExcelSheetLayout, resolveExcelSheetLayout, type ExcelSheetPresentation } from "./exportPresentation";

// XLSX calendar dates are numbers with formatting, not a distinct scalar type.
export type WorkbookScalar = string | number | boolean | null | { error: CellErrorValue["error"] };
export interface WorkbookCell {
  importExpression?: import("./formulaAst").ExcelExpression;
  value: WorkbookScalar;
  formula?: string;
  numberFormat?: string;
  arrayFormula?: boolean;
  style?: StyleSpec;
}
export interface WorkbookSheet { name: string; rows: WorkbookCell[][]; headers?: HeaderAnalysis; merges?: string[]; presentation?: ExcelSheetPresentation }
export interface WorkbookData { sheets: WorkbookSheet[]; dateSystem?: ExcelDateSystem }
export interface DefinedName { name: string; source: string; sheetIndex?: number }
export interface DecodedWorkbook extends WorkbookData { dateSystem: ExcelDateSystem; definedNames: DefinedName[] }

/** Lazy loading keeps Excel's container implementation out of native startup. */
async function newWorkbook(): Promise<Workbook> {
  const Excel = await import("exceljs");
  return new Excel.default.Workbook();
}

export function checkWorkbookNames(names: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (!name || name.length > 31 || name.trim() !== name || /[\u0000-\u001f\u007f\[\]:*?/\\]/.test(name) || /^'|'$/.test(name) || name.toLowerCase() === "history") {
      throw new ExcelFailure("invalid_sheet_name", `Sheet name '${name}' cannot be represented unchanged in Excel.`, { sheetName: name });
    }
    const key = name.toLowerCase();
    if (seen.has(key)) throw new ExcelFailure("invalid_sheet_name", "Excel sheet names must be unique ignoring case.", { sheetName: name });
    seen.add(key);
  }
}

/** Check actual expanded bytes incrementally, including ZIPs without size headers. */
interface ArchiveMetadata {
  definedNames: DefinedName[];
  sheetRelations: Map<string, string>;
  sheetTargets: Map<string, string>;
  cellValues: Map<string, Map<string, { type: string; text: string | null; formula: boolean }>>;
  sharedStrings: string[];
  sheetDimensions: Map<string, { rows: number; columns: number }>;
  dateSystem: ExcelDateSystem;
  themeTarget: string | null;
  themes: Map<string, Map<string, string>>;
}

export async function inspectXlsxArchive(bytes: Uint8Array, limits: Readonly<ExcelLimits>, policy: UnsupportedContent = "reject"): Promise<ArchiveMetadata> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ExcelFailure("invalid_workbook", "Expected an unencrypted .xlsx ZIP package, not a legacy .xls file.");
  }
  if (bytes.length > limits.maxInputBytes) throw new ExcelFailure("limit_exceeded", "XLSX input exceeds the byte limit.");
  const { Unzip, UnzipInflate } = await import("fflate");
  const { SaxesParser } = await import("saxes");
  const names = new Set<string>();
  const metadata: ArchiveMetadata = {
    definedNames: [],
    sheetRelations: new Map(), sheetTargets: new Map(), cellValues: new Map(),
    sharedStrings: [], dateSystem: 1900,
    sheetDimensions: new Map(),
    themeTarget: null, themes: new Map(),
  };
  let expanded = 0;
  let unfinished = 0;
  let worksheetCount = 0;
  let worksheetCells = 0;
  let serializedCells = 0;
  const preserving = policy === "preserve-text";
  try {
    const archive = new Unzip(file => {
      if (names.size >= limits.maxArchiveEntries) throw new ExcelFailure("limit_exceeded", "Too many XLSX package entries.");
      if (names.has(file.name) || file.name.startsWith("/") || file.name.split("/").includes("..") || file.name.includes("\\")) {
        throw new ExcelFailure("invalid_workbook", "Duplicate or unsafe ZIP entry name.");
      }
      names.add(file.name);
      if (!preserving && (isExecutablePart(file.name) || isExternalDataPart(file.name))) {
        throw new ExcelFailure("unsupported_feature", "Macros, external workbooks and embedded executable content are not supported.");
      }
      if ((file.originalSize ?? 0) > limits.maxExpandedBytes - expanded) {
        throw new ExcelFailure("limit_exceeded", "Expanded XLSX content exceeds the byte limit.");
      }
      unfinished += 1;
      const xml = /\.(?:xml|rels)$/i.test(file.name) ? new SaxesParser({ xmlns: false }) : null;
      let decoder: TextDecoder | null = null;
      let prefix = new Uint8Array();
      let cellAddress: string | null = null;
      let cellType = "n";
      let formulaCell = false;
      let inValue = false;
      let cellValue: string | null = null;
      let sharedString: string | null = null;
      let inlineString: string | null = null;
      let textRun: string | null = null;
      let phonetic = false;
      let stringTable = false;
      let worksheet = false;
      let theme = false;
      let inColorScheme = false;
      let themeColor: string | null = null;
      let xmlDepth = 0;
      let maxRow = 0;
      let definedName: DefinedName | null = null;
      let maxColumn = 0;
      const coordinates = new Set<string>();
      const axisIndex = (raw: string, axis: "row" | "column"): number => {
        if (!/^[1-9]\d*$/.test(raw)) throw new ExcelFailure("invalid_workbook", `Invalid worksheet ${axis} index.`);
        const value = Number(raw);
        const maximum = axis === "row" ? Math.min(preserving ? Infinity : limits.maxRows, EXCEL_GRID_LIMITS.rows)
          : Math.min(preserving ? Infinity : limits.maxColumns, EXCEL_GRID_LIMITS.columns);
        if (!Number.isSafeInteger(value) || value > maximum) throw new ExcelFailure("limit_exceeded", `Worksheet ${axis} exceeds the conversion limit.`);
        return value;
      };
      const coordinate = (address: string): { row: number; column: number } => {
        const match = /^([A-Z]+)([1-9]\d*)$/.exec(address);
        if (!match) throw new ExcelFailure("invalid_workbook", "Invalid worksheet cell coordinate.");
        let column = 0;
        for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
        if (!Number.isSafeInteger(column) || column > Math.min(preserving ? Infinity : limits.maxColumns, EXCEL_GRID_LIMITS.columns)) {
          throw new ExcelFailure("limit_exceeded", "Worksheet column exceeds the conversion limit.");
        }
        return { row: axisIndex(match[2], "row"), column };
      };
      const includeExtent = (row: number, column: number): void => {
        if (row > limits.maxRows || column > limits.maxColumns) throw new ExcelFailure("limit_exceeded", "Data coordinates exceed the configured row/column limit.");
        const previousArea = maxRow * maxColumn;
        maxRow = Math.max(maxRow, row); maxColumn = Math.max(maxColumn, column);
        worksheetCells += maxRow * maxColumn - previousArea;
        if (worksheetCells > limits.maxCells) throw new ExcelFailure("limit_exceeded", `Workbook data spans at least ${worksheetCells.toLocaleString("en-US")} cell positions; the configured limit is ${limits.maxCells.toLocaleString("en-US")}.`);
      };
      xml?.on("doctype", () => { throw new ExcelFailure("unsupported_feature", "XML document types and entity declarations are not supported."); });
      xml?.on("opentag", tag => {
        const localName = tag.name.split(":").pop();
        if (xmlDepth++ === 0) {
          stringTable = localName === "sst";
          theme = localName === "theme";
          if (localName === "worksheet") {
            worksheet = true;
            worksheetCount += 1;
            if (worksheetCount > limits.maxSheets) throw new ExcelFailure("limit_exceeded", "Too many worksheet parts.");
          }
        }
        const attrs = tag.attributes;
        if (file.name === "xl/workbook.xml" && localName === "definedName") {
          definedName = { name: String(attrs.name), source: "", ...(attrs.localSheetId === undefined ? {} : { sheetIndex: Number(attrs.localSheetId) }) };
        }
        if (theme && localName === "clrScheme") inColorScheme = true;
        if (inColorScheme && THEME_COLOR_NAMES.includes(localName!)) themeColor = localName!;
        if (themeColor && (localName === "srgbClr" || localName === "sysClr")) {
          let colors = metadata.themes.get(file.name);
          if (!colors) { colors = new Map(); metadata.themes.set(file.name, colors); }
          colors.set(themeColor, String(localName === "srgbClr" ? attrs.val : attrs.lastClr));
        }
        const type = String(attrs.Type ?? attrs.ContentType ?? "");
        if (file.name === "xl/workbook.xml" && localName === "workbookPr") {
          const flag = attrs.date1904;
          if (flag !== undefined && !["0", "1", "true", "false"].includes(String(flag))) {
            throw new ExcelFailure("invalid_workbook", "Invalid workbook date system flag.");
          }
          metadata.dateSystem = flag === "1" || flag === "true" ? 1904 : 1900;
        }
        if (file.name === "xl/workbook.xml" && localName === "sheet") {
          metadata.sheetRelations.set(String(attrs.name), String(attrs["r:id"]));
        }
        if (file.name === "xl/_rels/workbook.xml.rels" && localName === "Relationship" && (type.endsWith("/worksheet") || type.endsWith("/theme"))) {
          const target = String(attrs.Target);
          const parts: string[] = [];
          for (const part of (target.startsWith("/") ? target.slice(1) : `xl/${target}`).split("/")) {
            if (part === "..") parts.pop();
            else if (part && part !== ".") parts.push(part);
          }
          if (type.endsWith("/theme")) metadata.themeTarget = parts.join("/");
          else metadata.sheetTargets.set(String(attrs.Id), parts.join("/"));
        }
        if (worksheet && localName === "c") {
          cellAddress = String(attrs.r ?? "");
          if (coordinates.has(cellAddress)) throw new ExcelFailure("invalid_workbook", "Duplicate worksheet cell coordinate.");
          const { row, column } = coordinate(cellAddress);
          if (++serializedCells > limits.maxCells) throw new ExcelFailure("limit_exceeded", "Serialized cell count exceeds the conversion limit.");
          if (!preserving) includeExtent(row, column);
          coordinates.add(cellAddress);
          cellType = String(attrs.t ?? "n");
          formulaCell = false;
          cellValue = null;
          inlineString = cellType === "inlineStr" ? "" : null;
        } else if (cellAddress !== null && localName === "v") { inValue = true; cellValue = ""; }
        else if (cellAddress !== null && localName === "f") formulaCell = true;
        // The adapter materializes these even without any serialized cell value:
        // merge ranges create every covered cell; col spans allocate columns;
        // a high row index extends its sparse row array. Bound them before load.
        if (worksheet && localName === "mergeCell") {
          const endpoints = String(attrs.ref ?? "").split(":");
          if (endpoints.length < 1 || endpoints.length > 2) throw new ExcelFailure("invalid_workbook", "Invalid merged-cell range.");
          const first = coordinate(endpoints[0]), last = coordinate(endpoints[endpoints.length - 1]);
          if (first.row > last.row || first.column > last.column) throw new ExcelFailure("invalid_workbook", "Reversed merged-cell range.");
          if (!preserving) includeExtent(last.row, last.column);
        }
        if (worksheet && localName === "row") {
          const row = axisIndex(String(attrs.r ?? ""), "row");
          if (!preserving) includeExtent(row, 0);
        }
        if (worksheet && localName === "col") {
          const min = axisIndex(String(attrs.min ?? ""), "column");
          const max = axisIndex(String(attrs.max ?? ""), "column");
          if (min > max) throw new ExcelFailure("invalid_workbook", "Reversed worksheet column span.");
        }
        if (stringTable && localName === "si") sharedString = "";
        if (localName === "rPh") phonetic = true;
        if (localName === "t" && !phonetic && (sharedString !== null || inlineString !== null)) textRun = "";
        if (!preserving && (localName === "Relationship" || localName === "Override" || localName === "Default") &&
            (isExecutableType(type) || /macroEnabled/i.test(type) || isExternalDataType(type) ||
             (attrs.TargetMode === "External" && !type.endsWith("/hyperlink")))) {
          throw new ExcelFailure("unsupported_feature", "Executable, linked or external workbook content is not supported.");
        }
      });
      const appendText = (text: string) => {
        if (definedName) definedName.source += text;
        if (inValue) cellValue += text;
        if (textRun !== null) textRun += text;
      };
      xml?.on("text", appendText);
      xml?.on("cdata", appendText);
      xml?.on("closetag", tag => {
        xmlDepth -= 1;
        const localName = tag.name.split(":").pop();
        if (localName === "definedName" && definedName) { metadata.definedNames.push(definedName); definedName = null; }
        if (localName === themeColor) themeColor = null;
        if (localName === "clrScheme") inColorScheme = false;
        if (localName === "v") inValue = false;
        if (localName === "t" && textRun !== null) {
          if (sharedString !== null) sharedString += decodeXstring(textRun);
          if (inlineString !== null) inlineString += decodeXstring(textRun);
          textRun = null;
        }
        if (localName === "rPh") phonetic = false;
        if (localName === "si" && sharedString !== null) {
          metadata.sharedStrings.push(sharedString);
          sharedString = null;
        }
        if (worksheet && localName === "c") {
          const text = inlineString ?? cellValue;
          if (cellAddress !== null) {
            if (preserving && (formulaCell || text !== null)) {
              const { row, column } = coordinate(cellAddress);
              includeExtent(row, column);
            }
            let values = metadata.cellValues.get(file.name);
            if (!values) { values = new Map(); metadata.cellValues.set(file.name, values); }
            values.set(cellAddress, { type: cellType, text, formula: formulaCell });
          }
          cellAddress = null;
          inlineString = null;
        }
        if (worksheet && xmlDepth === 0) metadata.sheetDimensions.set(file.name, { rows: maxRow, columns: maxColumn });
      });
      file.ondata = (error, data, final) => {
        if (error) throw error;
        expanded += data.length;
        if (expanded > limits.maxExpandedBytes) throw new ExcelFailure("limit_exceeded", "Expanded XLSX content exceeds the byte limit.");
        if (xml) {
          if (!decoder) {
            const initial = new Uint8Array(prefix.length + data.length);
            initial.set(prefix); initial.set(data, prefix.length);
            if (initial.length < 4 && !final) { prefix = initial; return; }
            // XML's BOM/signature determines encoding. This is not lossy retry decoding.
            const encoding = initial[0] === 0xff && initial[1] === 0xfe || initial[0] === 0x3c && initial[1] === 0
              ? "utf-16le" : initial[0] === 0xfe && initial[1] === 0xff || initial[0] === 0 && initial[1] === 0x3c ? "utf-16be" : "utf-8";
            decoder = new TextDecoder(encoding, { fatal: true });
            data = initial;
          }
          xml.write(decoder.decode(data, { stream: !final }));
          if (final) xml.close();
        }
        if (final) unfinished -= 1;
      };
      file.start();
    });
    archive.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      archive.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
    }
    if (unfinished !== 0 || !names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) {
      throw new ExcelFailure("invalid_workbook", "Incomplete or non-spreadsheet ZIP package.");
    }
  } catch (error) {
    if (error instanceof ExcelFailure) throw error;
    throw new ExcelFailure("invalid_workbook", "Cannot decode the XLSX ZIP/XML package.");
  }
  return metadata;
}

function scalar(value: CellValue | undefined, location: ExcelLocation, report: ExcelReport): WorkbookScalar {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ExcelFailure("unrepresentable_value", "Non-finite spreadsheet number.", location);
    return value;
  }
  if (typeof value === "object" && "error" in value) return { error: value.error };
  if (typeof value === "object" && "richText" in value) {
    report.warn("presentation_omitted", "Rich text styling was flattened to text.", location);
    return value.richText.map(run => run.text).join("");
  }
  if (typeof value === "object" && "hyperlink" in value) {
    report.warn("metadata_omitted", "Hyperlink target was omitted; visible text is retained.", location);
    return value.text;
  }
  throw new ExcelFailure("unsupported_feature", "Unsupported spreadsheet cell value.", location);
}

export async function readXlsx(bytes: Uint8Array, limits: Readonly<ExcelLimits>, report: ExcelReport, policy: UnsupportedContent = "reject"): Promise<DecodedWorkbook> {
  let metadata = await inspectXlsxArchive(bytes, limits, policy);
  const input = policy === "preserve-text" ? await sanitizeXlsxImport(bytes, metadata.sheetDimensions, report) : bytes;
  // Check the transformed package with the strict allocation and link rules too.
  if (policy === "preserve-text") metadata = await inspectXlsxArchive(input, limits);
  const workbook = await newWorkbook();
  try {
    await workbook.xlsx.load(input.slice().buffer);
  } catch {
    throw new ExcelFailure("invalid_workbook", "The XLSX workbook could not be read.");
  }
  if (workbook.worksheets.length === 0) throw new ExcelFailure("invalid_workbook", "A workbook must contain at least one worksheet.");
  if (workbook.worksheets.length > limits.maxSheets) throw new ExcelFailure("limit_exceeded", "Too many worksheets.");
  checkWorkbookNames(workbook.worksheets.map(sheet => sheet.name));
  // These reserved names configure sheet presentation; they are not formula variables.
  const presentationNames = new Set(["_xlnm._FilterDatabase", "_xlnm.Print_Area", "_xlnm.Print_Titles"]);
  for (const definition of metadata.definedNames) {
    if (presentationNames.has(definition.name)) report.warn("metadata_omitted", "Print areas, print titles and saved filters are not retained.");
  }
  let cells = 0;
  const sheets: WorkbookSheet[] = [];
  for (const sheet of workbook.worksheets) {
    const location = { sheetName: sheet.name };
    const relation = metadata.sheetRelations.get(sheet.name);
    const target = relation === undefined ? undefined : metadata.sheetTargets.get(relation);
    if (target === undefined) throw new ExcelFailure("invalid_workbook", "Worksheet relationship is missing.", location);
    const rawValues = metadata.cellValues.get(target);
    const dimensions = metadata.sheetDimensions.get(target);
    if (!dimensions) throw new ExcelFailure("invalid_workbook", "Worksheet part is missing.", location);
    const rowCount = Math.max(sheet.rowCount, dimensions.rows);
    const columnCount = Math.max(sheet.columnCount, dimensions.columns);
    cells += rowCount * columnCount;
    if (rowCount > limits.maxRows || columnCount > limits.maxColumns || cells > limits.maxCells) {
      throw new ExcelFailure("limit_exceeded", "Worksheet dimensions exceed the conversion limit.", location);
    }
    if (sheet.model.merges.length) report.warn("presentation_omitted", "Merged cells are imported as a master value and empty covered cells.", location);
    if (sheet.state !== "visible") report.warn("presentation_omitted", "Hidden sheet state is not retained; its data is included.", location);
    if (sheet.columns?.some(column => column.width !== undefined)) report.warn("presentation_omitted", "Excel column widths are replaced by content-based sizing.", location);
    const rows: WorkbookCell[][] = Array.from({ length: rowCount }, () =>
      Array.from({ length: columnCount }, () => ({ value: null })));
    // ExcelJS has no column array for an empty worksheet.
    let styled = sheet.columns?.some(column => column.hidden || column.outlineLevel) ?? false;
    sheet.eachRow(row => {
      if (row.hidden || row.outlineLevel) styled = true;
    });
    const themeColors = metadata.themeTarget === null ? new Map<string, string>() : metadata.themes.get(metadata.themeTarget) ?? new Map<string, string>();
    // Iterate serialized cells, not the adapter's nonempty-cell iterator: some
    // readers discard typed empty inline strings and empty string caches.
    for (const [address, raw] of rawValues ?? []) {
      const cell = sheet.getCell(address);
      const at = { ...location, rowIndex: Number(cell.row) - 1, colIndex: Number(cell.col) - 1 };
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      if (cell.note) report.warn("metadata_omitted", "Cell comment was omitted.", at);
      const value = cell.value;
      if (raw.formula && !(typeof value === "object" && value !== null && ("formula" in value || "sharedFormula" in value))) {
        throw new ExcelFailure("invalid_workbook", "Formula source could not be resolved; cached results will not be substituted.", at);
      }
      const readValue = (value: CellValue | undefined): WorkbookScalar => {
        // Formatting must not change the value's type. In particular Date
        // objects lose serial 60 (1900-02-29) and sub-millisecond precision.
        if (raw.type === "n" && raw.text !== null) {
          if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.text) || !Number.isFinite(Number(raw.text))) {
            throw new ExcelFailure("unrepresentable_value", "Invalid or non-finite spreadsheet number.", at);
          }
          return Number(raw.text);
        }
        // Keep presentation diagnostics from the adapter, but use the XML
        // lexical value as the single source of truth for all string storage.
        if (value && typeof value === "object" && ("richText" in value || "hyperlink" in value)) scalar(value, at, report);
        if (raw.type === "str" && raw.text !== null) return decodeXstring(raw.text);
        if (raw.type === "b" && raw.text !== null) {
          if (raw.text !== "0" && raw.text !== "1") throw new ExcelFailure("invalid_workbook", "Invalid spreadsheet boolean.", at);
          return raw.text === "1";
        }
        if (raw.type === "e" && raw.text !== null) {
          if (!["#N/A", "#REF!", "#NAME?", "#DIV/0!", "#NULL!", "#VALUE!", "#NUM!"].includes(raw.text)) throw new ExcelFailure("unsupported_feature", `Unknown spreadsheet error: ${raw.text}.`, at);
          return {error: raw.text as CellErrorValue["error"]};
        }
        if (raw.type === "inlineStr" && raw.text !== null) return raw.text;
        if (raw.type === "s" && raw.text !== null) {
          const index = Number(raw.text);
          if (!/^\d+$/.test(raw.text) || !Number.isSafeInteger(index) || index >= metadata.sharedStrings.length) {
            throw new ExcelFailure("invalid_workbook", "Shared string index has no table entry.", at);
          }
          return metadata.sharedStrings[index];
        }
        if (raw.type === "d") throw new ExcelFailure("unsupported_feature", "This ISO-encoded date cell is not supported by the XLSX adapter.", at);
        const decoded = scalar(value, at, report);
        return decoded;
      };
      if (typeof value === "object" && value !== null && ("formula" in value || "sharedFormula" in value)) {
        const model = cell.model as Cell["model"] & { shareType?: string; ref?: string };
        if (model.shareType === "array" && model.ref !== cell.address && model.ref !== `${cell.address}:${cell.address}`) {
          throw new ExcelFailure("unsupported_feature", "Multi-cell array/spill formulas cannot be imported as independent cells.", at);
        }
        let formula: string;
        try { formula = decodeXstring(cell.formula); } catch { throw new ExcelFailure("invalid_workbook", "Invalid shared formula master.", at); }
        if (!formula) throw new ExcelFailure("invalid_workbook", "A formula cell has no formula source.", at);
        rows[at.rowIndex][at.colIndex] = { formula, value: readValue(cell.result), numberFormat: cell.numFmt };
      } else {
        rows[at.rowIndex][at.colIndex] = { value: readValue(value), numberFormat: cell.numFmt };
      }
      const style = importCellStyle(cell.style, themeColors, report, at);
      if (style) rows[at.rowIndex][at.colIndex].style = style;
    }
    if (styled) report.warn("presentation_omitted", "Hidden rows, columns and outlines are not retained by the core import.", location);
    // ExcelJS's getTables declaration incorrectly describes tuples. Keep this
    // container-specific model detail inside the adapter.
    const tables = (sheet.getTables() as unknown as Array<{ model: { tableRef: string; headerRow: boolean } }>);
    const tableHeaders: ExcelTableHeader[] = tables.map(({ model }) => ({ range: model.tableRef, headerRow: model.headerRow }));
    sheets.push({ name: sheet.name, rows, headers: analyzeHeaders(rows, tableHeaders), merges:sheet.model.merges });
  }
  return { sheets, dateSystem: metadata.dateSystem, definedNames: metadata.definedNames.filter(name => !presentationNames.has(name.name)) };
}

export async function writeXlsx(data: WorkbookData, limits: Readonly<ExcelLimits>): Promise<Uint8Array> {
  checkWorkbookNames(data.sheets.map(sheet => sheet.name));
  if (data.sheets.length === 0 || data.sheets.length > limits.maxSheets) throw new ExcelFailure("limit_exceeded", "Invalid worksheet count.");
  const workbook = await newWorkbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.properties.date1904 = data.dateSystem === 1904;
  let count = 0;
  for (const source of data.sheets) {
    const columns = source.rows[0]?.length ?? 0;
    count += source.rows.length * columns;
    if (source.rows.length > Math.min(limits.maxRows, EXCEL_GRID_LIMITS.rows) || columns > Math.min(limits.maxColumns, EXCEL_GRID_LIMITS.columns) || count > limits.maxCells) throw new ExcelFailure("limit_exceeded", "Worksheet dimensions exceed the conversion limit.");
    const sheet = workbook.addWorksheet(source.name);
    if (source.presentation) applyExcelSheetLayout(sheet, source.presentation, resolveExcelSheetLayout(source.presentation, source.rows.length, columns));
    source.rows.forEach((row, r) => {
      if (row.length !== columns) throw new Error("Workbook adapter requires rectangular rows.");
      row.forEach((input, c) => {
        const cell = sheet.getCell(r + 1, c + 1);
        const raw = input.value;
        if (typeof raw === "number" && !Number.isFinite(raw)) throw new ExcelFailure("unrepresentable_value", "Non-finite spreadsheet number.");
        if (typeof raw === "string" && raw.length > 32_767) throw new ExcelFailure("limit_exceeded", "Excel cell text exceeds 32767 UTF-16 units.", { sheetName: source.name, rowIndex: r, colIndex: c });
        const value = typeof raw === "string" ? encodeXstring(raw) : raw;
        if (input.formula !== undefined) {
          if (input.formula.length > limits.maxFormulaLength) throw new ExcelFailure("limit_exceeded", "Generated Excel formula exceeds the length limit.", { sheetName: source.name, rowIndex: r, colIndex: c });
          cell.value = { formula: encodeXstring(input.formula), ...(value === null ? {} : { result: value }), ...(input.arrayFormula ? { shareType: "array", ref: cell.address } : {}) };
        } else cell.value = value;
        if (input.numberFormat !== undefined) cell.numFmt = input.numberFormat;
        if (input.style) Object.assign(cell.style, exportCellStyle(input.style));
        if (source.presentation) applyExcelCellPresentation(cell, source.presentation, r, c);
      });
    });
    if (source.presentation) applyExcelHeaderMerges(sheet, source.presentation);
  }
  const output = new Uint8Array(await workbook.xlsx.writeBuffer());
  if (output.length > limits.maxInputBytes) throw new ExcelFailure("limit_exceeded", "Generated XLSX exceeds the byte limit.");
  // Apply the same package budgets in both directions. Compression alone must
  // not allow output which immediately exceeds its configured import limits.
  await inspectXlsxArchive(output, limits);
  return output;
}
