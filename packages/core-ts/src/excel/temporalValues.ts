import type { DateRuntimeValue, DatetimeRuntimeValue } from "../runtime/types";
import { ExcelFailure, type ExcelLocation } from "./contracts";
import type { ExcelDateSystem } from "./dateTranslation";

export type CalendarCellKind = "date" | "datetime";
/** A date-formatted formula can recalculate to either native calendar type. */
export type CalendarValueKind = CalendarCellKind | "date-or-datetime";
const DAY = 86400000;
const epoch = (system: ExcelDateSystem) => system === 1900 ? 25569 : 24107;

/** File-format evidence is consumed by the importer, never stored as a display preset. */
export function calendarCellKind(format: string | undefined): CalendarCellKind | null {
  if (!format) return null;
  const tokens = format.split(";")[0].replace(/"[^"]*"|\\.|_.|\*.|\[\$[^\]]*\]/g, "").replace(/(s)\.0{1,3}/gi, "$1");
  if (/[\[\]0#?]/.test(tokens) || !/[yd]/i.test(tokens) || !/^[ymdhs\s/.,:\-APMapm]+$/i.test(tokens)) return null;
  return /[hs]/i.test(tokens) ? "datetime" : "date";
}

export function importDateLiteral(value: number, system: ExcelDateSystem, kind: CalendarCellKind, at: ExcelLocation): string {
  const day = Math.floor(value);
  if (!Number.isFinite(value) || value < 0 || day > (system === 1900 ? 2958465 : 2957003)
      || (system === 1900 && (day === 0 || day === 60))) {
    throw new ExcelFailure("unrepresentable_value", "Excel date is not a valid native calendar date.", at);
  }
  const millis = Math.round((value - epoch(system) + (system === 1900 && day < 60 ? 1 : 0)) * DAY);
  const iso = new Date(millis).toISOString();
  if (iso.startsWith("+")) throw new ExcelFailure("unrepresentable_value", "Date exceeds the native calendar range.", at);
  // Preserve time hidden by a date-only Excel format instead of truncating it.
  return kind === "date" && value === day ? iso.slice(0, 10) : iso.slice(0, -1);
}

export function exportDateValue(value: DateRuntimeValue | DatetimeRuntimeValue, at: ExcelLocation): number {
  const iso = value.kind === "date" ? `${value.value}T00:00:00.000Z` : `${value.value.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "")}Z`;
  const days = Date.parse(iso) / DAY;
  const serial = days + 25569 - (days < -25508 ? 1 : 0);
  if (!Number.isFinite(serial) || serial < 1 || serial >= 2958466) throw new ExcelFailure("unrepresentable_value", "Date is outside Excel's supported calendar range.", at);
  return serial;
}

/** Explicit unit conversion for formulas crossing the XLSX/native boundary. */
export function nativeDateToSerial(source: string, kind: CalendarValueKind, system: ExcelDateSystem): string {
  const timestamp = `datetime(date(${source}),00:00:00Z)`;
  const clock = `(hour(${source})*3600000+minute(${source})*60000+second(${source})*1000+millisecond(${source}))`;
  // Only mixed calendar references need a type branch. Do not broaden time(date)
  // or infer a formula's future type from its cached result.
  const fraction = kind === "date" ? "" : `+${kind === "date-or-datetime" ? `if(isDate(${source}),0,${clock})` : clock}/86400000`;
  const days = `(unixMillis(${timestamp})/86400000+${epoch(system)}${fraction})`;
  return system === 1900 ? `(${days}-if(${days}<61,1,0))` : days;
}

export function serialToNativeDate(source: string, kind: CalendarCellKind, system: ExcelDateSystem): string {
  const value = `(${source})`;
  const days = system === 1900 ? `(${value}+if(${value}<60,1,0))` : value;
  // Remove the UTC offset: spreadsheet dates are local calendar values, not instants.
  const instant = `datetimeFromUnixMillis(round((${days}-${epoch(system)})*86400000,0))`;
  const date = `date(${instant})`;
  // Move the elapsed duration onto a floating epoch instead of rebuilding the
  // clock from four components. Same wall time, no offset, much smaller formulas.
  const datetime = `(1970-01-01T00:00+(${instant}-datetimeFromUnixMillis(0)))`;
  // Display intent cannot truncate a fractional-day value. Exact integral input
  // remains a date; fractional input remains a datetime, including rounded midnight.
  const result = kind === "date" ? `if(${value}==floor(${value}),${date},${datetime})` : datetime;
  const valid = system === 1900 ? `and(${value}>=1,${value}<2958466,floor(${value})!=60)` : `and(${value}>=0,${value}<2957004)`;
  return `if(${valid},${result},error[type_error])`;
}
