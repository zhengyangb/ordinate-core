import { isError } from "./errors";
import type { RuntimeArray, RuntimeCollection, RuntimeValue, RuntimeView, ViewSelection } from "./types";

export type EvalCell = (rowIndex: number, colIndex: number) => RuntimeValue;

export function makeRuntimeArray(values: RuntimeValue[]): RuntimeArray {
  return { kind: "array", values };
}

export function makeRuntimeView(rowCount: number, colCount: number, values: RuntimeValue[]): RuntimeView {
  if (rowCount < 0 || colCount < 0 || !Number.isInteger(rowCount) || !Number.isInteger(colCount)) {
    throw new Error(`invalid runtime view shape ${rowCount}x${colCount}`);
  }
  if (values.length !== rowCount * colCount) {
    throw new Error(`runtime view shape ${rowCount}x${colCount} does not match ${values.length} values`);
  }
  return { kind: "view", rowCount, colCount, values };
}

export function mapRuntimeCollection(source: RuntimeCollection, values: RuntimeValue[]): RuntimeCollection {
  if (values.length !== source.values.length) {
    throw new Error(`runtime collection size ${source.values.length} does not match ${values.length} values`);
  }
  return source.kind === "array"
    ? makeRuntimeArray(values)
    : makeRuntimeView(source.rowCount, source.colCount, values);
}

export function materializeViewSelection(view: ViewSelection, evalCell: EvalCell): RuntimeView {
  const values: RuntimeValue[] = [];
  for (const rowIndex of view.rowIndices) {
    for (const colIndex of view.colIndices) {
      values.push(evalCell(rowIndex, colIndex));
    }
  }
  return makeRuntimeView(view.rowIndices.length, view.colIndices.length, values);
}

export function isRuntimeCollection(value: unknown): value is RuntimeCollection {
  return (
    typeof value === "object"
    && value !== null
    && ((value as { kind?: unknown }).kind === "array" || (value as { kind?: unknown }).kind === "view")
    && Array.isArray((value as { values?: unknown }).values)
  );
}

export function isRuntimeView(value: unknown): value is RuntimeView {
  return isRuntimeCollection(value) && value.kind === "view";
}

export function runtimeViewScalarValue(value: RuntimeCollection): RuntimeValue | null {
  if (value.kind === "view" && value.rowCount === 1 && value.colCount === 1) {
    return value.values[0] ?? { kind: "blank", value: null };
  }
  return null;
}

export function runtimeCollectionShapesMatch(left: RuntimeCollection, right: RuntimeCollection): boolean {
  if (left.kind === "array") return right.kind === "array" && left.values.length === right.values.length;
  return right.kind === "view" && left.rowCount === right.rowCount && left.colCount === right.colCount;
}

// Binary operators align axes from the right. At least one operand must already
// have the result shape, so the operation cannot create an outer-product grid.
export function mapRuntimeBroadcast(
  left: RuntimeValue | RuntimeCollection,
  right: RuntimeValue | RuntimeCollection,
  evaluate: (left: RuntimeValue, right: RuntimeValue) => RuntimeValue,
): RuntimeValue | RuntimeCollection | null {
  const leftOperandShape = runtimeOperandShape(left);
  const rightOperandShape = runtimeOperandShape(right);
  const rank = Math.max(leftOperandShape.length, rightOperandShape.length);
  if (rank === 0) throw new Error("runtime broadcast requires a collection operand");

  const leftShape = alignRuntimeShape(leftOperandShape, rank);
  const rightShape = alignRuntimeShape(rightOperandShape, rank);
  const resultShape: number[] = [];
  for (let axis = 0; axis < rank; axis += 1) {
    const leftLength = leftShape[axis];
    const rightLength = rightShape[axis];
    if (leftLength === rightLength) resultShape.push(leftLength);
    else if (leftLength === 1) resultShape.push(rightLength);
    else if (rightLength === 1) resultShape.push(leftLength);
    else return null;
  }
  if (!sameRuntimeShape(leftShape, resultShape) && !sameRuntimeShape(rightShape, resultShape)) return null;

  const resultLength = resultShape.reduce((length, axis) => length * axis, 1);
  const values: RuntimeValue[] = [];
  for (let index = 0; index < resultLength; index += 1) {
    const row = rank === 2 ? Math.floor(index / resultShape[1]) : 0;
    const col = rank === 2 ? index % resultShape[1] : index;
    const leftValue = runtimeOperandValueAt(left, row, col);
    const rightValue = runtimeOperandValueAt(right, row, col);
    if (isError(leftValue)) return leftValue;
    if (isError(rightValue)) return rightValue;
    const result = evaluate(leftValue, rightValue);
    if (isError(result)) return result;
    values.push(result);
  }
  return rank === 1
    ? makeRuntimeArray(values)
    : makeRuntimeView(resultShape[0], resultShape[1], values);
}

function runtimeOperandShape(value: RuntimeValue | RuntimeCollection): number[] {
  if (!isRuntimeCollection(value)) return [];
  return value.kind === "array" ? [value.values.length] : [value.rowCount, value.colCount];
}

function alignRuntimeShape(shape: readonly number[], rank: number): number[] {
  return [...Array<number>(rank - shape.length).fill(1), ...shape];
}

function sameRuntimeShape(left: readonly number[], right: readonly number[]): boolean {
  return left.every((length, axis) => length === right[axis]);
}

function runtimeOperandValueAt(value: RuntimeValue | RuntimeCollection, row: number, col: number): RuntimeValue {
  if (!isRuntimeCollection(value)) return value;
  if (value.kind === "array") return value.values[value.values.length === 1 ? 0 : col];
  const sourceRow = value.rowCount === 1 ? 0 : row;
  const sourceCol = value.colCount === 1 ? 0 : col;
  return value.values[sourceRow * value.colCount + sourceCol];
}

export function runtimeCollectionShapeContext(value: RuntimeCollection): Record<string, unknown> {
  return value.kind === "array"
    ? { kind: "array", length: value.values.length }
    : { kind: "view", rowCount: value.rowCount, colCount: value.colCount };
}

export function isVectorCollection(value: RuntimeCollection): boolean {
  return value.kind === "array" || value.rowCount === 1 || value.colCount === 1;
}
