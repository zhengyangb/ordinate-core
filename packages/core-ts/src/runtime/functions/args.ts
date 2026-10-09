import { isError, makeInternalError } from "../errors";
import type { ExprNode, RuntimeValue, RuntimeCollection } from "../types";

export type EvaluatedArgument = ["error" | "scalar" | "collection", RuntimeValue | RuntimeCollection];

export type FunctionEvalContext = {
  evalArgValue: (node: ExprNode) => EvaluatedArgument;
  evalRawArgValue: (node: ExprNode) => EvaluatedArgument;
  evalScalarArg: (node: ExprNode) => RuntimeValue;
  evalExpressionValue: (node: ExprNode) => RuntimeValue | RuntimeCollection;
  evalCell: (rowIndex: number, colIndex: number) => RuntimeValue;
};

export function expectCollectionArg(
  ctx: FunctionEvalContext,
  functionName: string,
  node: ExprNode,
): RuntimeValue | RuntimeCollection {
  const [argKind, argVal] = ctx.evalArgValue(node);
  if (argKind === "error") return argVal as RuntimeValue;
  if (argKind !== "collection") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: argKind });
  }
  return argVal as RuntimeCollection;
}

export function expectNumberArg(ctx: FunctionEvalContext, functionName: string, node: ExprNode): RuntimeValue {
  const value = ctx.evalScalarArg(node);
  if (isError(value)) return value;
  if (value.kind !== "number") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  return value;
}

export function expectBooleanArg(ctx: FunctionEvalContext, functionName: string, node: ExprNode): RuntimeValue {
  const value = ctx.evalScalarArg(node);
  if (isError(value)) return value;
  if (value.kind !== "boolean") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  return value;
}

export function assertArity(functionName: string, actual: number, expected: number): RuntimeValue | null {
  if (actual === expected) return null;
  return makeInternalError("invalid_function_call", { function: functionName, expectedArgs: expected, got: actual });
}

export function assertArityRange(functionName: string, actual: number, min: number, max: number): RuntimeValue | null {
  if (actual >= min && actual <= max) return null;
  return makeInternalError("invalid_function_call", { function: functionName, minArgs: min, maxArgs: max, got: actual });
}
