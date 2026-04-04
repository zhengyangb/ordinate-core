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

function expectString(context: ErrorContext, key: string): string {
  const value = context[key];
  if (typeof value !== "string") {
    throw new Error(`expected error context key '${key}' to be string`);
  }
  return value;
}

function parseContext(rawContext: string): ErrorContext {
  const parsed = JSON.parse(rawContext);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected error context to be object");
  }
  return parsed as ErrorContext;
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
  const context = parseContext(params.context);

  if (params.internalKind === "divide_by_zero") {
    return t(params.locale, "error.message.div_by_zero");
  }
  if (params.internalKind === "parse_expression_missing_closing_paren") {
    return t(params.locale, "error.message.parse_missing_closing_paren");
  }
  if (params.internalKind === "parse_function_call_missing_closing_paren") {
    return t(params.locale, "error.message.parse_function_missing_closing_paren", {
      name: expectString(context, "name"),
    });
  }
  if (params.internalKind === "invalid_arithmetic") {
    return t(params.locale, "error.message.type_invalid_arithmetic", {
      operator: expectString(context, "operator"),
      leftKind: expectString(context, "leftKind"),
      rightKind: expectString(context, "rightKind"),
    });
  }
  if (params.internalKind === "invalid_function_call") {
    return t(params.locale, "error.message.type_invalid_function_call", {
      name: expectString(context, "function"),
    });
  }

  const key = classifyGenericMessage(params.internalKind);
  return t(params.locale, key);
}
