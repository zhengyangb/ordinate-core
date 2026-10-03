import { deriveHierarchyRows, parseDocument, parseTableRow, stripDisplayControlFrame, type ParsedRow } from "../parser";
import { parseCellInput, stripCellDisplayMetadata } from "./parse";
import {
  type ArrayExpr,
  type EvaluationResult,
  type ExprNode,
  type FunctionCall,
  type IndexAxisExpr,
  type IndexExpr,
  type ReferenceExpr,
  type RefSelector,
  type RuntimeValue,
  type RuntimeView,
  type SheetEvaluation,
  type ViewSelection,
} from "./types";
import { isError, makeInternalError, runtimeErrorFromDiagnostic } from "./errors";
import { evalArithmetic, evalPower } from "./arithmetic";
import { evalScalarComparison } from "./comparison";
import { evalFunctionCall } from "./functions";
import { evaluateIndexing, type RuntimeIndexAxis } from "./indexing";
import { negateDurationValue } from "./temporal";
import type { EvaluatedArgument } from "./functions/args";
import {
  isRuntimeView,
  dimensionForShape,
  makeRuntimeView,
  materializeViewSelection,
  runtimeViewScalarValue,
  runtimeViewShapeContext,
  runtimeViewShapesMatch,
} from "./view";
import { getBoundSheetId, setBoundSheetId } from "./references";

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

export type ExpressionValue = RuntimeValue | RuntimeView;

export type CrossSheetResolver = (
  ref: ReferenceExpr,
  rowIdx: number,
  colIdx: number,
) => ExpressionValue | null;

interface EvalSheetContext {
  sheetId: number;
  name: string;
  logicalRows: ParsedRow[];
  rowPaths: string[];
  colLabels: string[];
  rowMap: Map<string, number[]>;
  colMap: Map<string, number[]>;
  rowCount: number;
  colCount: number;
  bodyStart: number;
  bodyRowCount: number;
  dataRowIndices: number[];
  dataColIndices: number[];
  allCells: string[][];
}

// Evaluate a full document into runtime values.
export function evaluateDocument(text: string): EvaluationResult {
  const { sheets: parsed } = parseDocument(text);
  const contexts = parsed.map((sheet, index) =>
    sheet.table ? buildEvalSheetContext(index + 1, sheet.name, sheet.table.rows) : emptyEvalSheetContext(index + 1, sheet.name));
  return { sheets: evaluateSheetContexts(contexts) };
}

// Evaluate a single sheet (table rows only).
function evaluateSheet(name: string, rows: string[]): SheetEvaluation {
  return evaluateSheetContexts([buildEvalSheetContext(1, name, rows)])[0] ?? {
    name,
    rowPaths: [],
    colLabels: [],
    values: [],
  };
}

function buildEvalSheetContext(sheetId: number, name: string, rows: string[]): EvalSheetContext {
  const parsedRows: ParsedRow[] = rows.map((r) => parseTableRow(r));
  const semanticRows = stripDisplayControlFrame(parsedRows).rows;
  if (semanticRows.length === 0) {
    return emptyEvalSheetContext(sheetId, name);
  }

  const separatorIndex = separatorRowIndex(semanticRows);
  const logicalRows: ParsedRow[] = semanticRows.filter((_, idx) => idx !== separatorIndex);
  if (logicalRows.length === 0) {
    return emptyEvalSheetContext(sheetId, name);
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

  const colLabelPaths = buildColumnLabelPaths(logicalRows, headerRowCount, colCount);
  const colLabels = buildColumnLabels(colLabelPaths);

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

  const colMap = buildColumnLabelMap(colLabelPaths, colLabels);

  const bodyRowCount = logicalRows.length - bodyStart;
  const dataRowIndices = computeDataRowIndices(logicalRows, bodyStart);
  const dataColIndices = Array.from({ length: colCount - headerColCount }, (_, i) => i + headerColCount);

  return {
    sheetId,
    name,
    logicalRows,
    rowPaths,
    colLabels,
    rowMap,
    colMap,
    rowCount: logicalRows.length,
    colCount,
    bodyStart,
    bodyRowCount,
    dataRowIndices,
    dataColIndices,
    allCells,
  };
}

function emptyEvalSheetContext(sheetId: number, name: string): EvalSheetContext {
  return {
    sheetId,
    name,
    logicalRows: [],
    rowPaths: [],
    colLabels: [],
    rowMap: new Map(),
    colMap: new Map(),
    rowCount: 0,
    colCount: 0,
    bodyStart: 0,
    bodyRowCount: 0,
    dataRowIndices: [],
    dataColIndices: [],
    allCells: [],
  };
}

function evaluateSheetContexts(contexts: EvalSheetContext[]): SheetEvaluation[] {
  const states = new Map<string, string>();
  const memo = new Map<string, RuntimeValue>();

  const evalCell = (sheetIndex: number, rAbs: number, c: number): RuntimeValue => {
    const ctx = contexts[sheetIndex];
    if (!ctx) {
      return makeInternalError("unresolved_reference_sheet", { sheetIndex });
    }
    const key = `${sheetIndex}:${rAbs},${c}`;
    const state = states.get(key);
    if (state === "visiting") {
      return makeInternalError("cycle");
    }
    if (state === "done") {
      return memo.get(key) ?? { kind: "blank", value: null };
    }

    states.set(key, "visiting");
    const cellText = rAbs >= 0 && rAbs < ctx.allCells.length && c >= 0 && c < ctx.colCount ? ctx.allCells[rAbs][c] : "";
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
        (rDep, cDep) => evalCell(sheetIndex, rDep, cDep),
        ctx.rowMap,
        ctx.colMap,
        ctx.rowCount,
        ctx.colCount,
        ctx.bodyStart,
        ctx.bodyRowCount,
        ctx.dataRowIndices,
        ctx.dataColIndices,
        undefined,
        undefined,
        (ref, currentRow, currentCol) => resolveCrossSheetReference(ref, currentRow, currentCol, contexts, evalCell),
      );
    }

    states.set(key, "done");
    memo.set(key, value);
    return value;
  };

  return contexts.map((ctx, sheetIndex) => {
    const values: RuntimeValue[][] = [];
    for (let rAbs = ctx.bodyStart; rAbs < ctx.rowCount; rAbs += 1) {
      values.push(Array.from({ length: ctx.colCount }, (_, c) => evalCell(sheetIndex, rAbs, c)));
    }
    return {
      name: ctx.name,
      rowPaths: ctx.rowPaths,
      colLabels: ctx.colLabels,
      values,
    };
  });
}

function resolveCrossSheetReference(
  ref: ReferenceExpr,
  rowIdx: number,
  colIdx: number,
  contexts: EvalSheetContext[],
  evalCell: (sheetIndex: number, r: number, c: number) => RuntimeValue,
): ExpressionValue | null {
  if (!ref.sheetSelector) return null;

  let targetIndex = -1;
  const boundSheetId = getBoundSheetId(ref.sheetSelector);
  if (boundSheetId !== null) {
    targetIndex = contexts.findIndex((ctx) => ctx.sheetId === boundSheetId);
    if (targetIndex < 0) {
      return makeInternalError("unresolved_reference_sheet", { sheet: ref.sheetSelector.value, sheetId: boundSheetId });
    }
  } else {
    const matches: number[] = [];
    contexts.forEach((ctx, index) => {
      if (ctx.name === ref.sheetSelector?.value) matches.push(index);
    });
    if (matches.length === 0) {
      return makeInternalError("unresolved_reference_sheet", { sheet: ref.sheetSelector.value });
    }
    if (matches.length > 1) {
      return makeInternalError("ambiguous_reference_sheet", { sheet: ref.sheetSelector.value });
    }
    targetIndex = matches[0];
    setBoundSheetId(ref.sheetSelector, contexts[targetIndex].sheetId);
  }

  const target = contexts[targetIndex];
  const resolved = selectViewDetailed(
    ref,
    rowIdx,
    colIdx,
    target.rowMap,
    target.colMap,
    target.rowCount,
    target.colCount,
    target.bodyStart,
    target.bodyRowCount,
    target.dataRowIndices,
    target.dataColIndices,
  );
  if (!resolved.ok) {
    return makeInternalError(resolved.internalKind, resolved.context);
  }
  return materializeViewSelection(resolved.view, (r, c) => evalCell(targetIndex, r, c));
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
  crossSheetResolver?: CrossSheetResolver,
): RuntimeValue {
  const value = evalExpressionValue(
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
    crossSheetResolver,
  );
  return expressionValueToScalarResult(value, "final_result");
}

function evalExpressionValue(
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
  crossSheetResolver?: CrossSheetResolver,
): ExpressionValue {
  if (!node) {
    return makeInternalError("parse_expression_empty");
  }

  if (node.kind === "literal") {
    return node.value as RuntimeValue;
  }

  if (node.kind === "reference") {
    const ref = node.value as ReferenceExpr;
    const crossSheet = crossSheetResolver?.(ref, rowIdx, colIdx);
    if (crossSheet) return crossSheet;
    if (ref.sheetSelector) {
      return makeInternalError("unresolved_reference_sheet", { sheet: ref.sheetSelector.value });
    }
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
    return materializeViewSelection(resolved.view, evalCell);
  }

  if (node.kind === "array") {
    return evalArrayLiteral(
      node.value as ArrayExpr,
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
      crossSheetResolver,
    );
  }

  if (node.kind === "call") {
    const call = node.value as FunctionCall;
    return evalFunctionCall(call, {
      evalCell,
      evalArgValue: (arg) =>
        evalArgValue(
          arg,
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
          crossSheetResolver,
        ),
      evalRawArgValue: (arg) =>
        evalRawArgValue(
          arg,
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
          crossSheetResolver,
        ),
      evalScalarArg: (arg) =>
        evalScalarArg(
          arg,
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
          crossSheetResolver,
        ),
      evalExpressionValue: (arg) =>
        evalExpressionValue(
          arg,
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
          crossSheetResolver,
        ),
    });
  }

  if (node.kind === "index") {
    const index = node.value as IndexExpr;
    return evalIndexExpression(
      index,
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
      crossSheetResolver,
    );
  }

  if (node.kind === "unary") {
    const op = node.value as string;
    const rightValue = evalExpressionValue(
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
      crossSheetResolver,
    );
    const right = expressionValueToScalarResult(rightValue, "unary_operand");
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
      if (right.kind === "duration") {
        return negateDurationValue(right);
      }
      return makeInternalError("invalid_unary", { operator: op, rightKind: right.kind });
    }
    return makeInternalError("invalid_unary", { operator: op, rightKind: right.kind });
  }

  const left = evalExpressionValue(
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
    crossSheetResolver,
  );
  const right = evalExpressionValue(
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
    crossSheetResolver,
  );
  if (isExpressionError(left)) return left;
  if (isExpressionError(right)) return right;

  const op = node.value as string;
  if (["+", "-", "*", "/"].includes(op)) {
    return evalArithmeticExpression(op, left, right);
  }
  if (op === "**") {
    return evalArithmeticExpression(op, left, right);
  }
  if (["==", "!="].includes(op)) {
    return evalComparison(op, left, right);
  }
  if (["<", "<=", ">", ">="].includes(op)) {
    return evalComparison(op, left, right);
  }
  return makeInternalError("unknown_operator", { operator: String(node.value ?? "") });
}

function evalArrayLiteral(
  array: ArrayExpr,
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
  crossSheetResolver?: CrossSheetResolver,
): ExpressionValue {
  const rows = array.rows;
  if (rows.length === 0) {
    return makeInternalError("invalid_array_literal", { reason: "empty_row_set" });
  }
  const width = rows[0].length;
  if (!rows.every((row) => row.length === width)) {
    return makeInternalError("invalid_array_literal", { reason: "ragged_rows" });
  }

  const values: RuntimeValue[] = [];
  for (const row of rows) {
    for (const element of row) {
      if (element.kind === "array") {
        return makeInternalError("invalid_array_literal", { reason: "array_too_deep" });
      }
      const value = evalExpressionValue(
        element,
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
        crossSheetResolver,
      );
      if (isRuntimeView(value)) {
        const scalar = runtimeViewScalarValue(value);
        if (!scalar) {
          return makeInternalError("invalid_array_literal", { reason: "non_scalar_element", ...runtimeViewShapeContext(value) });
        }
        values.push(scalar);
        continue;
      }
      if (isError(value) && !isExplicitErrorLiteral(element)) {
        return value;
      }
      values.push(value);
    }
  }

  return makeRuntimeView(dimensionForShape(rows.length, width), rows.length, width, values);
}

function isExplicitErrorLiteral(node: ExprNode): boolean {
  if (node.kind !== "literal") return false;
  const value = node.value as RuntimeValue;
  return isError(value) && value.internalKind === "literal_error_literal";
}

function expressionValueToScalarResult(value: ExpressionValue, reason: string): RuntimeValue {
  if (!isRuntimeView(value)) {
    return value;
  }
  const scalar = runtimeViewScalarValue(value);
  if (scalar) {
    return scalar;
  }
  return makeInternalError("invalid_view", { reason, ...runtimeViewShapeContext(value) });
}

function isExpressionError(value: ExpressionValue): value is RuntimeValue & { kind: "error" } {
  return !isRuntimeView(value) && isError(value);
}

function evalIndexExpression(
  index: IndexExpr,
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
  crossSheetResolver?: CrossSheetResolver,
): ExpressionValue {
  const target = evalExpressionValue(
    index.target,
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
    crossSheetResolver,
  );
  if (isExpressionError(target)) return target;

  const axes: RuntimeIndexAxis[] = [];
  for (const axis of index.axes) {
    const evaluated = evalIndexAxis(
      axis,
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
      crossSheetResolver,
    );
    if (isError(evaluated as RuntimeValue)) return evaluated as RuntimeValue;
    axes.push(evaluated as RuntimeIndexAxis);
  }

  return evaluateIndexing(target, axes, "index");
}

function evalIndexAxis(
  axis: IndexAxisExpr,
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
  crossSheetResolver?: CrossSheetResolver,
): RuntimeIndexAxis | RuntimeValue {
  if (axis.kind === "scalar") {
    const value = evalIndexAxisScalar(
      axis.value,
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
      crossSheetResolver,
    );
    if (isError(value)) return value;
    return { kind: "scalar", value };
  }

  const start = axis.start
    ? evalIndexAxisScalar(
        axis.start,
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
        crossSheetResolver,
      )
    : null;
  if (start && isError(start)) return start;

  const end = axis.end
    ? evalIndexAxisScalar(
        axis.end,
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
        crossSheetResolver,
      )
    : null;
  if (end && isError(end)) return end;

  return { kind: "slice", start, end };
}

function evalIndexAxisScalar(
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
  crossSheetResolver?: CrossSheetResolver,
): RuntimeValue {
  const value = evalExpressionValue(
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
    crossSheetResolver,
  );
  return expressionValueToScalarResult(value, "index_axis");
}

function evalArithmeticExpression(op: string, left: ExpressionValue, right: ExpressionValue): ExpressionValue {
  const leftIsView = isRuntimeView(left);
  const rightIsView = isRuntimeView(right);

  if (!leftIsView && !rightIsView) {
    return evalScalarArithmetic(op, left, right);
  }

  if (leftIsView && rightIsView) {
    if (!runtimeViewShapesMatch(left, right)) {
      return makeInternalError("invalid_view_arithmetic", {
        operator: op,
        left: runtimeViewShapeContext(left),
        right: runtimeViewShapeContext(right),
      });
    }
    return mapArithmeticView(left, right, op);
  }

  if (leftIsView) {
    return mapArithmeticView(left, right as RuntimeValue, op);
  }

  return mapArithmeticView(left as RuntimeValue, right as RuntimeView, op);
}

function mapArithmeticView(left: RuntimeView | RuntimeValue, right: RuntimeView | RuntimeValue, op: string): ExpressionValue {
  const view = isRuntimeView(left) ? left : (right as RuntimeView);
  const values: RuntimeValue[] = [];
  for (let index = 0; index < view.values.length; index += 1) {
    const leftValue = isRuntimeView(left) ? left.values[index] : left;
    const rightValue = isRuntimeView(right) ? right.values[index] : right;
    if (isError(leftValue)) return leftValue;
    if (isError(rightValue)) return rightValue;
    const result = evalScalarArithmetic(op, leftValue, rightValue);
    if (isError(result)) return result;
    values.push(result);
  }
  return makeRuntimeView(view.dimension, view.rowCount, view.colCount, values);
}

function evalScalarArithmetic(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (op === "**") {
    return evalPower(left, right);
  }
  return evalArithmetic(op, left, right);
}

function evalComparison(op: string, left: ExpressionValue, right: ExpressionValue): ExpressionValue {
  const leftIsView = isRuntimeView(left);
  const rightIsView = isRuntimeView(right);

  if (!leftIsView && !rightIsView) {
    return evalScalarComparison(op, left, right);
  }

  if (leftIsView && rightIsView) {
    if (!runtimeViewShapesMatch(left, right)) {
      return makeInternalError("invalid_view_comparison", {
        operator: op,
        left: runtimeViewShapeContext(left),
        right: runtimeViewShapeContext(right),
      });
    }
    return mapComparisonView(left, right, op);
  }

  if (leftIsView) {
    return mapComparisonView(left, right as RuntimeValue, op);
  }

  return mapComparisonView(left as RuntimeValue, right as RuntimeView, op);
}

function mapComparisonView(left: RuntimeView | RuntimeValue, right: RuntimeView | RuntimeValue, op: string): ExpressionValue {
  const view = isRuntimeView(left) ? left : (right as RuntimeView);
  const values: RuntimeValue[] = [];
  for (let index = 0; index < view.values.length; index += 1) {
    const leftValue = isRuntimeView(left) ? left.values[index] : left;
    const rightValue = isRuntimeView(right) ? right.values[index] : right;
    if (isError(leftValue)) return leftValue;
    if (isError(rightValue)) return rightValue;
    const compared = evalScalarComparison(op, leftValue, rightValue);
    if (isError(compared)) return compared;
    values.push(compared);
  }
  return makeRuntimeView(view.dimension, view.rowCount, view.colCount, values);
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

export function selectViewDetailed(
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
    if (isStructurallyBoundSelector(startSel) && isStructurallyBoundSelector(endSel) && start.index > end.index) {
      return { ok: true, indices: Array.from({ length: start.index - end.index + 1 }, (_, i) => end.index + i) };
    }
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

function isStructurallyBoundSelector(selector: RefSelector | null): boolean {
  return selector?.kind === "absolute_id" || selector?.kind === "label_id";
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

export function buildColumnLabelPaths(logicalRows: ParsedRow[], headerRowCount: number, colCount: number): string[][] {
  return Array.from({ length: colCount }, (_, colIndex) => {
    if (headerRowCount <= 0) return [`C${colIndex + 1}`];
    const path: string[] = [];
    for (let rowIndex = 0; rowIndex < headerRowCount; rowIndex += 1) {
      const headerRow = logicalRows[rowIndex];
      const rawHeader = headerRow && colIndex < headerRow.rawCells.length ? headerRow.rawCells[colIndex] : "";
      const label = stripCellDisplayMetadata(rawHeader).trim();
      if (label.length > 0) path.push(label);
    }
    return path.length > 0 ? path : [`C${colIndex + 1}`];
  });
}

export function buildColumnLabels(colLabelPaths: string[][]): string[] {
  return colLabelPaths.map((path, index) => path[path.length - 1] ?? `C${index + 1}`);
}

export function buildColumnLabelMap(colLabelPaths: string[][], colLabels: string[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  colLabelPaths.forEach((path, index) => {
    const key = path.join(".");
    const existing = map.get(key) ?? [];
    existing.push(index);
    map.set(key, existing);
  });
  colLabels.forEach((label, index) => {
    const existing = map.get(label) ?? [];
    if (!existing.includes(index)) existing.push(index);
    map.set(label, existing);
  });
  return map;
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
  crossSheetResolver?: CrossSheetResolver,
): EvaluatedArgument {
  if (node.kind === "reference") {
    const ref = node.value as ReferenceExpr;
    const crossSheet = crossSheetResolver?.(ref, rowIdx, colIdx);
    if (crossSheet) {
      if (isExpressionError(crossSheet)) return ["error", crossSheet];
      if (isRuntimeView(crossSheet)) return ["view", crossSheet];
      return ["scalar", crossSheet];
    }
    if (ref.sheetSelector) {
      return ["error", makeInternalError("unresolved_reference_sheet", { sheet: ref.sheetSelector.value })];
    }
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
    return ["view", materializeViewSelection(view.view, evalCell)];
  }
  const value = evalExpressionValue(
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
    crossSheetResolver,
  );
  if (isExpressionError(value)) return ["error", value];
  if (isRuntimeView(value)) return ["view", value];
  return ["scalar", value];
}

// Evaluate an argument without treating scalar errors as function-call failures.
function evalRawArgValue(
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
  crossSheetResolver?: CrossSheetResolver,
): EvaluatedArgument {
  if (node.kind === "reference") {
    return evalArgValue(
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
      crossSheetResolver,
    );
  }
  const value = evalExpressionValue(
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
    crossSheetResolver,
  );
  if (isRuntimeView(value)) return ["view", value];
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
  crossSheetResolver?: CrossSheetResolver,
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
    crossSheetResolver,
  );
  if (kind === "error") return value as RuntimeValue;
  if (kind === "scalar") return value as RuntimeValue;
  const view = value as RuntimeView;
  const scalar = runtimeViewScalarValue(view);
  if (!scalar) {
    return makeInternalError("invalid_function_call", { function: "scalar_coercion", reason: "view_not_scalar" });
  }
  return scalar;
}

// Parse a section marker like [Section] or [[Section]].
