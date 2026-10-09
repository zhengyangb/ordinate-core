import { evalScalarComparison } from "../comparison";
import { isError, makeInternalError } from "../errors";
import { evaluateIndexing, type RuntimeIndexAxis } from "../indexing";
import type { ErrorRuntimeValue, NumberRuntimeValue, RuntimeValue, RuntimeCollection } from "../types";
import { isVectorCollection } from "../view";

export function matchView(value: RuntimeValue, keys: RuntimeCollection, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  for (let index = 0; index < keys.values.length; index += 1) {
    const key = keys.values[index];
    if (isError(key)) return key;
    const compared = evalScalarComparison("==", key, value);
    if (isError(compared)) return compared;
    if (compared.value) {
      return { kind: "number", value: index };
    }
  }
  return makeInternalError("lookup_not_found", { function: functionName });
}

export function lookupView(
  key: RuntimeValue,
  keys: RuntimeCollection,
  values: RuntimeCollection,
  functionName: string,
): RuntimeValue {
  if (!isVectorCollection(keys) || !isVectorCollection(values)) {
    return makeInternalError("invalid_function_call", {
      function: functionName,
      reason: "lookup_requires_one_dimensional_views",
    });
  }
  if (keys.values.length !== values.values.length) {
    return makeInternalError("invalid_function_call", {
      function: functionName,
      reason: "length_mismatch",
      keysLength: keys.values.length,
      valuesLength: values.values.length,
    });
  }

  const matched = matchView(key, keys, functionName);
  if (isError(matched)) return matched;
  return values.values[matched.value as number] ?? makeInternalError("lookup_not_found", { function: functionName });
}

export function takeValue(target: RuntimeValue | RuntimeCollection, count: RuntimeValue, functionName: string): RuntimeValue | RuntimeCollection {
  const normalizedCount = selectionCount(count, functionName);
  if (isError(normalizedCount)) return normalizedCount;
  const axis = normalizedCount.value >= 0
    ? sliceAxis(null, normalizedCount)
    : sliceAxis(normalizedCount, null);
  return evaluateSelectionSlice(target, axis, functionName);
}

export function dropValue(target: RuntimeValue | RuntimeCollection, count: RuntimeValue, functionName: string): RuntimeValue | RuntimeCollection {
  const normalizedCount = selectionCount(count, functionName);
  if (isError(normalizedCount)) return normalizedCount;
  const axis = normalizedCount.value >= 0
    ? sliceAxis(normalizedCount, null)
    : sliceAxis(null, normalizedCount);
  return evaluateSelectionSlice(target, axis, functionName);
}

function evaluateSelectionSlice(
  target: RuntimeValue | RuntimeCollection,
  axis: RuntimeIndexAxis,
  functionName: string,
): RuntimeValue | RuntimeCollection {
  if (target.kind === "view" && target.rowCount > 1 && target.colCount > 1) {
    return evaluateIndexing(target, [axis, sliceAxis(null, null)], functionName);
  }
  return evaluateIndexing(target, [axis], functionName);
}

function selectionCount(count: RuntimeValue, functionName: string): NumberRuntimeValue | ErrorRuntimeValue {
  if (isError(count)) return count;
  if (count.kind !== "number") {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "count", argumentKind: count.kind });
  }
  if (!Number.isInteger(count.value)) {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "count", reason: "integer_required" });
  }
  return count;
}

function sliceAxis(start: RuntimeValue | null, end: RuntimeValue | null): RuntimeIndexAxis {
  return { kind: "slice", start, end };
}
