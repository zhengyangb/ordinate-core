import { isError, makeInternalError } from "../errors";
import type { RuntimeValue, RuntimeView } from "../types";
import { makeRuntimeView } from "../view";
import type { FunctionEvalContext } from "./args";

type TypePredicate = (value: RuntimeValue) => boolean;
type TypeConversion = (value: RuntimeValue, functionName: string) => RuntimeValue;

const NUMERIC_STRING_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

export function isNumberValue(value: RuntimeValue): boolean {
  return value.kind === "number";
}

/** Exact native type test, not date-looking text or an Excel serial heuristic. */
export function isDateValue(value: RuntimeValue): boolean {
  return value.kind === "date";
}

export function isTextValue(value: RuntimeValue): boolean {
  return value.kind === "string";
}

export function isBooleanValue(value: RuntimeValue): boolean {
  return value.kind === "boolean";
}

export function isBlankValue(value: RuntimeValue): boolean {
  return value.kind === "blank";
}

export function isNullValue(value: RuntimeValue): boolean {
  return value.kind === "null";
}

export function isErrorValue(value: RuntimeValue): boolean {
  return isError(value);
}

export function numberValue(value: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind === "number") return value;
  if (value.kind === "boolean") return { kind: "number", value: value.value ? 1 : 0 };
  if (value.kind === "string") {
    const text = value.value.trim();
    if (!NUMERIC_STRING_RE.test(text)) {
      return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind, reason: "invalid_numeric_string" });
    }
    return { kind: "number", value: Number(text) };
  }
  return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
}

export function textValue(value: RuntimeValue, _functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind === "string") return value;
  if (value.kind === "number") return { kind: "string", value: String(value.value) };
  if (value.kind === "boolean") return { kind: "string", value: value.value ? "true" : "false" };
  if (value.kind === "blank") return { kind: "string", value: "" };
  if (value.kind === "null") return { kind: "string", value: "null" };
  if (value.kind === "date" || value.kind === "time" || value.kind === "datetime" || value.kind === "duration") {
    return { kind: "string", value: value.value };
  }
  return value;
}

export function booleanValue(value: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind === "boolean") return value;
  if (value.kind === "number") return { kind: "boolean", value: value.value !== 0 };
  if (value.kind === "string") {
    const text = value.value.trim();
    if (text === "true") return { kind: "boolean", value: true };
    if (text === "false") return { kind: "boolean", value: false };
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind, reason: "invalid_boolean_string" });
  }
  return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
}

export function evaluateTypePredicate(
  ctx: FunctionEvalContext,
  node: Parameters<FunctionEvalContext["evalRawArgValue"]>[0],
  predicate: TypePredicate,
): RuntimeValue | RuntimeView {
  const [kind, value] = ctx.evalRawArgValue(node);
  return mapTypeArgument(kind, value, (item) => ({ kind: "boolean", value: predicate(item) }), false);
}

export function evaluateTypeConversion(
  ctx: FunctionEvalContext,
  functionName: string,
  node: Parameters<FunctionEvalContext["evalRawArgValue"]>[0],
  convert: TypeConversion,
): RuntimeValue | RuntimeView {
  const [kind, value] = ctx.evalRawArgValue(node);
  return mapTypeArgument(kind, value, (item) => convert(item, functionName), true);
}

function mapTypeArgument(
  kind: "error" | "scalar" | "view",
  value: RuntimeValue | RuntimeView,
  mapValue: (value: RuntimeValue) => RuntimeValue,
  propagateErrors: boolean,
): RuntimeValue | RuntimeView {
  if (kind === "error") {
    const errorValue = value as RuntimeValue;
    return propagateErrors ? errorValue : mapValue(errorValue);
  }
  if (kind === "scalar") {
    const scalar = value as RuntimeValue;
    return propagateErrors && isError(scalar) ? scalar : mapValue(scalar);
  }

  const view = value as RuntimeView;
  const values: RuntimeValue[] = [];
  for (const item of view.values) {
    if (propagateErrors && isError(item)) return item;
    const mapped = mapValue(item);
    if (isError(mapped)) return mapped;
    values.push(mapped);
  }
  return makeRuntimeView(view.dimension, view.rowCount, view.colCount, values);
}
