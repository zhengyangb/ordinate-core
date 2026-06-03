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
import { booleanAggregateView, notValue, notView } from "./boolean";
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
import {
  averageDeviationView,
  correlView,
  countBlankView,
  covarianceView,
  devsqView,
  forecastValue,
  geomeanView,
  harmeanView,
  largeSmallView,
  medianView,
  modeView,
  percentileView,
  quartileView,
  rankView,
  slopeInterceptView,
  standardizeValue,
  stdevView,
  varianceView,
} from "./statistics";
import {
  booleanValue,
  evaluateTypeConversion,
  evaluateTypePredicate,
  isBlankValue,
  isBooleanValue,
  isErrorValue,
  isNullValue,
  isNumberValue,
  isTextValue,
  numberValue,
  textValue,
} from "./typePredicates";
import {
  containsText,
  endsWithText,
  evaluateTextBinary,
  evaluateTextSlice,
  evaluateTextTernary,
  evaluateTextUnary,
  joinTextView,
  lenText,
  lowerText,
  replaceText,
  startsWithText,
  trimText,
  upperText,
} from "./text";
import { dotProduct } from "./vector";

export type FunctionCategory = "aggregate" | "numeric" | "logical" | "vector" | "view" | "statistical" | "type" | "text";

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
    summary: "Averages numeric-compatible values in a view, ignoring blanks. For non-error, non-empty numeric-compatible inputs, this is equivalent to sum(x) / count(x).",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to average. Blank cells are ignored.")], "number")],
    examples: [example("average(@[Revenue,:])")],
    evaluator: viewEvaluator((view) => averageView(view)),
  },
  {
    name: "min",
    category: "aggregate",
    summary: "Returns the smallest numeric-compatible value in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to scan for the smallest value.")], "number")],
    examples: [example("min(@[#2:#10,#2])")],
    evaluator: viewEvaluator((view) => minMaxView(view, "min")),
  },
  {
    name: "max",
    category: "aggregate",
    summary: "Returns the largest numeric-compatible value in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to scan for the largest value.")], "number")],
    examples: [example("max(@[#2:#10,#2])")],
    evaluator: viewEvaluator((view) => minMaxView(view, "max")),
  },
  {
    name: "count",
    category: "aggregate",
    summary: "Counts numeric-compatible values in a view. For non-error inputs, this is equivalent to sum(isNumber(x)) + sum(isBoolean(x)).",
    signatures: [signature([param("x", "view[d<=2]", "Cells to count when their evaluated value is a number or boolean.")], "number")],
    examples: [example("count(@[:,2025])")],
    evaluator: viewEvaluator((view) => countView(view, false)),
  },
  {
    name: "counta",
    category: "aggregate",
    summary: "Counts non-blank values in a view. For non-error inputs, this is equivalent to sum(not(isBlank(x))).",
    signatures: [signature([param("x", "view[d<=2]", "Cells to count when their evaluated value is not blank.")], "number")],
    examples: [example("counta(@[:,2025])")],
    evaluator: viewEvaluator((view) => countView(view, true)),
  },
  {
    name: "sumsq",
    category: "aggregate",
    summary: "Adds the squares of numeric-compatible values in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to square and add. Blank cells are ignored.")], "number")],
    examples: [example("sumsq(@[Values,:])")],
    evaluator: viewEvaluator((view) => sumsqView(view)),
  },
  {
    name: "countblank",
    category: "statistical",
    summary: "Counts blank values in a view. For non-error inputs, this is equivalent to sum(isBlank(x)).",
    signatures: [signature([param("x", "view[d<=2]", "Values to scan for blanks.")], "number")],
    examples: [example("countblank(@[:,Score])")],
    evaluator: viewEvaluator((view) => countBlankView(view)),
  },
  {
    name: "median",
    category: "statistical",
    summary: "Returns the median numeric-compatible value in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("median(@[:,Score])")],
    evaluator: viewEvaluator((view, _ctx, call) => medianView(view, call.name)),
  },
  {
    name: "percentile",
    category: "statistical",
    summary: "Returns the inclusive percentile of numeric-compatible values in a view.",
    signatures: [signature([
      param("x", "view[d<=2]", "Numbers and booleans to summarize. Blank cells are ignored."),
      param("p", "Scalar[number]", "Percentile in the inclusive range [0, 1]."),
    ], "number")],
    examples: [example("percentile(@[:,Score], 0.9)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const view = expectViewArg(ctx, call.name, call.args[0]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      return percentileView(view as RuntimeView, ctx.evalScalarArg(call.args[1]), call.name);
    },
  },
  {
    name: "quartile",
    category: "statistical",
    summary: "Returns an inclusive quartile of numeric-compatible values in a view.",
    signatures: [signature([
      param("x", "view[d<=2]", "Numbers and booleans to summarize. Blank cells are ignored."),
      param("q", "Scalar[number]", "Quartile index 0, 1, 2, 3, or 4."),
    ], "number")],
    examples: [example("quartile(@[:,Score], 3)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const view = expectViewArg(ctx, call.name, call.args[0]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      return quartileView(view as RuntimeView, ctx.evalScalarArg(call.args[1]), call.name);
    },
  },
  {
    name: "variance",
    aliases: ["var"],
    category: "statistical",
    summary: "Returns the sample variance of numeric-compatible values in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("variance(@[:,Score])"), example("var(@[:,Score])")],
    evaluator: viewEvaluator((view, _ctx, call) => varianceView(view, true, call.name)),
  },
  {
    name: "variancep",
    aliases: ["varp"],
    category: "statistical",
    summary: "Returns the population variance of numeric-compatible values in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("variancep(@[:,Score])"), example("varp(@[:,Score])")],
    evaluator: viewEvaluator((view, _ctx, call) => varianceView(view, false, call.name)),
  },
  {
    name: "stdev",
    aliases: ["stddev"],
    category: "statistical",
    summary: "Returns the sample standard deviation of numeric-compatible values in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("stdev(@[:,Score])"), example("stddev(@[:,Score])")],
    evaluator: viewEvaluator((view, _ctx, call) => stdevView(view, true, call.name)),
  },
  {
    name: "stdevp",
    aliases: ["stddevp"],
    category: "statistical",
    summary: "Returns the population standard deviation of numeric-compatible values in a view.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("stdevp(@[:,Score])"), example("stddevp(@[:,Score])")],
    evaluator: viewEvaluator((view, _ctx, call) => stdevView(view, false, call.name)),
  },
  {
    name: "avedev",
    category: "statistical",
    summary: "Returns the average absolute deviation from the mean.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("avedev(@[:,Score])")],
    evaluator: viewEvaluator((view, _ctx, call) => averageDeviationView(view, call.name)),
  },
  {
    name: "devsq",
    category: "statistical",
    summary: "Returns the sum of squared deviations from the mean.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("devsq(@[:,Score])")],
    evaluator: viewEvaluator((view, _ctx, call) => devsqView(view, call.name)),
  },
  {
    name: "geomean",
    category: "statistical",
    summary: "Returns the geometric mean of positive numeric-compatible values.",
    signatures: [signature([param("x", "view[d<=2]", "Positive numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("geomean(@[:,GrowthFactor])")],
    evaluator: viewEvaluator((view, _ctx, call) => geomeanView(view, call.name)),
  },
  {
    name: "harmean",
    category: "statistical",
    summary: "Returns the harmonic mean of positive numeric-compatible values.",
    signatures: [signature([param("x", "view[d<=2]", "Positive numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("harmean(@[:,Rate])")],
    evaluator: viewEvaluator((view, _ctx, call) => harmeanView(view, call.name)),
  },
  {
    name: "large",
    category: "statistical",
    summary: "Returns the k-th largest numeric-compatible value in a view.",
    signatures: [signature([
      param("x", "view[d<=2]", "Numbers and booleans to order. Blank cells are ignored."),
      param("k", "Scalar[number]", "One-based rank from largest to smallest."),
    ], "number")],
    examples: [example("large(@[:,Score], 3)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const view = expectViewArg(ctx, call.name, call.args[0]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      return largeSmallView(view as RuntimeView, ctx.evalScalarArg(call.args[1]), "large", call.name);
    },
  },
  {
    name: "small",
    category: "statistical",
    summary: "Returns the k-th smallest numeric-compatible value in a view.",
    signatures: [signature([
      param("x", "view[d<=2]", "Numbers and booleans to order. Blank cells are ignored."),
      param("k", "Scalar[number]", "One-based rank from smallest to largest."),
    ], "number")],
    examples: [example("small(@[:,Score], 3)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const view = expectViewArg(ctx, call.name, call.args[0]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      return largeSmallView(view as RuntimeView, ctx.evalScalarArg(call.args[1]), "small", call.name);
    },
  },
  {
    name: "rank",
    category: "statistical",
    summary: "Returns the one-based rank of a value within a view.",
    signatures: [
      signature([
        param("value", "Scalar[number]", "Value to rank."),
        param("x", "view[d<=2]", "Numbers and booleans to rank against. Blank cells are ignored."),
      ], "number"),
      signature([
        param("value", "Scalar[number]", "Value to rank."),
        param("x", "view[d<=2]", "Numbers and booleans to rank against. Blank cells are ignored."),
        param("ascending", "Scalar[number]", "Use descending rank for 0 and ascending rank for non-zero."),
      ], "number"),
    ],
    examples: [example("rank(@[This,Score], @[:,Score])"), example("rank(@[This,Score], @[:,Score], 1)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 2, 3);
      if (arityError) return arityError;
      const value = ctx.evalScalarArg(call.args[0]);
      if (isError(value)) return value;
      const view = expectViewArg(ctx, call.name, call.args[1]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      const ascending = call.args.length === 3 ? ctx.evalScalarArg(call.args[2]) : null;
      return rankView(value, view as RuntimeView, ascending, call.name);
    },
  },
  {
    name: "mode",
    category: "statistical",
    summary: "Returns the most frequent numeric-compatible value, using the smallest value to break ties.",
    signatures: [signature([param("x", "view[d<=2]", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("mode(@[:,Score])")],
    evaluator: viewEvaluator((view, _ctx, call) => modeView(view, call.name)),
  },
  {
    name: "correl",
    aliases: ["correlation"],
    category: "statistical",
    summary: "Returns the Pearson correlation coefficient for two same-shape views.",
    signatures: [signature([
      param("x", "view[d<=2]", "First numeric-compatible view."),
      param("y", "view[d<=2]", "Second numeric-compatible view with the same shape as x."),
    ], "number")],
    examples: [example("correl(@[:,Spend], @[:,Revenue])")],
    evaluator: twoViewEvaluator((left, right, call) => correlView(left, right, call.name)),
  },
  {
    name: "covariance",
    category: "statistical",
    summary: "Returns the sample covariance for two same-shape views.",
    signatures: [signature([
      param("x", "view[d<=2]", "First numeric-compatible view."),
      param("y", "view[d<=2]", "Second numeric-compatible view with the same shape as x."),
    ], "number")],
    examples: [example("covariance(@[:,Spend], @[:,Revenue])")],
    evaluator: twoViewEvaluator((left, right, call) => covarianceView(left, right, true, call.name)),
  },
  {
    name: "covariancep",
    category: "statistical",
    summary: "Returns the population covariance for two same-shape views.",
    signatures: [signature([
      param("x", "view[d<=2]", "First numeric-compatible view."),
      param("y", "view[d<=2]", "Second numeric-compatible view with the same shape as x."),
    ], "number")],
    examples: [example("covariancep(@[:,Spend], @[:,Revenue])")],
    evaluator: twoViewEvaluator((left, right, call) => covarianceView(left, right, false, call.name)),
  },
  {
    name: "slope",
    category: "statistical",
    summary: "Returns the linear-regression slope for known y values over known x values.",
    signatures: [signature([
      param("y", "view[d<=2]", "Known y values."),
      param("x", "view[d<=2]", "Known x values with the same shape as y."),
    ], "number")],
    examples: [example("slope(@[:,Revenue], @[:,Spend])")],
    evaluator: twoViewEvaluator((left, right, call) => slopeInterceptView(left, right, call.name)),
  },
  {
    name: "intercept",
    category: "statistical",
    summary: "Returns the linear-regression intercept for known y values over known x values.",
    signatures: [signature([
      param("y", "view[d<=2]", "Known y values."),
      param("x", "view[d<=2]", "Known x values with the same shape as y."),
    ], "number")],
    examples: [example("intercept(@[:,Revenue], @[:,Spend])")],
    evaluator: twoViewEvaluator((left, right, call) => slopeInterceptView(left, right, call.name)),
  },
  {
    name: "forecast",
    category: "statistical",
    summary: "Predicts y for x using a linear regression over known y and known x views.",
    signatures: [signature([
      param("x", "Scalar[number]", "Input x value to predict for."),
      param("knownY", "view[d<=2]", "Known y values."),
      param("knownX", "view[d<=2]", "Known x values with the same shape as knownY."),
    ], "number")],
    examples: [example("forecast(100, @[:,Revenue], @[:,Spend])")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 3);
      if (arityError) return arityError;
      const x = ctx.evalScalarArg(call.args[0]);
      if (isError(x)) return x;
      const knownY = expectViewArg(ctx, call.name, call.args[1]);
      if (isError(knownY as RuntimeValue)) return knownY as RuntimeValue;
      const knownX = expectViewArg(ctx, call.name, call.args[2]);
      if (isError(knownX as RuntimeValue)) return knownX as RuntimeValue;
      return forecastValue(x, knownY as RuntimeView, knownX as RuntimeView, call.name);
    },
  },
  {
    name: "standardize",
    category: "statistical",
    summary: "Returns the z-score for x given a mean and standard deviation.",
    signatures: [signature([
      param("x", "Scalar[number]", "Value to standardize."),
      param("mean", "Scalar[number]", "Mean of the distribution."),
      param("stdev", "Scalar[number]", "Positive standard deviation."),
    ], "number")],
    examples: [example("standardize(@[This,Score], average(@[:,Score]), stdev(@[:,Score]))")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 3);
      if (arityError) return arityError;
      return standardizeValue(ctx.evalScalarArg(call.args[0]), ctx.evalScalarArg(call.args[1]), ctx.evalScalarArg(call.args[2]), call.name);
    },
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
    aliases: ["all"],
    category: "logical",
    summary: "Returns true when every boolean value in a view is true. all(x) is an alias for and(x).",
    signatures: [signature([param("x", "view[d<=2]", "Boolean values that must all evaluate to true.")], "boolean")],
    examples: [example("and(@[Flags,:])"), example("all(@[Flags,:])")],
    evaluator: viewEvaluator((view) => booleanAggregateView(view, "and")),
  },
  {
    name: "or",
    aliases: ["any"],
    category: "logical",
    summary: "Returns true when at least one boolean value in a view is true. any(x) is an alias for or(x).",
    signatures: [signature([param("x", "view[d<=2]", "Boolean values where at least one value must evaluate to true.")], "boolean")],
    examples: [example("or(@[Flags,:])"), example("any(@[Flags,:])")],
    evaluator: viewEvaluator((view) => booleanAggregateView(view, "or")),
  },
  {
    name: "isNumber",
    category: "type",
    summary: "Returns true for numbers and false for every other runtime value.",
    signatures: [
      signature([param("x", "value", "Value to inspect.")], "boolean"),
      signature([param("x", "view[d<=2]", "Values to inspect element-wise.")], "view[d<=2]"),
    ],
    examples: [example("isNumber(@[:,Score])")],
    evaluator: typePredicateEvaluator(isNumberValue),
  },
  {
    name: "isText",
    aliases: ["isString"],
    category: "type",
    summary: "Returns true for text strings and false for every other runtime value.",
    signatures: [
      signature([param("x", "value", "Value to inspect.")], "boolean"),
      signature([param("x", "view[d<=2]", "Values to inspect element-wise.")], "view[d<=2]"),
    ],
    examples: [example("isText(@[:,Code])")],
    evaluator: typePredicateEvaluator(isTextValue),
  },
  {
    name: "isBoolean",
    category: "type",
    summary: "Returns true for booleans and false for every other runtime value.",
    signatures: [
      signature([param("x", "value", "Value to inspect.")], "boolean"),
      signature([param("x", "view[d<=2]", "Values to inspect element-wise.")], "view[d<=2]"),
    ],
    examples: [example("isBoolean(@[:,Flag])")],
    evaluator: typePredicateEvaluator(isBooleanValue),
  },
  {
    name: "isBlank",
    category: "type",
    summary: "Returns true for blank values and false for every other runtime value.",
    signatures: [
      signature([param("x", "value", "Value to inspect.")], "boolean"),
      signature([param("x", "view[d<=2]", "Values to inspect element-wise.")], "view[d<=2]"),
    ],
    examples: [example("isBlank(@[:,Optional])")],
    evaluator: typePredicateEvaluator(isBlankValue),
  },
  {
    name: "isNull",
    category: "type",
    summary: "Returns true for null values and false for every other runtime value.",
    signatures: [
      signature([param("x", "value", "Value to inspect.")], "boolean"),
      signature([param("x", "view[d<=2]", "Values to inspect element-wise.")], "view[d<=2]"),
    ],
    examples: [example("isNull(@[:,Value])")],
    evaluator: typePredicateEvaluator(isNullValue),
  },
  {
    name: "isError",
    category: "type",
    summary: "Returns true for error values and false for every other runtime value.",
    signatures: [
      signature([param("x", "value", "Value to inspect.")], "boolean"),
      signature([param("x", "view[d<=2]", "Values to inspect element-wise.")], "view[d<=2]"),
    ],
    examples: [example("isError(@[:,Value])")],
    evaluator: typePredicateEvaluator(isErrorValue),
  },
  {
    name: "number",
    category: "type",
    summary: "Explicitly converts a value to a number.",
    signatures: [
      signature([param("x", "value", "Value to convert.")], "number"),
      signature([param("x", "view[d<=2]", "Values to convert element-wise.")], "view[d<=2]"),
    ],
    examples: [example("number(\"12.5\")"), example("average(number(@[:,ImportedAmount]))")],
    evaluator: typeConversionEvaluator(numberValue),
  },
  {
    name: "text",
    category: "type",
    summary: "Explicitly converts a value to text.",
    signatures: [
      signature([param("x", "value", "Value to convert.")], "string"),
      signature([param("x", "view[d<=2]", "Values to convert element-wise.")], "view[d<=2]"),
    ],
    examples: [example("\"SKU-\" + text(@[:,Code])")],
    evaluator: typeConversionEvaluator(textValue),
  },
  {
    name: "boolean",
    category: "type",
    summary: "Explicitly converts a value to a boolean.",
    signatures: [
      signature([param("x", "value", "Value to convert.")], "boolean"),
      signature([param("x", "view[d<=2]", "Values to convert element-wise.")], "view[d<=2]"),
    ],
    examples: [example("boolean(\"true\")")],
    evaluator: typeConversionEvaluator(booleanValue),
  },
  {
    name: "len",
    category: "text",
    summary: "Returns the number of characters in text. For views, applies element-wise to text values; it does not return view cardinality.",
    signatures: [
      signature([param("x", "Scalar[string]", "Text whose character count should be returned.")], "number"),
      signature([param("x", "view[d<=2]", "Text values whose character counts should be returned element-wise.")], "view[d<=2]"),
    ],
    examples: [example("len(\"hello\")", "5"), example("len(@[:,Name])")],
    evaluator: textUnaryEvaluator(lenText),
  },
  {
    name: "lower",
    category: "text",
    summary: "Converts text to lowercase. For views, applies element-wise to text values.",
    signatures: [
      signature([param("x", "Scalar[string]", "Text to convert to lowercase.")], "string"),
      signature([param("x", "view[d<=2]", "Text values to convert element-wise.")], "view[d<=2]"),
    ],
    examples: [example("lower(\"ABC\")", "\"abc\""), example("lower(@[:,Name])")],
    evaluator: textUnaryEvaluator(lowerText),
  },
  {
    name: "upper",
    category: "text",
    summary: "Converts text to uppercase. For views, applies element-wise to text values.",
    signatures: [
      signature([param("x", "Scalar[string]", "Text to convert to uppercase.")], "string"),
      signature([param("x", "view[d<=2]", "Text values to convert element-wise.")], "view[d<=2]"),
    ],
    examples: [example("upper(\"abc\")", "\"ABC\""), example("upper(@[:,Code])")],
    evaluator: textUnaryEvaluator(upperText),
  },
  {
    name: "trim",
    category: "text",
    summary: "Removes leading and trailing whitespace from text. For views, applies element-wise to text values.",
    signatures: [
      signature([param("x", "Scalar[string]", "Text to trim.")], "string"),
      signature([param("x", "view[d<=2]", "Text values to trim element-wise.")], "view[d<=2]"),
    ],
    examples: [example("trim(\"  abc  \")", "\"abc\""), example("trim(@[:,Name])")],
    evaluator: textUnaryEvaluator(trimText),
  },
  {
    name: "contains",
    category: "text",
    summary: "Returns true when text contains the case-sensitive search text. View arguments broadcast scalars and require exact shape matches.",
    signatures: [signature([
      param("text", "Scalar[string] | view[d<=2]", "Text to search."),
      param("search", "Scalar[string] | view[d<=2]", "Case-sensitive search text."),
    ], "boolean | view[d<=2]")],
    examples: [example("contains(\"abc\", \"b\")", "true"), example("contains(lower(@[:,Name]), \"smith\")")],
    evaluator: textBinaryEvaluator(containsText),
  },
  {
    name: "startsWith",
    category: "text",
    summary: "Returns true when text starts with the case-sensitive prefix. View arguments broadcast scalars and require exact shape matches.",
    signatures: [signature([
      param("text", "Scalar[string] | view[d<=2]", "Text to inspect."),
      param("prefix", "Scalar[string] | view[d<=2]", "Case-sensitive prefix."),
    ], "boolean | view[d<=2]")],
    examples: [example("startsWith(\"A-001\", \"A-\")", "true"), example("startsWith(@[:,Code], \"A-\")")],
    evaluator: textBinaryEvaluator(startsWithText),
  },
  {
    name: "endsWith",
    category: "text",
    summary: "Returns true when text ends with the case-sensitive suffix. View arguments broadcast scalars and require exact shape matches.",
    signatures: [signature([
      param("text", "Scalar[string] | view[d<=2]", "Text to inspect."),
      param("suffix", "Scalar[string] | view[d<=2]", "Case-sensitive suffix."),
    ], "boolean | view[d<=2]")],
    examples: [example("endsWith(\"report.csv\", \".csv\")", "true"), example("endsWith(@[:,File], \".csv\")")],
    evaluator: textBinaryEvaluator(endsWithText),
  },
  {
    name: "replace",
    category: "text",
    summary: "Replaces all literal case-sensitive search text with replacement text. View arguments broadcast scalars and require exact shape matches.",
    signatures: [signature([
      param("text", "Scalar[string] | view[d<=2]", "Text to edit."),
      param("search", "Scalar[string] | view[d<=2]", "Non-empty literal text to replace."),
      param("replacement", "Scalar[string] | view[d<=2]", "Replacement text."),
    ], "string | view[d<=2]")],
    examples: [example("replace(\"a-b-c\", \"-\", \":\")", "\"a:b:c\""), example("replace(@[:,Code], \" \", \"-\")")],
    evaluator: textTernaryEvaluator(replaceText),
  },
  {
    name: "slice",
    category: "text",
    summary: "Returns a zero-based, end-exclusive text slice. Negative indexes count from the end. For views, applies element-wise to text values.",
    signatures: [
      signature([
        param("text", "Scalar[string] | view[d<=2]", "Text to slice."),
        param("start", "Scalar[number]", "Zero-based start index. Negative values count from the end."),
      ], "string | view[d<=2]"),
      signature([
        param("text", "Scalar[string] | view[d<=2]", "Text to slice."),
        param("start", "Scalar[number]", "Zero-based start index. Negative values count from the end."),
        param("end", "Scalar[number]", "Exclusive end index. Negative values count from the end."),
      ], "string | view[d<=2]"),
    ],
    examples: [example("slice(\"abcdef\", 1, 4)", "\"bcd\""), example("slice(@[:,Code], 0, 3)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 2, 3);
      if (arityError) return arityError;
      return evaluateTextSlice(ctx, call.name, call.args[0], call.args[1], call.args.length === 3 ? call.args[2] : null);
    },
  },
  {
    name: "join",
    category: "text",
    summary: "Flattens a text view in row-major order and joins the values with a text separator.",
    signatures: [signature([
      param("separator", "Scalar[string]", "Text inserted between joined values."),
      param("x", "view[d<=2]", "Text values to join in row-major order."),
    ], "string")],
    examples: [example("join(\", \", @[:,Tag])"), example("join(\"-\", text(@[:,Id]))")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const separator = ctx.evalScalarArg(call.args[0]);
      if (isError(separator)) return separator;
      const view = expectViewArg(ctx, call.name, call.args[1]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      return joinTextView(separator, view as RuntimeView, call.name);
    },
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
    summary: "Returns the logical negation of a boolean value or boolean view.",
    signatures: [
      signature([param("x", "Scalar[boolean]", "Boolean value to invert.")], "boolean"),
      signature([param("x", "view[d<=2]", "Boolean values to invert element-wise.")], "view[d<=2]"),
    ],
    examples: [example("not(true)", "false"), example("not(isNumber(@[:,Score]))")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 1);
      if (arityError) return arityError;
      const [kind, value] = ctx.evalArgValue(call.args[0]);
      if (kind === "error") return value as RuntimeValue;
      if (kind === "view") return notView(value as RuntimeView, call.name);
      return notValue(value as RuntimeValue, call.name);
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

function twoViewEvaluator(evaluate: (left: RuntimeView, right: RuntimeView, call: FunctionCall, ctx: FunctionEvalContext) => RuntimeValue): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 2);
    if (arityError) return arityError;
    const left = expectViewArg(ctx, call.name, call.args[0]);
    if (isError(left as RuntimeValue)) return left as RuntimeValue;
    const right = expectViewArg(ctx, call.name, call.args[1]);
    if (isError(right as RuntimeValue)) return right as RuntimeValue;
    return evaluate(left as RuntimeView, right as RuntimeView, call, ctx);
  };
}

function typePredicateEvaluator(predicate: (value: RuntimeValue) => boolean): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 1);
    if (arityError) return arityError;
    return evaluateTypePredicate(ctx, call.args[0], predicate);
  };
}

function typeConversionEvaluator(convert: (value: RuntimeValue, functionName: string) => RuntimeValue): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 1);
    if (arityError) return arityError;
    return evaluateTypeConversion(ctx, call.name, call.args[0], convert);
  };
}

function textUnaryEvaluator(evaluate: (value: string) => RuntimeValue): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 1);
    if (arityError) return arityError;
    return evaluateTextUnary(ctx, call.name, call.args[0], evaluate);
  };
}

function textBinaryEvaluator(evaluate: (left: string, right: string) => RuntimeValue): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 2);
    if (arityError) return arityError;
    return evaluateTextBinary(ctx, call.name, call.args[0], call.args[1], evaluate);
  };
}

function textTernaryEvaluator(evaluate: (text: string, search: string, replacement: string, functionName: string) => RuntimeValue): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 3);
    if (arityError) return arityError;
    return evaluateTextTernary(ctx, call.name, call.args[0], call.args[1], call.args[2], evaluate);
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
