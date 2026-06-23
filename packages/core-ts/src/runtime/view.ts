import type { RuntimeValue, RuntimeView, ViewSelection } from "./types";

export type EvalCell = (rowIndex: number, colIndex: number) => RuntimeValue;

export function makeRuntimeView(
  dimension: RuntimeView["dimension"],
  rowCount: number,
  colCount: number,
  values: RuntimeValue[],
): RuntimeView {
  if (rowCount < 0 || colCount < 0 || !Number.isInteger(rowCount) || !Number.isInteger(colCount)) {
    throw new Error(`invalid runtime view shape ${rowCount}x${colCount}`);
  }
  if (values.length !== rowCount * colCount) {
    throw new Error(`runtime view shape ${rowCount}x${colCount} does not match ${values.length} values`);
  }
  if (!isValidDimension(dimension, rowCount, colCount)) {
    throw new Error(`runtime view dimension d=${dimension} is invalid for shape ${rowCount}x${colCount}`);
  }
  return { kind: "view", dimension, rowCount, colCount, values };
}

export function materializeViewSelection(view: ViewSelection, evalCell: EvalCell): RuntimeView {
  const values: RuntimeValue[] = [];
  for (const rowIndex of view.rowIndices) {
    for (const colIndex of view.colIndices) {
      values.push(evalCell(rowIndex, colIndex));
    }
  }
  return makeRuntimeView(
    dimensionForShape(view.rowIndices.length, view.colIndices.length),
    view.rowIndices.length,
    view.colIndices.length,
    values,
  );
}

export function isRuntimeView(value: unknown): value is RuntimeView {
  return (
    typeof value === "object"
    && value !== null
    && (value as { kind?: unknown }).kind === "view"
    && Array.isArray((value as { values?: unknown }).values)
  );
}

export function runtimeViewScalarValue(view: RuntimeView): RuntimeValue | null {
  if (view.dimension === 0 && view.rowCount === 1 && view.colCount === 1) {
    return view.values[0] ?? { kind: "blank", value: null };
  }
  return null;
}

export function runtimeViewShapesMatch(left: RuntimeView, right: RuntimeView): boolean {
  return left.dimension === right.dimension && left.rowCount === right.rowCount && left.colCount === right.colCount;
}

export function runtimeViewShapeContext(view: RuntimeView): Record<string, unknown> {
  return { dimension: view.dimension, rowCount: view.rowCount, colCount: view.colCount };
}

export function dimensionForShape(rowCount: number, colCount: number): RuntimeView["dimension"] {
  if (rowCount === 1 && colCount === 1) return 0;
  if (rowCount === 1 || colCount === 1) return 1;
  return 2;
}

function isValidDimension(dimension: RuntimeView["dimension"], rowCount: number, colCount: number): boolean {
  if (dimension === 0) return rowCount === 1 && colCount === 1;
  if (dimension === 1) return rowCount === 1 || colCount === 1;
  return rowCount !== 1 && colCount !== 1;
}
