import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DocumentState,
  evaluateDocument,
  formatDocument,
  resolveDocumentPresentation,
  resolvePresentationFromText,
  serializeDocumentState,
} from "../src";
import { parseCellInput } from "../src/runtime";

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
  expectBold?: boolean;
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
      expectBold: opt("expect_bold") === undefined ? undefined : opt("expect_bold") === "true",
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
    const datetime = parseCellInput("2026-03-24T14:30:00Z");
    expect(datetime.literal?.kind).toBe("datetime");
    expect(datetime.literal?.value).toBe("2026-03-24T14:30:00Z");

    const duration = parseCellInput("PT1H30M");
    expect(duration.literal?.kind).toBe("duration");
    expect(duration.literal?.value).toBe("PT1H30M");

    const quotedDatetime = parseCellInput('"2026-03-24T14:30:00Z"');
    expect(quotedDatetime.literal?.kind).toBe("string");

    const both = parseCellInput("1234.5 {:,.2f:>,red}");
    expect(both.display?.valid).toBe(true);
    expect(both.display?.format).toBe(",.2f");
    expect(both.display?.style).toBe(">,red");
    expect(both.display?.formatSpec).toMatchObject({
      sign: "default",
      zeroPad: false,
      width: null,
      grouping: true,
      precision: 2,
      type: "f",
    });
    expect(both.display?.styleSpec).toMatchObject({
      align: "right",
      bold: false,
      color: "red",
    });

    const styleOnly = parseCellInput("42 {: :bold}");
    expect(styleOnly.display?.valid).toBe(true);
    expect(styleOnly.display?.format).toBeNull();
    expect(styleOnly.display?.style).toBe("bold");
    expect(styleOnly.display?.styleSpec).toMatchObject({
      align: null,
      bold: true,
      color: null,
    });

    const conflict = parseCellInput("1 {:,.2fd}");
    expect(conflict.display?.valid).toBe(false);
    expect(conflict.display?.errors[0]).toBe("invalid_format_spec_trailing_chars");

    const styleConflict = parseCellInput("1 {:,.2f:>,^}");
    expect(styleConflict.display?.valid).toBe(false);
    expect(styleConflict.display?.errors[0]).toBe("duplicate_align_style");

    const noMeta = parseCellInput("123");
    expect(noMeta.display).toBeNull();
  });

  it("resolves effective presentation with cell > column > default precedence", () => {
    const doc = `
# Sheet
| Item || Price {:,.1f:>} | Qty {:d:>} | Total {:,.2f:>,blue} |
| ---- || ---- | --- | ----- |
| A    || 1234.5 | 2 | = B2 * C2 |
| B    || 9.9 {:,.3f} | 3 | = B3 * C3 {: :^} |
`.trim();

    const presentation = resolvePresentationFromText(doc);
    const sheet = presentation.sheets[0];

    expect(sheet.columnDefaults[1].format).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(sheet.columnDefaults[1].style).toMatchObject({ align: "right", color: null, bold: false });
    expect(sheet.columnDefaults[3].format).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(sheet.columnDefaults[3].style).toMatchObject({ align: "right", color: "blue", bold: false });

    const aPrice = sheet.cells[0][1];
    expect(aPrice.source).toBe("column");
    expect(aPrice.format).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(aPrice.style).toMatchObject({ align: "right", color: null, bold: false });

    const bPrice = sheet.cells[1][1];
    expect(bPrice.source).toBe("cell");
    expect(bPrice.format).toMatchObject({ grouping: true, precision: 3, type: "f" });
    expect(bPrice.style).toMatchObject({ align: "right", color: null, bold: false });

    const aTotal = sheet.cells[0][3];
    expect(aTotal.value?.kind).toBe("number");
    expect(aTotal.value?.value).toBe(2469);
    expect(aTotal.source).toBe("column");
    expect(aTotal.format).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(aTotal.style).toMatchObject({ align: "right", color: "blue", bold: false });

    const bTotal = sheet.cells[1][3];
    expect(bTotal.value?.kind).toBe("number");
    expect(bTotal.value?.value).toBeCloseTo(29.7, 10);
    expect(bTotal.source).toBe("cell");
    expect(bTotal.format).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(bTotal.style).toMatchObject({ align: "center", color: null, bold: false });
  });

  it("reports invalid metadata without changing value semantics", () => {
    const doc = `
# Sheet
| Item || Val | Out |
| ---- || --- | --- |
| A    || 12.5 {:bad fmt} | = B2 + 1 {:,.2f:purple} |
`.trim();

    const state = DocumentState.fromText(doc);
    const presentation = resolveDocumentPresentation(state);
    const sheet = presentation.sheets[0];

    const valCell = sheet.cells[0][1];
    expect(valCell.errors.length).toBeGreaterThan(0);
    expect(valCell.format).toBeNull();
    expect(valCell.style).toBeNull();

    const outCell = sheet.cells[0][2];
    expect(outCell.value?.kind).toBe("number");
    expect(outCell.value?.value).toBe(13.5);
    expect(outCell.errors.length).toBeGreaterThan(0);
    expect(outCell.format).toBeNull();
    expect(outCell.style).toBeNull();
  });

  it("keeps formula metadata in serialization round-trip", () => {
    const doc = `
# Sheet
| Item || Val | Out |
| ---- || --- | --- |
| A    || 12.3 | = B2 {:,.2f:>} |
`.trim();

    const state = DocumentState.fromText(doc);
    state.evaluate();
    const output = serializeDocumentState(state);
    expect(output).toContain('12.3 = B2 {:,.2f:>}');
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
        if (spec.expectAlign !== undefined) expect(cell.style?.align ?? null).toBe(spec.expectAlign ?? null);
        if (spec.expectColor !== undefined) expect(cell.style?.color ?? null).toBe(spec.expectColor ?? null);
        if (spec.expectBold !== undefined) expect(cell.style?.bold ?? false).toBe(spec.expectBold);
        if (spec.expectFormatType !== undefined) expect(cell.format?.type ?? null).toBe(spec.expectFormatType ?? null);
        if (spec.expectFormatPrecision !== undefined) {
          expect(cell.format?.precision ?? null).toBe(spec.expectFormatPrecision);
        }
        if (spec.expectFormatGrouping !== undefined) {
          expect(cell.format?.grouping ?? false).toBe(spec.expectFormatGrouping);
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
