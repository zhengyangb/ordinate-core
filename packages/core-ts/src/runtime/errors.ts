import { type ExternalErrorKind, type RuntimeValue, type ErrorRuntimeValue } from "./types";

const EXTERNAL_KIND_RE = /^[a-z][a-z0-9_]*$/;

export function isValidExternalErrorKind(text: string): boolean {
  return EXTERNAL_KIND_RE.test(text);
}

export function makeError(
  errorKind: ExternalErrorKind | string,
  internalKind: string,
  context: Record<string, unknown> = {},
): ErrorRuntimeValue {
  if (!isValidExternalErrorKind(errorKind)) {
    throw new Error(`invalid external error kind '${errorKind}'`);
  }
  return {
    kind: "error",
    errorKind,
    internalKind,
    context,
  };
}

export function makeInternalError(internalKind: string, context: Record<string, unknown> = {}): ErrorRuntimeValue {
  return makeError(projectExternalKind(internalKind, context), internalKind, context);
}

export function isError(value: RuntimeValue | null | undefined): value is ErrorRuntimeValue {
  return value?.kind === "error";
}

export function projectExternalKind(internalKind: string, _context: Record<string, unknown> = {}): ExternalErrorKind {
  if (internalKind === "divide_by_zero") return "div_by_zero";
  if (internalKind === "cycle") return "cycle";

  if (internalKind.startsWith("parse_") || internalKind === "invalid_cached_literal") {
    return "parse_error";
  }

  if (internalKind.startsWith("ambiguous_reference")) {
    return "ambiguous_reference";
  }

  if (internalKind.startsWith("unresolved_reference")) {
    return "unresolved_reference";
  }

  if (
    internalKind.startsWith("invalid_")
    || internalKind === "unknown_operator"
    || internalKind === "unknown_function"
    || internalKind === "invalid_view"
  ) {
    return "type_error";
  }

  return "generic";
}

