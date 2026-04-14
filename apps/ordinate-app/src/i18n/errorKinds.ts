import type { ExternalErrorKind } from "@ordinate/core";

import { t, type UiLocale, type UiMessageKey } from "./messages";

const ERROR_KIND_KEY: Record<ExternalErrorKind, UiMessageKey> = {
  generic: "error.kind.generic",
  parse_error: "error.kind.parse_error",
  type_error: "error.kind.type_error",
  div_by_zero: "error.kind.div_by_zero",
  unresolved_reference: "error.kind.unresolved_reference",
  ambiguous_reference: "error.kind.ambiguous_reference",
  cycle: "error.kind.cycle",
};

function prettifyUnknownKind(rawKind: string): string {
  const cleaned = rawKind.trim().replace(/[_-]+/g, " ");
  if (cleaned.length === 0) {
    return "";
  }
  return cleaned.replace(/\b\w/g, (match) => match.toUpperCase());
}

export function getExternalErrorLabel(locale: UiLocale, rawKind: string): string {
  if (rawKind in ERROR_KIND_KEY) {
    const key = ERROR_KIND_KEY[rawKind as ExternalErrorKind];
    return t(locale, key);
  }
  const pretty = prettifyUnknownKind(rawKind);
  if (pretty.length > 0) return pretty;
  throw new Error(`unsupported external error kind '${rawKind}'`);
}

type ErrorContext = Record<string, unknown>;

function logErrorTooltipFallback(reason: string, details: Record<string, unknown>): void {
  console.warn("[ordinate-app] falling back to generic error tooltip", {
    reason,
    ...details,
  });
}

function readStringContext(
  context: ErrorContext,
  key: string,
  fallbackMessageKey: UiMessageKey,
  params: { locale: UiLocale; externalKind: string; internalKind: string },
): { ok: true; value: string } | { ok: false; message: string } {
  const value = context[key];
  if (typeof value === "string") {
    return { ok: true, value };
  }
  logErrorTooltipFallback("missing_string_context", {
    key,
    externalKind: params.externalKind,
    internalKind: params.internalKind,
    context,
  });
  return {
    ok: false,
    message: t(params.locale, fallbackMessageKey),
  };
}

function parseContext(
  rawContext: string,
  params: { locale: UiLocale; externalKind: string; internalKind: string },
): { ok: true; context: ErrorContext } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(rawContext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      logErrorTooltipFallback("invalid_context_shape", {
        externalKind: params.externalKind,
        internalKind: params.internalKind,
        rawContext,
      });
      return {
        ok: false,
        message: t(params.locale, classifyGenericMessage(params.internalKind)),
      };
    }
    return { ok: true, context: parsed as ErrorContext };
  } catch (error) {
    logErrorTooltipFallback("invalid_context_json", {
      externalKind: params.externalKind,
      internalKind: params.internalKind,
      rawContext,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: t(params.locale, classifyGenericMessage(params.internalKind)),
    };
  }
}

function classifyGenericMessage(internalKind: string): UiMessageKey {
  if (internalKind === "cycle") return "error.message.cycle";
  if (internalKind.startsWith("parse_")) return "error.message.parse_generic";
  if (internalKind.startsWith("unresolved_reference")) return "error.message.unresolved_reference";
  if (internalKind.startsWith("ambiguous_reference")) return "error.message.ambiguous_reference";
  if (internalKind.startsWith("invalid_") || internalKind === "unknown_function" || internalKind === "unknown_operator") {
    return "error.message.type_generic";
  }
  if (internalKind === "divide_by_zero") return "error.message.div_by_zero";
  return "error.message.generic";
}

export function formatErrorTooltip(params: {
  locale: UiLocale;
  externalKind: string;
  internalKind: string;
  context: string;
}): string {
  const parsedContext = parseContext(params.context, {
    locale: params.locale,
    externalKind: params.externalKind,
    internalKind: params.internalKind,
  });
  if (!parsedContext.ok) {
    return parsedContext.message;
  }
  const context = parsedContext.context;

  if (params.internalKind === "divide_by_zero") {
    return t(params.locale, "error.message.div_by_zero");
  }
  if (params.internalKind === "parse_expression_missing_closing_paren") {
    return t(params.locale, "error.message.parse_missing_closing_paren");
  }
  if (params.internalKind === "parse_function_call_missing_closing_paren") {
    const name = readStringContext(context, "name", "error.message.parse_generic", params);
    if (!name.ok) return name.message;
    return t(params.locale, "error.message.parse_function_missing_closing_paren", {
      name: name.value,
    });
  }
  if (params.internalKind === "invalid_arithmetic") {
    const operator = readStringContext(context, "operator", "error.message.type_generic", params);
    if (!operator.ok) return operator.message;
    const leftKind = readStringContext(context, "leftKind", "error.message.type_generic", params);
    if (!leftKind.ok) return leftKind.message;
    const rightKind = readStringContext(context, "rightKind", "error.message.type_generic", params);
    if (!rightKind.ok) return rightKind.message;
    return t(params.locale, "error.message.type_invalid_arithmetic", {
      operator: operator.value,
      leftKind: leftKind.value,
      rightKind: rightKind.value,
    });
  }
  if (params.internalKind === "invalid_function_call") {
    const fn = readStringContext(context, "function", "error.message.type_generic", params);
    if (!fn.ok) return fn.message;
    return t(params.locale, "error.message.type_invalid_function_call", {
      name: fn.value,
    });
  }

  const key = classifyGenericMessage(params.internalKind);
  return t(params.locale, key);
}
