import { isError, makeInternalError } from "../errors";
import type { FunctionCall, RuntimeValue, RuntimeView } from "../types";
import {
  averageView,
  countView,
  integerAggregateView,
  minMaxView,
  productView,
  sumsqView,
  sumView,
} from "./aggregates";
import { assertArity, assertArityRange, expectBooleanArg, expectNumberArg, expectViewArg, type FunctionEvalContext } from "./args";
import { booleanAggregateView, notValue } from "./boolean";
import { filterView } from "./filter";
import {
  absValue,
  ceilValue,
  floorValue,
  modValue,
  piValue,
  powerValue,
  rounddownValue,
  roundValue,
  roundupValue,
  signValue,
  sqrtValue,
  truncValue,
} from "./numeric";
import { dotProduct } from "./vector";

export type FunctionCategory = "aggregate" | "numeric" | "logical" | "vector" | "view";

export interface FunctionParameter {
  name: string;
  type: string;
  summary: string;
}

export interface FunctionSignature {
  parameters: readonly FunctionParameter[];
  returns: string;
}

export interface FunctionExample {
  expression: string;
  result?: string;
}

export type FunctionEvaluator = (
  call: FunctionCall,
  ctx: FunctionEvalContext,
  definition: FunctionDefinition,
) => RuntimeValue | RuntimeView;

export interface FunctionMetadata {
  name: string;
  aliases?: readonly string[];
  category: FunctionCategory;
  summary: string;
  signatures: readonly FunctionSignature[];
  examples: readonly FunctionExample[];
}

export interface FunctionDefinition extends FunctionMetadata {
  evaluator: FunctionEvaluator;
}

export const standardFunctionDefinitions: readonly FunctionDefinition[] = [
  {
    name: "sum",
    category: "aggregate",
    summary: "Adds values in a view using the RFC-0006 plus operator rules.",
    signatures: [signature([param("x", "view[d<=2]", "Values to add. Blanks are ignored by the view evaluator and invalid values fail the call.")], "number")],
    examples: [example("sum(@[:,2025])")],
    evaluator: viewEvaluator((view) => sumView(view)),
  },
  {
    name: "product",
    category: "aggregate",
    summary: "Multiplies values in a view using the RFC-0006 multiply operator rules.",
    signatures: [signature([param("x", "view[d<=2]", "Values to multiply using the runtime multiply operator rules.")], "number")],
    examples: [example("product(@[Factors,:])")],
    evaluator: viewEvaluator((view) => productView(view)),
  },
  {
    name: "average",
    category: "aggregate",
    summary: "Averages numeric values in a view, ignoring blanks and rejecting non-numbers.",
    signatures: [signature([param("x", "view[d<=2]", "Numeric values to average. Blank cells are ignored.")], "number")],
    examples: [example("average(@[Revenue,:])")],
    evaluator: viewEvaluator((view) => averageView(view)),
  },
  {
    name: "min",
    category: "aggregate",
    summary: "Returns the smallest numeric value in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numeric values to scan for the smallest value.")], "number")],
    examples: [example("min(@[#2:#10,#2])")],
    evaluator: viewEvaluator((view) => minMaxView(view, "min")),
  },
  {
    name: "max",
    category: "aggregate",
    summary: "Returns the largest numeric value in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numeric values to scan for the largest value.")], "number")],
    examples: [example("max(@[#2:#10,#2])")],
    evaluator: viewEvaluator((view) => minMaxView(view, "max")),
  },
  {
    name: "count",
    category: "aggregate",
    summary: "Counts numeric values in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Cells to count when their evaluated value is numeric.")], "number")],
    examples: [example("count(@[:,2025])")],
    evaluator: viewEvaluator((view) => countView(view, false)),
  },
  {
    name: "counta",
    category: "aggregate",
    summary: "Counts non-blank values in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Cells to count when their evaluated value is not blank.")], "number")],
    examples: [example("counta(@[:,2025])")],
    evaluator: viewEvaluator((view) => countView(view, true)),
  },
  {
    name: "sumsq",
    category: "aggregate",
    summary: "Adds the squares of numeric values in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numeric values to square and add. Blank cells are ignored.")], "number")],
    examples: [example("sumsq(@[Values,:])")],
    evaluator: viewEvaluator((view) => sumsqView(view)),
  },
  {
    name: "filter",
    category: "view",
    summary: "Returns the values whose corresponding mask entries are true.",
    signatures: [signature([
      param("values", "view[d<=2]", "Values to filter in row-major order."),
      param("mask", "view[d<=2]", "Boolean mask with the same shape as values."),
    ], "view[d=1]")],
    examples: [example("filter(@[:,Revenue], @[:,Region] == \"West\")")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const values = expectViewArg(ctx, call.name, call.args[0]);
      if (isError(values as RuntimeValue)) return values as RuntimeValue;
      const mask = expectViewArg(ctx, call.name, call.args[1]);
      if (isError(mask as RuntimeValue)) return mask as RuntimeValue;
      return filterView(values as RuntimeView, mask as RuntimeView, call.name);
    },
  },
  {
    name: "and",
    category: "logical",
    summary: "Returns true when every boolean value in a view is true.",
    signatures: [signature([param("x", "view[d<=2]", "Boolean values that must all evaluate to true.")], "boolean")],
    examples: [example("and(@[Flags,:])")],
    evaluator: viewEvaluator((view) => booleanAggregateView(view, "and")),
  },
  {
    name: "or",
    category: "logical",
    summary: "Returns true when at least one boolean value in a view is true.",
    signatures: [signature([param("x", "view[d<=2]", "Boolean values where at least one value must evaluate to true.")], "boolean")],
    examples: [example("or(@[Flags,:])")],
    evaluator: viewEvaluator((view) => booleanAggregateView(view, "or")),
  },
  {
    name: "abs",
    category: "numeric",
    summary: "Returns the absolute value of a number.",
    signatures: [signature([param("x", "Scalar[number]", "Number whose absolute value should be returned.")], "number")],
    examples: [example("abs(-3)", "3")],
    evaluator: numericUnaryEvaluator(absValue),
  },
  {
    name: "sign",
    category: "numeric",
    summary: "Returns -1, 0, or 1 for a negative, zero, or positive number.",
    signatures: [signature([param("x", "Scalar[number]", "Number whose sign should be returned.")], "number")],
    examples: [example("sign(-12)", "-1")],
    evaluator: numericUnaryEvaluator(signValue),
  },
  {
    name: "round",
    category: "numeric",
    summary: "Rounds a number to a fixed number of decimal places.",
    signatures: [signature([
      param("x", "Scalar[number]", "Number to round."),
      param("digits", "Scalar[number]", "Number of decimal places to keep."),
    ], "number")],
    examples: [example("round(12.345, 2)", "12.35")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      return roundValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), call.name);
    },
  },
  {
    name: "roundup",
    category: "numeric",
    summary: "Rounds a number away from zero to a fixed number of decimal places.",
    signatures: [signature([
      param("x", "Scalar[number]", "Number to round away from zero."),
      param("digits", "Scalar[number]", "Number of decimal places to keep."),
    ], "number")],
    examples: [example("roundup(12.341, 2)", "12.35")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      return roundupValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), call.name);
    },
  },
  {
    name: "rounddown",
    category: "numeric",
    summary: "Rounds a number toward zero to a fixed number of decimal places.",
    signatures: [signature([
      param("x", "Scalar[number]", "Number to round toward zero."),
      param("digits", "Scalar[number]", "Number of decimal places to keep."),
    ], "number")],
    examples: [example("rounddown(12.349, 2)", "12.34")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      return rounddownValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), call.name);
    },
  },
  {
    name: "trunc",
    category: "numeric",
    summary: "Truncates a number toward zero, optionally at a decimal digit position.",
    signatures: [
      signature([param("x", "Scalar[number]", "Number to truncate toward zero.")], "number"),
      signature([
        param("x", "Scalar[number]", "Number to truncate toward zero."),
        param("digits", "Scalar[number]", "Number of decimal places to keep."),
      ], "number"),
    ],
    examples: [example("trunc(12.9)", "12"), example("trunc(12.987, 2)", "12.98")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 1, 2);
      if (arityError) return arityError;
      const value = expectNumberArg(ctx, call.name, call.args[0]);
      const digits = call.args.length === 2 ? expectNumberArg(ctx, call.name, call.args[1]) : ({ kind: "number", value: 0 } as const);
      return truncValue(value, digits, call.name);
    },
  },
  {
    name: "floor",
    category: "numeric",
    summary: "Returns the greatest integer less than or equal to a number.",
    signatures: [signature([param("x", "Scalar[number]", "Number to round down to the nearest integer.")], "number")],
    examples: [example("floor(12.9)", "12")],
    evaluator: numericUnaryEvaluator(floorValue),
  },
  {
    name: "ceil",
    category: "numeric",
    summary: "Returns the least integer greater than or equal to a number.",
    signatures: [signature([param("x", "Scalar[number]", "Number to round up to the nearest integer.")], "number")],
    examples: [example("ceil(12.1)", "13")],
    evaluator: numericUnaryEvaluator(ceilValue),
  },
  {
    name: "mod",
    category: "numeric",
    summary: "Returns the remainder after division.",
    signatures: [signature([
      param("x", "Scalar[number]", "Number to divide."),
      param("divisor", "Scalar[number]", "Number used as the divisor."),
    ], "number")],
    examples: [example("mod(10, 3)", "1")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      return modValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), call.name);
    },
  },
  {
    name: "power",
    category: "numeric",
    summary: "Raises a number to an exponent.",
    signatures: [signature([
      param("base", "Scalar[number]", "Number to raise."),
      param("exponent", "Scalar[number]", "Power to raise the base by."),
    ], "number")],
    examples: [example("power(2, 8)", "256")],
    evaluator: numericBinaryEvaluator(powerValue),
  },
  {
    name: "sqrt",
    category: "numeric",
    summary: "Returns the square root of a number.",
    signatures: [signature([param("x", "Scalar[number]", "Number whose square root should be returned.")], "number")],
    examples: [example("sqrt(81)", "9")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 1);
      if (arityError) return arityError;
      return sqrtValue(expectNumberArg(ctx, call.name, call.args[0]), call.name);
    },
  },
  {
    name: "pi",
    category: "numeric",
    summary: "Returns an approximation of the mathematical constant pi.",
    signatures: [signature([], "number")],
    examples: [example("pi()")],
    evaluator: (call) => {
      const arityError = assertArity(call.name, call.args.length, 0);
      if (arityError) return arityError;
      return piValue();
    },
  },
  {
    name: "gcd",
    category: "numeric",
    summary: "Returns the greatest common divisor of integer values in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Integer values to scan for the greatest common divisor.")], "number")],
    examples: [example("gcd(@[Values,:])")],
    evaluator: viewEvaluator((view) => integerAggregateView(view, "gcd")),
  },
  {
    name: "lcm",
    category: "numeric",
    summary: "Returns the least common multiple of integer values in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Integer values to scan for the least common multiple.")], "number")],
    examples: [example("lcm(@[Values,:])")],
    evaluator: viewEvaluator((view) => integerAggregateView(view, "lcm")),
  },
  {
    name: "not",
    category: "logical",
    summary: "Returns the logical negation of a boolean value.",
    signatures: [signature([param("x", "Scalar[boolean]", "Boolean value to invert.")], "boolean")],
    examples: [example("not(true)", "false")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 1);
      if (arityError) return arityError;
      return notValue(expectBooleanArg(ctx, call.name, call.args[0]), call.name);
    },
  },
  {
    name: "dotProduct",
    aliases: ["sumproduct"],
    category: "vector",
    summary: "Multiplies two equal-length numeric vectors pairwise and sums the products.",
    signatures: [signature([
      param("x", "view[d=1]", "First numeric vector. It must have the same length as y."),
      param("y", "view[d=1]", "Second numeric vector. It must have the same length as x."),
    ], "number")],
    examples: [example("dotProduct(@[Price,:], @[Qty,:])"), example("sumproduct(@[Price,:], @[Qty,:])")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const left = expectViewArg(ctx, call.name, call.args[0]);
      if (isError(left as RuntimeValue)) return left as RuntimeValue;
      const right = expectViewArg(ctx, call.name, call.args[1]);
      if (isError(right as RuntimeValue)) return right as RuntimeValue;
      return dotProduct(left as RuntimeView, right as RuntimeView);
    },
  },
];

const functionRegistry = buildFunctionRegistry(standardFunctionDefinitions);

export function evalFunctionCall(call: FunctionCall, ctx: FunctionEvalContext): RuntimeValue | RuntimeView {
  const definition = functionRegistry.get(normalizeFunctionName(call.name));
  if (!definition) {
    return makeInternalError("unknown_function", { function: call.name });
  }
  return definition.evaluator(call, ctx, definition);
}

export function listStandardFunctionMetadata(): FunctionMetadata[] {
  return standardFunctionDefinitions.map(toMetadata);
}

export function getStandardFunctionMetadata(name: string): FunctionMetadata | null {
  const definition = functionRegistry.get(normalizeFunctionName(name));
  return definition ? toMetadata(definition) : null;
}

function buildFunctionRegistry(definitions: readonly FunctionDefinition[]): ReadonlyMap<string, FunctionDefinition> {
  const registry = new Map<string, FunctionDefinition>();
  for (const definition of definitions) {
    registerFunctionName(registry, definition.name, definition);
    for (const alias of definition.aliases ?? []) {
      registerFunctionName(registry, alias, definition);
    }
  }
  return registry;
}

function registerFunctionName(registry: Map<string, FunctionDefinition>, name: string, definition: FunctionDefinition): void {
  const normalized = normalizeFunctionName(name);
  if (registry.has(normalized)) {
    throw new Error(`duplicate function registry entry '${name}'`);
  }
  registry.set(normalized, definition);
}

function normalizeFunctionName(name: string): string {
  return name.toLowerCase();
}

function toMetadata(definition: FunctionDefinition): FunctionMetadata {
  return {
    name: definition.name,
    aliases: definition.aliases,
    category: definition.category,
    summary: definition.summary,
    signatures: definition.signatures,
    examples: definition.examples,
  };
}

function param(name: string, type: string, summary: string): FunctionParameter {
  return { name, type, summary };
}

function signature(parameters: readonly FunctionParameter[], returns: string): FunctionSignature {
  return { parameters, returns };
}

function example(expression: string, result?: string): FunctionExample {
  return result === undefined ? { expression } : { expression, result };
}

function viewEvaluator(evaluate: (view: RuntimeView, ctx: FunctionEvalContext, call: FunctionCall) => RuntimeValue): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 1);
    if (arityError) return arityError;
    const view = expectViewArg(ctx, call.name, call.args[0]);
    if (isError(view as RuntimeValue)) return view as RuntimeValue;
    return evaluate(view as RuntimeView, ctx, call);
  };
}

function numericUnaryEvaluator(evaluate: (value: RuntimeValue) => RuntimeValue): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 1);
    if (arityError) return arityError;
    return evaluate(expectNumberArg(ctx, call.name, call.args[0]));
  };
}

function numericBinaryEvaluator(evaluate: (left: RuntimeValue, right: RuntimeValue) => RuntimeValue): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 2);
    if (arityError) return arityError;
    return evaluate(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]));
  };
}
