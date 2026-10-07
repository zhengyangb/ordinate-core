import { isError, makeInternalError } from "../errors";
import { formatValue, parseFormatSpec } from "../formatting";
import { MAX_TEXT_LENGTH } from "../textLimits";
import type { FunctionCall, RuntimeValue } from "../types";
import { assertArityRange, type FunctionEvalContext } from "./args";
import { textValue } from "./typePredicates";

export function formatEvaluator(call: FunctionCall, ctx: FunctionEvalContext): RuntimeValue {
  const arity = assertArityRange(call.name, call.args.length, 1, 2);
  if (arity) return arity;
  const value = ctx.evalScalarArg(call.args[0]);
  if (isError(value)) return value;
  if (call.args.length === 1) return boundedText(textValue(value, call.name));
  const spec = ctx.evalScalarArg(call.args[1]);
  if (isError(spec)) return spec;
  if (spec.kind !== "string") return makeInternalError("invalid_format_spec", { valueKind: spec.kind });
  const parsed = parseFormatSpec(spec.value);
  if ("issue" in parsed) return makeInternalError("invalid_format_spec", { ...parsed.issue });
  const formatted = formatValue(value, parsed.value);
  if ("issue" in formatted) return makeInternalError("invalid_format_value", { ...formatted.issue });
  return boundedText({ kind: "string", value: formatted.text });
}

function boundedText(value: RuntimeValue): RuntimeValue {
  return value.kind === "string" && value.value.length > MAX_TEXT_LENGTH
    ? makeInternalError("invalid_format_output_limit", { max: MAX_TEXT_LENGTH }) : value;
}
