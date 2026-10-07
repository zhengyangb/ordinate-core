import { parseCellText } from "../runtime/parse";
import type { ExprNode, FunctionCall, RuntimeValue } from "../runtime/types";
import { nativeDateToSerial, type CalendarValueKind } from "./temporalValues";
import type { ExcelDateSystem } from "./dateTranslation";

const marker = "__calendar_unit_source__";
const patterns = ([1900, 1904] as const).flatMap(system =>
  (["date", "datetime", "date-or-datetime"] as const).map(kind => {
    // One source of truth: the inverse recognizes the actual import lowering,
    // not an independently maintained approximation of its formula spelling.
    const body = parseCellText(`= ${nativeDateToSerial(JSON.stringify(marker), kind, system)}`).body;
    if (!body.valid || body.kind !== "formula") throw new Error("Invalid calendar unit conversion template.");
    return {system, kind, expression: body.expression};
  }));

/** Exact structural inverse of the adapter's unit conversion. No caches, date
 * formatting guesses or algebraic rewrites of arbitrary user expressions. */
export function matchCalendarSerialConversion(node: ExprNode): {source: ExprNode; kind: CalendarValueKind; system: ExcelDateSystem} | null {
  for (const pattern of patterns) {
    let source: ExprNode | undefined;
    const match = (template: ExprNode, actual: ExprNode): boolean => {
      if (template.kind === "literal" && (template.value as RuntimeValue).kind === "string"
          && (template.value as {value: string}).value === marker) {
        if (!source) { source = actual; return true; }
        return JSON.stringify(source) === JSON.stringify(actual);
      }
      if (template.kind !== actual.kind) return false;
      if (template.kind === "call") {
        const expected = template.value as FunctionCall, value = actual.value as FunctionCall;
        return expected.name === value.name && expected.args.length === value.args.length
          && expected.args.every((arg, index) => match(arg, value.args[index]));
      }
      if (template.kind === "binary" || template.kind === "unary") return template.value === actual.value
        && (!template.left || !!actual.left && match(template.left, actual.left))
        && (!template.right || !!actual.right && match(template.right, actual.right));
      return JSON.stringify(template.value) === JSON.stringify(actual.value);
    };
    if (match(pattern.expression, node) && source) return {source, kind: pattern.kind, system: pattern.system};
  }
  return null;
}
