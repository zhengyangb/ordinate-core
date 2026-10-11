import { isError, makeInternalError } from "../errors";
import type { RuntimeValue, RuntimeCollection } from "../types";
import { makeRuntimeArray, runtimeCollectionShapeContext, runtimeCollectionShapesMatch } from "../view";

export function filterView(values: RuntimeCollection, mask: RuntimeCollection, functionName: string): RuntimeValue | RuntimeCollection {
  if (!runtimeCollectionShapesMatch(values, mask)) {
    return makeInternalError("invalid_function_call", {
      function: functionName,
      reason: "shape_mismatch",
      valuesShape: runtimeCollectionShapeContext(values),
      maskShape: runtimeCollectionShapeContext(mask),
    });
  }

  const kept: RuntimeValue[] = [];
  for (let index = 0; index < values.values.length; index += 1) {
    const value = values.values[index];
    const maskValue = mask.values[index];
    if (isError(value)) return value;
    if (isError(maskValue)) return maskValue;
    if (maskValue.kind !== "boolean") {
      return makeInternalError("invalid_function_call", {
        function: functionName,
        reason: "non_boolean_mask",
        argumentKind: maskValue.kind,
      });
    }
    if (maskValue.value) {
      kept.push(value);
    }
  }

  return makeRuntimeArray(kept);
}
