import { describe, expect, it } from "vitest";

import {
  formatLocalViewFromSpec,
  formatSpecFromLocalSelection,
  parseTemporalFormatOrThrow,
  resolveFormatPreview,
  validateTemporalFormatPattern,
} from "./formatDisplay";

describe("format display model", () => {
  it("maps numeric format specs to numeric local options", () => {
    expect(
      formatLocalViewFromSpec({
        kind: "numeric",
        type: "f",
        precision: 2,
        grouping: true,
        sign: "default",
        padWidth: null,
      }),
    ).toEqual({
      formatLocalKey: "decimal",
      formatLocalOptions: {
        kind: "numeric",
        precision: 2,
        grouping: true,
        sign: "default",
        padWidth: null,
      },
    });
  });

  it("maps date-time temporal specs to one temporal local key", () => {
    const spec = parseTemporalFormatOrThrow("%F %H:%M");
    expect(formatLocalViewFromSpec(spec)).toEqual({
      formatLocalKey: "temporal",
      formatLocalOptions: {
        kind: "temporal",
        pattern: "%F %H:%M",
        preset: "date-time",
      },
    });
  });

  it("maps duration temporal specs to the same temporal local key", () => {
    const spec = parseTemporalFormatOrThrow("%[h]:%M:%S");
    expect(formatLocalViewFromSpec(spec, { kind: "duration", value: "PT1H23M45S" })).toEqual({
      formatLocalKey: "temporal",
      formatLocalOptions: {
        kind: "temporal",
        pattern: "%[h]:%M:%S",
        preset: "duration-clock",
      },
    });
  });

  it("generates temporal FormatSpec from temporal local options", () => {
    expect(formatSpecFromLocalSelection("temporal", { kind: "temporal", pattern: "%F", preset: "iso-date" })).toMatchObject({
      kind: "temporal",
      pattern: "%F",
      tokens: [{ directive: "date_iso", raw: "%F" }],
    });
  });

  it("fails invalid custom temporal patterns early", () => {
    expect(validateTemporalFormatPattern("%Q")).toEqual({
      issue: {
        code: "unsupported_temporal_format_directive",
        context: { directive: "%Q" },
      },
    });
  });

  it("uses actual compatible values for preview", () => {
    expect(
      resolveFormatPreview(
        "temporal",
        { kind: "temporal", pattern: "%F %H:%M", preset: "date-time" },
        { value: { kind: "datetime", value: "2026-03-24T08:15:00", isOffsetQualified: false }, scope: "cell" },
      ),
    ).toMatchObject({
      text: "2026-03-24 08:15",
      sourceLabel: "Current",
      issue: null,
    });
  });

  it("uses sample preview when the current value is incompatible", () => {
    expect(
      resolveFormatPreview(
        "temporal",
        { kind: "temporal", pattern: "%F", preset: "iso-date" },
        { value: { kind: "number", value: 42 }, scope: "cell" },
      ),
    ).toMatchObject({
      text: "2026-06-07",
      sourceLabel: "Example",
      issue: null,
      });
  });

  it("uses a duration sample for duration-shaped temporal previews", () => {
    expect(
      resolveFormatPreview(
        "temporal",
        { kind: "temporal", pattern: "%[h]:%M:%S", preset: "duration-clock" },
        { value: { kind: "number", value: 42 }, scope: "cell" },
      ),
    ).toMatchObject({
      text: "1:23:45",
      sourceLabel: "Example",
      issue: null,
    });
  });
});
