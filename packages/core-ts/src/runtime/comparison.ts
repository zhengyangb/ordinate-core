import { makeInternalError } from "./errors";
import { evalTemporalEquality } from "./temporal";
import type { RuntimeValue } from "./types";

export function evalScalarComparison(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (["==", "!="].includes(op)) {
    return evalEquality(op, left, right);
  }
  return evalOrdering(op, left, right);
}

function evalEquality(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (left.kind === "error" || right.kind === "error") {
    return makeInternalError("invalid_comparison_error_operand", { operator: op });
  }
  const temporal = evalTemporalEquality(op as "==" | "!=", left, right);
  if (temporal) return temporal;
  if (left.kind === "blank" && right.kind === "blank") {
    return { kind: "boolean", value: op === "==" };
  }
  if (left.kind === "blank" || right.kind === "blank") {
    return { kind: "boolean", value: op === "!=" };
  }
  if (left.kind === "null" && right.kind === "null") {
    return { kind: "boolean", value: op === "==" };
  }
  if (left.kind === "null" || right.kind === "null") {
    return makeInternalError("invalid_comparison", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }
  if (left.kind !== right.kind) {
    return makeInternalError("invalid_comparison", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }
  const result = left.value === right.value;
  return { kind: "boolean", value: op === "==" ? result : !result };
}

function evalOrdering(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (left.kind === "error" || right.kind === "error") {
    return makeInternalError("invalid_comparison_error_operand", { operator: op });
  }
  if (left.kind !== "number" || right.kind !== "number") {
    return makeInternalError("invalid_comparison", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }
  if (op === "<") return { kind: "boolean", value: (left.value as number) < (right.value as number) };
  if (op === ">") return { kind: "boolean", value: (left.value as number) > (right.value as number) };
  if (op === "<=") return { kind: "boolean", value: (left.value as number) <= (right.value as number) };
  if (op === ">=") return { kind: "boolean", value: (left.value as number) >= (right.value as number) };
  return makeInternalError("unknown_operator", { operator: op });
}
