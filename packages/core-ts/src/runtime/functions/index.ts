import { isError, makeInternalError } from "../errors";
import { formatEvaluator } from "./format";
import { elementaryFunctionDefinitions } from "./elementary";
import { distributionFunctionDefinitions } from "./distributions";
import { mathematicalFunctionDefinitions } from "./mathematics";
import { mathViewFunctionDefinitions } from "./mathViews";
import { viewIndexFunction } from "../indexing";
import type { FunctionCall, RuntimeValue, RuntimeCollection, RuntimeView } from "../types";
import { makeRuntimeArray } from "../view";
import {
  averageView,
  countView,
  integerAggregateView,
  minMaxView,
  productView,
  sumsqView,
  sumView,
} from "./aggregates";
import { assertArity, assertArityRange, expectBooleanArg, expectNumberArg, expectCollectionArg, type FunctionEvalContext } from "./args";
import { booleanAggregateView, notValue, notView } from "./boolean";
import { filterView } from "./filter";
import {
  cumipmtValue,
  cumprincValue,
  dbValue,
  ddbValue,
  effectValue,
  fvValue,
  ipmtValue,
  irrView,
  ispmtValue,
  mirrView,
  nominalValue,
  nperValue,
  npvView,
  pmtValue,
  ppmtValue,
  pvValue,
  rateValue,
  slnValue,
  sydValue,
  xirrView,
  xnpvView,
} from "./financial";
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
  isDateValue,
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
import { dropValue, lookupView, matchView, takeValue } from "./selection";
import {
  dateEvaluator,
  datetimeEvaluator,
  datetimeFromUnixMillisEvaluator,
  durationEvaluator,
  temporalComponentEvaluator,
  timeEvaluator,
  unixMillisEvaluator,
} from "./temporal";
import { dotProduct } from "./vector";

export type FunctionCategory = "aggregate" | "numeric" | "logical" | "vector" | "view" | "statistical" | "type" | "text" | "temporal" | "financial";

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
) => RuntimeValue | RuntimeCollection;

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
  ...elementaryFunctionDefinitions,
  ...distributionFunctionDefinitions,
  ...mathematicalFunctionDefinitions,
  ...mathViewFunctionDefinitions,
  {
    name: "sum",
    category: "aggregate",
    summary: "Adds values in a one-dimensional array or two-dimensional view using the RFC-0006 plus operator rules.",
    signatures: [signature([param("x", "array | view", "Values to add. Blanks are ignored; invalid values fail the call.")], "number")],
    examples: [example("sum(@[:,2025])")],
    evaluator: collectionEvaluator((view) => sumView(view)),
  },
  {
    name: "product",
    category: "aggregate",
    summary: "Multiplies values in an array or view using the RFC-0006 multiply operator rules.",
    signatures: [signature([param("x", "array | view", "Values to multiply using the runtime multiply operator rules.")], "number")],
    examples: [example("product(@[Factors,:])")],
    evaluator: collectionEvaluator((view) => productView(view)),
  },
  {
    name: "average",
    category: "aggregate",
    summary: "Averages numeric-compatible values in an array or view, ignoring blanks. For non-error, non-empty numeric-compatible inputs, this is equivalent to sum(x) / count(x).",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to average. Blank cells are ignored.")], "number")],
    examples: [example("average(@[Revenue,:])")],
    evaluator: collectionEvaluator((view) => averageView(view)),
  },
  {
    name: "min",
    category: "aggregate",
    summary: "Returns the smallest numeric-compatible value in an array or view.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to scan for the smallest value.")], "number")],
    examples: [example("min(@[#2:#10,#2])")],
    evaluator: collectionEvaluator((view) => minMaxView(view, "min")),
  },
  {
    name: "max",
    category: "aggregate",
    summary: "Returns the largest numeric-compatible value in an array or view.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to scan for the largest value.")], "number")],
    examples: [example("max(@[#2:#10,#2])")],
    evaluator: collectionEvaluator((view) => minMaxView(view, "max")),
  },
  {
    name: "count",
    category: "aggregate",
    summary: "Counts numeric-compatible values in an array or view. For non-error inputs, this is equivalent to sum(isNumber(x)) + sum(isBoolean(x)).",
    signatures: [signature([param("x", "array | view", "Cells to count when their evaluated value is a number or boolean.")], "number")],
    examples: [example("count(@[:,2025])")],
    evaluator: collectionEvaluator((view) => countView(view, false)),
  },
  {
    name: "counta",
    category: "aggregate",
    summary: "Counts non-blank values in an array or view. For non-error inputs, this is equivalent to sum(not(isBlank(x))).",
    signatures: [signature([param("x", "array | view", "Cells to count when their evaluated value is not blank.")], "number")],
    examples: [example("counta(@[:,2025])")],
    evaluator: collectionEvaluator((view) => countView(view, true)),
  },
  {
    name: "sumsq",
    category: "aggregate",
    summary: "Adds the squares of numeric-compatible values in an array or view.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to square and add. Blank cells are ignored.")], "number")],
    examples: [example("sumsq(@[Values,:])")],
    evaluator: collectionEvaluator((view) => sumsqView(view)),
  },
  {
    name: "countblank",
    category: "statistical",
    summary: "Counts blank values in an array or view. For non-error inputs, this is equivalent to sum(isBlank(x)).",
    signatures: [signature([param("x", "array | view", "Values to scan for blanks.")], "number")],
    examples: [example("countblank(@[:,Score])")],
    evaluator: collectionEvaluator((view) => countBlankView(view)),
  },
  {
    name: "median",
    category: "statistical",
    summary: "Returns the median numeric-compatible value in an array or view.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("median(@[:,Score])")],
    evaluator: collectionEvaluator((view, _ctx, call) => medianView(view, call.name)),
  },
  {
    name: "percentile",
    category: "statistical",
    summary: "Returns the inclusive percentile of numeric-compatible values in an array or view.",
    signatures: [signature([
      param("x", "array | view", "Numbers and booleans to summarize. Blank cells are ignored."),
      param("p", "Scalar[number]", "Percentile in the inclusive range [0, 1]."),
    ], "number")],
    examples: [example("percentile(@[:,Score], 0.9)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const view = expectCollectionArg(ctx, call.name, call.args[0]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      return percentileView(view as RuntimeCollection, ctx.evalScalarArg(call.args[1]), call.name);
    },
  },
  {
    name: "quartile",
    category: "statistical",
    summary: "Returns an inclusive quartile of numeric-compatible values in an array or view.",
    signatures: [signature([
      param("x", "array | view", "Numbers and booleans to summarize. Blank cells are ignored."),
      param("q", "Scalar[number]", "Quartile index 0, 1, 2, 3, or 4."),
    ], "number")],
    examples: [example("quartile(@[:,Score], 3)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const view = expectCollectionArg(ctx, call.name, call.args[0]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      return quartileView(view as RuntimeCollection, ctx.evalScalarArg(call.args[1]), call.name);
    },
  },
  {
    name: "variance",
    aliases: ["var"],
    category: "statistical",
    summary: "Returns the sample variance of numeric-compatible values in an array or view.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("variance(@[:,Score])"), example("var(@[:,Score])")],
    evaluator: collectionEvaluator((view, _ctx, call) => varianceView(view, true, call.name)),
  },
  {
    name: "variancep",
    aliases: ["varp"],
    category: "statistical",
    summary: "Returns the population variance of numeric-compatible values in an array or view.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("variancep(@[:,Score])"), example("varp(@[:,Score])")],
    evaluator: collectionEvaluator((view, _ctx, call) => varianceView(view, false, call.name)),
  },
  {
    name: "stdev",
    aliases: ["stddev"],
    category: "statistical",
    summary: "Returns the sample standard deviation of numeric-compatible values in an array or view.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("stdev(@[:,Score])"), example("stddev(@[:,Score])")],
    evaluator: collectionEvaluator((view, _ctx, call) => stdevView(view, true, call.name)),
  },
  {
    name: "stdevp",
    aliases: ["stddevp"],
    category: "statistical",
    summary: "Returns the population standard deviation of numeric-compatible values in an array or view.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("stdevp(@[:,Score])"), example("stddevp(@[:,Score])")],
    evaluator: collectionEvaluator((view, _ctx, call) => stdevView(view, false, call.name)),
  },
  {
    name: "avedev",
    category: "statistical",
    summary: "Returns the average absolute deviation from the mean.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("avedev(@[:,Score])")],
    evaluator: collectionEvaluator((view, _ctx, call) => averageDeviationView(view, call.name)),
  },
  {
    name: "devsq",
    category: "statistical",
    summary: "Returns the sum of squared deviations from the mean.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("devsq(@[:,Score])")],
    evaluator: collectionEvaluator((view, _ctx, call) => devsqView(view, call.name)),
  },
  {
    name: "geomean",
    category: "statistical",
    summary: "Returns the geometric mean of positive numeric-compatible values.",
    signatures: [signature([param("x", "array | view", "Positive numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("geomean(@[:,GrowthFactor])")],
    evaluator: collectionEvaluator((view, _ctx, call) => geomeanView(view, call.name)),
  },
  {
    name: "harmean",
    category: "statistical",
    summary: "Returns the harmonic mean of positive numeric-compatible values.",
    signatures: [signature([param("x", "array | view", "Positive numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("harmean(@[:,Rate])")],
    evaluator: collectionEvaluator((view, _ctx, call) => harmeanView(view, call.name)),
  },
  {
    name: "large",
    category: "statistical",
    summary: "Returns the k-th largest numeric-compatible value in an array or view.",
    signatures: [signature([
      param("x", "array | view", "Numbers and booleans to order. Blank cells are ignored."),
      param("k", "Scalar[number]", "One-based rank from largest to smallest."),
    ], "number")],
    examples: [example("large(@[:,Score], 3)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const view = expectCollectionArg(ctx, call.name, call.args[0]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      return largeSmallView(view as RuntimeCollection, ctx.evalScalarArg(call.args[1]), "large", call.name);
    },
  },
  {
    name: "small",
    category: "statistical",
    summary: "Returns the k-th smallest numeric-compatible value in an array or view.",
    signatures: [signature([
      param("x", "array | view", "Numbers and booleans to order. Blank cells are ignored."),
      param("k", "Scalar[number]", "One-based rank from smallest to largest."),
    ], "number")],
    examples: [example("small(@[:,Score], 3)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const view = expectCollectionArg(ctx, call.name, call.args[0]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      return largeSmallView(view as RuntimeCollection, ctx.evalScalarArg(call.args[1]), "small", call.name);
    },
  },
  {
    name: "rank",
    category: "statistical",
    summary: "Returns the one-based rank of a value within an array or view.",
    signatures: [
      signature([
        param("value", "Scalar[number]", "Value to rank."),
        param("x", "array | view", "Numbers and booleans to rank against. Blank cells are ignored."),
      ], "number"),
      signature([
        param("value", "Scalar[number]", "Value to rank."),
        param("x", "array | view", "Numbers and booleans to rank against. Blank cells are ignored."),
        param("ascending", "Scalar[number]", "Use descending rank for 0 and ascending rank for non-zero."),
      ], "number"),
    ],
    examples: [example("rank(@[This,Score], @[:,Score])"), example("rank(@[This,Score], @[:,Score], 1)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 2, 3);
      if (arityError) return arityError;
      const value = ctx.evalScalarArg(call.args[0]);
      if (isError(value)) return value;
      const view = expectCollectionArg(ctx, call.name, call.args[1]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      const ascending = call.args.length === 3 ? ctx.evalScalarArg(call.args[2]) : null;
      return rankView(value, view as RuntimeCollection, ascending, call.name);
    },
  },
  {
    name: "mode",
    category: "statistical",
    summary: "Returns the most frequent numeric-compatible value, using the smallest value to break ties.",
    signatures: [signature([param("x", "array | view", "Numbers and booleans to summarize. Blank cells are ignored.")], "number")],
    examples: [example("mode(@[:,Score])")],
    evaluator: collectionEvaluator((view, _ctx, call) => modeView(view, call.name)),
  },
  {
    name: "correl",
    aliases: ["correlation"],
    category: "statistical",
    summary: "Returns the Pearson correlation coefficient for two same-shape views.",
    signatures: [signature([
      param("x", "array | view", "First numeric-compatible view."),
      param("y", "array | view", "Second numeric-compatible view with the same shape as x."),
    ], "number")],
    examples: [example("correl(@[:,Spend], @[:,Revenue])")],
    evaluator: twoCollectionEvaluator((left, right, call) => correlView(left, right, call.name)),
  },
  {
    name: "covariance",
    category: "statistical",
    summary: "Returns the sample covariance for two same-shape views.",
    signatures: [signature([
      param("x", "array | view", "First numeric-compatible view."),
      param("y", "array | view", "Second numeric-compatible view with the same shape as x."),
    ], "number")],
    examples: [example("covariance(@[:,Spend], @[:,Revenue])")],
    evaluator: twoCollectionEvaluator((left, right, call) => covarianceView(left, right, true, call.name)),
  },
  {
    name: "covariancep",
    category: "statistical",
    summary: "Returns the population covariance for two same-shape views.",
    signatures: [signature([
      param("x", "array | view", "First numeric-compatible view."),
      param("y", "array | view", "Second numeric-compatible view with the same shape as x."),
    ], "number")],
    examples: [example("covariancep(@[:,Spend], @[:,Revenue])")],
    evaluator: twoCollectionEvaluator((left, right, call) => covarianceView(left, right, false, call.name)),
  },
  {
    name: "slope",
    category: "statistical",
    summary: "Returns the linear-regression slope for known y values over known x values.",
    signatures: [signature([
      param("y", "array | view", "Known y values."),
      param("x", "array | view", "Known x values with the same shape as y."),
    ], "number")],
    examples: [example("slope(@[:,Revenue], @[:,Spend])")],
    evaluator: twoCollectionEvaluator((left, right, call) => slopeInterceptView(left, right, call.name)),
  },
  {
    name: "intercept",
    category: "statistical",
    summary: "Returns the linear-regression intercept for known y values over known x values.",
    signatures: [signature([
      param("y", "array | view", "Known y values."),
      param("x", "array | view", "Known x values with the same shape as y."),
    ], "number")],
    examples: [example("intercept(@[:,Revenue], @[:,Spend])")],
    evaluator: twoCollectionEvaluator((left, right, call) => slopeInterceptView(left, right, call.name)),
  },
  {
    name: "forecast",
    category: "statistical",
    summary: "Predicts y for x using a linear regression over known y and known x views.",
    signatures: [signature([
      param("x", "Scalar[number]", "Input x value to predict for."),
      param("knownY", "array | view", "Known y values."),
      param("knownX", "array | view", "Known x values with the same shape as knownY."),
    ], "number")],
    examples: [example("forecast(100, @[:,Revenue], @[:,Spend])")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 3);
      if (arityError) return arityError;
      const x = ctx.evalScalarArg(call.args[0]);
      if (isError(x)) return x;
      const knownY = expectCollectionArg(ctx, call.name, call.args[1]);
      if (isError(knownY as RuntimeValue)) return knownY as RuntimeValue;
      const knownX = expectCollectionArg(ctx, call.name, call.args[2]);
      if (isError(knownX as RuntimeValue)) return knownX as RuntimeValue;
      return forecastValue(x, knownY as RuntimeCollection, knownX as RuntimeCollection, call.name);
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
      param("values", "array | view", "Values to filter in row-major order."),
      param("mask", "array | view", "Boolean mask with the same shape as values."),
    ], "array")],
    examples: [example("filter(@[:,Revenue], @[:,Region] == \"West\")")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const values = expectCollectionArg(ctx, call.name, call.args[0]);
      if (isError(values as RuntimeValue)) return values as RuntimeValue;
      const mask = expectCollectionArg(ctx, call.name, call.args[1]);
      if (isError(mask as RuntimeValue)) return mask as RuntimeValue;
      return filterView(values as RuntimeCollection, mask as RuntimeCollection, call.name);
    },
  },
  {
    name: "index",
    category: "view",
    summary: "Returns a scalar value from an array or view using zero-based indexes. Negative indexes count from the end.",
    signatures: [
      signature([
        param("x", "array | vector view", "Scalar-shaped or one-dimensional view to index in row-major order."),
        param("n", "Scalar[number]", "Zero-based index. Negative values count from the end."),
      ], "value"),
      signature([
        param("x", "view", "View to index by row and column."),
        param("row", "Scalar[number]", "Zero-based row index. Negative values count from the end."),
        param("col", "Scalar[number]", "Zero-based column index. Negative values count from the end."),
      ], "value"),
    ],
    examples: [example("index(@[:,Name], 0)"), example("index(@[:,Revenue:Cost], 0, 1)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 2, 3);
      if (arityError) return arityError;
      const view = expectCollectionArg(ctx, call.name, call.args[0]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      const indexes = call.args.slice(1).map((arg) => ctx.evalScalarArg(arg));
      const indexError = indexes.find((value) => isError(value));
      if (indexError) return indexError;
      return viewIndexFunction(view as RuntimeCollection, indexes, call.name);
    },
  },
  {
    name: "shape",
    category: "view",
    summary: "Returns [length] for an array or [rowCount, columnCount] for a view.",
    signatures: [signature([param("x", "array | view", "Collection whose shape is returned.")], "array")],
    examples: [example("shape(@[:,Revenue])[0]", "row count"), example("shape(@[:,Revenue])[1]", "column count")],
    evaluator: collectionEvaluator((view) => shapeView(view)),
  },
  {
    name: "size",
    category: "view",
    summary: "Returns the number of elements in an array or positions in a view.",
    signatures: [signature([param("x", "array | view", "Collection whose positions are counted.")], "number")],
    examples: [example("size(filter(@[:,Name], @[:,Score] > 90))")],
    evaluator: collectionEvaluator((view) => ({ kind: "number", value: view.values.length })),
  },
  {
    name: "rowCount",
    aliases: ["rows"],
    category: "view",
    summary: "Returns the number of rows in a view. rows(x) is an alias.",
    signatures: [signature([param("x", "view", "View whose rows are counted; arrays have no row axis.")], "number")],
    examples: [example("rowCount(@[:,Revenue])"), example("rows(@[:,Revenue])")],
    evaluator: gridViewEvaluator((view) => ({ kind: "number", value: view.rowCount })),
  },
  {
    name: "columnCount",
    aliases: ["columns", "cols"],
    category: "view",
    summary: "Returns the number of columns in a view. columns(x) and cols(x) are aliases.",
    signatures: [signature([param("x", "view", "View whose columns are counted; arrays have no column axis.")], "number")],
    examples: [example("columnCount(@[:,Revenue])"), example("cols(@[:,Revenue])")],
    evaluator: gridViewEvaluator((view) => ({ kind: "number", value: view.colCount })),
  },
  {
    name: "match",
    category: "view",
    summary: "Returns the zero-based row-major index of the first exact match in keys.",
    signatures: [signature([
      param("value", "value", "Value to find."),
      param("keys", "array | view", "Values to search in row-major order."),
    ], "number")],
    examples: [example("match(\"Beta\", @[:,Name])", "1")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const value = ctx.evalScalarArg(call.args[0]);
      if (isError(value)) return value;
      const keys = expectCollectionArg(ctx, call.name, call.args[1]);
      if (isError(keys as RuntimeValue)) return keys as RuntimeValue;
      return matchView(value, keys as RuntimeCollection, call.name);
    },
  },
  {
    name: "lookup",
    category: "view",
    summary: "Returns the value at values[match(key, keys)] for one-dimensional lookup tables.",
    signatures: [signature([
      param("key", "value", "Key to find."),
      param("keys", "array | vector view", "Lookup keys searched with match(key, keys)."),
      param("values", "array | vector view", "Values indexed by the matched zero-based position."),
    ], "value")],
    examples: [example("lookup(\"Beta\", @[:,Name], @[:,Score])"), example("@[:,Score][match(\"Beta\", @[:,Name])]")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 3);
      if (arityError) return arityError;
      const key = ctx.evalScalarArg(call.args[0]);
      if (isError(key)) return key;
      const keys = expectCollectionArg(ctx, call.name, call.args[1]);
      if (isError(keys as RuntimeValue)) return keys as RuntimeValue;
      const values = expectCollectionArg(ctx, call.name, call.args[2]);
      if (isError(values as RuntimeValue)) return values as RuntimeValue;
      return lookupView(key, keys as RuntimeCollection, values as RuntimeCollection, call.name);
    },
  },
  {
    name: "take",
    category: "view",
    summary: "Returns a prefix or suffix selection. For text and one-dimensional views, take(x, n) is x[:n] and take(x, -n) is x[-n:]. For matrices, it takes rows and preserves all columns.",
    signatures: [
      signature([
        param("x", "text", "Text to slice by code-point index."),
        param("count", "Scalar[number]", "Integer count. Positive takes from the start; negative takes from the end."),
      ], "text"),
      signature([
        param("x", "array | view", "View to slice."),
        param("count", "Scalar[number]", "Integer count. Positive takes from the start; negative takes from the end."),
      ], "array | view"),
    ],
    examples: [example("take(@[:,Name], 3)"), example("take(@[:,Name], -3)"), example("take(\"abcdef\", 3)", "\"abc\"")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const [targetKind, target] = ctx.evalArgValue(call.args[0]);
      if (targetKind === "error") return target as RuntimeValue;
      const count = ctx.evalScalarArg(call.args[1]);
      if (isError(count)) return count;
      return takeValue(target as RuntimeValue | RuntimeCollection, count, call.name);
    },
  },
  {
    name: "drop",
    category: "view",
    summary: "Returns a selection with a prefix or suffix removed. For text and one-dimensional views, drop(x, n) is x[n:] and drop(x, -n) is x[:-n]. For matrices, it drops rows and preserves all columns.",
    signatures: [
      signature([
        param("x", "text", "Text to slice by code-point index."),
        param("count", "Scalar[number]", "Integer count. Positive drops from the start; negative drops from the end."),
      ], "text"),
      signature([
        param("x", "array | view", "View to slice."),
        param("count", "Scalar[number]", "Integer count. Positive drops from the start; negative drops from the end."),
      ], "array | view"),
    ],
    examples: [example("drop(@[:,Name], 1)"), example("drop(@[:,Name], -1)"), example("drop(\"abcdef\", 3)", "\"def\"")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const [targetKind, target] = ctx.evalArgValue(call.args[0]);
      if (targetKind === "error") return target as RuntimeValue;
      const count = ctx.evalScalarArg(call.args[1]);
      if (isError(count)) return count;
      return dropValue(target as RuntimeValue | RuntimeCollection, count, call.name);
    },
  },
  {
    name: "and",
    aliases: ["all"],
    category: "logical",
    summary: "Returns true when every evaluated boolean operand is true. Scalar operands are evaluated lazily left to right; all(x) is an alias for and(x).",
    signatures: [
      signature([param("x", "array | view", "Boolean values that must all evaluate to true.")], "boolean"),
      signature([param("a, b, ...", "Scalar[boolean]", "Boolean operands evaluated lazily from left to right.")], "boolean"),
    ],
    examples: [example("and(@[Flags,:])"), example("and(isNumber(x), number(x) > 0)"), example("all(@[Flags,:])")],
    evaluator: lazyLogicalEvaluator("and"),
  },
  {
    name: "or",
    aliases: ["any"],
    category: "logical",
    summary: "Returns true when at least one evaluated boolean operand is true. Scalar operands are evaluated lazily left to right; any(x) is an alias for or(x).",
    signatures: [
      signature([param("x", "array | view", "Boolean values where at least one value must evaluate to true.")], "boolean"),
      signature([param("a, b, ...", "Scalar[boolean]", "Boolean operands evaluated lazily from left to right.")], "boolean"),
    ],
    examples: [example("or(@[Flags,:])"), example("or(isBlank(x), len(x) == 0)"), example("any(@[Flags,:])")],
    evaluator: lazyLogicalEvaluator("or"),
  },
  {
    name: "if",
    category: "logical",
    summary: "Lazy conditional special form. Evaluates condition first, then evaluates only the selected branch.",
    signatures: [signature([
      param("condition", "Scalar[boolean]", "Boolean condition used to choose a branch."),
      param("thenValue", "expression", "Expression evaluated only when condition is true."),
      param("elseValue", "expression", "Expression evaluated only when condition is false."),
    ], "value")],
    examples: [example("if(isNumber(@[This,Score]), number(@[This,Score]), 0)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 3);
      if (arityError) return arityError;
      const condition = ctx.evalScalarArg(call.args[0]);
      if (isError(condition)) return condition;
      if (condition.kind !== "boolean") {
        return makeInternalError("invalid_function_call", { function: call.name, argument: "condition", argumentKind: condition.kind });
      }
      return ctx.evalExpressionValue(condition.value ? call.args[1] : call.args[2]);
    },
  },
  {
    name: "isNumber",
    category: "type",
    summary: "Returns true for numbers and false for every other runtime value.",
    signatures: [
      signature([param("x", "value", "Value to inspect.")], "boolean"),
      signature([param("x", "array | view", "Values to inspect element-wise.")], "array | view"),
    ],
    examples: [example("isNumber(@[:,Score])")],
    evaluator: typePredicateEvaluator(isNumberValue),
  },
  {
    name: "isDate",
    category: "type",
    summary: "Returns true for dates, excluding datetimes, and false for every other runtime value.",
    signatures: [
      signature([param("x", "value", "Value to inspect.")], "boolean"),
      signature([param("x", "array | view", "Values to inspect element-wise.")], "array | view"),
    ],
    examples: [example("isDate(2026-03-04)", "true")],
    evaluator: typePredicateEvaluator(isDateValue),
  },
  {
    name: "isText",
    aliases: ["isString"],
    category: "type",
    summary: "Returns true for text strings and false for every other runtime value.",
    signatures: [
      signature([param("x", "value", "Value to inspect.")], "boolean"),
      signature([param("x", "array | view", "Values to inspect element-wise.")], "array | view"),
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
      signature([param("x", "array | view", "Values to inspect element-wise.")], "array | view"),
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
      signature([param("x", "array | view", "Values to inspect element-wise.")], "array | view"),
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
      signature([param("x", "array | view", "Values to inspect element-wise.")], "array | view"),
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
      signature([param("x", "array | view", "Values to inspect element-wise.")], "array | view"),
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
      signature([param("x", "array | view", "Values to convert element-wise.")], "array | view"),
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
      signature([param("x", "array | view", "Values to convert element-wise.")], "array | view"),
    ],
    examples: [example("\"SKU-\" + text(@[:,Code])")],
    evaluator: typeConversionEvaluator(textValue),
  },
  {
    name: "format",
    category: "text",
    summary: "Formats a scalar value as text using a native numeric or temporal format.",
    signatures: [
      signature([param("value", "value", "Scalar value to convert.")], "string"),
      signature([param("value", "value", "Scalar value to format."), param("spec", "string", "Native format specification.")], "string"),
    ],
    examples: [example('format(1234.5, ",.2f")', '"1,234.50"')],
    evaluator: formatEvaluator,
  },
  {
    name: "boolean",
    category: "type",
    summary: "Explicitly converts a value to a boolean.",
    signatures: [
      signature([param("x", "value", "Value to convert.")], "boolean"),
      signature([param("x", "array | view", "Values to convert element-wise.")], "array | view"),
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
      signature([param("x", "array | view", "Text values whose character counts should be returned element-wise.")], "array | view"),
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
      signature([param("x", "array | view", "Text values to convert element-wise.")], "array | view"),
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
      signature([param("x", "array | view", "Text values to convert element-wise.")], "array | view"),
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
      signature([param("x", "array | view", "Text values to trim element-wise.")], "array | view"),
    ],
    examples: [example("trim(\"  abc  \")", "\"abc\""), example("trim(@[:,Name])")],
    evaluator: textUnaryEvaluator(trimText),
  },
  {
    name: "contains",
    category: "text",
    summary: "Returns true when text contains the case-sensitive search text. View arguments broadcast scalars and require exact shape matches.",
    signatures: [signature([
      param("text", "Scalar[string] | array | view", "Text to search."),
      param("search", "Scalar[string] | array | view", "Case-sensitive search text."),
    ], "boolean | array | view")],
    examples: [example("contains(\"abc\", \"b\")", "true"), example("contains(lower(@[:,Name]), \"smith\")")],
    evaluator: textBinaryEvaluator(containsText),
  },
  {
    name: "startsWith",
    category: "text",
    summary: "Returns true when text starts with the case-sensitive prefix. View arguments broadcast scalars and require exact shape matches.",
    signatures: [signature([
      param("text", "Scalar[string] | array | view", "Text to inspect."),
      param("prefix", "Scalar[string] | array | view", "Case-sensitive prefix."),
    ], "boolean | array | view")],
    examples: [example("startsWith(\"A-001\", \"A-\")", "true"), example("startsWith(@[:,Code], \"A-\")")],
    evaluator: textBinaryEvaluator(startsWithText),
  },
  {
    name: "endsWith",
    category: "text",
    summary: "Returns true when text ends with the case-sensitive suffix. View arguments broadcast scalars and require exact shape matches.",
    signatures: [signature([
      param("text", "Scalar[string] | array | view", "Text to inspect."),
      param("suffix", "Scalar[string] | array | view", "Case-sensitive suffix."),
    ], "boolean | array | view")],
    examples: [example("endsWith(\"report.csv\", \".csv\")", "true"), example("endsWith(@[:,File], \".csv\")")],
    evaluator: textBinaryEvaluator(endsWithText),
  },
  {
    name: "replace",
    category: "text",
    summary: "Replaces all literal case-sensitive search text with replacement text. View arguments broadcast scalars and require exact shape matches.",
    signatures: [signature([
      param("text", "Scalar[string] | array | view", "Text to edit."),
      param("search", "Scalar[string] | array | view", "Non-empty literal text to replace."),
      param("replacement", "Scalar[string] | array | view", "Replacement text."),
    ], "string | array | view")],
    examples: [example("replace(\"a-b-c\", \"-\", \":\")", "\"a:b:c\""), example("replace(@[:,Code], \" \", \"-\")")],
    evaluator: textTernaryEvaluator(replaceText),
  },
  {
    name: "slice",
    category: "text",
    summary: "Returns a zero-based, end-exclusive text slice. Negative indexes count from the end. For views, applies element-wise to text values.",
    signatures: [
      signature([
        param("text", "Scalar[string] | array | view", "Text to slice."),
        param("start", "Scalar[number]", "Zero-based start index. Negative values count from the end."),
      ], "string | array | view"),
      signature([
        param("text", "Scalar[string] | array | view", "Text to slice."),
        param("start", "Scalar[number]", "Zero-based start index. Negative values count from the end."),
        param("end", "Scalar[number]", "Exclusive end index. Negative values count from the end."),
      ], "string | array | view"),
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
    summary: "Joins text values from an array or view in their order (row-major for views).",
    signatures: [signature([
      param("separator", "Scalar[string]", "Text inserted between joined values."),
      param("x", "array | view", "Text values to join in row-major order."),
    ], "string")],
    examples: [example("join(\", \", @[:,Tag])"), example("join(\"-\", text(@[:,Id]))")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const separator = ctx.evalScalarArg(call.args[0]);
      if (isError(separator)) return separator;
      const view = expectCollectionArg(ctx, call.name, call.args[1]);
      if (isError(view as RuntimeValue)) return view as RuntimeValue;
      return joinTextView(separator, view as RuntimeCollection, call.name);
    },
  },
  {
    name: "date",
    category: "temporal",
    summary: "Constructs a date from year, month, and day, or extracts the date component from a datetime.",
    signatures: [
      signature([
        param("year", "Scalar[number]", "Four-digit year."),
        param("month", "Scalar[number]", "Month number from 1 to 12."),
        param("day", "Scalar[number]", "Day number valid for the month."),
      ], "date"),
      signature([param("x", "Scalar[datetime]", "Datetime whose calendar date should be extracted.")], "date"),
    ],
    examples: [example("date(2026, 3, 24)", "2026-03-24"), example("date(@[This,Timestamp])")],
    evaluator: dateEvaluator(),
  },
  {
    name: "time",
    category: "temporal",
    summary: "Constructs a millisecond-precision time, or extracts the time component from a datetime.",
    signatures: [
      signature([
        param("hour", "Scalar[number]", "Hour from 0 to 23."),
        param("minute", "Scalar[number]", "Minute from 0 to 59."),
      ], "time"),
      signature([
        param("hour", "Scalar[number]", "Hour from 0 to 23."),
        param("minute", "Scalar[number]", "Minute from 0 to 59."),
        param("second", "Scalar[number]", "Second from 0 to less than 60, with millisecond precision."),
      ], "time"),
      signature([param("x", "Scalar[datetime]", "Datetime whose time component should be extracted.")], "time"),
    ],
    examples: [example("time(14, 30)", "14:30"), example("time(14, 30, 5.25)", "14:30:05.25")],
    evaluator: timeEvaluator(),
  },
  {
    name: "datetime",
    category: "temporal",
    summary: "Combines a date and a time into a datetime, preserving the time offset if present.",
    signatures: [signature([
      param("date", "Scalar[date]", "Calendar date component."),
      param("time", "Scalar[time]", "Time component. Its fixed offset is preserved when present."),
    ], "datetime")],
    examples: [example("datetime(@[This,Date], @[This,Time])")],
    evaluator: datetimeEvaluator(),
  },
  {
    name: "duration",
    category: "temporal",
    summary: "Constructs a fixed duration from optional days, hours, minutes, and seconds components.",
    signatures: [signature([
      param("days", "Scalar[number]", "Optional integer day count."),
      param("hours", "Scalar[number]", "Optional integer hour count."),
      param("minutes", "Scalar[number]", "Optional integer minute count."),
      param("seconds", "Scalar[number]", "Optional seconds component in [0, 60), with millisecond precision; not total elapsed seconds."),
    ], "duration")],
    examples: [example("duration(0, 1, 30)", "PT1H30M"), example("duration(1)", "P1D")],
    evaluator: durationEvaluator(),
  },
  {
    name: "year",
    category: "temporal",
    summary: "Returns the year component from a date or datetime.",
    signatures: [signature([param("x", "Scalar[date | datetime]", "Temporal value to inspect.")], "number")],
    examples: [example("year(@[This,Date])")],
    evaluator: temporalComponentEvaluator("year"),
  },
  {
    name: "month",
    category: "temporal",
    summary: "Returns the month component from a date or datetime.",
    signatures: [signature([param("x", "Scalar[date | datetime]", "Temporal value to inspect.")], "number")],
    examples: [example("month(@[This,Date])")],
    evaluator: temporalComponentEvaluator("month"),
  },
  {
    name: "day",
    category: "temporal",
    summary: "Returns the day component from a date or datetime.",
    signatures: [signature([param("x", "Scalar[date | datetime]", "Temporal value to inspect.")], "number")],
    examples: [example("day(@[This,Date])")],
    evaluator: temporalComponentEvaluator("day"),
  },
  {
    name: "hour",
    category: "temporal",
    summary: "Returns the hour component from a time or datetime.",
    signatures: [signature([param("x", "Scalar[time | datetime]", "Temporal value to inspect.")], "number")],
    examples: [example("hour(@[This,Time])")],
    evaluator: temporalComponentEvaluator("hour"),
  },
  {
    name: "minute",
    category: "temporal",
    summary: "Returns the minute component from a time or datetime.",
    signatures: [signature([param("x", "Scalar[time | datetime]", "Temporal value to inspect.")], "number")],
    examples: [example("minute(@[This,Time])")],
    evaluator: temporalComponentEvaluator("minute"),
  },
  {
    name: "second",
    category: "temporal",
    summary: "Returns the whole-second component from a time or datetime.",
    signatures: [signature([param("x", "Scalar[time | datetime]", "Temporal value to inspect.")], "number")],
    examples: [example("second(@[This,Time])")],
    evaluator: temporalComponentEvaluator("second"),
  },
  {
    name: "millisecond",
    category: "temporal",
    summary: "Returns the millisecond component from a time or datetime.",
    signatures: [signature([param("x", "Scalar[time | datetime]", "Temporal value to inspect.")], "number")],
    examples: [example("millisecond(@[This,Time])")],
    evaluator: temporalComponentEvaluator("millisecond"),
  },
  {
    name: "unixMillis",
    category: "temporal",
    summary: "Returns Unix milliseconds for an offset-qualified datetime. Offset-naive datetimes fail.",
    signatures: [signature([param("x", "Scalar[datetime offset-qualified]", "Datetime with an explicit fixed offset.")], "number")],
    examples: [example("unixMillis(@[This,Timestamp])")],
    evaluator: unixMillisEvaluator(),
  },
  {
    name: "datetimeFromUnixMillis",
    category: "temporal",
    summary: "Constructs a UTC datetime from integer Unix milliseconds.",
    signatures: [signature([param("ms", "Scalar[number]", "Unix milliseconds since 1970-01-01T00:00:00Z.")], "datetime")],
    examples: [example("datetimeFromUnixMillis(0)", "1970-01-01T00:00:00Z")],
    evaluator: datetimeFromUnixMillisEvaluator(),
  },
  {
    name: "fv",
    category: "financial",
    summary: "Returns the future value of an investment or loan using a fixed per-period rate.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Per-period interest rate."),
      param("nper", "Scalar[number]", "Number of periods."),
      param("pmt", "Scalar[number]", "Payment made each period."),
      param("pv", "Scalar[number]", "Present value. Defaults to 0."),
      param("type", "Scalar[number]", "0 for end-of-period payments, 1 for beginning-of-period payments. Defaults to 0."),
    ], "number")],
    examples: [example("fv(0.05, 10, -100, -1000)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 3, 5);
      if (arityError) return arityError;
      return fvValue(
        expectNumberArg(ctx, call.name, call.args[0]),
        expectNumberArg(ctx, call.name, call.args[1]),
        expectNumberArg(ctx, call.name, call.args[2]),
        call.args.length >= 4 ? expectNumberArg(ctx, call.name, call.args[3]) : null,
        call.args.length >= 5 ? expectNumberArg(ctx, call.name, call.args[4]) : null,
        call.name,
      );
    },
  },
  {
    name: "pv",
    category: "financial",
    summary: "Returns the present value of future payments and an optional future value.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Per-period interest rate."),
      param("nper", "Scalar[number]", "Number of periods."),
      param("pmt", "Scalar[number]", "Payment made each period."),
      param("fv", "Scalar[number]", "Future value. Defaults to 0."),
      param("type", "Scalar[number]", "0 for end-of-period payments, 1 for beginning-of-period payments. Defaults to 0."),
    ], "number")],
    examples: [example("pv(0.05, 10, -100)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 3, 5);
      if (arityError) return arityError;
      return pvValue(
        expectNumberArg(ctx, call.name, call.args[0]),
        expectNumberArg(ctx, call.name, call.args[1]),
        expectNumberArg(ctx, call.name, call.args[2]),
        call.args.length >= 4 ? expectNumberArg(ctx, call.name, call.args[3]) : null,
        call.args.length >= 5 ? expectNumberArg(ctx, call.name, call.args[4]) : null,
        call.name,
      );
    },
  },
  {
    name: "pmt",
    category: "financial",
    summary: "Returns the fixed periodic payment for an annuity.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Per-period interest rate."),
      param("nper", "Scalar[number]", "Number of periods."),
      param("pv", "Scalar[number]", "Present value."),
      param("fv", "Scalar[number]", "Future value. Defaults to 0."),
      param("type", "Scalar[number]", "0 for end-of-period payments, 1 for beginning-of-period payments. Defaults to 0."),
    ], "number")],
    examples: [example("pmt(0.05 / 12, 60, 10000)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 3, 5);
      if (arityError) return arityError;
      return pmtValue(
        expectNumberArg(ctx, call.name, call.args[0]),
        expectNumberArg(ctx, call.name, call.args[1]),
        expectNumberArg(ctx, call.name, call.args[2]),
        call.args.length >= 4 ? expectNumberArg(ctx, call.name, call.args[3]) : null,
        call.args.length >= 5 ? expectNumberArg(ctx, call.name, call.args[4]) : null,
        call.name,
      );
    },
  },
  {
    name: "nper",
    category: "financial",
    summary: "Returns the number of periods required for an annuity.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Per-period interest rate."),
      param("pmt", "Scalar[number]", "Payment made each period."),
      param("pv", "Scalar[number]", "Present value."),
      param("fv", "Scalar[number]", "Future value. Defaults to 0."),
      param("type", "Scalar[number]", "0 for end-of-period payments, 1 for beginning-of-period payments. Defaults to 0."),
    ], "number")],
    examples: [example("nper(0.05 / 12, -200, 10000)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 3, 5);
      if (arityError) return arityError;
      return nperValue(
        expectNumberArg(ctx, call.name, call.args[0]),
        expectNumberArg(ctx, call.name, call.args[1]),
        expectNumberArg(ctx, call.name, call.args[2]),
        call.args.length >= 4 ? expectNumberArg(ctx, call.name, call.args[3]) : null,
        call.args.length >= 5 ? expectNumberArg(ctx, call.name, call.args[4]) : null,
        call.name,
      );
    },
  },
  {
    name: "rate",
    category: "financial",
    summary: "Solves the per-period interest rate for an annuity using the deterministic RFC-0031 root solver.",
    signatures: [signature([
      param("nper", "Scalar[number]", "Number of periods."),
      param("pmt", "Scalar[number]", "Payment made each period."),
      param("pv", "Scalar[number]", "Present value."),
      param("fv", "Scalar[number]", "Future value. Defaults to 0."),
      param("type", "Scalar[number]", "0 for end-of-period payments, 1 for beginning-of-period payments. Defaults to 0."),
    ], "number")],
    examples: [example("rate(60, -188.71, 10000)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 3, 5);
      if (arityError) return arityError;
      return rateValue(
        expectNumberArg(ctx, call.name, call.args[0]),
        expectNumberArg(ctx, call.name, call.args[1]),
        expectNumberArg(ctx, call.name, call.args[2]),
        call.args.length >= 4 ? expectNumberArg(ctx, call.name, call.args[3]) : null,
        call.args.length >= 5 ? expectNumberArg(ctx, call.name, call.args[4]) : null,
        call.name,
      );
    },
  },
  {
    name: "ipmt",
    category: "financial",
    summary: "Returns the interest portion of a fixed periodic payment.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Per-period interest rate."),
      param("per", "Scalar[number]", "One-based period to inspect."),
      param("nper", "Scalar[number]", "Number of periods."),
      param("pv", "Scalar[number]", "Present value."),
      param("fv", "Scalar[number]", "Future value. Defaults to 0."),
      param("type", "Scalar[number]", "0 for end-of-period payments, 1 for beginning-of-period payments. Defaults to 0."),
    ], "number")],
    examples: [example("ipmt(0.05 / 12, 1, 60, 10000)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 4, 6);
      if (arityError) return arityError;
      return ipmtValue(
        expectNumberArg(ctx, call.name, call.args[0]),
        expectNumberArg(ctx, call.name, call.args[1]),
        expectNumberArg(ctx, call.name, call.args[2]),
        expectNumberArg(ctx, call.name, call.args[3]),
        call.args.length >= 5 ? expectNumberArg(ctx, call.name, call.args[4]) : null,
        call.args.length >= 6 ? expectNumberArg(ctx, call.name, call.args[5]) : null,
        call.name,
      );
    },
  },
  {
    name: "ppmt",
    category: "financial",
    summary: "Returns the principal portion of a fixed periodic payment.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Per-period interest rate."),
      param("per", "Scalar[number]", "One-based period to inspect."),
      param("nper", "Scalar[number]", "Number of periods."),
      param("pv", "Scalar[number]", "Present value."),
      param("fv", "Scalar[number]", "Future value. Defaults to 0."),
      param("type", "Scalar[number]", "0 for end-of-period payments, 1 for beginning-of-period payments. Defaults to 0."),
    ], "number")],
    examples: [example("ppmt(0.05 / 12, 1, 60, 10000)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 4, 6);
      if (arityError) return arityError;
      return ppmtValue(
        expectNumberArg(ctx, call.name, call.args[0]),
        expectNumberArg(ctx, call.name, call.args[1]),
        expectNumberArg(ctx, call.name, call.args[2]),
        expectNumberArg(ctx, call.name, call.args[3]),
        call.args.length >= 5 ? expectNumberArg(ctx, call.name, call.args[4]) : null,
        call.args.length >= 6 ? expectNumberArg(ctx, call.name, call.args[5]) : null,
        call.name,
      );
    },
  },
  {
    name: "cumipmt",
    category: "financial",
    summary: "Returns the cumulative interest paid over an inclusive period range.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Per-period interest rate."),
      param("nper", "Scalar[number]", "Number of periods."),
      param("pv", "Scalar[number]", "Present value."),
      param("startPeriod", "Scalar[number]", "One-based first period."),
      param("endPeriod", "Scalar[number]", "One-based final period."),
      param("type", "Scalar[number]", "0 for end-of-period payments, 1 for beginning-of-period payments. Defaults to 0."),
    ], "number")],
    examples: [example("cumipmt(0.05 / 12, 60, 10000, 1, 12)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 5, 6);
      if (arityError) return arityError;
      return cumipmtValue(
        expectNumberArg(ctx, call.name, call.args[0]),
        expectNumberArg(ctx, call.name, call.args[1]),
        expectNumberArg(ctx, call.name, call.args[2]),
        expectNumberArg(ctx, call.name, call.args[3]),
        expectNumberArg(ctx, call.name, call.args[4]),
        call.args.length === 6 ? expectNumberArg(ctx, call.name, call.args[5]) : null,
        call.name,
      );
    },
  },
  {
    name: "cumprinc",
    category: "financial",
    summary: "Returns the cumulative principal paid over an inclusive period range.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Per-period interest rate."),
      param("nper", "Scalar[number]", "Number of periods."),
      param("pv", "Scalar[number]", "Present value."),
      param("startPeriod", "Scalar[number]", "One-based first period."),
      param("endPeriod", "Scalar[number]", "One-based final period."),
      param("type", "Scalar[number]", "0 for end-of-period payments, 1 for beginning-of-period payments. Defaults to 0."),
    ], "number")],
    examples: [example("cumprinc(0.05 / 12, 60, 10000, 1, 12)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 5, 6);
      if (arityError) return arityError;
      return cumprincValue(
        expectNumberArg(ctx, call.name, call.args[0]),
        expectNumberArg(ctx, call.name, call.args[1]),
        expectNumberArg(ctx, call.name, call.args[2]),
        expectNumberArg(ctx, call.name, call.args[3]),
        expectNumberArg(ctx, call.name, call.args[4]),
        call.args.length === 6 ? expectNumberArg(ctx, call.name, call.args[5]) : null,
        call.name,
      );
    },
  },
  {
    name: "ispmt",
    category: "financial",
    summary: "Returns simple interest paid for a period of an investment.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Per-period interest rate."),
      param("per", "Scalar[number]", "One-based period to inspect."),
      param("nper", "Scalar[number]", "Number of periods."),
      param("pv", "Scalar[number]", "Present value."),
    ], "number")],
    examples: [example("ispmt(0.1, 1, 4, 1000)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 4);
      if (arityError) return arityError;
      return ispmtValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), expectNumberArg(ctx, call.name, call.args[2]), expectNumberArg(ctx, call.name, call.args[3]), call.name);
    },
  },
  {
    name: "npv",
    category: "financial",
    summary: "Discounts an array or vector view of future cash flows by a per-period rate.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Per-period discount rate."),
      param("values", "array | vector view", "Future cash flows, including a single value. The first value is discounted by one period."),
    ], "number")],
    examples: [example("npv(0.1, @[:,Cashflow])")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const values = expectCollectionArg(ctx, call.name, call.args[1]);
      if (values.kind !== "view" && values.kind !== "array") return values;
      return npvView(expectNumberArg(ctx, call.name, call.args[0]), values, call.name);
    },
  },
  {
    name: "irr",
    category: "financial",
    summary: "Solves the internal rate of return for an array or vector view of periodic cash flows.",
    signatures: [signature([param("values", "array | vector view", "Periodic cash flows whose first value is at period 0.")], "number")],
    examples: [example("irr(@[:,Cashflow])")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 1);
      if (arityError) return arityError;
      const values = expectCollectionArg(ctx, call.name, call.args[0]);
      if (values.kind !== "view" && values.kind !== "array") return values;
      return irrView(values, call.name);
    },
  },
  {
    name: "mirr",
    category: "financial",
    summary: "Returns the modified internal rate of return using separate finance and reinvestment rates.",
    signatures: [signature([
      param("values", "array | vector view", "Periodic cash flows whose first value is at period 0."),
      param("financeRate", "Scalar[number]", "Rate paid on negative cash flows."),
      param("reinvestRate", "Scalar[number]", "Rate earned by reinvested positive cash flows."),
    ], "number")],
    examples: [example("mirr(@[:,Cashflow], 0.08, 0.12)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 3);
      if (arityError) return arityError;
      const values = expectCollectionArg(ctx, call.name, call.args[0]);
      if (values.kind !== "view" && values.kind !== "array") return values;
      return mirrView(values, expectNumberArg(ctx, call.name, call.args[1]), expectNumberArg(ctx, call.name, call.args[2]), call.name);
    },
  },
  {
    name: "xnpv",
    category: "financial",
    summary: "Discounts cash flows using actual day offsets from the first supplied date and a 365-day year.",
    signatures: [signature([
      param("rate", "Scalar[number]", "Annual discount rate."),
      param("values", "array | vector view", "Cash flows, including a single value."),
      param("dates", "array | vector view", "Date values matching the cash-flow shape."),
    ], "number")],
    examples: [example("xnpv(0.1, @[:,Cashflow], @[:,Date])")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 3);
      if (arityError) return arityError;
      const values = expectCollectionArg(ctx, call.name, call.args[1]);
      if (values.kind !== "view" && values.kind !== "array") return values;
      const dates = expectCollectionArg(ctx, call.name, call.args[2]);
      if (dates.kind !== "view" && dates.kind !== "array") return dates;
      return xnpvView(expectNumberArg(ctx, call.name, call.args[0]), values, dates, call.name);
    },
  },
  {
    name: "xirr",
    category: "financial",
    summary: "Solves the annual internal rate of return for dated cash flows using the deterministic RFC-0031 root solver.",
    signatures: [signature([
      param("values", "array | vector view", "Cash flows, including a single value."),
      param("dates", "array | vector view", "Date values matching the cash-flow shape."),
    ], "number")],
    examples: [example("xirr(@[:,Cashflow], @[:,Date])")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const values = expectCollectionArg(ctx, call.name, call.args[0]);
      if (values.kind !== "view" && values.kind !== "array") return values;
      const dates = expectCollectionArg(ctx, call.name, call.args[1]);
      if (dates.kind !== "view" && dates.kind !== "array") return dates;
      return xirrView(values, dates, call.name);
    },
  },
  {
    name: "effect",
    category: "financial",
    summary: "Returns the effective annual interest rate from a nominal annual rate and compounding period count.",
    signatures: [signature([param("nominalRate", "Scalar[number]", "Nominal annual interest rate."), param("npery", "Scalar[number]", "Compounding periods per year.")], "number")],
    examples: [example("effect(0.12, 12)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      return effectValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), call.name);
    },
  },
  {
    name: "nominal",
    category: "financial",
    summary: "Returns the nominal annual interest rate from an effective annual rate and compounding period count.",
    signatures: [signature([param("effectRate", "Scalar[number]", "Effective annual interest rate."), param("npery", "Scalar[number]", "Compounding periods per year.")], "number")],
    examples: [example("nominal(0.126825, 12)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      return nominalValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), call.name);
    },
  },
  {
    name: "sln",
    category: "financial",
    summary: "Returns straight-line depreciation for one period.",
    signatures: [signature([param("cost", "Scalar[number]", "Initial asset cost."), param("salvage", "Scalar[number]", "Value at the end of depreciation."), param("life", "Scalar[number]", "Useful life in periods.")], "number")],
    examples: [example("sln(10000, 1000, 5)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 3);
      if (arityError) return arityError;
      return slnValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), expectNumberArg(ctx, call.name, call.args[2]), call.name);
    },
  },
  {
    name: "syd",
    category: "financial",
    summary: "Returns sum-of-years-digits depreciation for one period.",
    signatures: [signature([param("cost", "Scalar[number]", "Initial asset cost."), param("salvage", "Scalar[number]", "Value at the end of depreciation."), param("life", "Scalar[number]", "Useful life in periods."), param("period", "Scalar[number]", "One-based period.")], "number")],
    examples: [example("syd(10000, 1000, 5, 1)")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 4);
      if (arityError) return arityError;
      return sydValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), expectNumberArg(ctx, call.name, call.args[2]), expectNumberArg(ctx, call.name, call.args[3]), call.name);
    },
  },
  {
    name: "db",
    category: "financial",
    summary: "Returns fixed-declining-balance depreciation for one period using the Excel-compatible rounded rate convention.",
    signatures: [signature([param("cost", "Scalar[number]", "Initial asset cost."), param("salvage", "Scalar[number]", "Value at the end of depreciation."), param("life", "Scalar[number]", "Useful life in periods."), param("period", "Scalar[number]", "One-based period."), param("month", "Scalar[number]", "Months in the first year. Defaults to 12.")], "number")],
    examples: [example("db(1000000, 100000, 6, 1, 7)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 4, 5);
      if (arityError) return arityError;
      return dbValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), expectNumberArg(ctx, call.name, call.args[2]), expectNumberArg(ctx, call.name, call.args[3]), call.args.length === 5 ? expectNumberArg(ctx, call.name, call.args[4]) : null, call.name);
    },
  },
  {
    name: "ddb",
    category: "financial",
    summary: "Returns declining-balance depreciation for one period.",
    signatures: [signature([param("cost", "Scalar[number]", "Initial asset cost."), param("salvage", "Scalar[number]", "Value at the end of depreciation."), param("life", "Scalar[number]", "Useful life in periods."), param("period", "Scalar[number]", "One-based period."), param("factor", "Scalar[number]", "Declining balance factor. Defaults to 2.")], "number")],
    examples: [example("ddb(10000, 1000, 5, 1)")],
    evaluator: (call, ctx) => {
      const arityError = assertArityRange(call.name, call.args.length, 4, 5);
      if (arityError) return arityError;
      return ddbValue(expectNumberArg(ctx, call.name, call.args[0]), expectNumberArg(ctx, call.name, call.args[1]), expectNumberArg(ctx, call.name, call.args[2]), expectNumberArg(ctx, call.name, call.args[3]), call.args.length === 5 ? expectNumberArg(ctx, call.name, call.args[4]) : null, call.name);
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
    summary: "Returns the greatest common divisor of integer values in an array or view.",
    signatures: [signature([param("x", "array | view", "Integer values to scan for the greatest common divisor.")], "number")],
    examples: [example("gcd(@[Values,:])")],
    evaluator: collectionEvaluator((view) => integerAggregateView(view, "gcd")),
  },
  {
    name: "lcm",
    category: "numeric",
    summary: "Returns the least common multiple of integer values in an array or view.",
    signatures: [signature([param("x", "array | view", "Integer values to scan for the least common multiple.")], "number")],
    examples: [example("lcm(@[Values,:])")],
    evaluator: collectionEvaluator((view) => integerAggregateView(view, "lcm")),
  },
  {
    name: "not",
    category: "logical",
    summary: "Returns the logical negation of a boolean value or boolean view.",
    signatures: [
      signature([param("x", "Scalar[boolean]", "Boolean value to invert.")], "boolean"),
      signature([param("x", "array | view", "Boolean values to invert element-wise.")], "array | view"),
    ],
    examples: [example("not(true)", "false"), example("not(isNumber(@[:,Score]))")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 1);
      if (arityError) return arityError;
      const [kind, value] = ctx.evalArgValue(call.args[0]);
      if (kind === "error") return value as RuntimeValue;
      if (kind === "collection") return notView(value as RuntimeCollection, call.name);
      return notValue(value as RuntimeValue, call.name);
    },
  },
  {
    name: "dotProduct",
    aliases: ["sumproduct"],
    category: "vector",
    summary: "Multiplies two equal-length numeric vectors pairwise and sums the products.",
    signatures: [signature([
      param("x", "array | vector view", "First numeric vector. It must have the same length as y."),
      param("y", "array | vector view", "Second numeric vector. It must have the same length as x."),
    ], "number")],
    examples: [example("dotProduct(@[Price,:], @[Qty,:])"), example("sumproduct(@[Price,:], @[Qty,:])")],
    evaluator: (call, ctx) => {
      const arityError = assertArity(call.name, call.args.length, 2);
      if (arityError) return arityError;
      const left = expectCollectionArg(ctx, call.name, call.args[0]);
      if (isError(left as RuntimeValue)) return left as RuntimeValue;
      const right = expectCollectionArg(ctx, call.name, call.args[1]);
      if (isError(right as RuntimeValue)) return right as RuntimeValue;
      return dotProduct(left as RuntimeCollection, right as RuntimeCollection);
    },
  },
];

const functionRegistry = buildFunctionRegistry(standardFunctionDefinitions);

export function evalFunctionCall(call: FunctionCall, ctx: FunctionEvalContext): RuntimeValue | RuntimeCollection {
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

function collectionEvaluator(evaluate: (view: RuntimeCollection, ctx: FunctionEvalContext, call: FunctionCall) => RuntimeValue | RuntimeCollection): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 1);
    if (arityError) return arityError;
    const view = expectCollectionArg(ctx, call.name, call.args[0]);
    if (isError(view as RuntimeValue)) return view as RuntimeValue;
    return evaluate(view as RuntimeCollection, ctx, call);
  };
}

function gridViewEvaluator(evaluate: (view: RuntimeView, ctx: FunctionEvalContext, call: FunctionCall) => RuntimeValue): FunctionEvaluator {
  return collectionEvaluator((value, ctx, call) => value.kind === "view"
    ? evaluate(value, ctx, call)
    : makeInternalError("invalid_function_call", { function: call.name, argumentKind: "array", reason: "grid_view_required" }));
}

function shapeView(view: RuntimeCollection): RuntimeCollection {
  return makeRuntimeArray(view.kind === "array"
    ? [{ kind: "number", value: view.values.length }]
    : [{ kind: "number", value: view.rowCount }, { kind: "number", value: view.colCount }]);
}

function twoCollectionEvaluator(evaluate: (left: RuntimeCollection, right: RuntimeCollection, call: FunctionCall, ctx: FunctionEvalContext) => RuntimeValue): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 2);
    if (arityError) return arityError;
    const left = expectCollectionArg(ctx, call.name, call.args[0]);
    if (isError(left as RuntimeValue)) return left as RuntimeValue;
    const right = expectCollectionArg(ctx, call.name, call.args[1]);
    if (isError(right as RuntimeValue)) return right as RuntimeValue;
    return evaluate(left as RuntimeCollection, right as RuntimeCollection, call, ctx);
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

function lazyLogicalEvaluator(op: "and" | "or"): FunctionEvaluator {
  return (call, ctx) => {
    if (call.args.length < 1) {
      return makeInternalError("invalid_function_call", { function: call.name, minArgs: 1, got: call.args.length });
    }

    if (call.args.length === 1) {
      const [kind, value] = ctx.evalArgValue(call.args[0]);
      if (kind === "error") return value as RuntimeValue;
      if (kind === "collection") return booleanAggregateView(value as RuntimeCollection, op);
      return requireBooleanScalar(value as RuntimeValue, call.name);
    }

    for (const arg of call.args) {
      const value = ctx.evalScalarArg(arg);
      if (isError(value)) return value;
      const booleanValue = requireBooleanScalar(value, call.name);
      if (isError(booleanValue)) return booleanValue;
      const rawBoolean = booleanValue.value as boolean;
      if (op === "and" && !rawBoolean) return { kind: "boolean", value: false };
      if (op === "or" && rawBoolean) return { kind: "boolean", value: true };
    }

    return { kind: "boolean", value: op === "and" };
  };
}

function requireBooleanScalar(value: RuntimeValue, functionName: string): RuntimeValue {
  if (value.kind !== "boolean") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  return value;
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
