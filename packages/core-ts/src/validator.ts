import { DocumentParseError, deriveHierarchyRows, parseDocument, parseTableRow, stripDisplayControlFrame, type ParsedRow, type Sheet, type Table } from "./parser";
import {
  parseCellInput,
  stripCellDisplayMetadata,
  type Diagnostic,
  type ExprNode,
  type FunctionCall,
  type RuntimeValue,
} from "./runtime";
import { describeDisplayMetadataDiagnostic } from "./runtime/displayMetadata";
import { isError } from "./runtime/errors";

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

export interface ValidationError {
  message: string;
  sheet?: string;
  row?: number;
  col?: number;
  code?: string;
  context?: Record<string, unknown>;
}

export interface SheetSummary {
  name: string;
  rowCount: number;
  columnCount: number | null;
  headerRowCount: number;
  headerColumnCount: number;
  maxHierarchyDepth: number;
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
  let sheets: Sheet[];
  try {
    ({ sheets } = parseDocument(text));
  } catch (error) {
    if (!(error instanceof DocumentParseError)) throw error;
    result.errors.push({ code: error.code, message: error.message });
    return result;
  }
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
        maxHierarchyDepth: 0,
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

function pushValidationError(
  result: ValidationResult,
  error: ValidationError,
): void {
  result.errors.push(error);
}

function pushDiagnosticValidationError(
  result: ValidationResult,
  args: {
    sheet: string;
    row: number;
    col?: number;
    message: string;
    issue: Diagnostic;
  },
): void {
  pushValidationError(result, {
    message: args.message,
    sheet: args.sheet,
    row: args.row,
    col: args.col,
    code: args.issue.code,
    context: args.issue.context,
  });
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
      maxHierarchyDepth: 0,
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
    const { maxDepth } = hierarchyStats(result, sheet, parsedRows, headerRowCount);
    return {
      name: sheet,
      rowCount: parsedRows.length,
      columnCount,
      headerRowCount,
      headerColumnCount,
      maxHierarchyDepth: maxDepth,
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
  displayMetadataChecks(result, sheet, parsedRows, headerRowCount);
  semanticCellChecks(result, sheet, parsedRows, headerRowCount);
  const { maxDepth } = hierarchyStats(result, sheet, parsedRows, headerRowCount);

  return {
    name: sheet,
    rowCount: parsedRows.length,
    columnCount,
    headerRowCount,
    headerColumnCount,
    maxHierarchyDepth: maxDepth,
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
    if (content !== "" || parsed.localDisplay === null) {
      pushValidationError(result, {
        message: `Row 1, col ${c + 1}: display control cell must contain only display metadata.`,
        sheet,
        row: 1,
        col: c + 1,
      });
      continue;
    }
    if (parsed.localDisplay.valid === false) {
      pushDiagnosticValidationError(result, {
        message: `Row 1, col ${c + 1}: invalid display metadata (${describeDisplayMetadataDiagnostic(parsed.localDisplay.issue)}).`,
        sheet,
        row: 1,
        col: c + 1,
        issue: parsed.localDisplay.issue,
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

function hierarchyStats(
  result: ValidationResult,
  sheet: string,
  parsedRows: ParsedRow[],
  headerRowCount: number,
) : { maxDepth: number } {
  const bodyStart = headerRowCount > 0 ? headerRowCount + 1 : 0;
  const derivedRows = deriveHierarchyRows(parsedRows, bodyStart);
  let maxDepth = 0;

  derivedRows.forEach((row, offset) => {
    const rowIdx = bodyStart + offset + 1;
    if (row.rawDepth > row.depth) {
      result.errors.push({
        message: `Row ${rowIdx}: row hierarchy depth ${row.rawDepth} exceeds available parent depth ${row.depth}.`,
        sheet,
        row: rowIdx,
      });
    }
    maxDepth = Math.max(maxDepth, row.depth);
  });

  return { maxDepth };
}

function semanticCellChecks(result: ValidationResult, sheet: string, parsedRows: ParsedRow[], headerRowCount: number): void {
  const bodyStart = headerRowCount > 0 ? headerRowCount + 1 : 0;
  parsedRows.slice(bodyStart).forEach((row, offset) => {
    const rowIdx = bodyStart + offset + 1;
    row.cells.forEach((text: string, colIdx: number) => {
      const parsed = parseCellInput(text);
      if (!parsed.body.valid) {
        pushDiagnosticValidationError(result, {
          message: `Row ${rowIdx}, col ${colIdx + 1}: invalid formula expression.`,
          sheet,
          row: rowIdx,
          col: colIdx + 1,
          issue: parsed.body.issue,
        });
        return;
      }
      if (parsed.body.kind !== "formula") return;
      if (
        parsed.initialCachedValue &&
        isError(parsed.initialCachedValue) &&
        parsed.initialCachedValue.internalKind === "invalid_cached_literal"
      ) {
        pushValidationError(result, {
          message: `Row ${rowIdx}, col ${colIdx + 1}: invalid cached literal format.`,
          sheet,
          row: rowIdx,
          col: colIdx + 1,
          code: "invalid_cached_literal_format",
        });
      }
      if (hasInvalidReference(parsed.body.expression)) {
        pushValidationError(result, {
          message: `Row ${rowIdx}, col ${colIdx + 1}: invalid reference selector syntax.`,
          sheet,
          row: rowIdx,
          col: colIdx + 1,
          code: "invalid_reference_selector_syntax",
        });
      }
    });
  });
}

function displayMetadataChecks(
  result: ValidationResult,
  sheet: string,
  parsedRows: ParsedRow[],
  headerRowCount: number,
): void {
  const separatorRowIndex = headerRowCount > 0 ? headerRowCount : -1;
  parsedRows.forEach((row, rowZeroIndex) => {
    if (rowZeroIndex === separatorRowIndex) return;
    const rowIdx = rowZeroIndex + 1;
    row.cells.forEach((text: string, colIdx: number) => {
      const parsed = parseCellInput(text);
      if (parsed.localDisplay?.valid === false) {
        pushDiagnosticValidationError(result, {
          message: `Row ${rowIdx}, col ${colIdx + 1}: invalid display metadata (${describeDisplayMetadataDiagnostic(parsed.localDisplay.issue)}).`,
          sheet,
          row: rowIdx,
          col: colIdx + 1,
          issue: parsed.localDisplay.issue,
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
  if (expr.kind === "array") {
    const array = expr.value as { rows: ExprNode[][] };
    return array.rows.some((row) => row.some((element) => isParseErrorExpr(element)));
  }
  if (expr.kind === "index") {
    const index = expr.value as { target: ExprNode; axes: Array<{ kind: string; value?: ExprNode; start?: ExprNode | null; end?: ExprNode | null }> };
    return isParseErrorExpr(index.target)
      || index.axes.some((axis) => axis.kind === "scalar"
        ? isParseErrorExpr(axis.value ?? null)
        : isParseErrorExpr(axis.start ?? null) || isParseErrorExpr(axis.end ?? null));
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
  if (expr.kind === "array") {
    const array = expr.value as { rows: ExprNode[][] };
    return array.rows.some((row) => row.some((element) => hasInvalidReference(element)));
  }
  if (expr.kind === "index") {
    const index = expr.value as { target: ExprNode; axes: Array<{ kind: string; value?: ExprNode; start?: ExprNode | null; end?: ExprNode | null }> };
    return hasInvalidReference(index.target)
      || index.axes.some((axis) => axis.kind === "scalar"
        ? hasInvalidReference(axis.value ?? null)
        : hasInvalidReference(axis.start ?? null) || hasInvalidReference(axis.end ?? null));
  }
  return hasInvalidReference(expr.left ?? null) || hasInvalidReference(expr.right ?? null);
}
