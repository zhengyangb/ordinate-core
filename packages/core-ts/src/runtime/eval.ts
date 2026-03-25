import { parseDocument, parseTableRow, type ParsedRow } from "../parser";
import { parseCellInput, stripCellDisplayMetadata } from "./parse";
import {
  type EvaluationResult,
  type ExprNode,
  type FunctionCall,
  type ReferenceExpr,
  type RefSelector,
  type RuntimeValue,
  type SheetEvaluation,
  type ViewSelection,
} from "./types";

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;
const SECTION_RE = /^(\[+)([^\[\]]+)(\]+)$/;

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
  if (parsedRows.length === 0) {
    return { name, rowPaths: [], colLabels: [], values: [] };
  }

  const separatorIndex = separatorRowIndex(parsedRows);
  const logicalRows: ParsedRow[] = parsedRows.filter((_, idx) => idx !== separatorIndex);
  if (logicalRows.length === 0) {
    return { name, rowPaths: [], colLabels: [], values: [] };
  }

  const colCount = logicalRows.reduce((m, r) => Math.max(m, r.cells.length), 0);
  const headerRowCount = headerRowCountFrom(parsedRows);
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
      return { kind: "error", value: "cycle" };
    }
    if (state === "done") {
      return memo.get(key) ?? { kind: "blank", value: null };
    }

    states.set(key, "visiting");
    const cellText = rAbs >= 0 && rAbs < allCells.length && c >= 0 && c < colCount ? allCells[rAbs][c] : "";
    const parsedCell = parseCellInput(cellText);

    let value: RuntimeValue;
    if (parsedCell.kind === "literal") {
      value = parsedCell.literal ?? { kind: "blank", value: null };
    } else {
      value = evalExpr(
        parsedCell.expression,
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
    return { kind: "error", value: "empty_expression" };
  }

  if (node.kind === "literal") {
    return node.value as RuntimeValue;
  }

  if (node.kind === "reference") {
    const ref = node.value as ReferenceExpr;
    const view = selectView(
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
    if (!view) {
      return { kind: "error", value: "bad_reference" };
    }
    if (view.rowIndices.length !== 1 || view.colIndices.length !== 1) {
      return { kind: "error", value: "invalid_view" };
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
      return { kind: "error", value: "invalid_unary" };
    }
    return { kind: "error", value: "invalid_unary" };
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
  return { kind: "error", value: "unknown_operator" };
}

// Check if a runtime value represents an error.
function isError(value: RuntimeValue): boolean {
  return value.kind === "error";
}

// Evaluate arithmetic with RFC-0006 coercion rules.
function evalArithmetic(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (left.kind === "blank" && right.kind === "blank") {
    if (op === "+" || op === "-" || op === "*") {
      return { kind: "blank", value: null };
    }
    return { kind: "error", value: "invalid_arithmetic" };
  }

  if (left.kind === "string" && right.kind === "string") {
    if (op === "+") {
      return { kind: "string", value: String(left.value) + String(right.value) };
    }
    return { kind: "error", value: "invalid_arithmetic" };
  }

  if (left.kind === "blank" && right.kind === "string") {
    if (op === "+") {
      return { kind: "string", value: String(right.value) };
    }
    return { kind: "error", value: "invalid_arithmetic" };
  }

  if (left.kind === "string" && right.kind === "blank") {
    if (op === "+") {
      return { kind: "string", value: String(left.value) };
    }
    return { kind: "error", value: "invalid_arithmetic" };
  }

  if (left.kind === "blank" && right.kind === "number") {
    if (op === "/") {
      return { kind: "number", value: 0 };
    }
    if (op === "+" || op === "-" || op === "*") {
      return evalNumberOp(op, 0, right.value as number);
    }
    return { kind: "error", value: "invalid_arithmetic" };
  }

  if (left.kind === "number" && right.kind === "blank") {
    if (op === "/") {
      return { kind: "error", value: "invalid_arithmetic" };
    }
    if (op === "+" || op === "-" || op === "*") {
      return evalNumberOp(op, left.value as number, 0);
    }
    return { kind: "error", value: "invalid_arithmetic" };
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

  return { kind: "error", value: "invalid_arithmetic" };
}

// Perform a numeric arithmetic operation.
function evalNumberOp(op: string, left: number, right: number): RuntimeValue {
  if (op === "+") return { kind: "number", value: left + right };
  if (op === "-") return { kind: "number", value: left - right };
  if (op === "*") return { kind: "number", value: left * right };
  if (right === 0) return { kind: "error", value: "divide_by_zero" };
  return { kind: "number", value: left / right };
}

// Convert a boolean value to a number.
function boolToNumber(value: RuntimeValue): number {
  return value.value ? 1 : 0;
}

// Evaluate equality/inequality comparisons.
function evalEquality(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (left.kind === "error" || right.kind === "error") {
    return { kind: "error", value: "error" };
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
    return { kind: "error", value: "invalid_comparison" };
  }
  if (left.kind !== right.kind) {
    return { kind: "error", value: "invalid_comparison" };
  }
  const result = left.value === right.value;
  return { kind: "boolean", value: op === "==" ? result : !result };
}

// Evaluate ordering comparisons.
function evalOrdering(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (left.kind === "error" || right.kind === "error") {
    return { kind: "error", value: "error" };
  }
  if (left.kind !== "number" || right.kind !== "number") {
    return { kind: "error", value: "invalid_comparison" };
  }
  if (op === "<") return { kind: "boolean", value: (left.value as number) < (right.value as number) };
  if (op === "<=") return { kind: "boolean", value: (left.value as number) <= (right.value as number) };
  if (op === ">") return { kind: "boolean", value: (left.value as number) > (right.value as number) };
  if (op === ">=") return { kind: "boolean", value: (left.value as number) >= (right.value as number) };
  return { kind: "error", value: "invalid_comparison" };
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
  if (!rowIndices) return null;
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
  if (!colIndices) return null;
  return { rowIndices, colIndices };
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
): number[] | null {
  if (selector.kind === "all") {
    return [...dataIndices];
  }
  if (selector.kind === "range") {
    const [startSel, endSel] = selector.value as [RefSelector | null, RefSelector | null];
    const start =
      startSel !== null
        ? resolveScalarRendered(startSel, current, labelMap, totalCount, currentBounds, labelKey, idToIndex)
        : 0;
    const end =
      endSel !== null
        ? resolveScalarRendered(endSel, current, labelMap, totalCount, currentBounds, labelKey, idToIndex)
        : totalCount - 1;
    if (start === null || end === null) return null;
    if (start > end) return null;
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  const idx = resolveScalarRendered(selector, current, labelMap, totalCount, currentBounds, labelKey, idToIndex);
  if (idx === null) return null;
  return [idx];
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
): number | null {
  if (selector.kind === "current") {
    let idx = current;
    if (currentBounds !== null) {
      const [base, count] = currentBounds;
      const rel = current - base;
      if (rel < 0 || rel >= count) return null;
      idx = base + rel;
    }
    return idx >= 0 && idx < totalCount ? idx : null;
  }
  if (selector.kind === "offset") {
    if (currentBounds === null) {
      const idx = current + Number(selector.value);
      if (idx < 0 || idx >= totalCount) return null;
      return idx;
    }
    const [base, count] = currentBounds;
    let rel = current - base;
    if (rel < 0 || rel >= count) return null;
    rel += Number(selector.value);
    if (rel < 0 || rel >= count) return null;
    const idx = base + rel;
    return idx >= 0 && idx < totalCount ? idx : null;
  }
  if (selector.kind === "absolute") {
    const idx = Number(selector.value);
    if (idx < 0 || idx >= totalCount) return null;
    return idx;
  }
  if (selector.kind === "absolute_fixed") {
    const idx = Number(selector.value);
    if (idx < 0 || idx >= totalCount) return null;
    return idx;
  }
  if (selector.kind === "absolute_id") {
    if (!idToIndex) return null;
    const idx = idToIndex.get(Number(selector.value));
    if (idx === undefined) return null;
    if (idx < 0 || idx >= totalCount) return null;
    return idx;
  }
  if (selector.kind === "label") {
    const key = labelKey(selector.value as string[]);
    const matches = labelMap.get(key) ?? [];
    if (matches.length !== 1) return null;
    const idx = matches[0];
    return idx >= 0 && idx < totalCount ? idx : null;
  }
  return null;
}

// Build row path strings for all body rows.
export function buildBodyRows(parsedRows: ParsedRow[], bodyStart: number): { rowPaths: string[] } {
  const sectionStack: string[] = [];
  const rowPaths: string[] = [];
  for (const row of parsedRows.slice(bodyStart)) {
    const labelRaw = row.rawCells.length > 0 ? row.rawCells[0] : "";
    const marker = parseSectionMarker(labelRaw.trim());
    if (marker) {
      const [name, level] = marker;
      while (sectionStack.length >= level) {
        sectionStack.pop();
      }
      sectionStack.push(name);
      rowPaths.push(sectionStack.join("."));
    } else {
      const indent = indentDepth(labelRaw);
      while (sectionStack.length > indent) {
        sectionStack.pop();
      }
      const label = labelRaw.trim();
      const parts = [...sectionStack];
      if (label) parts.push(label);
      rowPaths.push(parts.join("."));
    }
  }
  return { rowPaths };
}

// Build row keys for reference resolution (path components).
export function buildRowKeys(parsedRows: ParsedRow[], bodyStart: number): string[][] {
  const sectionStack: string[] = [];
  const rowKeys: string[][] = [];

  for (const row of parsedRows.slice(bodyStart)) {
    const labelRaw = row.rawCells.length > 0 ? row.rawCells[0] : "";
    const marker = parseSectionMarker(labelRaw.trim());
    if (marker) {
      const [name, level] = marker;
      while (sectionStack.length >= level) {
        sectionStack.pop();
      }
      sectionStack.push(name);
      rowKeys.push([...sectionStack]);
      continue;
    }
    const indent = indentDepth(labelRaw);
    while (sectionStack.length > indent) {
      sectionStack.pop();
    }
    const label = labelRaw.trim();
    if (label) {
      rowKeys.push([...sectionStack, label]);
    } else {
      rowKeys.push([...sectionStack]);
    }
  }
  return rowKeys;
}

// Collect body row indices that represent data rows.
export function computeDataRowIndices(parsedRows: ParsedRow[], bodyStart: number): number[] {
  const indices: number[] = [];
  parsedRows.slice(bodyStart).forEach((row, offset) => {
    const absIdx = bodyStart + offset;
    const labelRaw = row.rawCells.length > 0 ? row.rawCells[0] : "";
    if (!parseSectionMarker(labelRaw.trim())) {
      indices.push(absIdx);
    }
  });
  return indices;
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
  const name = call.name;
  const args = call.args;

  if (name === "sum") {
    if (args.length !== 1) return { kind: "error", value: "invalid_function_call" };
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
    if (argKind !== "view") return { kind: "error", value: "invalid_function_call" };
    return sumView(argVal as ViewSelection, evalCell);
  }

  if (name === "abs") {
    if (args.length !== 1) return { kind: "error", value: "invalid_function_call" };
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
    if (value.kind !== "number") return { kind: "error", value: "invalid_function_call" };
    return { kind: "number", value: Math.abs(value.value as number) };
  }

  if (name === "not") {
    if (args.length !== 1) return { kind: "error", value: "invalid_function_call" };
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
    if (value.kind !== "boolean") return { kind: "error", value: "invalid_function_call" };
    return { kind: "boolean", value: !value.value };
  }

  if (name === "dotProduct") {
    if (args.length !== 2) return { kind: "error", value: "invalid_function_call" };
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
    if (leftKind !== "view" || rightKind !== "view") return { kind: "error", value: "invalid_function_call" };
    return dotProduct(leftVal as ViewSelection, rightVal as ViewSelection, evalCell);
  }

  return { kind: "error", value: "unknown_function" };
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
    const view = selectView(
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
    if (!view) return ["error", { kind: "error", value: "bad_reference" }];
    return ["view", view];
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
    return { kind: "error", value: "invalid_function_call" };
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
  if (!leftVals || !rightVals) return { kind: "error", value: "invalid_function_call" };
  if (leftVals.length !== rightVals.length) return { kind: "error", value: "invalid_function_call" };

  let total = 0;
  for (let i = 0; i < leftVals.length; i += 1) {
    const lVal = leftVals[i];
    const rVal = rightVals[i];
    if (isError(lVal)) return lVal;
    if (isError(rVal)) return rVal;
    if (lVal.kind !== "number" || rVal.kind !== "number") {
      return { kind: "error", value: "invalid_function_call" };
    }
    total += Number(lVal.value) * Number(rVal.value);
  }
  return { kind: "number", value: Number.isInteger(total) ? Math.trunc(total) : total };
}

// Parse a section marker like [Section] or [[Section]].
function parseSectionMarker(label: string): [string, number] | null {
  const match = SECTION_RE.exec(label);
  if (!match) return null;
  const [opens, name, closes] = match.slice(1);
  if (opens.length !== closes.length) return null;
  return [name.trim(), opens.length];
}

// Compute indentation depth in 2-space steps.
function indentDepth(labelRaw: string): number {
  const leading = labelRaw.length - labelRaw.trimStart().length;
  return Math.floor(leading / 2);
}
