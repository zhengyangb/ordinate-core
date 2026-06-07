import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DocumentState,
  evaluateDocument,
  formatPresentedCell,
  formatDocument,
  resolveDocumentPresentation,
  resolvePresentationFromText,
  serializeDocumentState,
  validateDocument,
} from "../src";
import { parseCellInput, splitCellDisplayMetadata } from "../src/runtime";
import type { ParsedCell, RuntimeValue } from "../src/runtime";

function literalOf(cell: ParsedCell): RuntimeValue | null {
  return cell.body.valid && cell.body.kind === "literal" ? cell.body.literal : null;
}

type DisplayCase = {
  name: string;
  doc: string;
  expect: string;
  evaluate: boolean;
  targetRow?: string;
  targetCol?: string;
  expectSource?: "cell" | "column" | "default";
  expectAlign?: "left" | "right" | "center";
  expectColor?: "red" | "green" | "blue";
  expectWeight?: "bold" | "normal" | null;
  expectFormatType?: "f" | "e" | "%" | "d";
  expectFormatPrecision?: number;
  expectFormatGrouping?: boolean;
  expectHasErrors?: boolean;
};

function loadDisplayCases(path: string): DisplayCase[] {
  const content = readFileSync(path, "utf-8");
  const chunks = content
    .split("===")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const cases: DisplayCase[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    const name = lines[0].trim();
    const body = lines.slice(1).join("\n");

    const docStart = body.indexOf("[doc]\n");
    const docEnd = body.indexOf("\n[/doc]");
    if (docStart === -1 || docEnd === -1) {
      throw new Error(`case '${name}' missing [doc] block`);
    }
    const doc = body.slice(docStart + "[doc]\n".length, docEnd).trim();

    const expectStart = body.indexOf("[expect]\n");
    const expectEnd = body.indexOf("\n[/expect]");
    if (expectStart === -1 || expectEnd === -1) {
      throw new Error(`case '${name}' missing [expect] block`);
    }
    const expectDoc = body.slice(expectStart + "[expect]\n".length, expectEnd).trim();

    const fields = body
      .slice(expectEnd + "\n[/expect]".length)
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const parsed: Record<string, string> = {};
    for (const line of fields) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      parsed[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }

    const opt = (key: string): string | undefined => {
      const value = parsed[key];
      if (value === undefined) return undefined;
      return value === "" ? undefined : value;
    };

    cases.push({
      name,
      doc,
      expect: expectDoc,
      evaluate: parsed.evaluate === "true",
      targetRow: opt("target_row"),
      targetCol: opt("target_col"),
      expectSource: opt("expect_source") as DisplayCase["expectSource"],
      expectAlign: opt("expect_align") as DisplayCase["expectAlign"],
      expectColor: opt("expect_color") as DisplayCase["expectColor"],
      expectWeight:
        opt("expect_weight") === undefined
          ? undefined
          : opt("expect_weight") === "null"
            ? null
            : (opt("expect_weight") as "bold" | "normal"),
      expectFormatType: opt("expect_format_type") as DisplayCase["expectFormatType"],
      expectFormatPrecision:
        opt("expect_format_precision") === undefined ? undefined : Number(opt("expect_format_precision")),
      expectFormatGrouping:
        opt("expect_format_grouping") === undefined ? undefined : opt("expect_format_grouping") === "true",
      expectHasErrors:
        opt("expect_has_errors") === undefined ? undefined : opt("expect_has_errors") === "true",
    });
  }
  return cases;
}

describe("RFC-0014 temporal/display metadata (v1 core slice)", () => {
  it("parses cell-level display metadata blocks", () => {
    const date = parseCellInput("2026-03-24");
    expect(literalOf(date)?.kind).toBe("date");
    expect((literalOf(date) as any)?.value).toBe("2026-03-24");
    expect((literalOf(date) as any)?.isOffsetQualified).toBe(false);

    const timeNaive = parseCellInput("14:30");
    expect(literalOf(timeNaive)?.kind).toBe("time");
    expect((literalOf(timeNaive) as any)?.value).toBe("14:30");
    expect((literalOf(timeNaive) as any)?.isOffsetQualified).toBe(false);

    const timeOffset = parseCellInput("14:30:00-04:00");
    expect(literalOf(timeOffset)?.kind).toBe("time");
    expect((literalOf(timeOffset) as any)?.value).toBe("14:30:00-04:00");
    expect((literalOf(timeOffset) as any)?.isOffsetQualified).toBe(true);

    const datetimeNaive = parseCellInput("2026-03-24T14:30");
    expect(literalOf(datetimeNaive)?.kind).toBe("datetime");
    expect((literalOf(datetimeNaive) as any)?.value).toBe("2026-03-24T14:30");
    expect((literalOf(datetimeNaive) as any)?.isOffsetQualified).toBe(false);

    const datetime = parseCellInput("2026-03-24T14:30:00Z");
    expect(literalOf(datetime)?.kind).toBe("datetime");
    expect((literalOf(datetime) as any)?.value).toBe("2026-03-24T14:30:00Z");
    expect((literalOf(datetime) as any)?.isOffsetQualified).toBe(true);

    const duration = parseCellInput("PT1H30M");
    expect(literalOf(duration)?.kind).toBe("duration");
    expect((literalOf(duration) as any)?.value).toBe("PT1H30M");

    const cachedTime = parseCellInput("14:30 = B2");
    expect(cachedTime.initialCachedValue?.kind).toBe("time");
    expect((cachedTime.initialCachedValue as any)?.value).toBe("14:30");
    expect((cachedTime.initialCachedValue as any)?.isOffsetQualified).toBe(false);

    const cachedDatetime = parseCellInput("2026-03-24T14:30:00+08:00 = B2");
    expect(cachedDatetime.initialCachedValue?.kind).toBe("datetime");
    expect((cachedDatetime.initialCachedValue as any)?.value).toBe("2026-03-24T14:30:00+08:00");
    expect((cachedDatetime.initialCachedValue as any)?.isOffsetQualified).toBe(true);

    const quotedDatetime = parseCellInput('"2026-03-24T14:30:00Z"');
    expect(literalOf(quotedDatetime)?.kind).toBe("string");

    const both = parseCellInput("1234.5 {:,.2f} {::>,red}");
    expect(both.localDisplay?.valid).toBe(true);
    if (!both.localDisplay?.valid) throw new Error("expected valid display metadata");
    expect(both.localDisplay.format).toMatchObject({
      sign: "default",
      padWidth: null,
      grouping: true,
      precision: 2,
      type: "f",
    });
    expect(both.localDisplay.style).toMatchObject({
      align: "right",
      weight: null,
      color: "red",
    });

    const styleOnly = parseCellInput("42 {::bold}");
    expect(styleOnly.localDisplay?.valid).toBe(true);
    if (!styleOnly.localDisplay?.valid) throw new Error("expected valid display metadata");
    expect(styleOnly.localDisplay.format).toBeNull();
    expect(styleOnly.localDisplay.style).toMatchObject({
      align: null,
      weight: "bold",
      color: null,
    });

    const longWeight = parseCellInput("42 {::weight=normal,color=blue,align=left}");
    expect(longWeight.localDisplay?.valid).toBe(true);
    if (!longWeight.localDisplay?.valid) throw new Error("expected valid display metadata");
    expect(longWeight.localDisplay.style).toMatchObject({
      align: "left",
      weight: "normal",
      color: "blue",
    });

    const legacyBoldEquals = parseCellInput("1 {::bold=true}");
    expect(legacyBoldEquals.localDisplay?.valid).toBe(false);
    if (legacyBoldEquals.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(legacyBoldEquals.localDisplay.issue.code).toBe("unsupported_style_item:bold=true");

    const conflict = parseCellInput("1 {:,.2fd}");
    expect(conflict.localDisplay?.valid).toBe(false);
    if (conflict.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(conflict.localDisplay.issue.code).toBe("invalid_format_spec_trailing_chars");

    const integerPrecision = parseCellInput("1 {:.2d}");
    expect(integerPrecision.localDisplay?.valid).toBe(false);
    if (integerPrecision.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(integerPrecision.localDisplay.issue.code).toBe("invalid_format_combination");
    expect(integerPrecision.localDisplay.issue.context).toMatchObject({
      type: "d",
      field: "precision",
      reason: "disallowed_for_type",
    });

    const scientificGrouping = parseCellInput("1 {:,.2e}");
    expect(scientificGrouping.localDisplay?.valid).toBe(false);
    if (scientificGrouping.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(scientificGrouping.localDisplay.issue.code).toBe("invalid_format_combination");
    expect(scientificGrouping.localDisplay.issue.context).toMatchObject({
      type: "e",
      field: "grouping",
      reason: "disallowed_for_type",
    });

    const legacyCombined = parseCellInput("1 {:,.2f:>,red}");
    expect(legacyCombined.localDisplay?.valid).toBe(false);
    if (legacyCombined.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(legacyCombined.localDisplay.issue.code).toBe("invalid_format_spec_trailing_chars");

    const legacyStyleOnly = parseCellInput("1 {: :bold}");
    expect(legacyStyleOnly.localDisplay?.valid).toBe(false);
    if (legacyStyleOnly.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(legacyStyleOnly.localDisplay.issue.code).toBe("format_spec_contains_whitespace");

    const duplicateFormat = parseCellInput("1 {:,.2f} {:.1%}");
    expect(duplicateFormat.localDisplay?.valid).toBe(false);
    if (duplicateFormat.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(duplicateFormat.localDisplay.issue.code).toBe("duplicate_format_metadata");

    const duplicateStyle = parseCellInput("1 {::>} {::blue}");
    expect(duplicateStyle.localDisplay?.valid).toBe(false);
    if (duplicateStyle.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(duplicateStyle.localDisplay.issue.code).toBe("duplicate_style_metadata");

    const styleConflict = parseCellInput("1 {::>,^}");
    expect(styleConflict.localDisplay?.valid).toBe(false);
    if (styleConflict.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(styleConflict.localDisplay.issue.code).toBe("duplicate_align_style");

    const weightConflict = parseCellInput("1 {::bold,weight=normal}");
    expect(weightConflict.localDisplay?.valid).toBe(false);
    if (weightConflict.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(weightConflict.localDisplay.issue.code).toBe("duplicate_weight_style");

    const noMeta = parseCellInput("123");
    expect(noMeta.localDisplay).toBeNull();
  });

  it("splits editable content from trailing display metadata", () => {
    expect(splitCellDisplayMetadata("= sum(B2:B9) {:,.2f} {::>,green}")).toEqual({
      contentText: "= sum(B2:B9)",
      displayMetaRaw: "{:,.2f} {::>,green}",
    });

    expect(splitCellDisplayMetadata("  42  ")).toEqual({
      contentText: "42",
      displayMetaRaw: null,
    });
  });

  it("resolves effective presentation with cell > column > default precedence", () => {
    const doc = `
# Sheet
| @display |      || {:,.1f} {::>,bold} | {:d} {::>,bold} | {:,.2f} {::>,blue,bold} |
|          | Item || Price          | Qty         | Total                |
| -------- | ---- || ----           | ---         | -----                |
|          | A    || 1234.5         | 2           | = B2 * C2            |
|          | B    || 9.9 {:,.3f}    | 3 {::green} | = B3 * C3 {::^,normal} |
`.trim();

    const presentation = resolvePresentationFromText(doc);
    const sheet = presentation.sheets[0];

    expect(sheet.headerDisplayRows).toEqual([
      ["Item", "Price", "Qty", "Total"],
    ]);

    expect(sheet.columnDefaults[1].formatLayer.effective).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(sheet.columnDefaults[1].styleLayer.effective).toMatchObject({ align: "right", color: null, weight: "bold" });
    expect(sheet.columnDefaults[3].formatLayer.effective).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(sheet.columnDefaults[3].styleLayer.effective).toMatchObject({ align: "right", color: "blue", weight: "bold" });

    const aPrice = sheet.cells[0][1];
    expect(aPrice.source).toBe("column");
    expect(aPrice.formatLayer.local).toBeNull();
    expect(aPrice.formatLayer.inherited).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(aPrice.formatLayer.effective).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(aPrice.styleLayer.local).toBeNull();
    expect(aPrice.styleLayer.inherited).toMatchObject({ align: "right", color: null, weight: "bold" });
    expect(aPrice.styleLayer.effective).toMatchObject({ align: "right", color: null, weight: "bold" });
    expect(aPrice.displayText).toBe("1,234.5");

    const bPrice = sheet.cells[1][1];
    expect(bPrice.source).toBe("cell");
    expect(bPrice.formatLayer.local).toMatchObject({ grouping: true, precision: 3, type: "f" });
    expect(bPrice.formatLayer.inherited).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(bPrice.formatLayer.effective).toMatchObject({ grouping: true, precision: 3, type: "f" });
    expect(bPrice.styleLayer.local).toBeNull();
    expect(bPrice.styleLayer.inherited).toMatchObject({ align: "right", color: null, weight: "bold" });
    expect(bPrice.styleLayer.effective).toMatchObject({ align: "right", color: null, weight: "bold" });
    expect(bPrice.displayText).toBe("9.900");

    const bQty = sheet.cells[1][2];
    expect(bQty.source).toBe("cell");
    expect(bQty.styleLayer.local).toMatchObject({ align: null, color: "green", weight: null });
    expect(bQty.styleLayer.inherited).toMatchObject({ align: "right", color: null, weight: "bold" });
    expect(bQty.styleLayer.effective).toMatchObject({ align: "right", color: "green", weight: "bold" });
    expect(bQty.displayText).toBe("3");

    const evaluated = evaluateDocument(doc);
    const evalSheet = evaluated.sheets[0];
    expect(evalSheet.values[0][3]?.kind).toBe("number");
    expect(evalSheet.values[0][3]?.value).toBe(2469);

    const aTotal = sheet.cells[0][3];
    expect(aTotal.source).toBe("column");
    expect(aTotal.formatLayer.effective).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(aTotal.styleLayer.effective).toMatchObject({ align: "right", color: "blue", weight: "bold" });
    expect(aTotal.displayText).toBe("2,469.00");

    const bTotal = sheet.cells[1][3];
    expect(evalSheet.values[1][3]?.kind).toBe("number");
    expect(evalSheet.values[1][3]?.value).toBeCloseTo(29.7, 10);
    expect(bTotal.source).toBe("cell");
    expect(bTotal.formatLayer.effective).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(bTotal.styleLayer.effective).toMatchObject({ align: "center", color: "blue", weight: "normal" });
    expect(bTotal.displayText).toBe("29.70");
  });

  it("reports invalid metadata without changing value semantics", () => {
    const doc = `
# Sheet
| Item || Val | Out |
| ---- || --- | --- |
| A    || 12.5 {:bad fmt} | = B2 + 1 {:,.2f} {::purple} |
`.trim();

    const state = DocumentState.fromText(doc);
    const presentation = resolveDocumentPresentation(state);
    const sheet = presentation.sheets[0];

    const valCell = sheet.cells[0][1];
    expect(valCell.errors.length).toBeGreaterThan(0);
    expect(valCell.formatLayer.effective).toBeNull();
    expect(valCell.styleLayer.effective).toBeNull();
    expect(valCell.displayText).toBe("12.5");

    const evalSheet = state.evaluate().sheets[0];
    expect(evalSheet.values[0][2]?.kind).toBe("number");
    expect(evalSheet.values[0][2]?.value).toBe(13.5);

    const outCell = sheet.cells[0][2];
    expect(outCell.errors.length).toBeGreaterThan(0);
    expect(outCell.formatLayer.effective).toBeNull();
    expect(outCell.styleLayer.effective).toBeNull();
    expect(outCell.displayText).toBe("13.5");
  });

  it("formats numeric display text via shared formatter", () => {
    expect(
      formatPresentedCell({
        value: { kind: "number", value: -1234.5 },
        formatLayer: {
          effective: { sign: "parentheses", padWidth: null, grouping: true, precision: 2, type: "f" },
        },
      }),
    ).toBe("(1,234.50)");

    expect(
      formatPresentedCell({
        value: { kind: "number", value: 0.125 },
        formatLayer: {
          effective: { sign: "plus", padWidth: null, grouping: false, precision: 1, type: "%" },
        },
      }),
    ).toBe("+12.5%");

    expect(
      formatPresentedCell({
        value: { kind: "number", value: 42 },
        formatLayer: {
          effective: { sign: "default", padWidth: 6, grouping: false, precision: null, type: "d" },
        },
      }),
    ).toBe("000042");
  });

  it("keeps formula metadata in serialization round-trip", () => {
    const doc = `
# Sheet
| Item || Val | Out |
| ---- || --- | --- |
| A    || 12.3 | = B2 {:,.2f} {::>} |
`.trim();

    const state = DocumentState.fromText(doc);
    state.evaluate();
    const output = serializeDocumentState(state);
    expect(output).toContain('12.3 = B2 {:,.2f} {::>}');
  });

  it("applies column defaults from control frame without header rows", () => {
    const doc = `
# Raw
| @display |        | {:,.2f} | {::>} |
|          | A      | 12.3    | 7     |
|          | B      | 45      | 9     |
`.trim();

    const presentation = resolvePresentationFromText(doc);
    const sheet = presentation.sheets[0];
    expect(sheet.headerDisplayRows).toEqual([]);

    const val = sheet.cells[0][1];
    expect(val.source).toBe("column");
    expect(val.formatLayer.effective).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(val.displayText).toBe("12.30");

    const out = sheet.cells[0][2];
    expect(out.source).toBe("column");
    expect(out.styleLayer.effective).toMatchObject({ align: "right", weight: null, color: null });
    expect(out.displayText).toBe("7");
  });

  it("applies column defaults from control frame without header row and header column", () => {
    const doc = `
# Raw
| @display | {:,.2f} | {::>} |
|          | 12.3    | 7     |
|          | 45      | 9     |
`.trim();

    const presentation = resolvePresentationFromText(doc);
    const sheet = presentation.sheets[0];
    expect(sheet.headerDisplayRows).toEqual([]);

    const first = sheet.cells[0][0];
    expect(first.source).toBe("column");
    expect(first.formatLayer.effective).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(first.displayText).toBe("12.30");

    const second = sheet.cells[0][1];
    expect(second.source).toBe("column");
    expect(second.styleLayer.effective).toMatchObject({ align: "right", weight: null, color: null });
    expect(second.displayText).toBe("7");
  });

  it("fails validation when a control-frame cell is not metadata-only", () => {
    const doc = `
# Sheet
| @display | oops || {:,.2f} |
|          | Item || Val     |
| -------- | ---- || ---     |
|          | A    || 12.3    |
`.trim();

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("display control cell must contain only display metadata"))).toBe(
      true,
    );
  });

  it("reports invalid cell and control-frame display metadata through validateDocument", () => {
    const doc = `
# Sheet
| @display | {:bad fmt} | {::purple} |
| Label    | Value      | Out         |
| -------  | -----      | ---         |
| A        | 12.5 {:bad fmt} | = B2 + 1 {::purple} |
`.trim();

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);

    expect(
      result.errors.some(
        (e) => e.row === 1 && e.col === 2 && e.code === "format_spec_contains_whitespace",
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (e) => e.row === 1 && e.col === 3 && e.code === "unsupported_style_item:purple",
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (e) => e.row === 3 && e.col === 1 && e.code === "format_spec_contains_whitespace",
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (e) => e.row === 3 && e.col === 2 && e.code === "unsupported_style_item:purple",
      ),
    ).toBe(true);
  });

  it("prints human-readable validation detail for invalid format combinations", () => {
    const doc = `
# Sheet
| Item || Out |
| ---- || --- |
| A    || 1 {:.2d} |
`.trim();

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.code === "invalid_format_combination"
          && e.message.includes("precision is not allowed for integer format"),
      ),
    ).toBe(true);
  });

  it("prints human-readable validation detail for invalid scientific grouping", () => {
    const doc = `
# Sheet
| Item || Out |
| ---- || --- |
| A    || 1 {:,.2e} |
`.trim();

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.code === "invalid_format_combination"
          && e.message.includes("grouping is not allowed for scientific format"),
      ),
    ).toBe(true);
  });

  it("fixture cases: read + serialize canonicalization", () => {
    const fixturePath = resolve(process.cwd(), "tests", "fixtures", "rfc_0014", "display_metadata_round_trip.cases");
    const cases = loadDisplayCases(fixturePath);
    for (const spec of cases) {
      const state = DocumentState.fromText(spec.doc);
      if (spec.evaluate) {
        state.evaluate();
      }
      const output = serializeDocumentState(state);
      const expected = formatDocument(`${spec.expect}\n`);
      expect(output).toBe(expected);

      if (spec.targetRow && spec.targetCol) {
        const presentation = resolvePresentationFromText(output);
        const sheet = presentation.sheets[0];
        const evalSheet = evaluateDocument(output).sheets[0];
        const rowRel = evalSheet.rowPaths.indexOf(spec.targetRow);
        const colIndex = evalSheet.colLabels.indexOf(spec.targetCol);
        if (rowRel < 0) throw new Error(`case '${spec.name}' target row not found`);
        if (colIndex < 0) throw new Error(`case '${spec.name}' target col not found`);
        const row = sheet.cells[rowRel];
        const cell = row[colIndex];
        if (spec.expectSource) expect(cell.source).toBe(spec.expectSource);
        if (spec.expectAlign !== undefined) expect(cell.styleLayer.effective?.align ?? null).toBe(spec.expectAlign ?? null);
        if (spec.expectColor !== undefined) expect(cell.styleLayer.effective?.color ?? null).toBe(spec.expectColor ?? null);
        if (spec.expectWeight !== undefined) expect(cell.styleLayer.effective?.weight ?? null).toBe(spec.expectWeight);
        if (spec.expectFormatType !== undefined) expect(cell.formatLayer.effective?.type ?? null).toBe(spec.expectFormatType ?? null);
        if (spec.expectFormatPrecision !== undefined) {
          expect(cell.formatLayer.effective?.precision ?? null).toBe(spec.expectFormatPrecision);
        }
        if (spec.expectFormatGrouping !== undefined) {
          expect(cell.formatLayer.effective?.grouping ?? false).toBe(spec.expectFormatGrouping);
        }
        if (spec.expectHasErrors !== undefined) {
          if (spec.expectHasErrors) {
            expect(cell.errors.length).toBeGreaterThan(0);
          } else {
            expect(cell.errors.length).toBe(0);
          }
        }
      }
    }
  });
});
