import { evalPower } from "../arithmetic";
import { isError, makeInternalError } from "../errors";
import type { RuntimeValue } from "../types";

export function absValue(value: RuntimeValue): RuntimeValue {
  if (isError(value)) return value;
  return { kind: "number", value: Math.abs(value.value as number) };
}

export function signValue(value: RuntimeValue): RuntimeValue {
  if (isError(value)) return value;
  const numberValue = value.value as number;
  if (numberValue < 0) return { kind: "number", value: -1 };
  if (numberValue > 0) return { kind: "number", value: 1 };
  return { kind: "number", value: 0 };
}

export function roundValue(value: RuntimeValue, digits: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (isError(digits)) return digits;
  return roundAtDigits(value.value as number, digits.value as number, functionName, "nearest");
}

export function roundupValue(value: RuntimeValue, digits: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (isError(digits)) return digits;
  return roundAtDigits(value.value as number, digits.value as number, functionName, "away_from_zero");
}

export function rounddownValue(value: RuntimeValue, digits: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (isError(digits)) return digits;
  return roundAtDigits(value.value as number, digits.value as number, functionName, "toward_zero");
}

export function truncValue(value: RuntimeValue, digits: RuntimeValue, functionName: string): RuntimeValue {
  return rounddownValue(value, digits, functionName);
}

export function floorValue(value: RuntimeValue): RuntimeValue {
  if (isError(value)) return value;
  return { kind: "number", value: Math.floor(value.value as number) };
}

export function ceilValue(value: RuntimeValue): RuntimeValue {
  if (isError(value)) return value;
  return { kind: "number", value: Math.ceil(value.value as number) };
}

export function modValue(value: RuntimeValue, divisor: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (isError(divisor)) return divisor;
  if (divisor.value === 0) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "zero_divisor" });
  }
  return { kind: "number", value: (value.value as number) % (divisor.value as number) };
}

export function powerValue(base: RuntimeValue, exponent: RuntimeValue): RuntimeValue {
  if (isError(base)) return base;
  if (isError(exponent)) return exponent;
  return evalPower(base, exponent);
}

export function sqrtValue(value: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if ((value.value as number) < 0) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "negative_argument" });
  }
  return { kind: "number", value: Math.sqrt(value.value as number) };
}

export function piValue(): RuntimeValue {
  return { kind: "number", value: Math.PI };
}

function roundAtDigits(
  value: number,
  digits: number,
  functionName: string,
  mode: "nearest" | "away_from_zero" | "toward_zero",
): RuntimeValue {
  if (!Number.isInteger(digits)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "non_integer_digits" });
  }

  const factor = Math.pow(10, digits);
  if (!Number.isFinite(factor)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "non_finite_digits_scale" });
  }

  const scaled = value * factor;
  let rounded: number;
  if (mode === "nearest") {
    rounded = Math.round(scaled);
  } else if (mode === "away_from_zero") {
    rounded = Math.sign(scaled) * Math.ceil(Math.abs(scaled));
  } else {
    rounded = Math.sign(scaled) * Math.floor(Math.abs(scaled));
  }

  const result = rounded / factor;
  if (!Number.isFinite(result)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "non_finite_result" });
  }
  return { kind: "number", value: Object.is(result, -0) ? 0 : result };
}
