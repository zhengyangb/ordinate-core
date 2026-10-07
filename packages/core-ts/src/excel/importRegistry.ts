import { functionTranslations, importedFunctions } from "./functionTranslation";
import { importTextFunctions } from "./textTranslation";
import { distributionImports } from "./distributionTranslation";
import { multipleRoundingImports } from "./roundingTranslation";

export type ImportRule = "shape" | "index" | "match" | "switch" | "char" | "dotProduct" | "calendar" | "signature" | "booleanLiteral"
  | "conditional" | "ifError" | "not" | "predicate" | "logical" | "aggregate"
  | "numericUnary" | "pi" | "numericBinary" | "rounding" | "multipleRounding" | "text" | "concatenate" | "exact" | "format" | "join" | "filter" | "lookup" | "verticalLookup" | "distribution" | "selection";

export const predicateImports: Readonly<Record<string, string>> = {
  ISNUMBER: "isNumber", ISTEXT: "isText", ISLOGICAL: "isBoolean", ISBLANK: "isBlank", ISERROR: "isError",
};

// This dispatch manifest is consumed by the adapter, not merely documentation.
const definitions: ReadonlyArray<readonly [readonly string[], ImportRule]> = [
  [["TEXT"], "format"],
  [["ROWS", "COLUMNS"], "shape"], [["INDEX"], "index"],
  [["MATCH"], "match"], [["SWITCH"], "switch"], [["CHAR"], "char"], [["SUMPRODUCT"], "dotProduct"],
  [["DATE", "YEAR", "MONTH", "DAY"], "calendar"],
  [[...importedFunctions.keys()], "signature"],
  [["TEXTJOIN"], "join"], [["FILTER"], "filter"], [["XLOOKUP"], "lookup"], [["TAKE", "DROP"], "selection"],
  [["VLOOKUP"], "verticalLookup"],
  [[...distributionImports.keys()], "distribution"],
  [["TRUE", "FALSE"], "booleanLiteral"], [["IF"], "conditional"], [["IFERROR"], "ifError"],
  [["NOT"], "not"], [Object.keys(predicateImports), "predicate"], [["AND", "OR"], "logical"],
  [["SUM", "PRODUCT", "COUNT", "COUNTA", "AVERAGE", "MIN", "MAX", "SUMSQ", "COUNTBLANK"], "aggregate"],
  [["ABS", "SIGN", "SQRT", "INT"], "numericUnary"], [["PI"], "pi"],
  [["POWER", "MOD"], "numericBinary"], [["ROUND", "ROUNDUP", "ROUNDDOWN", "TRUNC"], "rounding"],
  [Object.keys(multipleRoundingImports), "multipleRounding"],
  [Object.keys(importTextFunctions), "text"], [["CONCATENATE"], "concatenate"], [["EXACT"], "exact"],
];
export const excelImportRules: ReadonlyMap<string, ImportRule> = new Map(definitions.flatMap(([names, rule]) => names.map(name => [name, rule] as const)));
export const excelImportDecisionNames = definitions.flatMap(([names]) => names);

/** Native functions need a separate inbound decision; export support does not
 * imply import support. Exhaustiveness is tested against the runtime registry. */
export const nativeImportDecisions = {
  translated: [
    "format",
    "rowCount", "columnCount", "index", "match", "dotProduct", "date", "year", "month", "day",
    ...Object.keys(functionTranslations), "join", "filter", "lookup", "take", "drop", "if", "not", ...Object.values(predicateImports), "and", "or",
    "sum", "product", "count", "counta", "countblank", "sumsq", "average", "min", "max", "abs", "sign", "sqrt", "floor", "ceil",
    "pi", "power", "mod", "round", "roundup", "rounddown", "trunc", "lower", "upper", "len", "slice", "replace",
  ],
  helperOnly: ["text", "datetime", "time", "unixMillis", "datetimeFromUnixMillis", "isDate"],
  unsupported: [
    "shape", "size", "number", "boolean", "contains", "startsWith", "endsWith", "isNull", "trim",
    "duration", "hour", "minute", "second", "millisecond",
  ],
} as const;
