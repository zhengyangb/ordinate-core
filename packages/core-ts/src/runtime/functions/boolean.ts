import { isError, makeInternalError } from "../errors";
import type { RuntimeValue, RuntimeCollection } from "../types";
import { mapRuntimeCollection } from "../view";
import { collectionValues } from "./aggregates";

export function notValue(value: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind !== "boolean") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  return { kind: "boolean", value: !value.value };
}

export function booleanAggregateView(view: RuntimeCollection, op: "and" | "or"): RuntimeValue {
  let result = op === "and";
  for (const value of collectionValues(view)) {
    if (isError(value)) return value;
    if (value.kind !== "boolean") {
      return makeInternalError("invalid_function_call", { function: op, argumentKind: value.kind });
    }
    if (op === "and") {
      result = result && value.value;
    } else {
      result = result || value.value;
    }
  }
  return { kind: "boolean", value: result };
}

export function notView(view: RuntimeCollection, functionName: string): RuntimeValue | RuntimeCollection {
  const values: RuntimeValue[] = [];
  for (const value of collectionValues(view)) {
    const mapped = notValue(value, functionName);
    if (isError(mapped)) return mapped;
    values.push(mapped);
  }
  return mapRuntimeCollection(view, values);
}
