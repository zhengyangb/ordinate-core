import {
  describeDisplayMetadataDiagnostic,
  formatPresentedCell,
  formatTemporalValue,
  parseTemporalFormatSpec,
  type Diagnostic,
  type FormatSpec,
  type RuntimeValue,
} from "@ordinate/core";

import type {
  FormatLocalKey,
  FormatLocalOptions,
  FormatPreviewContext,
  NumericFormatLocalKey,
  NumericFormatLocalOptions,
  TemporalFormatLocalKey,
  TemporalFormatLocalOptions,
} from "../types/ui";

export type FormatFamily = "number" | "temporal";

export type TemporalFormatPreset = {
  id: string;
  group: "dateTime" | "duration";
  label: string;
  pattern: string;
};

export type FormatPreviewResult = {
  text: string;
  sourceLabel: "Current" | "Row" | "Column" | "Example";
  issue: Diagnostic | null;
};

export type FormatLocalView = {
  formatLocalKey: FormatLocalKey;
  formatLocalOptions: FormatLocalOptions | null;
};

const NUMERIC_TYPE_BY_KEY: Record<NumericFormatLocalKey, "d" | "f" | "e" | "%"> = {
  integer: "d",
  decimal: "f",
  scientific: "e",
  percent: "%",
};

const NUMERIC_KEY_BY_TYPE: Record<"d" | "f" | "e" | "%", NumericFormatLocalKey> = {
  d: "integer",
  f: "decimal",
  e: "scientific",
  "%": "percent",
};

export const DATE_TIME_FORMAT_PRESETS: TemporalFormatPreset[] = [
  { id: "iso-date", group: "dateTime", label: "2026-06-07", pattern: "%F" },
  { id: "us-date", group: "dateTime", label: "06/07/2026", pattern: "%m/%d/%Y" },
  { id: "dot-date", group: "dateTime", label: "07.06.2026", pattern: "%d.%m.%Y" },
  { id: "time-short", group: "dateTime", label: "14:35", pattern: "%H:%M" },
  { id: "time-seconds", group: "dateTime", label: "14:35:27", pattern: "%T" },
  { id: "date-time", group: "dateTime", label: "2026-06-07 14:35", pattern: "%F %H:%M" },
  { id: "date-time-seconds", group: "dateTime", label: "2026-06-07 14:35:27", pattern: "%F %T" },
];

export const DURATION_FORMAT_PRESETS: TemporalFormatPreset[] = [
  { id: "duration-clock-short", group: "duration", label: "1:23", pattern: "%[h]:%M" },
  { id: "duration-clock", group: "duration", label: "1:23:45", pattern: "%[h]:%M:%S" },
  { id: "duration-hours-minutes", group: "duration", label: "1 h 23 m", pattern: "%[h] h %M m" },
  { id: "duration-total-minutes", group: "duration", label: "83 min", pattern: "%[m] min" },
  { id: "duration-total-seconds", group: "duration", label: "5025 sec", pattern: "%[s] sec" },
  { id: "duration-total-ms", group: "duration", label: "5025000 ms", pattern: "%[ms] ms" },
];

export const TEMPORAL_FORMAT_PRESETS = [...DATE_TIME_FORMAT_PRESETS, ...DURATION_FORMAT_PRESETS];

export const FORMAT_SAMPLE_VALUES: Record<FormatFamily, RuntimeValue> = {
  number: { kind: "number", value: 1234.56 },
  temporal: { kind: "datetime", value: "2026-06-07T14:35:27", isOffsetQualified: false },
};

const TEMPORAL_SAMPLE_VALUES: RuntimeValue[] = [
  FORMAT_SAMPLE_VALUES.temporal,
  { kind: "duration", value: "PT1H23M45S" },
];

export function isNumericFormatKey(key: FormatLocalKey): key is NumericFormatLocalKey {
  return key === "integer" || key === "decimal" || key === "scientific" || key === "percent";
}

export function isTemporalFormatKey(key: FormatLocalKey): key is TemporalFormatLocalKey {
  return key === "temporal";
}

export function formatFamilyForKey(key: FormatLocalKey): FormatFamily | "auto" {
  if (isNumericFormatKey(key)) return "number";
  if (isTemporalFormatKey(key)) return "temporal";
  return "auto";
}

export function defaultNumericFormatOptions(key: NumericFormatLocalKey): NumericFormatLocalOptions {
  return {
    kind: "numeric",
    sign: "default",
    padWidth: null,
    grouping: false,
    precision: key === "integer" ? null : null,
  };
}

export function defaultTemporalFormatOptions(key: TemporalFormatLocalKey): TemporalFormatLocalOptions {
  const preset = TEMPORAL_FORMAT_PRESETS[0];
  if (!preset) throw new Error(`missing default ${key} format preset`);
  return {
    kind: "temporal",
    pattern: preset.pattern,
    preset: preset.id,
  };
}

export function defaultFormatOptions(key: Exclude<FormatLocalKey, "auto">): FormatLocalOptions {
  if (isNumericFormatKey(key)) return defaultNumericFormatOptions(key);
  return defaultTemporalFormatOptions(key);
}

export function numericFormatKeyFromType(type: "f" | "e" | "%" | "d" | null | undefined): FormatLocalKey {
  return type ? NUMERIC_KEY_BY_TYPE[type] ?? "auto" : "auto";
}

export function formatLocalViewFromSpec(format: FormatSpec | null | undefined, _previewValue?: RuntimeValue | null): FormatLocalView {
  if (!format) {
    return {
      formatLocalKey: "auto" as const,
      formatLocalOptions: null,
    };
  }
  if (format.kind === "numeric") {
    return {
      formatLocalKey: numericFormatKeyFromType(format.type),
      formatLocalOptions: {
        kind: "numeric" as const,
        sign: format.sign,
        padWidth: format.padWidth,
        grouping: format.grouping,
        precision: format.precision,
      },
    };
  }

  const key = "temporal";
  const preset = TEMPORAL_FORMAT_PRESETS.find((candidate) => candidate.pattern === format.pattern);
  return {
    formatLocalKey: key,
    formatLocalOptions: {
      kind: "temporal" as const,
      pattern: format.pattern,
      preset: preset?.id ?? null,
    },
  };
}

export function formatSpecFromLocalSelection(key: FormatLocalKey, options: FormatLocalOptions | null): FormatSpec | null {
  if (key === "auto") return null;
  if (isNumericFormatKey(key)) {
    if (options && options.kind !== "numeric") {
      throw new Error("numeric format key requires numeric format options");
    }
    return {
      kind: "numeric",
      sign: options?.sign ?? "default",
      padWidth: options?.padWidth ?? null,
      grouping: options?.grouping ?? false,
      precision: key === "integer" ? null : options?.precision ?? null,
      type: NUMERIC_TYPE_BY_KEY[key],
    };
  }

  if (options?.kind !== "temporal") {
    throw new Error("temporal format key requires temporal format options");
  }
  return parseTemporalFormatOrThrow(options.pattern);
}

export function parseTemporalFormatOrThrow(pattern: string): FormatSpec {
  const parsed = parseTemporalFormatSpec(pattern);
  if (!parsed) {
    throw new Error("temporal format pattern must contain a supported temporal directive");
  }
  if ("issue" in parsed) {
    throw new Error(describeDisplayMetadataDiagnostic(parsed.issue));
  }
  return parsed.value;
}

export function validateTemporalFormatPattern(pattern: string): { value: FormatSpec } | { issue: Diagnostic } {
  const parsed = parseTemporalFormatSpec(pattern);
  if (!parsed) {
    return { issue: { code: "empty_format_spec", context: {} } };
  }
  return parsed;
}

export function temporalFormatErrorMessage(issue: Diagnostic): string {
  return describeDisplayMetadataDiagnostic(issue);
}

export function resolveFormatPreview(
  key: Exclude<FormatLocalKey, "auto">,
  options: FormatLocalOptions,
  context: FormatPreviewContext | null | undefined,
): FormatPreviewResult {
  const family = formatFamilyForKey(key);
  if (family === "auto") {
    throw new Error("format preview requires a concrete format key");
  }

  if (family === "number") {
    if (options.kind !== "numeric") throw new Error("number preview requires numeric options");
    const spec = formatSpecFromLocalSelection(key, options);
    if (!spec) throw new Error("number preview requires a numeric format spec");
    const actual = context?.value?.kind === "number" ? context.value : null;
    const value = actual ?? FORMAT_SAMPLE_VALUES.number;
    return {
      text: formatPresentedCell({ value, formatLayer: { effective: spec } }),
      sourceLabel: actual ? sourceLabelForContext(context) : "Example",
      issue: null,
    };
  }

  if (options.kind !== "temporal") throw new Error("temporal preview requires temporal options");
  const spec = parseTemporalFormatOrThrow(options.pattern);
  if (spec.kind !== "temporal") throw new Error("temporal preview expected temporal spec");

  const actual = context?.value ?? null;
  if (actual && isTemporalRuntimeValue(actual)) {
    const formatted = formatTemporalValue(actual, spec);
    if (!("issue" in formatted)) {
      return {
        text: formatted.text,
        sourceLabel: sourceLabelForContext(context),
        issue: null,
      };
    }
  }

  const sampleFormatted = formatTemporalSampleValue(spec);
  if (!sampleFormatted) {
    return {
      text: runtimeValueFallbackText(FORMAT_SAMPLE_VALUES.temporal),
      sourceLabel: "Example",
      issue: null,
    };
  }
  return {
    text: sampleFormatted.text,
    sourceLabel: "Example",
    issue: sampleFormatted.issue,
  };
}

export function firstColumnFormatPreviewValue(values: RuntimeValue[][] | null | undefined, colIndex: number): RuntimeValue | null {
  if (!values || colIndex < 0) return null;
  for (const row of values) {
    const value = row[colIndex];
    if (!value || value.kind === "blank" || value.kind === "null" || value.kind === "error") continue;
    return value;
  }
  return null;
}

function sourceLabelForContext(context: FormatPreviewContext | null | undefined): FormatPreviewResult["sourceLabel"] {
  if (context?.scope === "row") return "Row";
  return context?.scope === "column" ? "Column" : "Current";
}

function isTemporalRuntimeValue(value: RuntimeValue): boolean {
  return value.kind === "date" || value.kind === "time" || value.kind === "datetime" || value.kind === "duration";
}

function formatTemporalSampleValue(spec: Extract<FormatSpec, { kind: "temporal" }>): { text: string; issue: null } | { text: string; issue: Diagnostic } | null {
  let firstIssue: Diagnostic | null = null;
  for (const sample of TEMPORAL_SAMPLE_VALUES) {
    const formatted = formatTemporalValue(sample, spec);
    if (!("issue" in formatted)) {
      return { text: formatted.text, issue: null };
    }
    firstIssue ??= formatted.issue;
  }
  return firstIssue ? { text: runtimeValueFallbackText(FORMAT_SAMPLE_VALUES.temporal), issue: firstIssue } : null;
}

function runtimeValueFallbackText(value: RuntimeValue): string {
  if (value.kind === "blank" || value.kind === "null") return "";
  if (value.kind === "boolean") return value.value ? "true" : "false";
  if (value.kind === "error") return "#ERROR";
  return String(value.value ?? "");
}
