import { functionTranslations } from "./functionTranslation";
import { exportTextFunctions } from "./textTranslation";
import { temporalFunctions } from "./temporalExport";

/** Explicit decisions, not a same-name fallback into either function library. */
export type ExportRule = "aggregate" | "predicate" | "conditional" | "logical" | "not"
  | "numericUnary" | "numericBinary" | "rounding" | "pi" | "text" | "signature" | "index" | "shape" | "conversion" | "format"
  | "join" | "filter" | "match" | "lookup" | "dotProduct" | "selection" | "temporal" | "calendarPredicate";
export type FunctionCompatibility =
  | { status: "translated"; rule: ExportRule }
  | { status: "unsupported"; reason: string };

const definitions: ReadonlyArray<readonly [readonly string[], FunctionCompatibility]> = [
  [["format"], { status: "translated", rule: "format" }],
  [["sum", "product", "average", "min", "max", "sumsq", "count", "counta", "countblank"], { status: "translated", rule: "aggregate" }],
  [["isNumber", "isText", "isBoolean", "isBlank", "isError"], { status: "translated", rule: "predicate" }],
  [["isDate"], { status: "translated", rule: "calendarPredicate" }],
  [["if"], { status: "translated", rule: "conditional" }],
  [["and", "or"], { status: "translated", rule: "logical" }],
  [["not"], { status: "translated", rule: "not" }],
  [["abs", "sign", "sqrt", "floor", "ceil"], { status: "translated", rule: "numericUnary" }],
  [["power", "mod"], { status: "translated", rule: "numericBinary" }],
  [["round", "roundup", "rounddown", "trunc"], { status: "translated", rule: "rounding" }],
  [["pi"], { status: "translated", rule: "pi" }],
  [Object.keys(exportTextFunctions), { status: "translated", rule: "text" }],
  [Object.keys(functionTranslations), { status: "translated", rule: "signature" }],
  [["join"], { status: "translated", rule: "join" }],
  [["filter"], { status: "translated", rule: "filter" }],
  [["match"], { status: "translated", rule: "match" }],
  [["lookup"], { status: "translated", rule: "lookup" }],
  [["dotProduct"], { status: "translated", rule: "dotProduct" }],
  [["take", "drop"], { status: "translated", rule: "selection" }],
  [["index"], { status: "translated", rule: "index" }],
  [["shape", "size", "rowCount", "columnCount"], { status: "translated", rule: "shape" }],
  [["number", "boolean", "text"], { status: "translated", rule: "conversion" }],
  [["isNull"],
    { status: "unsupported", reason: "Excel has no distinct native null type." }],
  [["trim"],
    { status: "unsupported", reason: "Whitespace trimming differs: native trim keeps interior spacing; Excel TRIM collapses it." }],
  [temporalFunctions, {status:"translated",rule:"temporal"}],
];

export const nativeFunctionCompatibility: ReadonlyMap<string, FunctionCompatibility> = new Map(definitions.flatMap(([names, policy]) =>
  names.map(name => [name, Object.freeze(policy)] as const)));

export const compatibilityDecisionNames: readonly string[] = definitions.flatMap(([names]) => names);
