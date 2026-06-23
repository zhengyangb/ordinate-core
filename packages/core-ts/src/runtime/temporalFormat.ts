import { type Diagnostic, type RuntimeValue, type TemporalFormatDirective, type TemporalFormatSpec, type TemporalFormatToken } from "./types";
import { decomposeDurationValue, decomposeTemporalValue, fixedDurationParts, type FixedDurationParts, type TemporalValueParts } from "./temporal";

type TemporalFormatParseResult = { value: TemporalFormatSpec } | { issue: Diagnostic } | null;

const DIRECTIVES: Record<string, TemporalFormatDirective> = {
  "%": "literal_percent",
  Y: "year",
  m: "month",
  d: "day",
  H: "hour",
  M: "minute",
  S: "second",
  f: "fraction",
  z: "offset_compact",
  F: "date_iso",
  T: "time_iso",
};

const DURATION_DIRECTIVES: Record<string, TemporalFormatDirective> = {
  d: "duration_total_days",
  h: "duration_total_hours",
  m: "duration_total_minutes",
  s: "duration_total_seconds",
  ms: "duration_total_milliseconds",
};

export function parseTemporalFormatSpec(pattern: string): TemporalFormatParseResult {
  const tokens: TemporalFormatToken[] = [];
  let sawSupportedDirective = false;
  let sawUnsupportedDirective = false;
  let firstUnsupportedDirective = "";

  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] !== "%") continue;
    if (i === pattern.length - 1) {
      return pattern.startsWith("%") || sawSupportedDirective
        ? { issue: diagnostic("invalid_temporal_format_trailing_percent") }
        : null;
    }

    const next = pattern[i + 1];
    if (next === ":") {
      if (pattern[i + 2] === "z") {
        sawSupportedDirective = true;
        tokens.push({ directive: "offset_colon", raw: "%:z" });
        i += 2;
        continue;
      }
      sawUnsupportedDirective = true;
      firstUnsupportedDirective = firstUnsupportedDirective || pattern.slice(i, Math.min(i + 3, pattern.length));
      if (pattern.startsWith("%") || sawSupportedDirective) {
        return { issue: diagnostic("unsupported_temporal_format_directive", { directive: pattern.slice(i, Math.min(i + 3, pattern.length)) }) };
      }
      continue;
    }

    if (next === "[") {
      const end = pattern.indexOf("]", i + 2);
      const raw = end === -1 ? pattern.slice(i) : pattern.slice(i, end + 1);
      const unit = end === -1 ? "" : pattern.slice(i + 2, end);
      const directive = DURATION_DIRECTIVES[unit];
      if (directive) {
        sawSupportedDirective = true;
        tokens.push({ directive, raw });
        i = end;
        continue;
      }
      sawUnsupportedDirective = true;
      firstUnsupportedDirective = firstUnsupportedDirective || raw;
      if (pattern.startsWith("%") || sawSupportedDirective) {
        return { issue: diagnostic("unsupported_temporal_format_directive", { directive: raw }) };
      }
      continue;
    }

    const directive = DIRECTIVES[next];
    if (directive) {
      sawSupportedDirective = true;
      tokens.push({ directive, raw: `%${next}` });
      i += 1;
      continue;
    }

    sawUnsupportedDirective = true;
    firstUnsupportedDirective = firstUnsupportedDirective || `%${next}`;
    if (pattern.startsWith("%") || sawSupportedDirective) {
      return { issue: diagnostic("unsupported_temporal_format_directive", { directive: `%${next}` }) };
    }
  }

  if (sawSupportedDirective && firstUnsupportedDirective) {
    return { issue: diagnostic("unsupported_temporal_format_directive", { directive: firstUnsupportedDirective }) };
  }

  if (!sawSupportedDirective) {
    return sawUnsupportedDirective && pattern.startsWith("%")
      ? { issue: diagnostic("unsupported_temporal_format_directive", { directive: firstDirective(pattern) }) }
      : null;
  }

  return {
    value: {
      kind: "temporal",
      pattern,
      tokens,
    },
  };
}

export function formatTemporalValue(value: RuntimeValue, format: TemporalFormatSpec): { text: string } | { issue: Diagnostic } {
  if (value.kind === "duration") {
    return formatDurationTemporalValue(value, format);
  }

  const parts = decomposeTemporalValue(value);
  if (!parts) {
    return { issue: diagnostic("format_value_kind_mismatch", { formatKind: "temporal", valueKind: value.kind }) };
  }

  let out = "";
  for (let i = 0; i < format.pattern.length; i += 1) {
    const ch = format.pattern[i];
    if (ch !== "%") {
      out += ch;
      continue;
    }
    const next = format.pattern[i + 1];
    if (next === "%") {
      out += "%";
      i += 1;
      continue;
    }
    if (next === ":" && format.pattern[i + 2] === "z") {
      const offset = formatOffset(parts, value.kind, true);
      if ("issue" in offset) return offset;
      out += offset.text;
      i += 2;
      continue;
    }
    if (next === "[") {
      const end = format.pattern.indexOf("]", i + 2);
      const raw = end === -1 ? format.pattern.slice(i) : format.pattern.slice(i, end + 1);
      const unit = end === -1 ? "" : format.pattern.slice(i + 2, end);
      const directive = DURATION_DIRECTIVES[unit];
      if (!directive) {
        throw new Error(`unvalidated temporal format directive '${raw}'`);
      }
      const formatted = formatDirective(parts, value.kind, directive);
      if ("issue" in formatted) return formatted;
      out += formatted.text;
      i = end;
      continue;
    }

    const directive = DIRECTIVES[next];
    if (!directive) {
      throw new Error(`unvalidated temporal format directive '%${next ?? ""}'`);
    }
    const formatted = formatDirective(parts, value.kind, directive);
    if ("issue" in formatted) return formatted;
    out += formatted.text;
    i += 1;
  }

  return { text: out };
}

function formatDurationTemporalValue(value: RuntimeValue, format: TemporalFormatSpec): { text: string } | { issue: Diagnostic } {
  const parts = decomposeDurationValue(value);
  if (!parts) {
    return { issue: diagnostic("format_value_kind_mismatch", { formatKind: "temporal", valueKind: value.kind }) };
  }
  const fixed = fixedDurationParts(parts);
  const needsFixedDuration = format.tokens.some((token) => durationDirectiveRequiresFixed(token.directive));
  if (!fixed && needsFixedDuration) {
    return { issue: diagnostic("duration_format_requires_fixed_duration") };
  }

  let out = "";
  let signApplied = false;
  for (let i = 0; i < format.pattern.length; i += 1) {
    const ch = format.pattern[i];
    if (ch !== "%") {
      out += ch;
      continue;
    }
    const next = format.pattern[i + 1];
    if (next === "%") {
      out += "%";
      i += 1;
      continue;
    }
    if (next === "[") {
      const end = format.pattern.indexOf("]", i + 2);
      const raw = end === -1 ? format.pattern.slice(i) : format.pattern.slice(i, end + 1);
      const unit = end === -1 ? "" : format.pattern.slice(i + 2, end);
      const directive = DURATION_DIRECTIVES[unit];
      if (!directive) {
        throw new Error(`unvalidated temporal format directive '${raw}'`);
      }
      if (!fixed) return { issue: diagnostic("duration_format_requires_fixed_duration") };
      const formatted = formatDurationDirective(fixed, directive);
      out += applyDurationSign(formatted, fixed.sign, signApplied);
      signApplied = true;
      i = end;
      continue;
    }
    if (next === ":" && format.pattern[i + 2] === "z") {
      return directiveMismatch(value.kind, "offset_colon");
    }

    const directive = DIRECTIVES[next];
    if (!directive) {
      throw new Error(`unvalidated temporal format directive '%${next ?? ""}'`);
    }
    if (durationDirectiveRequiresFixed(directive) && !fixed) {
      return { issue: diagnostic("duration_format_requires_fixed_duration") };
    }
    if (!durationDirectiveRequiresFixed(directive)) {
      return directiveMismatch("duration", directive);
    }
    if (!fixed) {
      return { issue: diagnostic("duration_format_requires_fixed_duration") };
    }
    const formatted = formatDurationClockDirective(fixed, directive);
    if ("issue" in formatted) return formatted;
    out += applyDurationSign(formatted.text, fixed.sign, signApplied);
    signApplied = true;
    i += 1;
  }

  return { text: out };
}

function formatDirective(
  parts: TemporalValueParts,
  valueKind: RuntimeValue["kind"],
  directive: TemporalFormatDirective,
): { text: string } | { issue: Diagnostic } {
  switch (directive) {
    case "literal_percent":
      return { text: "%" };
    case "year":
      return formatDateField(parts, valueKind, "year", 4);
    case "month":
      return formatDateField(parts, valueKind, "month", 2);
    case "day":
      return formatDateField(parts, valueKind, "day", 2);
    case "hour":
      return formatTimeField(parts, valueKind, "hour");
    case "minute":
      return formatTimeField(parts, valueKind, "minute");
    case "second":
      return formatTimeField(parts, valueKind, "second");
    case "fraction":
      if (!parts.time) return directiveMismatch(valueKind, directive);
      return { text: `${pad(parts.time.millisecond, 3)}000` };
    case "offset_compact":
      return formatOffset(parts, valueKind, false);
    case "offset_colon":
      return formatOffset(parts, valueKind, true);
    case "date_iso":
      if (!parts.date) return directiveMismatch(valueKind, directive);
      return { text: `${pad(parts.date.year, 4)}-${pad(parts.date.month, 2)}-${pad(parts.date.day, 2)}` };
    case "time_iso":
      if (!parts.time) return directiveMismatch(valueKind, directive);
      return { text: `${pad(parts.time.hour, 2)}:${pad(parts.time.minute, 2)}:${pad(parts.time.second, 2)}` };
    case "duration_total_days":
    case "duration_total_hours":
    case "duration_total_minutes":
    case "duration_total_seconds":
    case "duration_total_milliseconds":
      return directiveMismatch(valueKind, directive);
  }
}

function formatDurationClockDirective(
  parts: FixedDurationParts,
  directive: TemporalFormatDirective,
): { text: string } | { issue: Diagnostic } {
  switch (directive) {
    case "literal_percent":
      return { text: "%" };
    case "hour":
      return { text: pad(parts.hour, 2) };
    case "minute":
      return { text: pad(parts.minute, 2) };
    case "second":
      return { text: pad(parts.second, 2) };
    case "fraction":
      return { text: `${pad(parts.millisecond, 3)}000` };
    case "time_iso":
      return { text: `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}:${pad(parts.second, 2)}` };
    case "year":
    case "month":
    case "day":
    case "offset_compact":
    case "offset_colon":
    case "date_iso":
    case "duration_total_days":
    case "duration_total_hours":
    case "duration_total_minutes":
    case "duration_total_seconds":
    case "duration_total_milliseconds":
      return directiveMismatch("duration", directive);
  }
}

function durationDirectiveRequiresFixed(directive: TemporalFormatDirective): boolean {
  switch (directive) {
    case "hour":
    case "minute":
    case "second":
    case "fraction":
    case "time_iso":
    case "duration_total_days":
    case "duration_total_hours":
    case "duration_total_minutes":
    case "duration_total_seconds":
    case "duration_total_milliseconds":
      return true;
    case "literal_percent":
    case "year":
    case "month":
    case "day":
    case "offset_compact":
    case "offset_colon":
    case "date_iso":
      return false;
  }
}

function formatDurationDirective(parts: FixedDurationParts, directive: TemporalFormatDirective): string {
  switch (directive) {
    case "duration_total_days":
      return String(parts.totalDays);
    case "duration_total_hours":
      return String(parts.totalHours);
    case "duration_total_minutes":
      return String(parts.totalMinutes);
    case "duration_total_seconds":
      return String(parts.totalSeconds);
    case "duration_total_milliseconds":
      return String(parts.totalMilliseconds);
    case "literal_percent":
    case "year":
    case "month":
    case "day":
    case "hour":
    case "minute":
    case "second":
    case "fraction":
    case "offset_compact":
    case "offset_colon":
    case "date_iso":
    case "time_iso":
      throw new Error(`unexpected duration total directive '${directive}'`);
  }
}

function applyDurationSign(text: string, sign: 1 | -1, alreadyApplied: boolean): string {
  if (sign !== -1 || alreadyApplied) return text;
  return `-${text}`;
}

function formatDateField(parts: TemporalValueParts, valueKind: RuntimeValue["kind"], field: "year" | "month" | "day", width: number): { text: string } | { issue: Diagnostic } {
  if (!parts.date) return directiveMismatch(valueKind, field);
  return { text: pad(parts.date[field], width) };
}

function formatTimeField(parts: TemporalValueParts, valueKind: RuntimeValue["kind"], field: "hour" | "minute" | "second"): { text: string } | { issue: Diagnostic } {
  if (!parts.time) return directiveMismatch(valueKind, field);
  return { text: pad(parts.time[field], 2) };
}

function formatOffset(parts: TemporalValueParts, valueKind: RuntimeValue["kind"], colon: boolean): { text: string } | { issue: Diagnostic } {
  if (!parts.time || valueKind === "date") {
    return directiveMismatch(valueKind, colon ? "offset_colon" : "offset_compact");
  }
  if (parts.time.offsetMinutes === null) {
    return { issue: diagnostic("temporal_format_offset_requires_offset_qualified_value", { valueKind }) };
  }
  const minutes = parts.time.offsetMinutes;
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hoursText = pad(Math.floor(abs / 60), 2);
  const minutesText = pad(abs % 60, 2);
  return { text: colon ? `${sign}${hoursText}:${minutesText}` : `${sign}${hoursText}${minutesText}` };
}

function directiveMismatch(valueKind: RuntimeValue["kind"], directive: string): { issue: Diagnostic } {
  return { issue: diagnostic("temporal_format_directive_value_mismatch", { valueKind, directive }) };
}

function firstDirective(pattern: string): string {
  const idx = pattern.indexOf("%");
  if (idx === -1) return "";
  return pattern.slice(idx, Math.min(idx + 2, pattern.length));
}

function diagnostic(code: string, context: Record<string, unknown> = {}): Diagnostic {
  return { code, context };
}

function pad(value: number, width: number): string {
  return `${value}`.padStart(width, "0");
}
