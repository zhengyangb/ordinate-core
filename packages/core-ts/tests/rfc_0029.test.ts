import { describe, expect, it } from "vitest";

import {
  DocumentState,
  evaluateDocument,
  getStandardFunctionMetadata,
  listStandardFunctionMetadata,
  serializeDocumentState,
  type RuntimeValue,
} from "../src";
import { parseCellInput, type ParsedCell } from "../src/runtime";

function literalOf(cell: ParsedCell): RuntimeValue | null {
  return cell.body.valid && cell.body.kind === "literal" ? cell.body.literal : null;
}

function cellValue(doc: string, rowPath: string, colLabel: string): RuntimeValue {
  const result = evaluateDocument(doc);
  const sheet = result.sheets[0];
  const row = sheet.rowPaths.indexOf(rowPath);
  const col = sheet.colLabels.indexOf(colLabel);
  if (row < 0 || col < 0) {
    throw new Error(
      `missing cell ${rowPath}, ${colLabel}; rows=${JSON.stringify(sheet.rowPaths)} cols=${JSON.stringify(sheet.colLabels)}`,
    );
  }
  return sheet.values[row][col];
}

function expectError(doc: string, rowPath: string, colLabel: string): void {
  expect(cellValue(doc, rowPath, colLabel).kind).toBe("error");
}

describe("RFC-0029 temporal formula semantics", () => {
  it("exposes temporal functions from the registry", () => {
    const names = listStandardFunctionMetadata().map((definition) => definition.name);

    expect(names).toEqual(expect.arrayContaining([
      "date",
      "time",
      "datetime",
      "duration",
      "year",
      "month",
      "day",
      "hour",
      "minute",
      "second",
      "millisecond",
      "unixMillis",
      "datetimeFromUnixMillis",
    ]));
    expect(getStandardFunctionMetadata("date")?.category).toBe("temporal");
    expect(getStandardFunctionMetadata("unixMillis")?.summary).toContain("offset-qualified");
  });

  it("parses strict temporal literals and fails unsupported precision early", () => {
    const date = literalOf(parseCellInput("2026-03-24"));
    const leap = literalOf(parseCellInput("2024-02-29"));
    const time = literalOf(parseCellInput("14:30:00.123"));
    const offsetTime = literalOf(parseCellInput("14:30:00-04:00"));
    const datetime = literalOf(parseCellInput("2026-03-24T14:30:00Z"));
    const duration = literalOf(parseCellInput("PT0.001S"));
    const zeroDuration = literalOf(parseCellInput("PT0S"));
    const signedDuration = literalOf(parseCellInput("-PT1H"));

    expect(date).toEqual({ kind: "date", value: "2026-03-24", isOffsetQualified: false });
    expect(leap).toEqual({ kind: "date", value: "2024-02-29", isOffsetQualified: false });
    expect(time).toEqual({ kind: "time", value: "14:30:00.123", isOffsetQualified: false });
    expect(offsetTime).toEqual({ kind: "time", value: "14:30:00-04:00", isOffsetQualified: true });
    expect(datetime).toEqual({ kind: "datetime", value: "2026-03-24T14:30:00Z", isOffsetQualified: true });
    expect(duration).toEqual({ kind: "duration", value: "PT0.001S" });
    expect(zeroDuration).toEqual({ kind: "duration", value: "PT0S" });
    expect(signedDuration).toEqual({ kind: "duration", value: "-PT1H" });

    expect(literalOf(parseCellInput("2026-02-29"))?.kind).toBe("error");
    expect(literalOf(parseCellInput("2026-03-24Z"))?.kind).toBe("error");
    expect(literalOf(parseCellInput("14:30:00.1234"))?.kind).toBe("error");
    expect(literalOf(parseCellInput("2026-03-24T14:30:00.1234Z"))?.kind).toBe("error");
    expect(literalOf(parseCellInput("PT0.0001S"))?.kind).toBe("error");
    expect(literalOf(parseCellInput('"2026-03-24T14:30:00.1234Z"'))?.kind).toBe("string");
  });

  it("rejects malformed temporal-like literals without treating them as ordinary text", () => {
    expect(literalOf(parseCellInput("0000-01-01"))?.kind).toBe("error");
    expect(literalOf(parseCellInput("10000-01-01"))?.kind).toBe("string");
    expect(literalOf(parseCellInput("2026-13-01"))?.kind).toBe("error");
    expect(literalOf(parseCellInput("2026-01-32"))?.kind).toBe("error");
    expect(literalOf(parseCellInput("24:00"))?.kind).toBe("error");
    expect(literalOf(parseCellInput("23:60"))?.kind).toBe("error");
    expect(literalOf(parseCellInput("2026-03-24abc"))?.kind).toBe("string");
    expect(literalOf(parseCellInput("PT1Hx"))?.kind).toBe("string");
  });

  it("constructs and extracts temporal values in formulas", () => {
    const doc = `
# TemporalConstructors
| Item || Date | Time | Timestamp | Result |
| ---- || ---- | ---- | --------- | ------ |
| Source || 2026-03-24 | 14:30:05.250 | 2026-03-24T14:30:05.250Z | |
| DateCtor || | | | = date(2026, 3, 24) |
| TimeCtor || | | | = time(14, 30, 5.25) |
| DatetimeCtor || | | | = datetime(@[Source,Date], @[Source,Time]) |
| DurationCtor || | | | = duration(0, 1, 30, 5.25) |
| ExtractDate || | | | = date(@[Source,Timestamp]) |
| ExtractTime || | | | = time(@[Source,Timestamp]) |
| Year || | | | = year(@[Source,Timestamp]) |
| Month || | | | = month(@[Source,Timestamp]) |
| Day || | | | = day(@[Source,Timestamp]) |
| Hour || | | | = hour(@[Source,Timestamp]) |
| Minute || | | | = minute(@[Source,Timestamp]) |
| Second || | | | = second(@[Source,Timestamp]) |
| Millisecond || | | | = millisecond(@[Source,Timestamp]) |
`.trim();

    expect(cellValue(doc, "DateCtor", "Result")).toEqual({ kind: "date", value: "2026-03-24", isOffsetQualified: false });
    expect(cellValue(doc, "TimeCtor", "Result")).toEqual({ kind: "time", value: "14:30:05.25", isOffsetQualified: false });
    expect(cellValue(doc, "DatetimeCtor", "Result")).toEqual({ kind: "datetime", value: "2026-03-24T14:30:05.25", isOffsetQualified: false });
    expect(cellValue(doc, "DurationCtor", "Result")).toEqual({ kind: "duration", value: "PT1H30M5.25S" });
    expect(cellValue(doc, "ExtractDate", "Result")).toEqual({ kind: "date", value: "2026-03-24", isOffsetQualified: false });
    expect(cellValue(doc, "ExtractTime", "Result")).toEqual({ kind: "time", value: "14:30:05.25Z", isOffsetQualified: true });
    expect(cellValue(doc, "Year", "Result")).toEqual({ kind: "number", value: 2026 });
    expect(cellValue(doc, "Month", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "Day", "Result")).toEqual({ kind: "number", value: 24 });
    expect(cellValue(doc, "Hour", "Result")).toEqual({ kind: "number", value: 14 });
    expect(cellValue(doc, "Minute", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "Second", "Result")).toEqual({ kind: "number", value: 5 });
    expect(cellValue(doc, "Millisecond", "Result")).toEqual({ kind: "number", value: 250 });
  });

  it("evaluates date, time, and duration arithmetic", () => {
    const doc = `
# TemporalArithmetic
| Item || Date | Time | Duration | Result |
| ---- || ---- | ---- | -------- | ------ |
| Start || 2026-03-24 | 14:30 | P2D | |
| End || 2026-03-27 | 15:00 | PT30M | |
| Calendar || | | P1M | |
| HourOnly || | | PT1H | |
| AddDate || | | | = @[Start,Date] + duration(2) |
| SubtractDate || | | | = @[End,Date] - duration(1) |
| DateDiff || | | | = @[End,Date] - @[Start,Date] |
| NegativeDateDiff || | | | = @[Start,Date] - @[End,Date] |
| AddTime || | | | = @[Start,Time] + @[End,Duration] |
| TimeDiff || | | | = @[End,Time] - @[Start,Time] |
| AddDurations || | | | = @[Start,Duration] + @[End,Duration] |
| CalendarDurationError || | | | = @[Start,Date] + @[Calendar,Duration] |
| DateHourError || | | | = @[Start,Date] + @[HourOnly,Duration] |
| TimeWrapError || | | | = time(23, 30) + duration(0, 2) |
`.trim();

    expect(cellValue(doc, "AddDate", "Result")).toEqual({ kind: "date", value: "2026-03-26", isOffsetQualified: false });
    expect(cellValue(doc, "SubtractDate", "Result")).toEqual({ kind: "date", value: "2026-03-26", isOffsetQualified: false });
    expect(cellValue(doc, "DateDiff", "Result")).toEqual({ kind: "duration", value: "P3D" });
    expect(cellValue(doc, "NegativeDateDiff", "Result")).toEqual({ kind: "duration", value: "-P3D" });
    expect(cellValue(doc, "AddTime", "Result")).toEqual({ kind: "time", value: "15:00", isOffsetQualified: false });
    expect(cellValue(doc, "TimeDiff", "Result")).toEqual({ kind: "duration", value: "PT30M" });
    expect(cellValue(doc, "AddDurations", "Result")).toEqual({ kind: "duration", value: "P2DT30M" });
    expectError(doc, "CalendarDurationError", "Result");
    expectError(doc, "DateHourError", "Result");
    expectError(doc, "TimeWrapError", "Result");
  });

  it("supports temporal literals directly in formulas", () => {
    const doc = `
# FormulaTemporalLiterals
| Item || Result |
| ---- || ------ |
| DateLiteralAdd || = 2026-03-24 + duration(1) |
| DateLiteralDiff || = 2026-03-27 - 2026-03-24 |
| DatetimeLiteralDiff || = 2026-03-24T14:30:00Z - 2026-03-24T13:30:00Z |
| DurationLiteralAdd || = P1D + PT1H |
| NegativeDurationLiteral || = -PT1H |
| InvalidPrecision || = 2026-03-24T14:30:00.1234Z |
`.trim();

    expect(cellValue(doc, "DateLiteralAdd", "Result")).toEqual({ kind: "date", value: "2026-03-25", isOffsetQualified: false });
    expect(cellValue(doc, "DateLiteralDiff", "Result")).toEqual({ kind: "duration", value: "P3D" });
    expect(cellValue(doc, "DatetimeLiteralDiff", "Result")).toEqual({ kind: "duration", value: "PT1H" });
    expect(cellValue(doc, "DurationLiteralAdd", "Result")).toEqual({ kind: "duration", value: "P1DT1H" });
    expect(cellValue(doc, "NegativeDurationLiteral", "Result")).toEqual({ kind: "duration", value: "-PT1H" });
    expectError(doc, "InvalidPrecision", "Result");
  });

  it("round-trips formula temporal literals through serialization", () => {
    const doc = `
# FormulaTemporalRoundTrip
| Item || Result |
| ---- || ------ |
| DateAdd || = 2026-03-24 + duration(1) |
| DatetimeDiff || = 2026-03-24T14:30:00Z - 2026-03-24T13:30:00Z |
| DurationAdd || = P1D + PT1H |
`.trim();

    const output = serializeDocumentState(DocumentState.fromText(doc));

    expect(output).toContain("= 2026-03-24 + duration(1)");
    expect(output).toContain("= 2026-03-24T14:30:00Z - 2026-03-24T13:30:00Z");
    expect(output).toContain("= P1D + PT1H");
  });

  it("evaluates offset-qualified and offset-naive datetime arithmetic without mixing them", () => {
    const doc = `
# DatetimeOffsets
| Item || A | B | Result |
| ---- || --- | --- | ------ |
| QualifiedA || 2026-03-24T14:30:00+08:00 | 2026-03-24T06:30:00Z | |
| QualifiedB || 2026-03-24T15:30:00+08:00 | 2026-03-24T06:30:00Z | |
| Naive || 2026-03-24T14:30 | 2026-03-24T13:00 | |
| QualifiedSameInstantDiff || | | = @[QualifiedA,A] - @[QualifiedA,B] |
| QualifiedTimelineDiff || | | = @[QualifiedB,A] - @[QualifiedB,B] |
| NaiveDiff || | | = @[Naive,A] - @[Naive,B] |
| AddQualified || | | = @[QualifiedA,A] + duration(0, 1) |
| AddNaive || | | = @[Naive,A] + duration(0, 1) |
| MixedError || | | = @[QualifiedA,A] - @[Naive,A] |
`.trim();

    expect(cellValue(doc, "QualifiedSameInstantDiff", "Result")).toEqual({ kind: "duration", value: "PT0S" });
    expect(cellValue(doc, "QualifiedTimelineDiff", "Result")).toEqual({ kind: "duration", value: "PT1H" });
    expect(cellValue(doc, "NaiveDiff", "Result")).toEqual({ kind: "duration", value: "PT1H30M" });
    expect(cellValue(doc, "AddQualified", "Result")).toEqual({ kind: "datetime", value: "2026-03-24T15:30:00+08:00", isOffsetQualified: true });
    expect(cellValue(doc, "AddNaive", "Result")).toEqual({ kind: "datetime", value: "2026-03-24T15:30", isOffsetQualified: false });
    expectError(doc, "MixedError", "Result");
  });

  it("treats equivalent zero offsets consistently in arithmetic and equality", () => {
    const doc = `
# ZeroOffsetEquivalence
| Item || A | B | Result |
| ---- || --- | --- | ------ |
| TimeZero || 14:30:00Z | 14:30:00+00:00 | |
| DatetimeZero || 2026-03-24T14:30:00Z | 2026-03-24T14:30:00+00:00 | |
| SameInstant || 2026-03-24T14:30:00+08:00 | 2026-03-24T06:30:00Z | |
| TimeDiff || | | = @[TimeZero,A] - @[TimeZero,B] |
| TimeEquals || | | = @[TimeZero,A] == @[TimeZero,B] |
| DatetimeDiff || | | = @[DatetimeZero,A] - @[DatetimeZero,B] |
| DatetimeEquals || | | = @[DatetimeZero,A] == @[DatetimeZero,B] |
| SameInstantEquals || | | = @[SameInstant,A] == @[SameInstant,B] |
`.trim();

    expect(cellValue(doc, "TimeDiff", "Result")).toEqual({ kind: "duration", value: "PT0S" });
    expect(cellValue(doc, "TimeEquals", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "DatetimeDiff", "Result")).toEqual({ kind: "duration", value: "PT0S" });
    expect(cellValue(doc, "DatetimeEquals", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "SameInstantEquals", "Result")).toEqual({ kind: "boolean", value: true });
  });

  it("handles leap years and date arithmetic range boundaries", () => {
    const doc = `
# DateBoundaries
| Item || Result |
| ---- || ------ |
| LeapDay || = 2024-02-28 + duration(1) |
| LeapToMarch || = 2024-02-29 + duration(1) |
| YearBoundary || = 2026-12-31 + duration(1) |
| MinUnderflow || = date(1, 1, 1) - duration(1) |
| MaxOverflow || = date(9999, 12, 31) + duration(1) |
`.trim();

    expect(cellValue(doc, "LeapDay", "Result")).toEqual({ kind: "date", value: "2024-02-29", isOffsetQualified: false });
    expect(cellValue(doc, "LeapToMarch", "Result")).toEqual({ kind: "date", value: "2024-03-01", isOffsetQualified: false });
    expect(cellValue(doc, "YearBoundary", "Result")).toEqual({ kind: "date", value: "2027-01-01", isOffsetQualified: false });
    expectError(doc, "MinUnderflow", "Result");
    expectError(doc, "MaxOverflow", "Result");
  });

  it("handles additional duration and time arithmetic edge cases", () => {
    const doc = `
# DurationAndTimeEdges
| Item || Duration | Result |
| ---- || -------- | ------ |
| YearDuration || P1Y | |
| MonthDuration || P1M | |
| DayDuration || P7D | |
| TwentyFourHours || PT24H | |
| MixedFixed || P1DT1H | |
| ZeroDurationAdd || | = PT0S + duration(0) |
| FixedDayDiff || | = @[DayDuration,Duration] - @[TwentyFourHours,Duration] |
| MixedFixedAdd || | = @[DayDuration,Duration] + @[MixedFixed,Duration] |
| YearArithmeticError || | = 2026-03-24 + @[YearDuration,Duration] |
| MonthArithmeticError || | = 2026-03-24 + @[MonthDuration,Duration] |
| OffsetTimeAdd || | = 14:30:00+08:00 + PT1H |
| TimePlusOneMillisecondError || | = 23:59:59.999 + PT0.001S |
| TimeMinusOneMillisecondError || | = 00:00 - PT0.001S |
`.trim();

    expect(cellValue(doc, "ZeroDurationAdd", "Result")).toEqual({ kind: "duration", value: "PT0S" });
    expect(cellValue(doc, "FixedDayDiff", "Result")).toEqual({ kind: "duration", value: "P6D" });
    expect(cellValue(doc, "MixedFixedAdd", "Result")).toEqual({ kind: "duration", value: "P8DT1H" });
    expectError(doc, "YearArithmeticError", "Result");
    expectError(doc, "MonthArithmeticError", "Result");
    expect(cellValue(doc, "OffsetTimeAdd", "Result")).toEqual({ kind: "time", value: "15:30:00+08:00", isOffsetQualified: true });
    expectError(doc, "TimePlusOneMillisecondError", "Result");
    expectError(doc, "TimeMinusOneMillisecondError", "Result");
  });

  it("uses temporal equality in filter, match, and lookup", () => {
    const doc = `
# TemporalLookup
| Item || Date | Timestamp | Value | Result |
| ---- || ---- | --------- | ----- | ------ |
| A || 2026-03-24 | 2026-03-24T14:30:00+08:00 | 10 | |
| B || 2026-03-25 | 2026-03-24T06:30:00Z | 20 | |
| C || 2026-03-26 | 2026-03-26T00:00:00Z | 30 | |
| MatchDate || | | | = match(2026-03-25, @[#2:#4,Date]) |
| MatchInstant || | | | = match(2026-03-24T06:30:00Z, @[#2:#4,Timestamp]) |
| LookupDate || | | | = lookup(2026-03-26, @[#2:#4,Date], @[#2:#4,Value]) |
| FilterInstant || | | | = sum(filter(@[#2:#4,Value], @[#2:#4,Timestamp] == 2026-03-24T06:30:00Z)) |
`.trim();

    expect(cellValue(doc, "MatchDate", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "MatchInstant", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "LookupDate", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "FilterInstant", "Result")).toEqual({ kind: "number", value: 30 });
  });

  it("keeps temporal scanning from corrupting non-temporal formulas and references", () => {
    const doc = `
# ScannerEdges
| Item || P | Q | Result |
| ---- || --- | --- | ------ |
| R1 || 10 | 20 | |
| PlanIdentifier || | | = Plan |
| SpreadsheetRange || | | = sum(B2:C2) |
| PartialDateText || | | = 2026-03-24abc |
| PartialDurationText || | | = PT1Hx |
`.trim();

    expect(cellValue(doc, "PlanIdentifier", "Result")).toEqual({ kind: "string", value: "Plan" });
    expect(cellValue(doc, "SpreadsheetRange", "Result")).toEqual({ kind: "number", value: 30 });
    expectError(doc, "PartialDateText", "Result");
    expect(cellValue(doc, "PartialDurationText", "Result")).toEqual({ kind: "string", value: "PT1Hx" });
  });

  it("converts only offset-qualified datetimes to and from Unix milliseconds", () => {
    const doc = `
# UnixMillis
| Item || Timestamp | Result |
| ---- || --------- | ------ |
| Epoch || 1970-01-01T00:00:00Z | |
| OffsetEpoch || 1970-01-01T08:00:00+08:00 | |
| Naive || 1970-01-01T00:00:00 | |
| UnixEpoch || | = unixMillis(@[Epoch,Timestamp]) |
| UnixOffsetEpoch || | = unixMillis(@[OffsetEpoch,Timestamp]) |
| FromUnix || | = datetimeFromUnixMillis(0) |
| RoundTrip || | = unixMillis(datetimeFromUnixMillis(3600000)) |
| NegativeUnix || | = unixMillis(1969-12-31T23:59:59.999Z) |
| FromNegativeUnix || | = datetimeFromUnixMillis(-1) |
| MaxSafeUnix || | = datetimeFromUnixMillis(9007199254740991) |
| UnsafeUnixError || | = datetimeFromUnixMillis(9007199254740992) |
| NaiveError || | = unixMillis(@[Naive,Timestamp]) |
| NonIntegerError || | = datetimeFromUnixMillis(1.5) |
`.trim();

    expect(cellValue(doc, "UnixEpoch", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "UnixOffsetEpoch", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "FromUnix", "Result")).toEqual({ kind: "datetime", value: "1970-01-01T00:00:00Z", isOffsetQualified: true });
    expect(cellValue(doc, "RoundTrip", "Result")).toEqual({ kind: "number", value: 3600000 });
    expect(cellValue(doc, "NegativeUnix", "Result")).toEqual({ kind: "number", value: -1 });
    expect(cellValue(doc, "FromNegativeUnix", "Result")).toEqual({ kind: "datetime", value: "1969-12-31T23:59:59.999Z", isOffsetQualified: true });
    expectError(doc, "MaxSafeUnix", "Result");
    expectError(doc, "UnsafeUnixError", "Result");
    expectError(doc, "NaiveError", "Result");
    expectError(doc, "NonIntegerError", "Result");
  });

  it("fails invalid constructor and arithmetic inputs early", () => {
    const doc = `
# TemporalErrors
| Item || Date | Time | Result |
| ---- || ---- | ---- | ------ |
| Source || 2026-03-24 | 14:30:00Z | |
| InvalidDate || | | = date(2026, 2, 29) |
| InvalidTime || | | = time(24, 0) |
| InvalidSecondPrecision || | | = time(14, 30, 0.0001) |
| DatetimeDateArg || | | = datetime("2026-03-24", @[Source,Time]) |
| DatetimeTimeArg || | | = datetime(@[Source,Date], "14:30") |
| DateFromTime || | | = date(@[Source,Time]) |
| TimeFromDate || | | = time(@[Source,Date]) |
| UnixDate || | | = unixMillis(@[Source,Date]) |
`.trim();

    expectError(doc, "InvalidDate", "Result");
    expectError(doc, "InvalidTime", "Result");
    expectError(doc, "InvalidSecondPrecision", "Result");
    expectError(doc, "DatetimeDateArg", "Result");
    expectError(doc, "DatetimeTimeArg", "Result");
    expectError(doc, "DateFromTime", "Result");
    expectError(doc, "TimeFromDate", "Result");
    expectError(doc, "UnixDate", "Result");
  });
});
