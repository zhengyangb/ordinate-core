import { isError, makeInternalError } from "../errors";
import type { RuntimeValue, RuntimeView } from "../types";
import { makeRuntimeView, runtimeViewShapesMatch } from "../view";

export function filterView(values: RuntimeView, mask: RuntimeView, functionName: string): RuntimeValue | RuntimeView {
  if (!runtimeViewShapesMatch(values, mask)) {
    return makeInternalError("invalid_function_call", {
      function: functionName,
      reason: "shape_mismatch",
      valuesShape: { rowCount: values.rowCount, colCount: values.colCount },
      maskShape: { rowCount: mask.rowCount, colCount: mask.colCount },
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

  return makeRuntimeView(1, 1, kept.length, kept);
}
