import { decomposeDurationValue, decomposeTemporalValue, fixedDurationParts } from "../runtime/temporal";
import type { RuntimeValue } from "../runtime/types";
import { ExcelFailure, type ExcelLocation, type ExcelReport } from "./contracts";
import { exportDateValue } from "./temporalValues";

/** Excel calendar values have no offset. Preserve wall-clock components, not
 * the instant in the host's timezone. All offset losses are located warnings. */
export interface TemporalProjection {
  kind: "date" | "time" | "datetime" | "duration";
  offsetMinutes?: number;
}
export const temporalNumberFormats = {
  date: "yyyy-mm-dd", time: "hh:mm:ss.000", datetime: "yyyy-mm-dd hh:mm:ss.000", duration: "[h]:mm:ss.000",
} as const;
export function warnOffset(report: ExcelReport, at: ExcelLocation): void {
  report.warnOnce("semantic_difference", "Timezone offset is removed; the original calendar date and clock time are retained.", at);
}
export function warnTemporalPresentation(value: RuntimeValue, report: ExcelReport, at: ExcelLocation): void {
  if ((value.kind === "time" || value.kind === "datetime") && value.isOffsetQualified) warnOffset(report, at);
  if (value.kind === "duration" && value.value.startsWith("-")) report.warnOnce("presentation_approximated",
    "Negative elapsed time is retained as a numeric value; Excel's 1900-calendar time format may display ####.", at);
}
export function temporalProjection(value: RuntimeValue): TemporalProjection | undefined {
  if (value.kind === "duration") return {kind:"duration"};
  if (!["date", "time", "datetime"].includes(value.kind)) return undefined;
  const parts = decomposeTemporalValue(value);
  if (!parts) throw new Error("Invalid native temporal value at Excel export boundary.");
  return {kind:value.kind as "date" | "time" | "datetime", ...(parts.time?.offsetMinutes === null || parts.time?.offsetMinutes === undefined ? {} : {offsetMinutes:parts.time.offsetMinutes})};
}
export function exportTemporalValue(value: RuntimeValue, report: ExcelReport, at: ExcelLocation): number {
  warnTemporalPresentation(value, report, at);
  if (value.kind === "date" || value.kind === "datetime") {
    return exportDateValue(value,at);
  }
  if (value.kind === "time") {
    const parts = decomposeTemporalValue(value)!.time!;
    return (parts.hour*3600000 + parts.minute*60000 + parts.second*1000 + parts.millisecond)/86400000;
  }
  if (value.kind === "duration") {
    const parts = fixedDurationParts(decomposeDurationValue(value)!);
    if (!parts) throw new ExcelFailure("unrepresentable_value", "Calendar durations containing years or months have no fixed Excel day value.", at);
    return parts.sign * parts.totalMilliseconds/86400000;
  }
  throw new Error("Expected a temporal value.");
}

export const temporalFunctions = ["date", "time", "datetime", "duration", "year", "month", "day", "hour", "minute", "second", "millisecond", "unixMillis", "datetimeFromUnixMillis"] as const;
type TemporalTerm = {text:string; temporal?:TemporalProjection};
/** A fixed offset is a unit conversion, not a generated coercion guard.
 * Preserve wall time for display; compare/subtract known instants in UTC. */
export function temporalInstantText(term: TemporalTerm): string {
  const offset = term.temporal?.offsetMinutes;
  return offset ? `(${term.text})-(${offset})/1440` : term.text;
}
export function exportTemporalFunction(name: string, args: readonly TemporalTerm[], at: ExcelLocation): {text:string; precedence?:number; temporal?:TemporalProjection} {
  const fail = (message:string):never => {throw new ExcelFailure("unsupported_formula",message,at);};
  const required = name === "duration" ? [0,4] : name === "datetime" ? [2,2] : name === "date" || name === "time" ? [1,3] : [1,1];
  if (args.length < required[0] || args.length > required[1] || name === "date" && args.length === 2) fail("Invalid temporal function arity.");
  const values=args.map(arg=>arg.text), x=values[0];
  switch(name) {
    case "date": return {text:args.length === 1 ? `INT(${x})` : `DATE(${values.join(",")})`,temporal:{kind:"date"}};
    // Calendar serial subtraction loses low bits. Quantize extraction back to
    // the native millisecond unit, so an exact second doesn't become 55.999ms.
    case "time": return {text:args.length === 1 ? `ROUND(MOD(${x},1)*86400000,0)/86400000` : `((${x})*3600000+(${values[1]})*60000+ROUND((${values[2] ?? "0"})*1000,0))/86400000`,
      precedence:40,temporal:{kind:"time",...(args.length === 1 && args[0].temporal?.offsetMinutes !== undefined ? {offsetMinutes:args[0].temporal.offsetMinutes} : {})}};
    case "datetime": return {text:`INT(${x})+MOD(${values[1]},1)`,precedence:30,temporal:{kind:"datetime",...(args[1].temporal?.offsetMinutes !== undefined ? {offsetMinutes:args[1].temporal.offsetMinutes} : {})}};
    case "duration": return {text:`((${x ?? "0"})*86400000+(${values[1] ?? "0"})*3600000+(${values[2] ?? "0"})*60000+ROUND((${values[3] ?? "0"})*1000,0))/86400000`,precedence:40,temporal:{kind:"duration"}};
    case "year": case "month": case "day": case "hour": case "minute": return {text:`${name.toUpperCase()}(${x})`};
    // Excel SECOND rounds fractional seconds. Native SECOND is the whole-second
    // component; round only to the shared millisecond precision, then truncate.
    case "second": return {text:`INT(MOD(ROUND((${x})*86400000,0),60000)/1000)`};
    case "millisecond": return {text:`MOD(ROUND((${x})*86400000,0),1000)`};
    case "unixMillis": {
      const offset=args[0].temporal?.offsetMinutes;
      if (offset === undefined) return fail("unixMillis requires a statically known fixed timezone offset for Excel export.");
      return {text:`ROUND(((${x})-25569+IF(${x}<61,1,0))*86400000${offset ? `-(${offset})*60000` : ""},0)`};
    }
    case "datetimeFromUnixMillis": {
      const serial=`((${x})/86400000+25569)`;
      return {text:`${serial}-IF(${serial}<61,1,0)`,precedence:30,temporal:{kind:"datetime",offsetMinutes:0}};
    }
    default: throw new Error("Missing temporal Excel translation: "+name);
  }
}
