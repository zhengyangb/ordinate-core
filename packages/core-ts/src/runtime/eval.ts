import { deriveHierarchyRows, parseDocument, parseTableRow, stripDisplayControlFrame, type ParsedRow } from "../parser";
import { parseCellInput, stripCellDisplayMetadata } from "./parse";
import {
  type EvaluationResult,
  type ExprNode,
  type FunctionCall,
  type ReferenceExpr,
  type RefSelector,
  type RuntimeValue,
  type SheetEvaluation,
  type BooleanRuntimeValue,
  type ViewSelection,
} from "./types";
import { isError, makeInternalError, runtimeErrorFromDiagnostic } from "./errors";

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

// Evaluate a full document into runtime values.
export function evaluateDocument(text: string): EvaluationResult {
  const parsed = parseDocument(text);
  const sheetEvals: SheetEvaluation[] = [];
  for (const sheet of parsed) {
    if (!sheet.table) {
      sheetEvals.push({ name: sheet.name, rowPaths: [], colLabels: [], values: [] });
      continue;
    }
    sheetEvals.push(evaluateSheet(sheet.name, sheet.table.rows));
  }
  return { sheets: sheetEvals };
}

// Evaluate a single sheet (table rows only).
function evaluateSheet(name: string, rows: string[]): SheetEvaluation {
  const parsedRows: ParsedRow[] = rows.map((r) => parseTableRow(r));
  const semanticRows = stripDisplayControlFrame(parsedRows).rows;
  if (semanticRows.length === 0) {
    return { name, rowPaths: [], colLabels: [], values: [] };
  }

  const separatorIndex = separatorRowIndex(semanticRows);
  const logicalRows: ParsedRow[] = semanticRows.filter((_, idx) => idx !== separatorIndex);
  if (logicalRows.length === 0) {
    return { name, rowPaths: [], colLabels: [], values: [] };
  }

  const colCount = logicalRows.reduce((m, r) => Math.max(m, r.cells.length), 0);
  const headerRowCount = headerRowCountFrom(semanticRows);
  const headerColCount = headerColCountFrom(logicalRows);
  const bodyStart = headerRowCount > 0 ? headerRowCount : 0;

  const allCells: string[][] = [];
  for (const row of logicalRows) {
    const cells = [...row.cells];
    if (cells.length < colCount) {
      cells.push(...Array(colCount - cells.length).fill(""));
    }
    allCells.push(cells);
  }

  const colLabels: string[] = [];
  for (let c = 0; c < colCount; c += 1) {
    if (headerRowCount > 0) {
      const headerRow = logicalRows[headerRowCount - 1];
      const rawHeader = c < headerRow.rawCells.length ? headerRow.rawCells[c] : "";
      const label = stripCellDisplayMetadata(rawHeader).trim();
      if (label !== "") {
        colLabels.push(label);
        continue;
      }
    }
    {
      colLabels.push(`C${c + 1}`);
    }
  }

  const { rowPaths } = buildBodyRows(logicalRows, bodyStart);
  const rowKeys = buildRowKeys(logicalRows, bodyStart);
  const rowMap = new Map<string, number[]>();
  rowKeys.forEach((key, offset) => {
    const absIdx = bodyStart + offset;
    const k = JSON.stringify(key);
    const list = rowMap.get(k) ?? [];
    list.push(absIdx);
    rowMap.set(k, list);
  });

  const colMap = new Map<string, number[]>();
  colLabels.forEach((label, idx) => {
    const list = colMap.get(label) ?? [];
    list.push(idx);
    colMap.set(label, list);
  });

  const bodyRowCount = logicalRows.length - bodyStart;
  const dataRowIndices = computeDataRowIndices(logicalRows, bodyStart);
  const dataColIndices = Array.from({ length: colCount - headerColCount }, (_, i) => i + headerColCount);

  const states = new Map<string, string>();
  const memo = new Map<string, RuntimeValue>();

  // Evaluate a single cell with memoization and cycle detection.
  const evalCell = (rAbs: number, c: number): RuntimeValue => {
    const key = `${rAbs},${c}`;
    const state = states.get(key);
    if (state === "visiting") {
      return makeInternalError("cycle");
    }
    if (state === "done") {
      return memo.get(key) ?? { kind: "blank", value: null };
    }

    states.set(key, "visiting");
    const cellText = rAbs >= 0 && rAbs < allCells.length && c >= 0 && c < colCount ? allCells[rAbs][c] : "";
    const parsedCell = parseCellInput(cellText);
    const body = parsedCell.body;

    let value: RuntimeValue;
    if (!body.valid) {
      value = runtimeErrorFromDiagnostic(body.issue);
    } else if (body.kind === "literal") {
      value = body.literal;
    } else {
      value = evalExpr(
        body.expression,
        rAbs,
        c,
        evalCell,
        rowMap,
        colMap,
        logicalRows.length,
        colCount,
        bodyStart,
        bodyRowCount,
        dataRowIndices,
        dataColIndices,
      );
    }

    states.set(key, "done");
    memo.set(key, value);
    return value;
  };

  const values: RuntimeValue[][] = [];
  for (let rAbs = bodyStart; rAbs < logicalRows.length; rAbs += 1) {
    values.push(Array.from({ length: colCount }, (_, c) => evalCell(rAbs, c)));
  }

  return { name, rowPaths, colLabels, values };
}

// Evaluate an expression AST node.
export function evalExpr(
  node: ExprNode | null,
  rowIdx: number,
  colIdx: number,
  evalCell: (r: number, c: number) => RuntimeValue,
  rowMap: Map<string, number[]>,
  colMap: Map<string, number[]>,
  rowCount: number,
  colCount: number,
  bodyStart: number,
  bodyRowCount: number,
  dataRowIndices: number[],
  dataColIndices: number[],
  rowIdToIndex?: Map<number, number>,
  colIdToIndex?: Map<number, number>,
): RuntimeValue {
  if (!node) {
    return makeInternalError("parse_expression_empty");
  }

  if (node.kind === "literal") {
    return node.value as RuntimeValue;
  }

  if (node.kind === "reference") {
    const ref = node.value as ReferenceExpr;
    const resolved = selectViewDetailed(
      ref,
      rowIdx,
      colIdx,
      rowMap,
      colMap,
      rowCount,
      colCount,
      bodyStart,
      bodyRowCount,
      dataRowIndices,
      dataColIndices,
      rowIdToIndex,
      colIdToIndex,
    );
    if (!resolved.ok) {
      return makeInternalError(resolved.internalKind, resolved.context);
    }
    const view = resolved.view;
    if (view.rowIndices.length !== 1 || view.colIndices.length !== 1) {
      return makeInternalError("invalid_view");
    }
    return evalCell(view.rowIndices[0], view.colIndices[0]);
  }

  if (node.kind === "call") {
    const call = node.value as FunctionCall;
    return evalFunctionCall(
      call,
      rowIdx,
      colIdx,
      evalCell,
      rowMap,
      colMap,
      rowCount,
      colCount,
      bodyStart,
      bodyRowCount,
      dataRowIndices,
      dataColIndices,
      rowIdToIndex,
      colIdToIndex,
    );
  }

  if (node.kind === "unary") {
    const op = node.value as string;
    const right = evalExpr(
      node.right ?? null,
      rowIdx,
      colIdx,
      evalCell,
      rowMap,
      colMap,
      rowCount,
      colCount,
      bodyStart,
      bodyRowCount,
      dataRowIndices,
      dataColIndices,
      rowIdToIndex,
      colIdToIndex,
    );
    if (isError(right)) {
      return right;
    }
    if (op === "-") {
      if (right.kind === "number") {
        return { kind: "number", value: -(right.value as number) };
      }
      if (right.kind === "blank") {
        return { kind: "blank", value: null };
      }
      return makeInternalError("invalid_unary", { operator: op, rightKind: right.kind });
    }
    return makeInternalError("invalid_unary", { operator: op, rightKind: right.kind });
  }

  const left = evalExpr(
    node.left ?? null,
    rowIdx,
    colIdx,
    evalCell,
    rowMap,
    colMap,
    rowCount,
    colCount,
    bodyStart,
    bodyRowCount,
    dataRowIndices,
    dataColIndices,
    rowIdToIndex,
    colIdToIndex,
  );
  const right = evalExpr(
    node.right ?? null,
    rowIdx,
    colIdx,
    evalCell,
    rowMap,
    colMap,
    rowCount,
    colCount,
    bodyStart,
    bodyRowCount,
    dataRowIndices,
    dataColIndices,
    rowIdToIndex,
    colIdToIndex,
  );
  if (isError(left)) return left;
  if (isError(right)) return right;

  const op = node.value as string;
  if (["+", "-", "*", "/"].includes(op)) {
    return evalArithmetic(op, left, right);
  }
  if (["==", "!="].includes(op)) {
    return evalEquality(op, left, right);
  }
  if (["<", "<=", ">", ">="].includes(op)) {
    return evalOrdering(op, left, right);
  }
  return makeInternalError("unknown_operator", { operator: String(node.value ?? "") });
}

// Evaluate arithmetic with RFC-0006 coercion rules.
function evalArithmetic(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (left.kind === "blank" && right.kind === "blank") {
    if (op === "+" || op === "-" || op === "*") {
      return { kind: "blank", value: null };
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "string" && right.kind === "string") {
    if (op === "+") {
      return { kind: "string", value: String(left.value) + String(right.value) };
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "blank" && right.kind === "string") {
    if (op === "+") {
      return { kind: "string", value: String(right.value) };
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "string" && right.kind === "blank") {
    if (op === "+") {
      return { kind: "string", value: String(left.value) };
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "blank" && right.kind === "number") {
    if (op === "/") {
      return { kind: "number", value: 0 };
    }
    if (op === "+" || op === "-" || op === "*") {
      return evalNumberOp(op, 0, right.value as number);
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "number" && right.kind === "blank") {
    if (op === "/") {
      return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
    }
    if (op === "+" || op === "-" || op === "*") {
      return evalNumberOp(op, left.value as number, 0);
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "boolean" && right.kind === "number") {
    return evalNumberOp(op, boolToNumber(left), right.value as number);
  }

  if (left.kind === "number" && right.kind === "boolean") {
    return evalNumberOp(op, left.value as number, boolToNumber(right));
  }

  if (left.kind === "boolean" && right.kind === "boolean") {
    return evalNumberOp(op, boolToNumber(left), boolToNumber(right));
  }

  if (left.kind === "number" && right.kind === "number") {
    return evalNumberOp(op, left.value as number, right.value as number);
  }

  return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
}

// Perform a numeric arithmetic operation.
function evalNumberOp(op: string, left: number, right: number): RuntimeValue {
  if (op === "+") return { kind: "number", value: left + right };
  if (op === "-") return { kind: "number", value: left - right };
  if (op === "*") return { kind: "number", value: left * right };
  if (right === 0) return makeInternalError("divide_by_zero");
  return { kind: "number", value: left / right };
}

// Convert a boolean value to a number.
function boolToNumber(value: BooleanRuntimeValue): number {
  return value.value ? 1 : 0;
}

// Evaluate equality/inequality comparisons.
function evalEquality(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (left.kind === "error" || right.kind === "error") {
    return makeInternalError("invalid_comparison_error_operand", { operator: op });
  }
  if (left.kind === "blank" && right.kind === "blank") {
    return { kind: "boolean", value: op === "==" };
  }
  if (left.kind === "blank" || right.kind === "blank") {
    return { kind: "boolean", value: op === "!=" };
  }
  if (left.kind === "null" && right.kind === "null") {
    return { kind: "boolean", value: op === "==" };
  }
  if (left.kind === "null" || right.kind === "null") {
    return makeInternalError("invalid_comparison", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }
  if (left.kind !== right.kind) {
    return makeInternalError("invalid_comparison", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }
  const result = left.value === right.value;
  return { kind: "boolean", value: op === "==" ? result : !result };
}

// Evaluate ordering comparisons.
function evalOrdering(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (left.kind === "error" || right.kind === "error") {
    return makeInternalError("invalid_comparison_error_operand", { operator: op });
  }
  if (left.kind !== "number" || right.kind !== "number") {
    return makeInternalError("invalid_comparison", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }
  if (op === "<") return { kind: "boolean", value: (left.value as number) < (right.value as number) };
  if (op === "<=") return { kind: "boolean", value: (left.value as number) <= (right.value as number) };
  if (op === ">") return { kind: "boolean", value: (left.value as number) > (right.value as number) };
  if (op === ">=") return { kind: "boolean", value: (left.value as number) >= (right.value as number) };
  return makeInternalError("invalid_comparison", { operator: op, leftKind: left.kind, rightKind: right.kind });
}

// Resolve a reference expression into a view selection.
export function selectView(
  ref: ReferenceExpr,
  rowIdx: number,
  colIdx: number,
  rowMap: Map<string, number[]>,
  colMap: Map<string, number[]>,
  rowCount: number,
  colCount: number,
  bodyStart: number,
  bodyRowCount: number,
  dataRowIndices: number[],
  dataColIndices: number[],
  rowIdToIndex?: Map<number, number>,
  colIdToIndex?: Map<number, number>,
): ViewSelection | null {
  const resolved = selectViewDetailed(
    ref,
    rowIdx,
    colIdx,
    rowMap,
    colMap,
    rowCount,
    colCount,
    bodyStart,
    bodyRowCount,
    dataRowIndices,
    dataColIndices,
    rowIdToIndex,
    colIdToIndex,
  );
  return resolved.ok ? resolved.view : null;
}

type AxisResolution =
  | { ok: true; indices: number[] }
  | { ok: false; internalKind: string; context: Record<string, unknown> };

type ScalarResolution =
  | { ok: true; index: number }
  | { ok: false; internalKind: string; context: Record<string, unknown> };

type ViewResolution =
  | { ok: true; view: ViewSelection }
  | { ok: false; internalKind: string; context: Record<string, unknown> };

function selectViewDetailed(
  ref: ReferenceExpr,
  rowIdx: number,
  colIdx: number,
  rowMap: Map<string, number[]>,
  colMap: Map<string, number[]>,
  rowCount: number,
  colCount: number,
  bodyStart: number,
  bodyRowCount: number,
  dataRowIndices: number[],
  dataColIndices: number[],
  rowIdToIndex?: Map<number, number>,
  colIdToIndex?: Map<number, number>,
): ViewResolution {
  const rowIndices = resolveAxisSelector(
    ref.rowSelector,
    rowIdx,
    rowMap,
    rowCount,
    dataRowIndices,
    [bodyStart, bodyRowCount],
    (path) => JSON.stringify(path),
    rowIdToIndex,
  );
  if (!rowIndices.ok) return rowIndices;
  const colIndices = resolveAxisSelector(
    ref.colSelector,
    colIdx,
    colMap,
    colCount,
    dataColIndices,
    null,
    (path) => path.join("."),
    colIdToIndex,
  );
  if (!colIndices.ok) return colIndices;
  return { ok: true, view: { rowIndices: rowIndices.indices, colIndices: colIndices.indices } };
}

// Resolve a row/column selector into indices.
function resolveAxisSelector(
  selector: RefSelector,
  current: number,
  labelMap: Map<string, number[]>,
  totalCount: number,
  dataIndices: number[],
  currentBounds: [number, number] | null,
  labelKey: (path: string[]) => string,
  idToIndex?: Map<number, number>,
): AxisResolution {
  if (selector.kind === "all") {
    return { ok: true, indices: [...dataIndices] };
  }
  if (selector.kind === "range") {
    const [startSel, endSel] = selector.value as [RefSelector | null, RefSelector | null];
    const start =
      startSel !== null
        ? resolveScalarRendered(startSel, current, labelMap, totalCount, currentBounds, labelKey, idToIndex)
        : ({ ok: true, index: 0 } as const);
    const end =
      endSel !== null
        ? resolveScalarRendered(endSel, current, labelMap, totalCount, currentBounds, labelKey, idToIndex)
        : ({ ok: true, index: totalCount - 1 } as const);
    if (!start.ok) return start;
    if (!end.ok) return end;
    if (start.index > end.index) {
      return {
        ok: false,
        internalKind: "unresolved_reference_range_reversed",
        context: { start: start.index, end: end.index },
      };
    }
    return { ok: true, indices: Array.from({ length: end.index - start.index + 1 }, (_, i) => start.index + i) };
  }
  const idx = resolveScalarRendered(selector, current, labelMap, totalCount, currentBounds, labelKey, idToIndex);
  if (!idx.ok) return idx;
  return { ok: true, indices: [idx.index] };
}

// Resolve a selector that must point to a single position.
function resolveScalarRendered(
  selector: RefSelector,
  current: number,
  labelMap: Map<string, number[]>,
  totalCount: number,
  currentBounds: [number, number] | null,
  labelKey: (path: string[]) => string,
  idToIndex?: Map<number, number>,
): ScalarResolution {
  if (selector.kind === "current") {
    let idx = current;
    if (currentBounds !== null) {
      const [base, count] = currentBounds;
      const rel = current - base;
      if (rel < 0 || rel >= count) {
        return { ok: false, internalKind: "unresolved_reference_current_out_of_bounds", context: { current, base, count } };
      }
      idx = base + rel;
    }
    if (idx >= 0 && idx < totalCount) return { ok: true, index: idx };
    return { ok: false, internalKind: "unresolved_reference_current_out_of_bounds", context: { current, totalCount } };
  }
  if (selector.kind === "offset") {
    if (currentBounds === null) {
      const idx = current + Number(selector.value);
      if (idx < 0 || idx >= totalCount) {
        return { ok: false, internalKind: "unresolved_reference_offset_out_of_bounds", context: { current, offset: Number(selector.value), totalCount } };
      }
      return { ok: true, index: idx };
    }
    const [base, count] = currentBounds;
    let rel = current - base;
    if (rel < 0 || rel >= count) {
      return { ok: false, internalKind: "unresolved_reference_offset_out_of_bounds", context: { current, base, count } };
    }
    rel += Number(selector.value);
    if (rel < 0 || rel >= count) {
      return {
        ok: false,
        internalKind: "unresolved_reference_offset_out_of_bounds",
        context: { current, offset: Number(selector.value), base, count },
      };
    }
    const idx = base + rel;
    if (idx >= 0 && idx < totalCount) return { ok: true, index: idx };
    return { ok: false, internalKind: "unresolved_reference_offset_out_of_bounds", context: { current, offset: Number(selector.value), totalCount } };
  }
  if (selector.kind === "absolute") {
    const idx = Number(selector.value);
    if (idx < 0 || idx >= totalCount) {
      return { ok: false, internalKind: "unresolved_reference_absolute_out_of_bounds", context: { index: idx, totalCount } };
    }
    return { ok: true, index: idx };
  }
  if (selector.kind === "absolute_fixed") {
    const idx = Number(selector.value);
    if (idx < 0 || idx >= totalCount) {
      return { ok: false, internalKind: "unresolved_reference_absolute_out_of_bounds", context: { index: idx, totalCount } };
    }
    return { ok: true, index: idx };
  }
  if (selector.kind === "absolute_id" || selector.kind === "label_id") {
    if (!idToIndex) {
      return { ok: false, internalKind: "unresolved_reference_absolute_id_missing_index", context: {} };
    }
    const idx = idToIndex.get(Number(selector.value));
    if (idx === undefined) {
      return { ok: false, internalKind: "unresolved_reference_absolute_id_not_found", context: { id: Number(selector.value) } };
    }
    if (idx < 0 || idx >= totalCount) {
      return { ok: false, internalKind: "unresolved_reference_absolute_out_of_bounds", context: { index: idx, totalCount } };
    }
    return { ok: true, index: idx };
  }
  if (selector.kind === "label") {
    const key = labelKey(selector.value as string[]);
    const matches = labelMap.get(key) ?? [];
    if (matches.length === 0) {
      return { ok: false, internalKind: "unresolved_reference_label_not_found", context: { label: selector.value as string[] } };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        internalKind: "ambiguous_reference_label",
        context: { label: selector.value as string[], matchCount: matches.length },
      };
    }
    const idx = matches[0];
    if (idx >= 0 && idx < totalCount) return { ok: true, index: idx };
    return { ok: false, internalKind: "unresolved_reference_label_out_of_bounds", context: { index: idx, totalCount } };
  }
  return { ok: false, internalKind: "unresolved_reference_invalid_selector", context: { selectorKind: selector.kind } };
}

// Build row path strings for all body rows.
export function buildBodyRows(parsedRows: ParsedRow[], bodyStart: number): { rowPaths: string[] } {
  return {
    rowPaths: deriveHierarchyRows(parsedRows, bodyStart).map((row) => row.path.join(".")),
  };
}

// Build row keys for reference resolution (path components).
export function buildRowKeys(parsedRows: ParsedRow[], bodyStart: number): string[][] {
  return deriveHierarchyRows(parsedRows, bodyStart).map((row) => [...row.path]);
}

// Collect body row indices that represent data rows.
export function computeDataRowIndices(parsedRows: ParsedRow[], bodyStart: number): number[] {
  return parsedRows.slice(bodyStart).map((_, offset) => bodyStart + offset);
}

// Count header rows using the separator row.
export function headerRowCountFrom(rows: ParsedRow[]): number {
  const idx = rows.findIndex((row) => isSeparatorRow(row.cells));
  return idx >= 0 ? idx : 0;
}

// Count header columns using the || boundary marker.
export function headerColCountFrom(rows: ParsedRow[]): number {
  if (rows.length === 0) return 0;
  const firstBoundary = rows[0].boundary;
  if (firstBoundary === null || firstBoundary === undefined) return 0;
  if (rows.every((r) => r.boundary === firstBoundary)) {
    return Math.min(firstBoundary, rows[0].cells.length);
  }
  return 0;
}

// Find the separator row index, if present.
export function separatorRowIndex(rows: ParsedRow[]): number | null {
  for (let i = 0; i < rows.length; i += 1) {
    if (isSeparatorRow(rows[i].cells)) return i;
  }
  return null;
}

// Check if a row is the header/body separator.
export function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL_RE.test(cell));
}

// Evaluate a function call expression.
function evalFunctionCall(
  call: FunctionCall,
  rowIdx: number,
  colIdx: number,
  evalCell: (r: number, c: number) => RuntimeValue,
  rowMap: Map<string, number[]>,
  colMap: Map<string, number[]>,
  rowCount: number,
  colCount: number,
  bodyStart: number,
  bodyRowCount: number,
  dataRowIndices: number[],
  dataColIndices: number[],
  rowIdToIndex?: Map<number, number>,
  colIdToIndex?: Map<number, number>,
): RuntimeValue {
  const originalName = call.name;
  const name = originalName.toLowerCase();
  const args = call.args;

  if (name === "sum") {
    if (args.length !== 1) return makeInternalError("invalid_function_call", { function: originalName, expectedArgs: 1, got: args.length });
    const [argKind, argVal] = evalArgValue(
      args[0],
      rowIdx,
      colIdx,
      evalCell,
      rowMap,
      colMap,
      rowCount,
      colCount,
      bodyStart,
      bodyRowCount,
      dataRowIndices,
      dataColIndices,
      rowIdToIndex,
      colIdToIndex,
    );
    if (argKind === "error") return argVal as RuntimeValue;
    if (argKind !== "view") return makeInternalError("invalid_function_call", { function: originalName, argumentKind: argKind });
    return sumView(argVal as ViewSelection, evalCell);
  }

  if (name === "abs") {
    if (args.length !== 1) return makeInternalError("invalid_function_call", { function: originalName, expectedArgs: 1, got: args.length });
    const value = evalScalarArg(
      args[0],
      rowIdx,
      colIdx,
      evalCell,
      rowMap,
      colMap,
      rowCount,
      colCount,
      bodyStart,
      bodyRowCount,
      dataRowIndices,
      dataColIndices,
      rowIdToIndex,
      colIdToIndex,
    );
    if (isError(value)) return value;
    if (value.kind !== "number") return makeInternalError("invalid_function_call", { function: originalName, argumentKind: value.kind });
    return { kind: "number", value: Math.abs(value.value as number) };
  }

  if (name === "not") {
    if (args.length !== 1) return makeInternalError("invalid_function_call", { function: originalName, expectedArgs: 1, got: args.length });
    const value = evalScalarArg(
      args[0],
      rowIdx,
      colIdx,
      evalCell,
      rowMap,
      colMap,
      rowCount,
      colCount,
      bodyStart,
      bodyRowCount,
      dataRowIndices,
      dataColIndices,
      rowIdToIndex,
      colIdToIndex,
    );
    if (isError(value)) return value;
    if (value.kind !== "boolean") return makeInternalError("invalid_function_call", { function: originalName, argumentKind: value.kind });
    return { kind: "boolean", value: !value.value };
  }

  if (name === "dotproduct") {
    if (args.length !== 2) return makeInternalError("invalid_function_call", { function: originalName, expectedArgs: 2, got: args.length });
    const [leftKind, leftVal] = evalArgValue(
      args[0],
      rowIdx,
      colIdx,
      evalCell,
      rowMap,
      colMap,
      rowCount,
      colCount,
      bodyStart,
      bodyRowCount,
      dataRowIndices,
      dataColIndices,
      rowIdToIndex,
      colIdToIndex,
    );
    if (leftKind === "error") return leftVal as RuntimeValue;
    const [rightKind, rightVal] = evalArgValue(
      args[1],
      rowIdx,
      colIdx,
      evalCell,
      rowMap,
      colMap,
      rowCount,
      colCount,
      bodyStart,
      bodyRowCount,
      dataRowIndices,
      dataColIndices,
      rowIdToIndex,
      colIdToIndex,
    );
    if (rightKind === "error") return rightVal as RuntimeValue;
    if (leftKind !== "view" || rightKind !== "view") {
      return makeInternalError("invalid_function_call", { function: originalName, leftKind, rightKind });
    }
    return dotProduct(leftVal as ViewSelection, rightVal as ViewSelection, evalCell);
  }

  return makeInternalError("unknown_function", { function: originalName });
}

// Evaluate an argument into either scalar or view.
function evalArgValue(
  node: ExprNode,
  rowIdx: number,
  colIdx: number,
  evalCell: (r: number, c: number) => RuntimeValue,
  rowMap: Map<string, number[]>,
  colMap: Map<string, number[]>,
  rowCount: number,
  colCount: number,
  bodyStart: number,
  bodyRowCount: number,
  dataRowIndices: number[],
  dataColIndices: number[],
  rowIdToIndex?: Map<number, number>,
  colIdToIndex?: Map<number, number>,
): [string, RuntimeValue | ViewSelection] {
  if (node.kind === "reference") {
    const ref = node.value as ReferenceExpr;
    const view = selectViewDetailed(
      ref,
      rowIdx,
      colIdx,
      rowMap,
      colMap,
      rowCount,
      colCount,
      bodyStart,
      bodyRowCount,
      dataRowIndices,
      dataColIndices,
      rowIdToIndex,
      colIdToIndex,
    );
    if (!view.ok) return ["error", makeInternalError(view.internalKind, view.context)];
    return ["view", view.view];
  }
  const value = evalExpr(
    node,
    rowIdx,
    colIdx,
    evalCell,
    rowMap,
    colMap,
    rowCount,
    colCount,
    bodyStart,
    bodyRowCount,
    dataRowIndices,
    dataColIndices,
    rowIdToIndex,
    colIdToIndex,
  );
  if (isError(value)) return ["error", value];
  return ["scalar", value];
}

// Coerce an argument to a scalar value.
function evalScalarArg(
  node: ExprNode,
  rowIdx: number,
  colIdx: number,
  evalCell: (r: number, c: number) => RuntimeValue,
  rowMap: Map<string, number[]>,
  colMap: Map<string, number[]>,
  rowCount: number,
  colCount: number,
  bodyStart: number,
  bodyRowCount: number,
  dataRowIndices: number[],
  dataColIndices: number[],
  rowIdToIndex?: Map<number, number>,
  colIdToIndex?: Map<number, number>,
): RuntimeValue {
  const [kind, value] = evalArgValue(
    node,
    rowIdx,
    colIdx,
    evalCell,
    rowMap,
    colMap,
    rowCount,
    colCount,
    bodyStart,
    bodyRowCount,
    dataRowIndices,
    dataColIndices,
    rowIdToIndex,
    colIdToIndex,
  );
  if (kind === "error") return value as RuntimeValue;
  if (kind === "scalar") return value as RuntimeValue;
  const view = value as ViewSelection;
  if (view.rowIndices.length !== 1 || view.colIndices.length !== 1) {
    return makeInternalError("invalid_function_call", { function: "scalar_coercion", reason: "view_not_scalar" });
  }
  return evalCell(view.rowIndices[0], view.colIndices[0]);
}

// Sum a view by flattening in row-major order.
function sumView(view: ViewSelection, evalCell: (r: number, c: number) => RuntimeValue): RuntimeValue {
  if (view.rowIndices.length === 0 || view.colIndices.length === 0) {
    return { kind: "number", value: 0 };
  }
  let result: RuntimeValue = { kind: "number", value: 0 };
  for (const r of view.rowIndices) {
    for (const c of view.colIndices) {
      const value = evalCell(r, c);
      if (isError(value)) return value;
      result = evalArithmetic("+", result, value);
      if (isError(result)) return result;
    }
  }
  return result;
}

// Collect values for a vector view (single row or single column).
function vectorValues(view: ViewSelection, evalCell: (r: number, c: number) => RuntimeValue): RuntimeValue[] | null {
  if (view.rowIndices.length === 1) {
    const row = view.rowIndices[0];
    return view.colIndices.map((c) => evalCell(row, c));
  }
  if (view.colIndices.length === 1) {
    const col = view.colIndices[0];
    return view.rowIndices.map((r) => evalCell(r, col));
  }
  return null;
}

// Compute dot product for two vector views.
function dotProduct(
  left: ViewSelection,
  right: ViewSelection,
  evalCell: (r: number, c: number) => RuntimeValue,
): RuntimeValue {
  const leftVals = vectorValues(left, evalCell);
  const rightVals = vectorValues(right, evalCell);
  if (!leftVals || !rightVals) return makeInternalError("invalid_function_call", { function: "dotProduct", reason: "non_vector" });
  if (leftVals.length !== rightVals.length) {
    return makeInternalError("invalid_function_call", { function: "dotProduct", reason: "length_mismatch" });
  }

  let total = 0;
  for (let i = 0; i < leftVals.length; i += 1) {
    const lVal = leftVals[i];
    const rVal = rightVals[i];
    if (isError(lVal)) return lVal;
    if (isError(rVal)) return rVal;
    if (lVal.kind !== "number" || rVal.kind !== "number") {
      return makeInternalError("invalid_function_call", { function: "dotProduct", reason: "non_number_element" });
    }
    total += Number(lVal.value) * Number(rVal.value);
  }
  return { kind: "number", value: Number.isInteger(total) ? Math.trunc(total) : total };
}

// Parse a section marker like [Section] or [[Section]].
