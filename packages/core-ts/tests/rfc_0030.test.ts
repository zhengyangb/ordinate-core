import { describe, expect, it } from "vitest";

import {
  DocumentState,
  applyBatchAtomic,
  resolvePresentationFromText,
  serializeDocumentState,
} from "../src";
import { parseCellInput } from "../src/runtime";
import { parseTemporalFormatSpec } from "../src/runtime/temporalFormat";

function onlyCellDisplay(doc: string): string {
  const presentation = resolvePresentationFromText(doc);
  return presentation.sheets[0].cells[0][1].displayText;
}

function onlyCellErrors(doc: string): string[] {
  const presentation = resolvePresentationFromText(doc);
  return presentation.sheets[0].cells[0][1].errors.map((issue) => issue.code);
}

describe("RFC-0030 temporal display formatting", () => {
  it("parses numeric and temporal format specs without confusing numeric percent and strftime percent", () => {
    const numericPercent = parseCellInput("0.125 {:.1%}");
    expect(numericPercent.localDisplay?.valid).toBe(true);
    if (!numericPercent.localDisplay?.valid) throw new Error("expected valid numeric display metadata");
    expect(numericPercent.localDisplay.format).toMatchObject({ kind: "numeric", type: "%", precision: 1 });

    const temporalDate = parseCellInput("2026-03-24 {:%Y-%m-%d}");
    expect(temporalDate.localDisplay?.valid).toBe(true);
    if (!temporalDate.localDisplay?.valid) throw new Error("expected valid temporal display metadata");
    expect(temporalDate.localDisplay.format).toMatchObject({ kind: "temporal", pattern: "%Y-%m-%d" });

    const temporalPercentLiteral = parseCellInput("2026-03-24 {:%%}");
    expect(temporalPercentLiteral.localDisplay?.valid).toBe(true);
    if (!temporalPercentLiteral.localDisplay?.valid) throw new Error("expected valid temporal display metadata");
    expect(temporalPercentLiteral.localDisplay.format).toMatchObject({ kind: "temporal", pattern: "%%" });

    const durationTotalHours = parseCellInput("P1DT2H {:%[h]}");
    expect(durationTotalHours.localDisplay?.valid).toBe(true);
    if (!durationTotalHours.localDisplay?.valid) throw new Error("expected valid duration display metadata");
    expect(durationTotalHours.localDisplay.format).toMatchObject({
      kind: "temporal",
      pattern: "%[h]",
      tokens: [{ directive: "duration_total_hours", raw: "%[h]" }],
    });

    const temporalWithWhitespace = parseCellInput("2026-03-24T14:30:05Z {:%Y-%m-%d %H:%M:%S%:z}");
    expect(temporalWithWhitespace.localDisplay?.valid).toBe(true);
    if (!temporalWithWhitespace.localDisplay?.valid) throw new Error("expected valid temporal display metadata");
    expect(temporalWithWhitespace.localDisplay.format).toMatchObject({
      kind: "temporal",
      pattern: "%Y-%m-%d %H:%M:%S%:z",
    });

    const numericWhitespace = parseCellInput("1 {:,.2 f}");
    expect(numericWhitespace.localDisplay?.valid).toBe(false);
    if (numericWhitespace.localDisplay?.valid !== false) throw new Error("expected invalid numeric display metadata");
    expect(numericWhitespace.localDisplay.issue.code).toBe("format_spec_contains_whitespace");
  });

  it("rejects unsupported, locale-sensitive, and malformed temporal directives at parse time", () => {
    const cases = [
      ["2026-03-24 {:%}", "invalid_temporal_format_trailing_percent"],
      ["2026-03-24 {:%Q}", "unsupported_temporal_format_directive"],
      ["2026-03-24 {:%B}", "unsupported_temporal_format_directive"],
      ["2026-03-24 {:%A}", "unsupported_temporal_format_directive"],
      ["2026-03-24 {:%p}", "unsupported_temporal_format_directive"],
      ["2026-03-24 {:%x}", "unsupported_temporal_format_directive"],
      ["2026-03-24 {:%Z}", "unsupported_temporal_format_directive"],
      ["2026-03-24 {:%Y %.1%}", "unsupported_temporal_format_directive"],
      ["2026-03-24 {:%Y%Q}", "unsupported_temporal_format_directive"],
      ["2026-03-24 {:prefix%Q%Y}", "unsupported_temporal_format_directive"],
      ["P1D {:%[]}", "unsupported_temporal_format_directive"],
      ["P1D {:%[q]}", "unsupported_temporal_format_directive"],
      ["P1D {:%[hours]}", "unsupported_temporal_format_directive"],
      ["P1D {:prefix%[q]%Y}", "unsupported_temporal_format_directive"],
    ] as const;

    for (const [input, code] of cases) {
      const parsed = parseCellInput(input);
      expect(parsed.localDisplay?.valid, input).toBe(false);
      if (parsed.localDisplay?.valid !== false) throw new Error(`expected invalid display metadata for ${input}`);
      expect(parsed.localDisplay.issue.code).toBe(code);
    }

    const malformedBracketPatterns = ["%[", "%[}", "%[h", "%[ms", "%[hours]", "prefix%[q]%Y"] as const;
    for (const pattern of malformedBracketPatterns) {
      const parsed = parseTemporalFormatSpec(pattern);
      expect(parsed && "issue" in parsed ? parsed.issue.code : null, pattern).toBe("unsupported_temporal_format_directive");
    }
  });

  it("formats date values with date directives and literal percent text", () => {
    const doc = `
# Sheet
| Item || DateIso | DateUs | DateShortcut | LiteralPercent |
| ---- || ------- | ------ | ------------ | -------------- |
| A    || 2026-03-24 {:%Y-%m-%d} | 2026-03-24 {:%m/%d/%Y} | 2026-03-24 {:%F} | 2026-03-24 {:%Y%%} |
`.trim();

    const sheet = resolvePresentationFromText(doc).sheets[0];
    expect(sheet.cells[0][1].displayText).toBe("2026-03-24");
    expect(sheet.cells[0][2].displayText).toBe("03/24/2026");
    expect(sheet.cells[0][3].displayText).toBe("2026-03-24");
    expect(sheet.cells[0][4].displayText).toBe("2026%");
    expect(sheet.cells[0][4].errors).toEqual([]);
  });

  it("formats time values with time directives, millisecond-derived microsecond text, and offsets", () => {
    const doc = `
# Sheet
| Item || HM   | HMS  | HMSF | NoSecondFraction | OffsetCompact | OffsetColon | HalfHourCompact | HalfHourColon |
| ---- || ---- | ---- | ---- | ---------------- | ------------- | ----------- | --------------- | ------------- |
| A    || 14:30:05.250 {:%H:%M} | 14:30:05.250 {:%T} | 14:30:05.005 {:%H:%M:%S.%f} | 14:30 {:%f} | 14:30:05-04:00 {:%z} | 14:30:05-04:00 {:%:z} | 14:30:05+05:30 {:%z} | 14:30:05+05:30 {:%:z} |
`.trim();

    const sheet = resolvePresentationFromText(doc).sheets[0];
    expect(sheet.cells[0][1].displayText).toBe("14:30");
    expect(sheet.cells[0][2].displayText).toBe("14:30:05");
    expect(sheet.cells[0][3].displayText).toBe("14:30:05.005000");
    expect(sheet.cells[0][4].displayText).toBe("000000");
    expect(sheet.cells[0][5].displayText).toBe("-0400");
    expect(sheet.cells[0][6].displayText).toBe("-04:00");
    expect(sheet.cells[0][7].displayText).toBe("+0530");
    expect(sheet.cells[0][8].displayText).toBe("+05:30");
  });

  it("formats datetime values with date, time, offset, shortcuts, and literal percent directives", () => {
    const doc = `
# Sheet
| Item || Space | IsoOffset | CompactOffset | DatetimeFraction | LiteralPercent | PercentOnly |
| ---- || ----- | --------- | ------------- | ---------------- | -------------- | ----------- |
| A    || 2026-03-24T14:30:05.250Z {:%F %T} | 2026-03-24T14:30:05Z {:%Y-%m-%dT%H:%M:%S%:z} | 2026-03-24T14:30:05Z {:%z} | 2026-03-24T14:30:05.007Z {:%f} | 2026-03-24T14:30:05Z {:%Y%% %T} | 2026-03-24T14:30:05Z {:%%} |
`.trim();

    const sheet = resolvePresentationFromText(doc).sheets[0];
    expect(sheet.cells[0][1].displayText).toBe("2026-03-24 14:30:05");
    expect(sheet.cells[0][2].displayText).toBe("2026-03-24T14:30:05+00:00");
    expect(sheet.cells[0][3].displayText).toBe("+0000");
    expect(sheet.cells[0][4].displayText).toBe("007000");
    expect(sheet.cells[0][5].displayText).toBe("2026% 14:30:05");
    expect(sheet.cells[0][6].displayText).toBe("%");
  });

  it("formats fixed durations with total elapsed directives and wrapped clock directives", () => {
    // Duration totals and clock-style fields intentionally mean different things.
    // %[h]/%[m]/%[s]/%[ms] are total elapsed values; %H/%M/%S/%f are wrapped remainder fields.
    const doc = `
# Sheet
| Item || TotalDays | TotalHours | TotalMinutes | TotalSeconds | TotalMilliseconds | WrappedClock | TimeShortcut |
| ---- || --------- | ---------- | ------------ | ------------ | ----------------- | ------------ | ------------ |
| A    || P1DT2H3M4.005S {:%[d]} | P1DT2H3M4.005S {:%[h]} | P1DT2H3M4.005S {:%[m]} | P1DT2H3M4.005S {:%[s]} | P1DT2H3M4.005S {:%[ms]} | P1DT2H3M4.005S {:%H:%M:%S.%f} | P1DT2H3M4.005S {:%T} |
`.trim();

    const sheet = resolvePresentationFromText(doc).sheets[0];
    expect(sheet.cells[0][1].displayText).toBe("1");
    expect(sheet.cells[0][2].displayText).toBe("26");
    expect(sheet.cells[0][3].displayText).toBe("1563");
    expect(sheet.cells[0][4].displayText).toBe("93784");
    expect(sheet.cells[0][5].displayText).toBe("93784005");
    expect(sheet.cells[0][6].displayText).toBe("02:03:04.005000");
    expect(sheet.cells[0][7].displayText).toBe("02:03:04");
  });

  it("formats duration fields after normalizing overflow components for presentation", () => {
    // ISO duration literals can carry overflow-like components. Formatting reduces them to elapsed milliseconds,
    // so total fields and wrapped fields still agree on a single fixed-duration value.
    const doc = `
# Sheet
| Item || TotalHours | WrappedClock | TotalMilliseconds |
| ---- || ---------- | ------------ | ----------------- |
| A    || PT25H61M62.125S {:%[h]} | PT25H61M62.125S {:%H:%M:%S.%f} | PT25H61M62.125S {:%[ms]} |
`.trim();

    const sheet = resolvePresentationFromText(doc).sheets[0];
    expect(sheet.cells[0][1].displayText).toBe("26");
    expect(sheet.cells[0][2].displayText).toBe("02:02:02.125000");
    expect(sheet.cells[0][3].displayText).toBe("93722125");
  });

  it("places a negative duration sign on the first numeric duration field", () => {
    // The sign belongs to the duration value, not to every field. Prefix text remains literal.
    const doc = `
# Sheet
| Item || TotalWithRemainder | WrappedClock | PrefixedText |
| ---- || ------------------ | ------------ | ------------ |
| A    || -PT1H30M {:%[h]:%M} | -PT1H30M {:%H:%M} | -PT1H30M {:elapsed %[h]h %Mmin} |
`.trim();

    const sheet = resolvePresentationFromText(doc).sheets[0];
    expect(sheet.cells[0][1].displayText).toBe("-1:30");
    expect(sheet.cells[0][2].displayText).toBe("-01:30");
    expect(sheet.cells[0][3].displayText).toBe("elapsed -1h 30min");
  });

  it("allows literal percent-only temporal format on durations without requiring fixed elapsed components", () => {
    // Literal-only temporal formatting does not inspect year/month/day/hour fields, so even calendar durations are safe.
    const doc = `
# Sheet
| Item || LiteralPercent |
| ---- || -------------- |
| A    || P1M {:%%} |
`.trim();

    const sheet = resolvePresentationFromText(doc).sheets[0];
    expect(sheet.cells[0][1].displayText).toBe("%");
    expect(sheet.cells[0][1].errors).toEqual([]);
  });

  it("reports presentation diagnostics for value-kind and directive compatibility mismatches", () => {
    const cases = [
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || 123 {:%Y-%m-%d} |
`.trim(),
        display: "123",
        codes: ["format_value_kind_mismatch"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || 2026-03-24 {:,.2f} |
`.trim(),
        display: "2026-03-24",
        codes: ["format_value_kind_mismatch"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || 2026-03-24 {:%H:%M:%S} |
`.trim(),
        display: "2026-03-24",
        codes: ["temporal_format_directive_value_mismatch"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || 14:30 {:%Y-%m-%d} |
`.trim(),
        display: "14:30",
        codes: ["temporal_format_directive_value_mismatch"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || 2026-03-24 {:%z} |
`.trim(),
        display: "2026-03-24",
        codes: ["temporal_format_directive_value_mismatch"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || 2026-03-24T14:30 {:%z} |
`.trim(),
        display: "2026-03-24T14:30",
        codes: ["temporal_format_offset_requires_offset_qualified_value"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || 14:30 {:%:z} |
`.trim(),
        display: "14:30",
        codes: ["temporal_format_offset_requires_offset_qualified_value"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || P1D {:%Y} |
`.trim(),
        display: "P1D",
        codes: ["temporal_format_directive_value_mismatch"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || 2026-03-24 {:%[d]} |
`.trim(),
        display: "2026-03-24",
        codes: ["temporal_format_directive_value_mismatch"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || 14:30 {:%[h]} |
`.trim(),
        display: "14:30",
        codes: ["temporal_format_directive_value_mismatch"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || P1M {:%[d]} |
`.trim(),
        display: "P1M",
        codes: ["duration_format_requires_fixed_duration"],
      },
      {
        doc: `
# Sheet
| Item || Value |
| ---- || ----- |
| A    || P1Y {:%H:%M} |
`.trim(),
        display: "P1Y",
        codes: ["duration_format_requires_fixed_duration"],
      },
    ];

    for (const entry of cases) {
      expect(onlyCellDisplay(entry.doc)).toBe(entry.display);
      expect(onlyCellErrors(entry.doc)).toEqual(entry.codes);
    }
  });

  it("applies temporal column defaults to compatible cells and reports incompatible cells independently", () => {
    const doc = `
# Sheet
| @display |      || {:%F} |
|          | Item || Value |
| -------- | ---- || ----- |
|          | A    || 2026-03-24 |
|          | B    || 14:30 |
`.trim();

    const sheet = resolvePresentationFromText(doc).sheets[0];
    expect(sheet.columnDefaults[1].formatLayer.effective).toMatchObject({ kind: "temporal", pattern: "%F" });
    expect(sheet.cells[0][1].displayText).toBe("2026-03-24");
    expect(sheet.cells[0][1].errors).toEqual([]);
    expect(sheet.cells[1][1].displayText).toBe("14:30");
    expect(sheet.cells[1][1].errors.map((issue) => issue.code)).toEqual(["temporal_format_directive_value_mismatch"]);
  });

  it("round-trips temporal format metadata on formula cells without rewriting the temporal pattern", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Moment | Out |
| ---- || ------ | --- |
| A    || 2026-03-24T14:30:05Z | = B2 {:%Y-%m-%d %H:%M:%S%:z} {::>} |
`.trim());

    state.evaluate();
    const output = serializeDocumentState(state);
    expect(output).toContain("2026-03-24T14:30:05Z = B2 {:%Y-%m-%d %H:%M:%S%:z} {::>}");

    const roundTripped = resolvePresentationFromText(output);
    expect(roundTripped.sheets[0].cells[0][2].displayText).toBe("2026-03-24 14:30:05+00:00");
    expect(roundTripped.sheets[0].cells[0][2].errors).toEqual([]);
  });

  it("accepts structured temporal format specs only when tokens match the parsed pattern", () => {
    const parsed = parseCellInput("2026-03-24 {:%F}");
    if (!parsed.localDisplay?.valid || !parsed.localDisplay.format) {
      throw new Error("expected parsed temporal format");
    }

    const state = DocumentState.fromText(`
# Sheet
| Item || Date |
| ---- || ---- |
| A    || 2026-03-24 |
`.trim());

    const applied = applyBatchAtomic(state, [
      {
        op: "set_cell_local_format",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Date" },
        format: parsed.localDisplay.format,
      },
    ]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error("expected structured temporal format to be accepted");
    expect(resolvePresentationFromText(serializeDocumentState(applied.nextDocument)).sheets[0].cells[0][1].displayText).toBe("2026-03-24");

    const rejected = applyBatchAtomic(state, [
      {
        op: "set_cell_local_format",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Date" },
        format: { ...parsed.localDisplay.format, tokens: [] },
      },
    ]);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected mismatched temporal tokens to be rejected");
    expect(rejected.error.message).toContain("format.tokens must match format.pattern");
  });
});
