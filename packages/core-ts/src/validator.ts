import { parseDocument, parseTableRow, stripDisplayControlFrame, type ParsedRow, type Table } from "./parser";
import { parseCellInput, stripCellDisplayMetadata, type ExprNode, type FunctionCall, type RuntimeValue } from "./runtime";
import { isError } from "./runtime/errors";

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;
const SECTION_RE = /^(\[+)([^\[\]]+)(\]+)$/;

export interface ValidationError {
  message: string;
  sheet?: string;
  row?: number;
  col?: number;
}

export interface SheetSummary {
  name: string;
  rowCount: number;
  columnCount: number | null;
  headerRowCount: number;
  headerColumnCount: number;
  sectionCount: number;
  maxSectionLevel: number;
}

export interface ValidationSummary {
  sheetCount: number;
  sheets: SheetSummary[];
}

export class ValidationResult {
  errors: ValidationError[] = [];
  summary: ValidationSummary = { sheetCount: 0, sheets: [] };

  get ok(): boolean {
    return this.errors.length === 0;
  }
}

export function validateDocument(text: string): ValidationResult {
  const result = new ValidationResult();
  const sheets = parseDocument(text);
  const sheetSummaries: SheetSummary[] = [];

  if (sheets.length === 0) {
    result.errors.push({ message: "Document must contain at least one sheet heading (# Name)." });
    result.summary = { sheetCount: 0, sheets: [] };
    return result;
  }

  for (const sheet of sheets) {
    if (!sheet.table) {
      result.errors.push({ message: "Sheet has no table.", sheet: sheet.name });
      sheetSummaries.push({
        name: sheet.name,
        rowCount: 0,
        columnCount: null,
        headerRowCount: 0,
        headerColumnCount: 0,
        sectionCount: 0,
        maxSectionLevel: 0,
      });
      continue;
    }

    if (sheet.hasMultipleTables) {
      result.errors.push({
        message: "Sheet contains multiple tables; exactly one table per sheet is required.",
        sheet: sheet.name,
      });
    }

    const summary = validateTable(result, sheet.name, sheet.table);
    sheetSummaries.push(summary);
  }

  result.summary = { sheetCount: sheets.length, sheets: sheetSummaries };
  return result;
}

function validateTable(result: ValidationResult, sheet: string, table: Table): SheetSummary {
  const parsedRowsAll: ParsedRow[] = table.rows.map((r) => parseTableRow(r));
  const controlFrame = stripDisplayControlFrame(parsedRowsAll);
  const parsedRows = controlFrame.rows;

  if (controlFrame.hasControlFrame) {
    validateDisplayControlFrame(result, sheet, controlFrame.controlRow);
  }

  if (parsedRows.length === 0) {
    result.errors.push({ message: "Table has no semantic rows after stripping display control frame.", sheet });
    return {
      name: sheet,
      rowCount: 0,
      columnCount: null,
      headerRowCount: 0,
      headerColumnCount: 0,
      sectionCount: 0,
      maxSectionLevel: 0,
    };
  }

  parsedRows.forEach((row, idx) => {
    const rowIndex = idx + 1;
    row.errors.forEach((err) => {
      result.errors.push({ message: `Row ${rowIndex}: ${err}.`, sheet, row: rowIndex });
    });
  });

  const widths = new Set(parsedRows.map((r) => r.cells.length));
  const columnCount = widths.size === 1 ? [...widths][0] : null;

  if (widths.size !== 1) {
    result.errors.push({ message: "Table is not rectangular.", sheet });
    const [headerRowCount, headerColumnCount] = headerCounts(parsedRows, null);
    const { sectionCount, maxLevel } = sectionStats(result, sheet, parsedRows, headerRowCount);
    return {
      name: sheet,
      rowCount: parsedRows.length,
      columnCount,
      headerRowCount,
      headerColumnCount,
      sectionCount,
      maxSectionLevel: maxLevel,
    };
  }

  const boundaryPositions = new Set(parsedRows.map((r) => r.boundary));
  if (boundaryPositions.size > 1) {
    result.errors.push({ message: "Table has inconsistent || boundary position.", sheet });
  }

  const separatorIndexes = parsedRows
    .map((row, idx) => (isSeparatorRow(row.cells) ? idx : -1))
    .filter((idx) => idx >= 0);
  if (separatorIndexes.length > 1) {
    result.errors.push({ message: "Table has multiple separator rows.", sheet });
  }
  if (separatorIndexes.length > 0 && separatorIndexes[0] === 0) {
    result.errors.push({ message: "Table separator row cannot be first row.", sheet });
  }

  const [headerRowCount, headerColumnCount] = headerCounts(parsedRows, columnCount);
  semanticCellChecks(result, sheet, parsedRows, headerRowCount);
  const { sectionCount, maxLevel } = sectionStats(result, sheet, parsedRows, headerRowCount);

  return {
    name: sheet,
    rowCount: parsedRows.length,
    columnCount,
    headerRowCount,
    headerColumnCount,
    sectionCount,
    maxSectionLevel: maxLevel,
  };
}

function validateDisplayControlFrame(
  result: ValidationResult,
  sheet: string,
  controlRow: ParsedRow | null,
): void {
  if (!controlRow) return;
  if (controlRow.cells.length === 0 || controlRow.cells[0] !== "@display") {
    result.errors.push({ message: "Invalid display control frame marker.", sheet, row: 1, col: 1 });
    return;
  }
  for (let c = 1; c < controlRow.rawCells.length; c += 1) {
    const raw = controlRow.rawCells[c];
    if (raw.trim() === "") continue;
    const parsed = parseCellInput(raw);
    const content = stripCellDisplayMetadata(raw).trim();
    if (content !== "" || parsed.display === null) {
      result.errors.push({
        message: `Row 1, col ${c + 1}: display control cell must contain only display metadata.`,
        sheet,
        row: 1,
        col: c + 1,
      });
    }
  }
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL_RE.test(cell));
}

function headerCounts(parsedRows: ParsedRow[], columnCount: number | null): [number, number] {
  const separatorIndexes = parsedRows
    .map((row, idx) => (isSeparatorRow(row.cells) ? idx : -1))
    .filter((idx) => idx >= 0);
  const headerRowCount = separatorIndexes.length > 0 ? separatorIndexes[0] : 0;

  let headerColumnCount = 0;
  if (parsedRows.length > 0) {
    const firstBoundary = parsedRows[0].boundary;
    if (firstBoundary !== null && parsedRows.every((r) => r.boundary === firstBoundary)) {
      headerColumnCount = firstBoundary;
    }
  }
  if (columnCount !== null) {
    headerColumnCount = Math.min(headerColumnCount, columnCount);
  }
  return [headerRowCount, headerColumnCount];
}

function sectionStats(
  result: ValidationResult,
  sheet: string,
  parsedRows: ParsedRow[],
  headerRowCount: number,
): { sectionCount: number; maxLevel: number } {
  const bodyStart = headerRowCount > 0 ? headerRowCount + 1 : 0;
  let stackDepth = 0;
  let sectionCount = 0;
  let maxLevel = 0;

  parsedRows.slice(bodyStart).forEach((row, offset) => {
    const rowIdx = bodyStart + offset + 1;
    const labelRaw = row.rawCells.length > 0 ? row.rawCells[0] : "";
    const marker = parseSectionMarker(labelRaw.trim());
    if (marker) {
      const level = marker[1];
      if (level > stackDepth + 1) {
        result.errors.push({
          message: `Row ${rowIdx}: section level jumps from ${stackDepth} to ${level}.`,
          sheet,
          row: rowIdx,
        });
        stackDepth = stackDepth + 1;
      } else {
        stackDepth = level;
      }
      sectionCount += 1;
      maxLevel = Math.max(maxLevel, stackDepth);
      return;
    }

    let indentLevel = indentDepth(labelRaw);
    if (indentLevel > stackDepth) {
      result.errors.push({
        message: `Row ${rowIdx}: row indentation level ${indentLevel} exceeds current section level ${stackDepth}.`,
        sheet,
        row: rowIdx,
      });
      indentLevel = stackDepth;
    }
    stackDepth = indentLevel;
  });

  return { sectionCount, maxLevel };
}

function semanticCellChecks(result: ValidationResult, sheet: string, parsedRows: ParsedRow[], headerRowCount: number): void {
  const bodyStart = headerRowCount > 0 ? headerRowCount + 1 : 0;
  parsedRows.slice(bodyStart).forEach((row, offset) => {
    const rowIdx = bodyStart + offset + 1;
    row.cells.forEach((text: string, colIdx: number) => {
      const parsed = parseCellInput(text);
      if (parsed.kind !== "formula") return;
      if (
        parsed.cached &&
        isError(parsed.cached) &&
        parsed.cached.internalKind === "invalid_cached_literal"
      ) {
        result.errors.push({
          message: `Row ${rowIdx}, col ${colIdx + 1}: invalid cached literal format.`,
          sheet,
          row: rowIdx,
        });
      }
      if (isParseErrorExpr(parsed.expression)) {
        result.errors.push({
          message: `Row ${rowIdx}, col ${colIdx + 1}: invalid formula expression.`,
          sheet,
          row: rowIdx,
        });
        return;
      }
      if (hasInvalidReference(parsed.expression)) {
        result.errors.push({
          message: `Row ${rowIdx}, col ${colIdx + 1}: invalid reference selector syntax.`,
          sheet,
          row: rowIdx,
        });
      }
    });
  });
}


function isParseErrorExpr(expr: ExprNode | null): boolean {
  if (!expr) return false;
  if (expr.kind === "literal") {
    const value = expr.value as RuntimeValue;
    return isError(value) && value.errorKind === "parse_error";
  }
  if (expr.kind === "call") {
    const call = expr.value as FunctionCall;
    return call.args.some((arg) => isParseErrorExpr(arg));
  }
  return isParseErrorExpr(expr.left ?? null) || isParseErrorExpr(expr.right ?? null);
}

function hasInvalidReference(expr: ExprNode | null): boolean {
  if (!expr) return false;
  if (expr.kind === "reference") {
    const ref = expr.value as any;
    return ref.rowSelector.kind === "invalid" || ref.colSelector.kind === "invalid";
  }
  if (expr.kind === "call") {
    const call = expr.value as FunctionCall;
    return call.args.some((arg) => hasInvalidReference(arg));
  }
  return hasInvalidReference(expr.left ?? null) || hasInvalidReference(expr.right ?? null);
}

function parseSectionMarker(label: string): [string, number] | null {
  const match = SECTION_RE.exec(label);
  if (!match) return null;
  const [opens, name, closes] = match.slice(1);
  if (opens.length !== closes.length) return null;
  return [name.trim(), opens.length];
}

function indentDepth(labelRaw: string): number {
  const leading = labelRaw.length - labelRaw.trimStart().length;
  return Math.floor(leading / 2);
}
