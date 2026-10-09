import { isError, makeInternalError } from "../errors";
import type { RuntimeValue, RuntimeCollection } from "../types";
import { runtimeCollectionShapeContext, runtimeCollectionShapesMatch } from "../view";
import { collectionValues } from "./aggregates";

type NumericInput = number[] | RuntimeValue;
type PairedInput = { x: number[]; y: number[] } | RuntimeValue;

export function numericCompatibleScalar(value: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind === "number") return value;
  if (value.kind === "boolean") return { kind: "number", value: value.value ? 1 : 0 };
  return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
}

export function numericCompatibleValues(view: RuntimeCollection, functionName: string): NumericInput {
  const values: number[] = [];
  for (const value of collectionValues(view)) {
    if (isError(value)) return value;
    if (value.kind === "blank") continue;
    const numberValue = numericCompatibleScalar(value, functionName);
    if (isError(numberValue)) return numberValue;
    values.push(numberValue.value as number);
  }
  return values;
}

export function countBlankView(view: RuntimeCollection): RuntimeValue {
  let count = 0;
  for (const value of collectionValues(view)) {
    if (isError(value)) return value;
    if (value.kind === "blank") count += 1;
  }
  return { kind: "number", value: count };
}

export function medianView(view: RuntimeCollection, functionName: string): RuntimeValue {
  const values = numericCompatibleValues(view, functionName);
  if (isNumericInputError(values)) return values;
  if (values.length === 0) return emptyNumericInput(functionName);
  const sorted = sortAscending(values);
  const middle = sorted.length / 2;
  if (Number.isInteger(middle)) {
    return { kind: "number", value: (sorted[middle - 1] + sorted[middle]) / 2 };
  }
  return { kind: "number", value: sorted[Math.floor(middle)] };
}

export function percentileView(view: RuntimeCollection, p: RuntimeValue, functionName: string): RuntimeValue {
  const percentile = numericCompatibleScalar(p, functionName);
  if (isError(percentile)) return percentile;
  const pValue = percentile.value as number;
  if (pValue < 0 || pValue > 1) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "percentile_out_of_range", value: pValue });
  }

  const values = numericCompatibleValues(view, functionName);
  if (isNumericInputError(values)) return values;
  if (values.length === 0) return emptyNumericInput(functionName);
  return { kind: "number", value: percentileFromSorted(sortAscending(values), pValue) };
}

export function quartileView(view: RuntimeCollection, quartile: RuntimeValue, functionName: string): RuntimeValue {
  const q = numericCompatibleScalar(quartile, functionName);
  if (isError(q)) return q;
  const qValue = q.value as number;
  if (!Number.isInteger(qValue) || qValue < 0 || qValue > 4) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "quartile_out_of_range", value: qValue });
  }
  return percentileView(view, { kind: "number", value: qValue / 4 }, functionName);
}

export function varianceView(view: RuntimeCollection, sample: boolean, functionName: string): RuntimeValue {
  const values = numericCompatibleValues(view, functionName);
  if (isNumericInputError(values)) return values;
  return varianceFromValues(values, sample, functionName);
}

export function stdevView(view: RuntimeCollection, sample: boolean, functionName: string): RuntimeValue {
  const variance = varianceView(view, sample, functionName);
  if (isError(variance)) return variance;
  return { kind: "number", value: Math.sqrt(variance.value as number) };
}

export function averageDeviationView(view: RuntimeCollection, functionName: string): RuntimeValue {
  const values = numericCompatibleValues(view, functionName);
  if (isNumericInputError(values)) return values;
  if (values.length === 0) return emptyNumericInput(functionName);
  const mean = average(values);
  return { kind: "number", value: average(values.map((value) => Math.abs(value - mean))) };
}

export function devsqView(view: RuntimeCollection, functionName: string): RuntimeValue {
  const values = numericCompatibleValues(view, functionName);
  if (isNumericInputError(values)) return values;
  if (values.length === 0) return emptyNumericInput(functionName);
  const mean = average(values);
  return { kind: "number", value: values.reduce((total, value) => total + (value - mean) ** 2, 0) };
}

export function geomeanView(view: RuntimeCollection, functionName: string): RuntimeValue {
  const values = numericCompatibleValues(view, functionName);
  if (isNumericInputError(values)) return values;
  if (values.length === 0) return emptyNumericInput(functionName);
  if (values.some((value) => value <= 0)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "non_positive_input" });
  }
  return { kind: "number", value: Math.exp(values.reduce((total, value) => total + Math.log(value), 0) / values.length) };
}

export function harmeanView(view: RuntimeCollection, functionName: string): RuntimeValue {
  const values = numericCompatibleValues(view, functionName);
  if (isNumericInputError(values)) return values;
  if (values.length === 0) return emptyNumericInput(functionName);
  if (values.some((value) => value <= 0)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "non_positive_input" });
  }
  return { kind: "number", value: values.length / values.reduce((total, value) => total + 1 / value, 0) };
}

export function largeSmallView(view: RuntimeCollection, k: RuntimeValue, order: "large" | "small", functionName: string): RuntimeValue {
  const ordinal = positiveInteger(k, functionName, "k");
  if (isError(ordinal)) return ordinal;
  const values = numericCompatibleValues(view, functionName);
  if (isNumericInputError(values)) return values;
  if (values.length === 0) return emptyNumericInput(functionName);
  const sorted = sortAscending(values);
  const kValue = ordinal.value as number;
  if (kValue > sorted.length) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "k_out_of_range", k: kValue, count: sorted.length });
  }
  const index = order === "small" ? kValue - 1 : sorted.length - kValue;
  return { kind: "number", value: sorted[index] };
}

export function rankView(value: RuntimeValue, view: RuntimeCollection, ascending: RuntimeValue | null, functionName: string): RuntimeValue {
  const ranked = numericCompatibleScalar(value, functionName);
  if (isError(ranked)) return ranked;
  const values = numericCompatibleValues(view, functionName);
  if (isNumericInputError(values)) return values;
  if (values.length === 0) return emptyNumericInput(functionName);

  let isAscending = false;
  if (ascending !== null) {
    const order = numericCompatibleScalar(ascending, functionName);
    if (isError(order)) return order;
    isAscending = (order.value as number) !== 0;
  }

  const target = ranked.value as number;
  const position = values.filter((item) => (isAscending ? item < target : item > target)).length + 1;
  return { kind: "number", value: position };
}

export function modeView(view: RuntimeCollection, functionName: string): RuntimeValue {
  const values = numericCompatibleValues(view, functionName);
  if (isNumericInputError(values)) return values;
  if (values.length === 0) return emptyNumericInput(functionName);

  const frequencies = new Map<number, number>();
  for (const value of values) {
    frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  }

  let bestValue: number | null = null;
  let bestCount = 0;
  for (const [value, count] of frequencies) {
    if (count > bestCount || (count === bestCount && bestValue !== null && value < bestValue)) {
      bestValue = value;
      bestCount = count;
    }
  }
  return { kind: "number", value: bestValue ?? values[0] };
}

export function correlView(xView: RuntimeCollection, yView: RuntimeCollection, functionName: string): RuntimeValue {
  const pair = pairedNumericValues(xView, yView, functionName);
  if (isPairedInputError(pair)) return pair;
  if (pair.x.length < 2) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "insufficient_paired_input" });
  }
  const xMean = average(pair.x);
  const yMean = average(pair.y);
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let index = 0; index < pair.x.length; index += 1) {
    const dx = pair.x[index] - xMean;
    const dy = pair.y[index] - yMean;
    xy += dx * dy;
    xx += dx * dx;
    yy += dy * dy;
  }
  if (xx === 0 || yy === 0) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "zero_variance_input" });
  }
  return { kind: "number", value: xy / Math.sqrt(xx * yy) };
}

export function covarianceView(xView: RuntimeCollection, yView: RuntimeCollection, sample: boolean, functionName: string): RuntimeValue {
  const pair = pairedNumericValues(xView, yView, functionName);
  if (isPairedInputError(pair)) return pair;
  if (pair.x.length < (sample ? 2 : 1)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "insufficient_paired_input" });
  }
  const xMean = average(pair.x);
  const yMean = average(pair.y);
  let total = 0;
  for (let index = 0; index < pair.x.length; index += 1) {
    total += (pair.x[index] - xMean) * (pair.y[index] - yMean);
  }
  return { kind: "number", value: total / (sample ? pair.x.length - 1 : pair.x.length) };
}

export function slopeInterceptView(yView: RuntimeCollection, xView: RuntimeCollection, functionName: string): RuntimeValue {
  const line = linearRegression(yView, xView, functionName);
  if (isRegressionError(line)) return line;
  return { kind: "number", value: functionName.toLowerCase() === "intercept" ? line.intercept : line.slope };
}

export function forecastValue(x: RuntimeValue, yView: RuntimeCollection, xView: RuntimeCollection, functionName: string): RuntimeValue {
  const xValue = numericCompatibleScalar(x, functionName);
  if (isError(xValue)) return xValue;
  const line = linearRegression(yView, xView, functionName);
  if (isRegressionError(line)) return line;
  return { kind: "number", value: line.intercept + line.slope * (xValue.value as number) };
}

export function standardizeValue(x: RuntimeValue, mean: RuntimeValue, stdev: RuntimeValue, functionName: string): RuntimeValue {
  const xValue = numericCompatibleScalar(x, functionName);
  if (isError(xValue)) return xValue;
  const meanValue = numericCompatibleScalar(mean, functionName);
  if (isError(meanValue)) return meanValue;
  const stdevValue = numericCompatibleScalar(stdev, functionName);
  if (isError(stdevValue)) return stdevValue;
  const divisor = stdevValue.value as number;
  if (divisor <= 0) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "non_positive_stdev" });
  }
  return { kind: "number", value: ((xValue.value as number) - (meanValue.value as number)) / divisor };
}

function pairedNumericValues(xView: RuntimeCollection, yView: RuntimeCollection, functionName: string): PairedInput {
  if (!runtimeCollectionShapesMatch(xView, yView)) {
    return makeInternalError("invalid_function_call", {
      function: functionName,
      reason: "shape_mismatch",
      left: runtimeCollectionShapeContext(xView),
      right: runtimeCollectionShapeContext(yView),
    });
  }

  const x: number[] = [];
  const y: number[] = [];
  for (let index = 0; index < xView.values.length; index += 1) {
    const xRaw = xView.values[index];
    const yRaw = yView.values[index];
    if (isError(xRaw)) return xRaw;
    if (isError(yRaw)) return yRaw;
    if (xRaw.kind === "blank" || yRaw.kind === "blank") continue;
    const xValue = numericCompatibleScalar(xRaw, functionName);
    if (isError(xValue)) return xValue;
    const yValue = numericCompatibleScalar(yRaw, functionName);
    if (isError(yValue)) return yValue;
    x.push(xValue.value as number);
    y.push(yValue.value as number);
  }
  return { x, y };
}

function linearRegression(yView: RuntimeCollection, xView: RuntimeCollection, functionName: string): { slope: number; intercept: number } | RuntimeValue {
  const pair = pairedNumericValues(xView, yView, functionName);
  if (isPairedInputError(pair)) return pair;
  if (pair.x.length < 2) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "insufficient_paired_input" });
  }
  const xMean = average(pair.x);
  const yMean = average(pair.y);
  let xy = 0;
  let xx = 0;
  for (let index = 0; index < pair.x.length; index += 1) {
    const dx = pair.x[index] - xMean;
    xy += dx * (pair.y[index] - yMean);
    xx += dx * dx;
  }
  if (xx === 0) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "zero_variance_input" });
  }
  const slope = xy / xx;
  return { slope, intercept: yMean - slope * xMean };
}

function varianceFromValues(values: number[], sample: boolean, functionName: string): RuntimeValue {
  if (values.length < (sample ? 2 : 1)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "insufficient_numeric_input" });
  }
  const mean = average(values);
  const total = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return { kind: "number", value: total / (sample ? values.length - 1 : values.length) };
}

function percentileFromSorted(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function positiveInteger(value: RuntimeValue, functionName: string, argumentName: string): RuntimeValue {
  const numberValue = numericCompatibleScalar(value, functionName);
  if (isError(numberValue)) return numberValue;
  const raw = numberValue.value as number;
  if (!Number.isInteger(raw) || raw < 1) {
    return makeInternalError("invalid_function_call", { function: functionName, argument: argumentName, reason: "positive_integer_required" });
  }
  return numberValue;
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sortAscending(values: number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

function emptyNumericInput(functionName: string): RuntimeValue {
  return makeInternalError("invalid_function_call", { function: functionName, reason: "empty_numeric_input" });
}

function isNumericInputError(value: NumericInput): value is RuntimeValue {
  return !Array.isArray(value);
}

function isPairedInputError(value: PairedInput): value is RuntimeValue {
  return "kind" in value;
}

function isRegressionError(value: { slope: number; intercept: number } | RuntimeValue): value is RuntimeValue {
  return "kind" in value;
}
