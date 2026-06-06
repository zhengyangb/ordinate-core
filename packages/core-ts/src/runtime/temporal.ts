import { isError, makeInternalError } from "./errors";
import type { DatetimeRuntimeValue, DurationRuntimeValue, ErrorRuntimeValue, RuntimeValue, TimeRuntimeValue } from "./types";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?((?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d))?$/;
const TIME_LIKE_RE = /^\d{2}:\d{2}/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?((?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d))?$/;
const DATETIME_LIKE_RE = /^\d{4}-\d{2}-\d{2}T/;
const DURATION_RE = /^(-)?P(?=.)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?=.)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.(\d{1,3}))?S)?)?$/;
const DURATION_LIKE_RE = /^-?P(?:\d|T)/;
const OFFSET_RE = /^(Z|[+-](\d{2}):(\d{2}))$/;
const DATETIME_SCAN_RE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)?/;
const DATE_WITH_OFFSET_SCAN_RE = /^\d{4}-\d{2}-\d{2}(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)/;
const DATE_SCAN_RE = /^\d{4}-\d{2}-\d{2}/;
const TIME_SCAN_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)?/;
const DURATION_SCAN_RE = /^P(?=.)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=.)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?/;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type TimeParts = {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetText: string | null;
  offsetMinutes: number | null;
};

type DatetimeParts = DateParts & TimeParts;

type DurationParts = {
  sign: 1 | -1;
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
};

export function parseTemporalLiteral(text: string): RuntimeValue | null {
  if (DATE_WITH_OFFSET_RE.test(text)) {
    return makeInternalError("parse_temporal_date_offset", { literal: text });
  }

  const date = parseDateParts(text);
  if (date) {
    if (isError(date as RuntimeValue)) return date as RuntimeValue;
    return { kind: "date", value: formatDate(date as DateParts), isOffsetQualified: false };
  }

  if (DATETIME_LIKE_RE.test(text)) {
    const datetime = parseDatetimeParts(text);
    if (isError(datetime as RuntimeValue)) return datetime as RuntimeValue;
    if (datetime) {
      return {
        kind: "datetime",
        value: formatDatetime(datetime as DatetimeParts),
        isOffsetQualified: (datetime as DatetimeParts).offsetText !== null,
      };
    }
    return makeInternalError("parse_temporal_invalid_datetime", { literal: text });
  }

  if (TIME_LIKE_RE.test(text)) {
    const time = parseTimeParts(text);
    if (isError(time as RuntimeValue)) return time as RuntimeValue;
    if (time) {
      return {
        kind: "time",
        value: formatTime(time as TimeParts),
        isOffsetQualified: (time as TimeParts).offsetText !== null,
      };
    }
    return makeInternalError("parse_temporal_invalid_time", { literal: text });
  }

  if (DURATION_LIKE_RE.test(text)) {
    const duration = parseDurationParts(text);
    if (isError(duration as RuntimeValue)) return duration as RuntimeValue;
    if (duration) return { kind: "duration", value: formatDuration(duration as DurationParts) };
    return null;
  }

  return null;
}

export function scanTemporalLiteralPrefix(text: string): string | null {
  const match =
    DATETIME_SCAN_RE.exec(text)
    ?? DATE_WITH_OFFSET_SCAN_RE.exec(text)
    ?? DATE_SCAN_RE.exec(text)
    ?? TIME_SCAN_RE.exec(text)
    ?? (/^P(?:\d|T)/.test(text) ? DURATION_SCAN_RE.exec(text) : null);
  return match?.[0] ?? null;
}

export function makeDateValue(year: RuntimeValue, month: RuntimeValue, day: RuntimeValue, functionName: string): RuntimeValue {
  const yearNumber = integerComponent(year, functionName, "year");
  if (typeof yearNumber !== "number") return yearNumber;
  const monthNumber = integerComponent(month, functionName, "month");
  if (typeof monthNumber !== "number") return monthNumber;
  const dayNumber = integerComponent(day, functionName, "day");
  if (typeof dayNumber !== "number") return dayNumber;
  const parts = validDateParts(yearNumber, monthNumber, dayNumber);
  if (!parts) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "invalid_date" });
  }
  return { kind: "date", value: formatDate(parts), isOffsetQualified: false };
}

export function dateFromDatetime(value: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind === "date") return value;
  if (value.kind !== "datetime") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  const parts = parseDatetimeParts(value.value);
  if (!parts || isError(parts as RuntimeValue)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "invalid_datetime" });
  }
  return { kind: "date", value: formatDate(parts as DatetimeParts), isOffsetQualified: false };
}

export function makeTimeValue(hour: RuntimeValue, minute: RuntimeValue, second: RuntimeValue | null, functionName: string): RuntimeValue {
  const hourNumber = integerComponent(hour, functionName, "hour");
  if (typeof hourNumber !== "number") return hourNumber;
  const minuteNumber = integerComponent(minute, functionName, "minute");
  if (typeof minuteNumber !== "number") return minuteNumber;

  let secondNumber = 0;
  let millisecond = 0;
  if (second !== null) {
    const parsedSecond = secondComponent(second, functionName);
    if ("kind" in parsedSecond) return parsedSecond;
    secondNumber = parsedSecond.second;
    millisecond = parsedSecond.millisecond;
  }

  const parts = validTimeParts(hourNumber, minuteNumber, secondNumber, millisecond, null);
  if (!parts) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "invalid_time" });
  }
  return { kind: "time", value: formatTime(parts), isOffsetQualified: false };
}

export function timeFromDatetime(value: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind === "time") return value;
  if (value.kind !== "datetime") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  const parts = parseDatetimeParts(value.value);
  if (!parts || isError(parts as RuntimeValue)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "invalid_datetime" });
  }
  const timeParts = parts as DatetimeParts;
  return { kind: "time", value: formatTime(timeParts), isOffsetQualified: timeParts.offsetText !== null };
}

export function makeDatetimeValue(date: RuntimeValue, time: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(date)) return date;
  if (isError(time)) return time;
  if (date.kind !== "date") {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "date", argumentKind: date.kind });
  }
  if (time.kind !== "time") {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "time", argumentKind: time.kind });
  }
  const dateParts = parseDateParts(date.value);
  const timeParts = parseTimeParts(time.value);
  if (!dateParts || isError(dateParts as RuntimeValue) || !timeParts || isError(timeParts as RuntimeValue)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "invalid_temporal_value" });
  }
  const parts = { ...(dateParts as DateParts), ...(timeParts as TimeParts) };
  return { kind: "datetime", value: formatDatetime(parts), isOffsetQualified: parts.offsetText !== null };
}

export function makeDurationValue(args: readonly RuntimeValue[], functionName: string): RuntimeValue {
  if (args.length > 4) {
    return makeInternalError("invalid_function_call", { function: functionName, maxArgs: 4, got: args.length });
  }
  const components = ["days", "hours", "minutes", "seconds"] as const;
  const values = [0, 0, 0, 0];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (isError(value)) return value;
    if (index < 3) {
      const integer = integerComponent(value, functionName, components[index]);
      if (typeof integer !== "number") return integer;
      values[index] = integer;
    } else {
      const seconds = secondComponent(value, functionName);
      if ("kind" in seconds) return seconds;
      values[index] = seconds.second + seconds.millisecond / MS_PER_SECOND;
    }
  }

  const totalMs = values[0] * MS_PER_DAY + values[1] * MS_PER_HOUR + values[2] * MS_PER_MINUTE + Math.round(values[3] * MS_PER_SECOND);
  if (!Number.isSafeInteger(totalMs)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "duration_out_of_range" });
  }
  return durationFromMilliseconds(totalMs);
}

export function temporalComponent(value: RuntimeValue, component: "year" | "month" | "day" | "hour" | "minute" | "second" | "millisecond", functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (component === "year" || component === "month" || component === "day") {
    const parts = value.kind === "date"
      ? parseDateParts(value.value)
      : value.kind === "datetime"
        ? parseDatetimeParts(value.value)
        : null;
    if (!parts || isError(parts as RuntimeValue)) {
      return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
    }
    return { kind: "number", value: (parts as DateParts)[component] };
  }

  const parts = value.kind === "time"
    ? parseTimeParts(value.value)
    : value.kind === "datetime"
      ? parseDatetimeParts(value.value)
      : null;
  if (!parts || isError(parts as RuntimeValue)) {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  return { kind: "number", value: (parts as TimeParts)[component] };
}

export function unixMillisValue(value: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  if (value.kind !== "datetime") {
    return makeInternalError("invalid_function_call", { function: functionName, argumentKind: value.kind });
  }
  const parts = parseDatetimeParts(value.value);
  if (!parts || isError(parts as RuntimeValue)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "invalid_datetime" });
  }
  const datetime = parts as DatetimeParts;
  if (datetime.offsetMinutes === null) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "offset_qualified_required" });
  }
  const ms = epochMillisForDatetime(datetime, true);
  if (!Number.isSafeInteger(ms)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "timestamp_out_of_range" });
  }
  return { kind: "number", value: ms };
}

export function datetimeFromUnixMillisValue(value: RuntimeValue, functionName: string): RuntimeValue {
  if (isError(value)) return value;
  const ms = integerComponent(value, functionName, "ms");
  if (typeof ms !== "number") return ms;
  if (!Number.isSafeInteger(ms)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "timestamp_out_of_range" });
  }
  const parts = datetimePartsFromEpochMillis(ms, 0);
  if (!parts || !validDateParts(parts.year, parts.month, parts.day)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "timestamp_out_of_range" });
  }
  return { kind: "datetime", value: formatDatetime({ ...parts, offsetText: "Z", offsetMinutes: 0 }), isOffsetQualified: true };
}

export function evalTemporalArithmetic(op: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue | null {
  const leftTemporal = isTemporalValue(left);
  const rightTemporal = isTemporalValue(right);
  if (!leftTemporal && !rightTemporal) return null;
  if (op !== "+" && op !== "-") {
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (op === "+") {
    if (left.kind === "duration" && right.kind !== "duration") return addDurationToTemporal(right, left, op);
    if (right.kind === "duration" && left.kind !== "duration") return addDurationToTemporal(left, right, op);
    if (left.kind === "duration" && right.kind === "duration") return addDurations(left, right);
    return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  if (right.kind === "duration" && left.kind !== "duration") {
    const negated = negateDuration(right);
    if (isError(negated)) return negated;
    return addDurationToTemporal(left, negated as DurationRuntimeValue, op);
  }
  if (left.kind === "duration" && right.kind === "duration") {
    const negated = negateDuration(right);
    if (isError(negated)) return negated;
    return addDurations(left, negated as DurationRuntimeValue);
  }
  if (left.kind === "date" && right.kind === "date") return subtractDates(left, right);
  if (left.kind === "time" && right.kind === "time") return subtractTimes(left, right);
  if (left.kind === "datetime" && right.kind === "datetime") return subtractDatetimes(left, right);
  return makeInternalError("invalid_arithmetic", { operator: op, leftKind: left.kind, rightKind: right.kind });
}

export function evalTemporalEquality(op: "==" | "!=", left: RuntimeValue, right: RuntimeValue): RuntimeValue | null {
  const leftTemporal = isTemporalValue(left);
  const rightTemporal = isTemporalValue(right);
  if (!leftTemporal && !rightTemporal) return null;
  if (leftTemporal !== rightTemporal || left.kind !== right.kind) {
    return makeInternalError("invalid_comparison", { operator: op, leftKind: left.kind, rightKind: right.kind });
  }

  const equal = temporalValuesEqual(left, right);
  if (isError(equal as RuntimeValue)) return equal as RuntimeValue;
  return { kind: "boolean", value: op === "==" ? equal as boolean : !(equal as boolean) };
}

export function negateDurationValue(duration: DurationRuntimeValue): RuntimeValue {
  return negateDuration(duration);
}

function addDurationToTemporal(value: RuntimeValue, duration: DurationRuntimeValue, op: string): RuntimeValue {
  if (value.kind === "date") return addDurationToDate(value, duration);
  if (value.kind === "time") return addDurationToTime(value, duration);
  if (value.kind === "datetime") return addDurationToDatetime(value, duration);
  return makeInternalError("invalid_arithmetic", { operator: op, leftKind: value.kind, rightKind: duration.kind });
}

function addDurationToDate(date: RuntimeValue & { kind: "date" }, duration: DurationRuntimeValue): RuntimeValue {
  const ms = fixedDurationMilliseconds(duration, "date_arithmetic");
  if (typeof ms !== "number") return ms;
  if (ms % MS_PER_DAY !== 0) {
    return makeInternalError("invalid_arithmetic", { operator: "+", leftKind: "date", rightKind: "duration", reason: "whole_day_duration_required" });
  }
  const parts = parseDateParts(date.value);
  if (!parts || isError(parts as RuntimeValue)) {
    return makeInternalError("invalid_arithmetic", { operator: "+", reason: "invalid_date" });
  }
  const resultMs = epochMillisForDate(parts as DateParts) + ms;
  const result = datePartsFromEpochMillis(resultMs);
  if (!result || !validDateParts(result.year, result.month, result.day)) {
    return makeInternalError("invalid_arithmetic", { operator: "+", reason: "date_out_of_range" });
  }
  return { kind: "date", value: formatDate(result), isOffsetQualified: false };
}

function addDurationToTime(time: TimeRuntimeValue, duration: DurationRuntimeValue): RuntimeValue {
  const ms = fixedDurationMilliseconds(duration, "time_arithmetic");
  if (typeof ms !== "number") return ms;
  const parts = parseTimeParts(time.value);
  if (!parts || isError(parts as RuntimeValue)) {
    return makeInternalError("invalid_arithmetic", { operator: "+", reason: "invalid_time" });
  }
  const next = timeOfDayMilliseconds(parts as TimeParts) + ms;
  if (next < 0 || next >= MS_PER_DAY) {
    return makeInternalError("invalid_arithmetic", { operator: "+", reason: "time_result_out_of_day" });
  }
  return { kind: "time", value: formatTime(timePartsFromMilliseconds(next, parts as TimeParts)), isOffsetQualified: time.isOffsetQualified };
}

function addDurationToDatetime(datetime: DatetimeRuntimeValue, duration: DurationRuntimeValue): RuntimeValue {
  const ms = fixedDurationMilliseconds(duration, "datetime_arithmetic");
  if (typeof ms !== "number") return ms;
  const parts = parseDatetimeParts(datetime.value);
  if (!parts || isError(parts as RuntimeValue)) {
    return makeInternalError("invalid_arithmetic", { operator: "+", reason: "invalid_datetime" });
  }
  const datetimeParts = parts as DatetimeParts;
  const base = epochMillisForDatetime(datetimeParts, datetimeParts.offsetMinutes !== null);
  const result = datetimePartsFromEpochMillis(base + ms, datetimeParts.offsetMinutes);
  if (!result || !validDateParts(result.year, result.month, result.day)) {
    return makeInternalError("invalid_arithmetic", { operator: "+", reason: "datetime_out_of_range" });
  }
  return { kind: "datetime", value: formatDatetime(result), isOffsetQualified: datetime.isOffsetQualified };
}

function addDurations(left: DurationRuntimeValue, right: DurationRuntimeValue): RuntimeValue {
  const leftMs = fixedDurationMilliseconds(left, "duration_arithmetic");
  if (typeof leftMs !== "number") return leftMs;
  const rightMs = fixedDurationMilliseconds(right, "duration_arithmetic");
  if (typeof rightMs !== "number") return rightMs;
  return durationFromMilliseconds(leftMs + rightMs);
}

function subtractDates(left: RuntimeValue & { kind: "date" }, right: RuntimeValue & { kind: "date" }): RuntimeValue {
  const leftParts = parseDateParts(left.value);
  const rightParts = parseDateParts(right.value);
  if (!leftParts || isError(leftParts as RuntimeValue) || !rightParts || isError(rightParts as RuntimeValue)) {
    return makeInternalError("invalid_arithmetic", { operator: "-", reason: "invalid_date" });
  }
  return durationFromMilliseconds(epochMillisForDate(leftParts as DateParts) - epochMillisForDate(rightParts as DateParts));
}

function subtractTimes(left: TimeRuntimeValue, right: TimeRuntimeValue): RuntimeValue {
  const leftParts = parseTimeParts(left.value);
  const rightParts = parseTimeParts(right.value);
  if (!leftParts || isError(leftParts as RuntimeValue) || !rightParts || isError(rightParts as RuntimeValue)) {
    return makeInternalError("invalid_arithmetic", { operator: "-", reason: "invalid_time" });
  }
  if (!offsetStatesMatch(leftParts as TimeParts, rightParts as TimeParts)) {
    return makeInternalError("invalid_arithmetic", { operator: "-", reason: "offset_mismatch" });
  }
  return durationFromMilliseconds(timeOfDayMilliseconds(leftParts as TimeParts) - timeOfDayMilliseconds(rightParts as TimeParts));
}

function subtractDatetimes(left: DatetimeRuntimeValue, right: DatetimeRuntimeValue): RuntimeValue {
  const leftParts = parseDatetimeParts(left.value);
  const rightParts = parseDatetimeParts(right.value);
  if (!leftParts || isError(leftParts as RuntimeValue) || !rightParts || isError(rightParts as RuntimeValue)) {
    return makeInternalError("invalid_arithmetic", { operator: "-", reason: "invalid_datetime" });
  }
  const leftDatetime = leftParts as DatetimeParts;
  const rightDatetime = rightParts as DatetimeParts;
  if (leftDatetime.offsetMinutes !== null !== (rightDatetime.offsetMinutes !== null)) {
    return makeInternalError("invalid_arithmetic", { operator: "-", reason: "offset_mismatch" });
  }
  const qualified = leftDatetime.offsetMinutes !== null;
  return durationFromMilliseconds(epochMillisForDatetime(leftDatetime, qualified) - epochMillisForDatetime(rightDatetime, qualified));
}

function negateDuration(duration: DurationRuntimeValue): RuntimeValue {
  const parts = parseDurationParts(duration.value);
  if (!parts || isError(parts as RuntimeValue)) {
    return makeInternalError("invalid_arithmetic", { operator: "-", reason: "invalid_duration" });
  }
  return { kind: "duration", value: formatDuration({ ...(parts as DurationParts), sign: (parts as DurationParts).sign === 1 ? -1 : 1 }) };
}

function temporalValuesEqual(left: RuntimeValue, right: RuntimeValue): boolean | RuntimeValue {
  if (left.kind === "date" && right.kind === "date") {
    return left.value === right.value;
  }

  if (left.kind === "time" && right.kind === "time") {
    const leftParts = parseTimeParts(left.value);
    const rightParts = parseTimeParts(right.value);
    if (!leftParts || isError(leftParts as RuntimeValue) || !rightParts || isError(rightParts as RuntimeValue)) {
      return makeInternalError("invalid_comparison", { operator: "==", leftKind: left.kind, rightKind: right.kind });
    }
    const leftTime = leftParts as TimeParts;
    const rightTime = rightParts as TimeParts;
    return leftTime.hour === rightTime.hour
      && leftTime.minute === rightTime.minute
      && leftTime.second === rightTime.second
      && leftTime.millisecond === rightTime.millisecond
      && leftTime.offsetMinutes === rightTime.offsetMinutes;
  }

  if (left.kind === "datetime" && right.kind === "datetime") {
    const leftParts = parseDatetimeParts(left.value);
    const rightParts = parseDatetimeParts(right.value);
    if (!leftParts || isError(leftParts as RuntimeValue) || !rightParts || isError(rightParts as RuntimeValue)) {
      return makeInternalError("invalid_comparison", { operator: "==", leftKind: left.kind, rightKind: right.kind });
    }
    const leftDatetime = leftParts as DatetimeParts;
    const rightDatetime = rightParts as DatetimeParts;
    if (leftDatetime.offsetMinutes !== null !== (rightDatetime.offsetMinutes !== null)) {
      return makeInternalError("invalid_comparison", { operator: "==", reason: "offset_mismatch" });
    }
    if (leftDatetime.offsetMinutes !== null) {
      return epochMillisForDatetime(leftDatetime, true) === epochMillisForDatetime(rightDatetime, true);
    }
    return left.value === right.value;
  }

  if (left.kind === "duration" && right.kind === "duration") {
    const leftMs = fixedDurationMilliseconds(left, "duration_equality");
    const rightMs = fixedDurationMilliseconds(right, "duration_equality");
    if (typeof leftMs === "number" && typeof rightMs === "number") return leftMs === rightMs;
    return left.value === right.value;
  }

  return makeInternalError("invalid_comparison", { operator: "==", leftKind: left.kind, rightKind: right.kind });
}

function parseDateParts(text: string): DateParts | RuntimeValue | null {
  const match = DATE_RE.exec(text);
  if (!match) return null;
  const parts = validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  return parts ?? makeInternalError("parse_temporal_invalid_date", { literal: text });
}

function parseTimeParts(text: string): TimeParts | RuntimeValue | null {
  const match = TIME_RE.exec(text);
  if (!match) {
    if (/\.\d{4,}/.test(text)) return makeInternalError("parse_temporal_precision", { literal: text });
    return null;
  }
  const offset = parseOffset(match[5] ?? null);
  return validTimeParts(Number(match[1]), Number(match[2]), Number(match[3] ?? 0), fractionToMilliseconds(match[4] ?? ""), offset);
}

function parseDatetimeParts(text: string): DatetimeParts | RuntimeValue | null {
  const match = DATETIME_RE.exec(text);
  if (!match) {
    if (/\.\d{4,}/.test(text)) return makeInternalError("parse_temporal_precision", { literal: text });
    return null;
  }
  const date = validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!date) return makeInternalError("parse_temporal_invalid_date", { literal: text });
  const offset = parseOffset(match[8] ?? null);
  const time = validTimeParts(Number(match[4]), Number(match[5]), Number(match[6] ?? 0), fractionToMilliseconds(match[7] ?? ""), offset);
  if (!time) return makeInternalError("parse_temporal_invalid_time", { literal: text });
  return { ...date, ...time };
}

function parseDurationParts(text: string): DurationParts | RuntimeValue | null {
  const match = DURATION_RE.exec(text);
  if (!match) {
    if (/\.\d{4,}S/.test(text)) return makeInternalError("parse_temporal_precision", { literal: text });
    return null;
  }
  const parts: DurationParts = {
    sign: match[1] ? -1 : 1,
    years: Number(match[2] ?? 0),
    months: Number(match[3] ?? 0),
    days: Number(match[4] ?? 0),
    hours: Number(match[5] ?? 0),
    minutes: Number(match[6] ?? 0),
    seconds: Number(match[7] ?? 0),
    milliseconds: fractionToMilliseconds(match[8] ?? ""),
  };
  return parts;
}

function fixedDurationMilliseconds(duration: DurationRuntimeValue, functionName: string): number | ErrorRuntimeValue {
  const parts = parseDurationParts(duration.value);
  if (!parts || isError(parts as RuntimeValue)) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "invalid_duration" });
  }
  const durationParts = parts as DurationParts;
  if (durationParts.years !== 0 || durationParts.months !== 0) {
    return makeInternalError("invalid_function_call", { function: functionName, reason: "calendar_duration_not_supported" });
  }
  return durationParts.sign * (
    durationParts.days * MS_PER_DAY
    + durationParts.hours * MS_PER_HOUR
    + durationParts.minutes * MS_PER_MINUTE
    + durationParts.seconds * MS_PER_SECOND
    + durationParts.milliseconds
  );
}

function validDateParts(year: number, month: number, day: number): DateParts | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const maxDay = daysInMonth(year, month);
  if (day > maxDay) return null;
  return { year, month, day };
}

function validTimeParts(hour: number, minute: number, second: number, millisecond: number, offset: { text: string; minutes: number } | null): TimeParts | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second) || !Number.isInteger(millisecond)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 || millisecond < 0 || millisecond > 999) return null;
  return {
    hour,
    minute,
    second,
    millisecond,
    offsetText: offset?.text ?? null,
    offsetMinutes: offset?.minutes ?? null,
  };
}

function secondComponent(value: RuntimeValue, functionName: string): { second: number; millisecond: number } | ErrorRuntimeValue {
  if (isError(value)) return value;
  if (value.kind !== "number") {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "second", argumentKind: value.kind });
  }
  if (!Number.isFinite(value.value) || value.value < 0 || value.value >= 60) {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "second", reason: "invalid_second" });
  }
  const milliseconds = value.value * MS_PER_SECOND;
  if (!Number.isInteger(milliseconds)) {
    return makeInternalError("invalid_function_call", { function: functionName, argument: "second", reason: "millisecond_precision_required" });
  }
  return { second: Math.floor(value.value), millisecond: milliseconds % MS_PER_SECOND };
}

function integerComponent(value: RuntimeValue, functionName: string, argument: string): number | ErrorRuntimeValue {
  if (isError(value)) return value;
  if (value.kind !== "number") {
    return makeInternalError("invalid_function_call", { function: functionName, argument, argumentKind: value.kind });
  }
  if (!Number.isInteger(value.value)) {
    return makeInternalError("invalid_function_call", { function: functionName, argument, reason: "integer_required" });
  }
  return value.value;
}

function parseOffset(text: string | null): { text: string; minutes: number } | null {
  if (!text) return null;
  const match = OFFSET_RE.exec(text);
  if (!match) return null;
  if (match[1] === "Z") return { text: "Z", minutes: 0 };
  const sign = text[0] === "-" ? -1 : 1;
  return { text, minutes: sign * (Number(match[2]) * 60 + Number(match[3])) };
}

function fractionToMilliseconds(fraction: string): number {
  if (fraction === "") return 0;
  return Number(fraction.padEnd(3, "0"));
}

function isTemporalValue(value: RuntimeValue): boolean {
  return value.kind === "date" || value.kind === "time" || value.kind === "datetime" || value.kind === "duration";
}

function offsetStatesMatch(left: TimeParts, right: TimeParts): boolean {
  return left.offsetMinutes === right.offsetMinutes;
}

function epochMillisForDate(parts: DateParts): number {
  return makeUtcDate(parts.year, parts.month, parts.day).getTime();
}

function epochMillisForDatetime(parts: DatetimeParts, useOffset: boolean): number {
  const base = makeUtcDate(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond).getTime();
  return useOffset ? base - (parts.offsetMinutes ?? 0) * MS_PER_MINUTE : base;
}

function datePartsFromEpochMillis(ms: number): DateParts | null {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function datetimePartsFromEpochMillis(ms: number, offsetMinutes: number | null): DatetimeParts | null {
  const localMs = ms + (offsetMinutes ?? 0) * MS_PER_MINUTE;
  const date = new Date(localMs);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
    offsetText: offsetMinutes === null ? null : offsetText(offsetMinutes),
    offsetMinutes,
  };
}

function timePartsFromMilliseconds(ms: number, base: TimeParts): TimeParts {
  const hour = Math.floor(ms / MS_PER_HOUR);
  const afterHour = ms % MS_PER_HOUR;
  const minute = Math.floor(afterHour / MS_PER_MINUTE);
  const afterMinute = afterHour % MS_PER_MINUTE;
  const second = Math.floor(afterMinute / MS_PER_SECOND);
  return {
    hour,
    minute,
    second,
    millisecond: afterMinute % MS_PER_SECOND,
    offsetText: base.offsetText,
    offsetMinutes: base.offsetMinutes,
  };
}

function timeOfDayMilliseconds(parts: TimeParts): number {
  return parts.hour * MS_PER_HOUR + parts.minute * MS_PER_MINUTE + parts.second * MS_PER_SECOND + parts.millisecond;
}

function makeUtcDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, millisecond = 0): Date {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  date.setUTCFullYear(year);
  return date;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function durationFromMilliseconds(ms: number): DurationRuntimeValue {
  const sign = ms < 0 ? -1 : 1;
  let remaining = Math.abs(ms);
  const days = Math.floor(remaining / MS_PER_DAY);
  remaining %= MS_PER_DAY;
  const hours = Math.floor(remaining / MS_PER_HOUR);
  remaining %= MS_PER_HOUR;
  const minutes = Math.floor(remaining / MS_PER_MINUTE);
  remaining %= MS_PER_MINUTE;
  const seconds = Math.floor(remaining / MS_PER_SECOND);
  const milliseconds = remaining % MS_PER_SECOND;
  return { kind: "duration", value: formatDuration({ sign, years: 0, months: 0, days, hours, minutes, seconds, milliseconds }) };
}

function formatDate(parts: DateParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

function formatTime(parts: TimeParts): string {
  const includeSeconds = parts.second !== 0 || parts.millisecond !== 0 || parts.offsetText !== null;
  const secondText = includeSeconds ? `:${pad(parts.second, 2)}${formatMillisecond(parts.millisecond)}` : "";
  return `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}${secondText}${parts.offsetText ?? ""}`;
}

function formatDatetime(parts: DatetimeParts): string {
  return `${formatDate(parts)}T${formatTime(parts)}`;
}

function formatDuration(parts: DurationParts): string {
  const prefix = parts.sign === -1 ? "-" : "";
  const dateParts = `${parts.years ? `${parts.years}Y` : ""}${parts.months ? `${parts.months}M` : ""}${parts.days ? `${parts.days}D` : ""}`;
  const secondText = parts.seconds || parts.milliseconds ? `${parts.seconds}${formatMillisecond(parts.milliseconds)}S` : "";
  const timeParts = `${parts.hours ? `${parts.hours}H` : ""}${parts.minutes ? `${parts.minutes}M` : ""}${secondText}`;
  if (!dateParts && !timeParts) return "PT0S";
  return `${prefix}P${dateParts}${timeParts ? `T${timeParts}` : ""}`;
}

function formatMillisecond(ms: number): string {
  if (ms === 0) return "";
  return `.${pad(ms, 3).replace(/0+$/, "")}`;
}

function offsetText(minutes: number): string {
  if (minutes === 0) return "Z";
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60), 2)}:${pad(absolute % 60, 2)}`;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
