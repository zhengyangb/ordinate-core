import { isError, makeInternalError } from "../errors";
import type { RuntimeValue, RuntimeView } from "../types";
import { viewValues } from "./aggregates";

export function notValue(value: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind !== "boolean") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  return { kind: "boolean", value: !value.value };
}

export function booleanAggregateView(view: RuntimeView, op: "and" | "or"): RuntimeValue {
  let result = op === "and";
  for (const value of viewValues(view)) {
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
