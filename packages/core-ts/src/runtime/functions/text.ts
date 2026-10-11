import { isError, makeInternalError } from "../errors";
import type { ExprNode, RuntimeValue, RuntimeCollection } from "../types";
import { mapRuntimeCollection, runtimeCollectionShapeContext, runtimeCollectionShapesMatch } from "../view";
import type { EvaluatedArgument, FunctionEvalContext } from "./args";
import { collectionValues } from "./aggregates";

type TextUnary = (text: string) => RuntimeValue;
type TextBinary = (text: string, other: string) => RuntimeValue;
type TextTernary = (text: string, search: string, replacement: string, functionName: string) => RuntimeValue;

export function lenText(value: string): RuntimeValue {
  return { kind: "number", value: Array.from(value).length };
}

export function lowerText(value: string): RuntimeValue {
  return { kind: "string", value: value.toLowerCase() };
}

export function upperText(value: string): RuntimeValue {
  return { kind: "string", value: value.toUpperCase() };
}

export function trimText(value: string): RuntimeValue {
  return { kind: "string", value: value.trim() };
}

export function containsText(value: string, search: string): RuntimeValue {
  return { kind: "boolean", value: value.includes(search) };
}

export function startsWithText(value: string, prefix: string): RuntimeValue {
  return { kind: "boolean", value: value.startsWith(prefix) };
}

export function endsWithText(value: string, suffix: string): RuntimeValue {
  return { kind: "boolean", value: value.endsWith(suffix) };
}

export function replaceText(value: string, search: string, replacement: string, functionName: string): RuntimeValue {
  if (search === "") {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "empty_search_text" });
  }
  return { kind: "string", value: value.split(search).join(replacement) };
}

export function sliceText(value: string, start: RuntimeValue, end: RuntimeValue | null, functionName: string): RuntimeValue {
  if (isError(start)) return start;
  if (end !== null && isError(end)) return end;
  if (start.kind !== "number") {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "start", argumentKind: start.kind });
  }
  if (end !== null && end.kind !== "number") {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "end", argumentKind: end.kind });
  }

  const rawStart = start.value as number;
  const rawEnd = end === null ? null : (end.value as number);
  if (!Number.isInteger(rawStart)) {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "start", reason: "integer_required" });
  }
  if (rawEnd !== null && !Number.isInteger(rawEnd)) {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "end", reason: "integer_required" });
  }

  const characters = Array.from(value);
  const normalizedStart = normalizeIndex(rawStart, characters.length);
  const normalizedEnd = rawEnd === null ? characters.length : normalizeIndex(rawEnd, characters.length);
  if (normalizedStart > normalizedEnd) {
    return { kind: "string", value: "" };
  }
  return { kind: "string", value: characters.slice(normalizedStart, normalizedEnd).join("") };
}

export function evaluateTextUnary(
  ctx: FunctionEvalContext,
  functionName: string,
  node: ExprNode,
  mapText: TextUnary,
): RuntimeValue | RuntimeCollection {
  const [kind, value] = ctx.evalArgValue(node);
  if (kind === "error") return value as RuntimeValue;
  if (kind === "scalar") {
    return mapTextValue(value as RuntimeValue, functionName, mapText);
  }

  const view = value as RuntimeCollection;
  const values: RuntimeValue[] = [];
  for (const item of collectionValues(view)) {
    const mapped = mapTextValue(item, functionName, mapText);
    if (isError(mapped)) return mapped;
    values.push(mapped);
  }
  return mapRuntimeCollection(view, values);
}

export function evaluateTextBinary(
  ctx: FunctionEvalContext,
  functionName: string,
  leftNode: ExprNode,
  rightNode: ExprNode,
  mapText: TextBinary,
): RuntimeValue | RuntimeCollection {
  const left = ctx.evalArgValue(leftNode);
  if (left[0] === "error") return left[1] as RuntimeValue;
  const right = ctx.evalArgValue(rightNode);
  if (right[0] === "error") return right[1] as RuntimeValue;

  return mapTextArguments(functionName, [left, right], (values) => mapText(values[0], values[1]));
}

export function evaluateTextTernary(
  ctx: FunctionEvalContext,
  functionName: string,
  textNode: ExprNode,
  searchNode: ExprNode,
  replacementNode: ExprNode,
  mapText: TextTernary,
): RuntimeValue | RuntimeCollection {
  const text = ctx.evalArgValue(textNode);
  if (text[0] === "error") return text[1] as RuntimeValue;
  const search = ctx.evalArgValue(searchNode);
  if (search[0] === "error") return search[1] as RuntimeValue;
  const replacement = ctx.evalArgValue(replacementNode);
  if (replacement[0] === "error") return replacement[1] as RuntimeValue;

  return mapTextArguments(functionName, [text, search, replacement], (values) =>
    mapText(values[0], values[1], values[2], functionName),
  );
}

export function evaluateTextSlice(
  ctx: FunctionEvalContext,
  functionName: string,
  textNode: ExprNode,
  startNode: ExprNode,
  endNode: ExprNode | null,
): RuntimeValue | RuntimeCollection {
  const start = ctx.evalScalarArg(startNode);
  if (isError(start)) return start;
  const end = endNode === null ? null : ctx.evalScalarArg(endNode);
  if (end !== null && isError(end)) return end;
  return evaluateTextUnary(ctx, functionName, textNode, (text) => sliceText(text, start, end, functionName));
}

export function joinTextView(separator: RuntimeValue, view: RuntimeCollection, functionName: string): RuntimeValue {
  if (isError(separator)) return separator;
  if (separator.kind !== "string") {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "separator", argumentKind: separator.kind });
  }

  const values: string[] = [];
  for (const item of collectionValues(view)) {
    if (isError(item)) return item;
    if (item.kind !== "string") {
      return makeInternalError("invalid_function_call", { function: functionName, argumentKind: item.kind });
    }
    values.push(item.value);
  }
  return { kind: "string", value: values.join(separator.value) };
}

function mapTextArguments(
  functionName: string,
  args: readonly EvaluatedArgument[],
  mapText: (values: string[]) => RuntimeValue,
): RuntimeValue | RuntimeCollection {
  const resultView = resultShapeView(functionName, args);
  if (isError(resultView as RuntimeValue)) return resultView as RuntimeValue;

  if (resultView === null) {
    const textArgs = textValuesFromEvaluatedArgs(args, 0, functionName);
    if (isError(textArgs as RuntimeValue)) return textArgs as RuntimeValue;
    const mapped = mapText(textArgs as string[]);
    return mapped;
  }

  const view = resultView as RuntimeCollection;
  const values: RuntimeValue[] = [];
  for (let index = 0; index < view.values.length; index += 1) {
    const textArgs = textValuesFromEvaluatedArgs(args, index, functionName);
    if (isError(textArgs as RuntimeValue)) return textArgs as RuntimeValue;
    const mapped = mapText(textArgs as string[]);
    if (isError(mapped)) return mapped;
    values.push(mapped);
  }
  return mapRuntimeCollection(view, values);
}

function resultShapeView(functionName: string, args: readonly EvaluatedArgument[]): RuntimeCollection | RuntimeValue | null {
  let result: RuntimeCollection | null = null;
  for (const [kind, value] of args) {
    if (kind !== "collection") continue;
    const view = value as RuntimeCollection;
    if (result === null) {
      result = view;
    } else if (!runtimeCollectionShapesMatch(result, view)) {
      return makeInternalError("invalid_function_call", {
        function: functionName,
        reason: "shape_mismatch",
        left: runtimeCollectionShapeContext(result),
        right: runtimeCollectionShapeContext(view),
      });
    }
  }
  return result;
}

function textValuesFromEvaluatedArgs(args: readonly EvaluatedArgument[], index: number, functionName: string): string[] | RuntimeValue {
  const values: string[] = [];
  for (const arg of args) {
    const text = textFromEvaluatedArg(arg, index, functionName);
    if (isError(text as RuntimeValue)) return text as RuntimeValue;
    values.push(text as string);
  }
  return values;
}

function textFromEvaluatedArg(arg: EvaluatedArgument, index: number, functionName: string): string | RuntimeValue {
  const value = arg[0] === "collection" ? (arg[1] as RuntimeCollection).values[index] : (arg[1] as RuntimeValue);
  if (isError(value)) {
    return value;
  }
  if (value.kind !== "string") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  return value.value;
}

function mapTextValue(value: RuntimeValue, functionName: string, mapText: TextUnary): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind !== "string") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  return mapText(value.value);
}

function normalizeIndex(index: number, length: number): number {
  const normalized = index < 0 ? length + index : index;
  return Math.min(Math.max(normalized, 0), length);
}
