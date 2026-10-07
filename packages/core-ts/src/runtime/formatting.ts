import type { Diagnostic, FormatSpec, NumericFormatSpec, RuntimeValue } from "./types";
import { validateFormatSpec } from "./displayMetadata";
import { parseTemporalFormatSpec, formatTemporalValue } from "./temporalFormat";
import { MAX_TEXT_LENGTH } from "./textLimits";

export function serializeFormatSpec(spec: FormatSpec): string {
  if (spec.kind === "temporal") return spec.pattern;
  let out = "";
  if (spec.sign === "plus") out += "+";
  else if (spec.sign === "parentheses") out += "()";
  if (spec.padWidth !== null) out += `${spec.padWidth}`;
  if (spec.grouping) out += ",";
  if (spec.precision !== null) out += `.${spec.precision}`;
  if (spec.type !== null) out += spec.type;
  return out;
}

export function parseFormatSpec(spec: string): { value: FormatSpec } | { issue: Diagnostic } {
  if (spec.length > MAX_TEXT_LENGTH) return { issue: diagnostic("format_size_limit") };
  const text = spec.trim();
  if (text === "") return { issue: diagnostic("empty_format_spec") };

  const temporalSpec = parseTemporalFormatSpec(text);
  if (temporalSpec) return temporalSpec;

  if (/\s/.test(text)) return { issue: diagnostic("format_spec_contains_whitespace") };

  let i = 0;
  let sign: NumericFormatSpec["sign"] = "default";
  if (text.startsWith("+")) {
    sign = "plus";
    i += 1;
  } else if (text.startsWith("()")) {
    sign = "parentheses";
    i += 2;
  }

  let padWidth: number | null = null;
  const padWidthStart = i;
  while (i < text.length && /[0-9]/.test(text[i])) {
    i += 1;
  }
  if (i > padWidthStart) {
    padWidth = Number(text.slice(padWidthStart, i));
  }

  let grouping = false;
  if (i < text.length && text[i] === ",") {
    grouping = true;
    i += 1;
  }

  let precision: number | null = null;
  if (i < text.length && text[i] === ".") {
    i += 1;
    const pStart = i;
    while (i < text.length && /[0-9]/.test(text[i])) {
      i += 1;
    }
    if (i === pStart) {
      return { issue: diagnostic("precision_requires_digits") };
    }
    precision = Number(text.slice(pStart, i));
  }

  let type: NumericFormatSpec["type"] = null;
  if (i < text.length) {
    const ch = text[i];
    if (ch === "f" || ch === "e" || ch === "%" || ch === "d") {
      type = ch;
      i += 1;
    } else {
      return { issue: diagnostic(`unsupported_format_type:${ch}`) };
    }
  }

  if (i !== text.length) {
    return { issue: diagnostic("invalid_format_spec_trailing_chars") };
  }

  const value = {
    kind: "numeric",
    sign,
    padWidth,
    grouping,
    precision,
    type,
  } satisfies NumericFormatSpec;
  const compatibilityIssue = validateFormatSpec(value);
  if (compatibilityIssue) {
    return { issue: compatibilityIssue };
  }

  return {
    value,
  };
}

/** Strict shared primitive. Presentation and calculation choose their error policy. */
export function formatValue(value: RuntimeValue, format: FormatSpec): { text: string } | { issue: Diagnostic } {
  const invalid = validateFormatSpec(format);
  if (invalid) return { issue: invalid };
  if (format.kind === "temporal") return formatTemporalValue(value, format);
  if (value.kind !== "number" || !Number.isFinite(Number(value.value))) {
    return { issue: diagnostic("format_value_kind_mismatch", { formatKind: format.kind, valueKind: value.kind }) };
  }
  if (format.type === "%" && !Number.isFinite(Number(value.value) * 100)) return { issue: diagnostic("format_numeric_overflow") };
  return { text: formatNumber(Number(value.value), format) };
}

function formatNumber(value: number, format: NumericFormatSpec): string {
  const isNegative = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);

  let numericText: string;
  const precision = format.precision;
  switch (format.type) {
    case "e":
      numericText = abs.toExponential(precision ?? 6);
      break;
    case "%": {
      const percentage = abs * 100;
      const percentageText = precision != null ? percentage.toFixed(precision) : serializeNumber(percentage);
      numericText = `${percentageText}%`;
      break;
    }
    case "d":
      numericText = Math.trunc(abs).toString(10);
      break;
    case "f":
      numericText = precision != null ? abs.toFixed(precision) : serializeNumber(abs);
      break;
    default:
      numericText = precision != null ? abs.toFixed(precision) : serializeNumber(abs);
      break;
  }

  if (format.grouping) {
    numericText = applyGrouping(numericText);
  }

  let signedText: string;
  if (format.sign === "parentheses" && isNegative) {
    signedText = `(${numericText})`;
  } else {
    const signPrefix = isNegative ? "-" : format.sign === "plus" ? "+" : "";
    signedText = `${signPrefix}${numericText}`;
  }

  if (format.padWidth === null || format.padWidth <= 0 || signedText.length >= format.padWidth) {
    return signedText;
  }
  if (signedText.startsWith("-") || signedText.startsWith("+")) {
    const sign = signedText[0];
    const body = signedText.slice(1).padStart(format.padWidth - 1, "0");
    return `${sign}${body}`;
  }
  return signedText.padStart(format.padWidth, "0");
}

function applyGrouping(text: string): string {
  const [integerPart, fractionalPart = ""] = text.split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fractionalPart.length > 0 ? `${grouped}.${fractionalPart}` : grouped;
}

export function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "#ERROR";
  }
  if (Number.isInteger(value)) {
    return `${value}`;
  }
  const text = Number(value).toPrecision(15);
  return Number(text).toString();
}

function diagnostic(code: string, context: Record<string, unknown> = {}): Diagnostic {
  return { code, context };
}
