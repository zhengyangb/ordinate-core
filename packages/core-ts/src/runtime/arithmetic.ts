import { makeInternalError } from "./errors";
import { evalTemporalArithmetic } from "./temporal";
import type { BooleanRuntimeValue, RuntimeValue } from "./types";

// Evaluate arithmetic with RFC-0006 coercion rules.
export function evalArithmetic(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  const temporal = evalTemporalArithmetic(op, left, right);
  if (temporal) return temporal;

  if (left.kind === "blank" && right.kind === "blank") {
    if (op === "+" || op === "-" || op === "*") {
      return { kind: "blank", value: null };
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "string" && right.kind === "string") {
    if (op === "+") {
      return { kind: "string", value: String(left.value) + String(right.value) };
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "blank" && right.kind === "string") {
    if (op === "+") {
      return { kind: "string", value: String(right.value) };
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "string" && right.kind === "blank") {
    if (op === "+") {
      return { kind: "string", value: String(left.value) };
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "blank" && right.kind === "number") {
    if (op === "/") {
      return { kind: "number", value: 0 };
    }
    if (op === "+" || op === "-" || op === "*") {
      return evalNumberOp(op, 0, right.value as number);
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "number" && right.kind === "blank") {
    if (op === "/") {
      return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
    }
    if (op === "+" || op === "-" || op === "*") {
      return evalNumberOp(op, left.value as number, 0);
    }
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (left.kind === "boolean" && right.kind === "number") {
    return evalNumberOp(op, boolToNumber(left), right.value as number);
  }

  if (left.kind === "number" && right.kind === "boolean") {
    return evalNumberOp(op, left.value as number, boolToNumber(right));
  }

  if (left.kind === "boolean" && right.kind === "boolean") {
    return evalNumberOp(op, boolToNumber(left), boolToNumber(right));
  }

  if (left.kind === "number" && right.kind === "number") {
    return evalNumberOp(op, left.value as number, right.value as number);
  }

  return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
}

export function evalPower(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (left.kind !== "number" || right.kind !== "number") {
    return makeInternalError("invalid_arithmetic", { operator: "**", leftKind: left.kind, rightKind: right.kind });
  }
  const value = Math.pow(left.value as number, right.value as number);
  if (!Number.isFinite(value)) {
    return makeInternalError("invalid_arithmetic", { operator: "**", reason: "non_finite_result" });
  }
  return { kind: "number", value };
}

function evalNumberOp(op: string, left: number, right: number): RuntimeValue {
  if (op === "+") return { kind: "number", value: left + right };
  if (op === "-") return { kind: "number", value: left - right };
  if (op === "*") return { kind: "number", value: left * right };
  if (right === 0) return makeInternalError("divide_by_zero");
  return { kind: "number", value: left / right };
}

function boolToNumber(value: BooleanRuntimeValue): number {
  return value.value ? 1 : 0;
}
