import { evalArithmetic } from "../arithmetic";
import { isError, makeInternalError } from "../errors";
import type { RuntimeValue, RuntimeCollection } from "../types";

export function sumView(view: RuntimeCollection): RuntimeValue {
  if (isEmptyView(view)) {
    return { kind: "number", value: 0 };
  }
  let result: RuntimeValue = { kind: "number", value: 0 };
  for (const value of collectionValues(view)) {
    if (isError(value)) return value;
    result = evalArithmetic("+", result, value);
    if (isError(result)) return result;
  }
  return result;
}

export function productView(view: RuntimeCollection): RuntimeValue {
  if (isEmptyView(view)) {
    return { kind: "number", value: 1 };
  }
  let result: RuntimeValue = { kind: "number", value: 1 };
  for (const value of collectionValues(view)) {
    if (isError(value)) return value;
    result = evalArithmetic("*", result, value);
    if (isError(result)) return result;
  }
  return result;
}

export function averageView(view: RuntimeCollection): RuntimeValue {
  let total = 0;
  let count = 0;
  for (const value of collectionValues(view)) {
    if (isError(value)) return value;
    if (value.kind === "blank") continue;
    const numberValue = numericCompatibleValue(value);
    if (numberValue === null) {
      return makeInternalError("invalid_function_call", { function: "average", argumentKind: value.kind });
    }
    total += numberValue;
    count += 1;
  }
  if (count === 0) {
    return makeInternalError("invalid_function_call", { function: "average", reason: "empty_numeric_input" });
  }
  return { kind: "number", value: total / count };
}

export function minMaxView(view: RuntimeCollection, op: "min" | "max"): RuntimeValue {
  let result: number | null = null;
  for (const value of collectionValues(view)) {
    if (isError(value)) return value;
    if (value.kind === "blank") continue;
    const numberValue = numericCompatibleValue(value);
    if (numberValue === null) {
      return makeInternalError("invalid_function_call", { function: op, argumentKind: value.kind });
    }
    result = result === null ? numberValue : op === "min" ? Math.min(result, numberValue) : Math.max(result, numberValue);
  }
  if (result === null) {
    return makeInternalError("invalid_function_call", { function: op, reason: "empty_numeric_input" });
  }
  return { kind: "number", value: result };
}

export function countView(view: RuntimeCollection, includeAnyNonBlank: boolean): RuntimeValue {
  let count = 0;
  for (const value of collectionValues(view)) {
    if (isError(value)) return value;
    if (includeAnyNonBlank) {
      if (value.kind !== "blank") count += 1;
    } else if (numericCompatibleValue(value) !== null) {
      count += 1;
    }
  }
  return { kind: "number", value: count };
}

export function integerAggregateView(view: RuntimeCollection, op: "gcd" | "lcm"): RuntimeValue {
  const values: number[] = [];
  for (const value of collectionValues(view)) {
    if (isError(value)) return value;
    if (value.kind !== "number" || !Number.isInteger(value.value)) {
      return makeInternalError("invalid_function_call", { function: op, argumentKind: value.kind });
    }
    values.push(Math.abs(value.value as number));
  }

  if (op === "gcd") {
    return { kind: "number", value: values.reduce((acc, value) => gcd2(acc, value), 0) };
  }
  if (values.length === 0) {
    return { kind: "number", value: 1 };
  }
  return { kind: "number", value: values.reduce((acc, value) => lcm2(acc, value), 1) };
}

export function sumsqView(view: RuntimeCollection): RuntimeValue {
  let total = 0;
  for (const value of collectionValues(view)) {
    if (isError(value)) return value;
    if (value.kind === "blank") continue;
    const numberValue = numericCompatibleValue(value);
    if (numberValue === null) {
      return makeInternalError("invalid_function_call", { function: "sumsq", argumentKind: value.kind });
    }
    total += numberValue ** 2;
  }
  return { kind: "number", value: total };
}

export function collectionValues(view: RuntimeCollection): RuntimeValue[] {
  return view.values;
}

function isEmptyView(view: RuntimeCollection): boolean {
  return view.values.length === 0;
}

function numericCompatibleValue(value: RuntimeValue): number | null {
  if (value.kind === "number") return value.value as number;
  if (value.kind === "boolean") return value.value ? 1 : 0;
  return null;
}

function gcd2(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

function lcm2(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs((a / gcd2(a, b)) * b);
}
