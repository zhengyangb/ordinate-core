import type { FormatSpec } from "../runtime/types";
import { parseTemporalFormatSpec } from "../runtime/temporalFormat";
import { calendarCellKind, type CalendarCellKind } from "./temporalValues";
import type { ExcelLocation, ExcelReport } from "./contracts";

/** Calculation formats must never use the lossy display import policy below.
 * This is deliberately the intersection of both languages' numeric notation.
 */
export function exactTextNumberFormat(source: string): FormatSpec | null {
  const mapping = mapNumberFormat(source);
  return mapping.status === "exact" ? mapping.spec : null;
}

export type NumberFormatMapping = { status: "exact" | "approximate"; spec: FormatSpec } | { status: "unsupported" };

export function mapNumberFormat(source: string): NumberFormatMapping {
  const match = /^(0|#,##0)(?:\.(0{1,20}))?(%)?$/.exec(source);
  if (match) return { status: "exact", spec: { kind: "numeric", sign: "default", padWidth: null, grouping: match[1].includes(","), precision: match[2]?.length ?? 0, type: match[3] ? "%" : "f" } };
  // Display-only simplification. Calculation callers must reject this outcome.
  const sections = source.replace(/"[^"]*"|\\.|_.|\*./g, token => token.startsWith('"') || token.startsWith('\\') ? token : "").split(";");
  const simple = sections[0].trim().replace(/"\$"|\$/g, "").trim();
  const approximate = /^(#*,?#[#0,]*|0+|#0)(?:\.(0+))?(%)?$/.exec(simple);
  if (!approximate || /,$/.test(approximate[1]) || (approximate[2]?.length ?? 0) > 20) return { status: "unsupported" };
  return { status: "approximate", spec: { kind: "numeric", precision: approximate[2]?.length ?? 0, grouping: approximate[1].includes(","), sign: sections[1]?.includes("(") ? "parentheses" : "default", padWidth: null, type: approximate[3] ? "%" : "f" } };
}

const temporalFormatCodes: Readonly<Record<string,string>> = {
  "%F":"yyyy-mm-dd", "%Y-%m-%d":"yyyy-mm-dd", "%T":"hh:mm:ss", "%H:%M:%S":"hh:mm:ss",
  "%F %T":"yyyy-mm-dd hh:mm:ss", "%Y-%m-%d %H:%M:%S":"yyyy-mm-dd hh:mm:ss",
  "%FT%T":'yyyy-mm-dd"T"hh:mm:ss', "%Y-%m-%dT%H:%M:%S":'yyyy-mm-dd"T"hh:mm:ss',
  "%Y":"yyyy", "%m":"mm", "%d":"dd", "%H":"hh",
};
export function exportTextFormat(spec: FormatSpec): string | null {
  if (spec.kind === "temporal") return temporalFormatCodes[spec.pattern] ?? null;
  if (spec.kind !== "numeric" || spec.sign !== "default" || spec.padWidth !== null || spec.type === "d" || spec.type === "e" || spec.precision === null || spec.precision > 20) return null;
  const code = exportNumberFormat(spec);
  return code && exactTextNumberFormat(code) ? code : null;
}

export function importNumberFormat(source: string | undefined, report: ExcelReport, at: ExcelLocation): FormatSpec | null {
  if (!source || source === "General" || source === "@") return null;
  if (calendarCellKind(source)) return null;
  const mapping = mapNumberFormat(source);
  if (mapping.status === "unsupported") { report.warn("presentation_omitted", "Number format is not supported; the original value is retained.", at); return null; }
  const spec = mapping.spec;
  if (source !== exportNumberFormat(spec)) report.warn("presentation_approximated", "Numeric precision, grouping and percent/negative display are retained; currency, spacing and zero decorations are simplified.", at);
  return spec;
}

/** Calendar layout is not evidence of the author's system locale. Keep the
 * native ISO default rather than guessing a month/day order. The one display
 * rule independent of locale is whether Excel hid a stored clock component.
 * Date-formatted formulas retain that rule even if their next result has time.
 * No value truncation and no implicit host locale belong in this projection.
 */
export function importCalendarDisplayFormat(kind: CalendarCellKind, mayHaveTime: boolean): FormatSpec | null {
  if (kind !== "date" || !mayHaveTime) return null;
  const parsed = parseTemporalFormatSpec("%F");
  if (!parsed || "issue" in parsed) throw new Error("Invalid native ISO date display format.");
  return parsed.value;
}

export function exportNumberFormat(format: FormatSpec): string | null {
  if (format.kind === "temporal") return temporalFormatCodes[format.pattern] ?? null;
  if (format.padWidth !== null || format.type === "d") return null;
  const precision = format.precision ?? (format.type === "e" ? 6 : null);
  if (precision === null) return null;
  const digits = `${format.grouping ? "#,##0" : "0"}${precision ? `.${"0".repeat(precision)}` : ""}${format.type === "%" ? "%" : format.type === "e" ? "E+00" : ""}`;
  return format.sign === "parentheses" ? `${digits};(${digits})` : format.sign === "plus" ? `+${digits};-${digits};${digits}` : digits;
}
