import { isError, makeInternalError } from "./errors";
import type { ErrorRuntimeValue, NumberRuntimeValue, RuntimeValue, RuntimeView } from "./types";
import { dimensionForShape, isRuntimeView, makeRuntimeView } from "./view";

export type RuntimeIndexAxis =
  | {
      kind: "scalar";
      value: RuntimeValue;
    }
  | {
      kind: "slice";
      start: RuntimeValue | null;
      end: RuntimeValue | null;
    };

type NormalizedSlice = { start: number; end: number };
type NormalizedAxis =
  | { kind: "scalar"; index: number }
  | { kind: "slice"; start: number; end: number };

export function evaluateIndexing(
  target: RuntimeValue | RuntimeView,
  axes: readonly RuntimeIndexAxis[],
  functionName: string,
): RuntimeValue | RuntimeView {
  const axisError = firstAxisError(axes);
  if (axisError) return axisError;

  if (!isRuntimeView(target)) {
    return indexText(target, axes, functionName);
  }

  return indexView(target, axes, functionName);
}

export function viewIndexFunction(view: RuntimeView, indexes: readonly RuntimeValue[], functionName: string): RuntimeValue {
  if (indexes.length === 1) {
    if (view.dimension === 2) {
      return makeInternalError("invalid_function_call", { function: functionName, reason: "two_dimensional_view_requires_row_and_col" });
    }
    const index = normalizeScalarIndex(indexes[0], view.values.length, functionName, "index");
    if (isError(index)) return index;
    return view.values[index.value as number] ?? makeInternalError("invalid_function_call", { function: functionName, reason: "index_out_of_bounds" });
  }

  if (indexes.length === 2) {
    const row = normalizeScalarIndex(indexes[0], view.rowCount, functionName, "row");
    if (isError(row)) return row;
    const col = normalizeScalarIndex(indexes[1], view.colCount, functionName, "col");
    if (isError(col)) return col;
    return view.values[(row.value as number) * view.colCount + (col.value as number)]
      ?? makeInternalError("invalid_function_call", { function: functionName, reason: "index_out_of_bounds" });
  }

  return makeInternalError("invalid_function_call", { function: functionName, minArgs: 2, maxArgs: 3, got: indexes.length + 1 });
}

function indexText(value: RuntimeValue, axes: readonly RuntimeIndexAxis[], functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind !== "string") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  if (axes.length !== 1) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "text_requires_one_axis" });
  }

  const characters = Array.from(value.value);
  const axis = axes[0];
  if (axis.kind === "scalar") {
    const index = normalizeScalarIndex(axis.value, characters.length, functionName, "index");
    if (isError(index)) return index;
    return { kind: "string", value: characters[index.value as number] ?? "" };
  }

  const range = normalizeSlice(axis, characters.length, functionName);
  if (isRuntimeError(range)) return range;
  return { kind: "string", value: characters.slice(range.start, range.end).join("") };
}

function indexView(view: RuntimeView, axes: readonly RuntimeIndexAxis[], functionName: string): RuntimeValue | RuntimeView {
  if (axes.length === 1) {
    if (view.dimension === 2) {
      return makeInternalError("invalid_function_call", { function: functionName, reason: "one_axis_indexing_requires_non_matrix_view" });
    }
    return indexOneDimensionalView(view, axes[0], functionName);
  }

  if (axes.length === 2) {
    return indexTwoDimensionalView(view, axes[0], axes[1], functionName);
  }

  return makeInternalError("invalid_function_call", { function: functionName, reason: "invalid_axis_count", axes: axes.length });
}

function indexOneDimensionalView(view: RuntimeView, axis: RuntimeIndexAxis, functionName: string): RuntimeValue | RuntimeView {
  if (axis.kind === "scalar") {
    const index = normalizeScalarIndex(axis.value, view.values.length, functionName, "index");
    if (isError(index)) return index;
    return view.values[index.value as number] ?? makeInternalError("invalid_function_call", { function: functionName, reason: "index_out_of_bounds" });
  }

  const range = normalizeSlice(axis, view.values.length, functionName);
  if (isRuntimeError(range)) return range;
  const values = view.values.slice(range.start, range.end);
  if (view.rowCount === 1) {
    return makeRuntimeView(dimensionForShape(1, values.length), 1, values.length, values);
  }
  return makeRuntimeView(dimensionForShape(values.length, 1), values.length, 1, values);
}

function indexTwoDimensionalView(
  view: RuntimeView,
  rowAxis: RuntimeIndexAxis,
  colAxis: RuntimeIndexAxis,
  functionName: string,
): RuntimeValue | RuntimeView {
  const rowSelection = normalizeAxis(rowAxis, view.rowCount, functionName, "row");
  if (isRuntimeError(rowSelection)) return rowSelection;
  const colSelection = normalizeAxis(colAxis, view.colCount, functionName, "col");
  if (isRuntimeError(colSelection)) return colSelection;

  if (rowSelection.kind === "scalar" && colSelection.kind === "scalar") {
    return view.values[rowSelection.index * view.colCount + colSelection.index]
      ?? makeInternalError("invalid_function_call", { function: functionName, reason: "index_out_of_bounds" });
  }

  const rowIndexes = rowSelection.kind === "scalar" ? [rowSelection.index] : rangeIndexes(rowSelection.start, rowSelection.end);
  const colIndexes = colSelection.kind === "scalar" ? [colSelection.index] : rangeIndexes(colSelection.start, colSelection.end);
  const values: RuntimeValue[] = [];
  for (const row of rowIndexes) {
    for (const col of colIndexes) {
      values.push(view.values[row * view.colCount + col] ?? { kind: "blank", value: null });
    }
  }

  return makeRuntimeView(dimensionForShape(rowIndexes.length, colIndexes.length), rowIndexes.length, colIndexes.length, values);
}

function normalizeAxis(
  axis: RuntimeIndexAxis,
  length: number,
  functionName: string,
  axisName: string,
): NormalizedAxis | ErrorRuntimeValue {
  if (axis.kind === "scalar") {
    const index = normalizeScalarIndex(axis.value, length, functionName, axisName);
    if (isError(index)) return index;
    return { kind: "scalar", index: index.value as number };
  }
  const range = normalizeSlice(axis, length, functionName);
  if (isRuntimeError(range)) return range;
  return { kind: "slice", start: range.start, end: range.end };
}

function normalizeScalarIndex(value: RuntimeValue, length: number, functionName: string, axisName: string): NumberRuntimeValue | ErrorRuntimeValue {
  if (isError(value)) return value;
  if (value.kind !== "number") {
    return makeInternalError("invalid_function_call", { function: functionName, argument: axisName, argumentKind: value.kind });
  }
  const raw = value.value as number;
  if (!Number.isInteger(raw)) {
    return makeInternalError("invalid_function_call", { function: functionName, argument: axisName, reason: "integer_required" });
  }
  const normalized = raw < 0 ? length + raw : raw;
  if (normalized < 0 || normalized >= length) {
    return makeInternalError("invalid_function_call", { function: functionName, argument: axisName, reason: "index_out_of_bounds", index: raw });
  }
  return { kind: "number", value: normalized };
}

function normalizeSlice(axis: Extract<RuntimeIndexAxis, { kind: "slice" }>, length: number, functionName: string): ErrorRuntimeValue | NormalizedSlice {
  const rawStart = axis.start === null ? 0 : normalizeSliceBound(axis.start, length, functionName, "start");
  if (typeof rawStart !== "number") return rawStart;
  const rawEnd = axis.end === null ? length : normalizeSliceBound(axis.end, length, functionName, "end");
  if (typeof rawEnd !== "number") return rawEnd;
  const start = rawStart;
  const end = rawEnd;
  return start <= end ? { start, end } : { start, end: start };
}

function normalizeSliceBound(value: RuntimeValue, length: number, functionName: string, boundName: string): ErrorRuntimeValue | number {
  if (isError(value)) return value;
  if (value.kind !== "number") {
    return makeInternalError("invalid_function_call", { function: functionName, argument: boundName, argumentKind: value.kind });
  }
  const raw = value.value as number;
  if (!Number.isInteger(raw)) {
    return makeInternalError("invalid_function_call", { function: functionName, argument: boundName, reason: "integer_required" });
  }
  const normalized = raw < 0 ? length + raw : raw;
  return Math.min(Math.max(normalized, 0), length);
}

function firstAxisError(axes: readonly RuntimeIndexAxis[]): RuntimeValue | null {
  for (const axis of axes) {
    if (axis.kind === "scalar") {
      if (isError(axis.value)) return axis.value;
    } else {
      if (axis.start && isError(axis.start)) return axis.start;
      if (axis.end && isError(axis.end)) return axis.end;
    }
  }
  return null;
}

function rangeIndexes(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_item, offset) => start + offset);
}

function isRuntimeError(value: unknown): value is RuntimeValue & { kind: "error" } {
  return isError(value as RuntimeValue);
}
