import { describe, expect, it } from "vitest";

import { DocumentState, evaluateDocument, formatDocument, serializeDocumentState } from "../src";

function scalarAt(doc: string, rowPath: string, colLabel: string): { kind: string; value: unknown } {
  const result = evaluateDocument(doc);
  const sheet = result.sheets[0];
  const r = sheet.rowPaths.indexOf(rowPath);
  const c = sheet.colLabels.indexOf(colLabel);
  const value = sheet.values[r][c];
  return { kind: value.kind, value: value.value };
}

describe("RFC-0013 dual reference styles", () => {
  it("evaluates spreadsheet-style A1 references in formulas", () => {
    const doc = `
# Sheet
| Item || V1 | V2 | Out |
| ---- || --- | --- | --- |
| A    || 1  | 2  | = B2 + C2 |
| B    || 3  | 4  | = sum(B2:C3) |
| C    || 5  | 6  | = sum(B:B) |
| D    || 0  | 0  | = sum(2:2) |
| E    || 0  | 0  | = B1 == "V1" |
| F    || 0  | 0  | = B2 + @[A,V1] |
`.trim();

    expect(scalarAt(doc, "A", "Out")).toEqual({ kind: "number", value: 3 });
    expect(scalarAt(doc, "B", "Out")).toEqual({ kind: "number", value: 10 });
    expect(scalarAt(doc, "C", "Out")).toEqual({ kind: "number", value: 9 });
    expect(scalarAt(doc, "D", "Out")).toEqual({ kind: "number", value: 6 });
    expect(scalarAt(doc, "E", "Out")).toEqual({ kind: "boolean", value: true });
    expect(scalarAt(doc, "F", "Out")).toEqual({ kind: "number", value: 2 });
  });

  it("keeps spreadsheet token-like text as literal outside formula context", () => {
    const doc = `
# Sheet
| Item || V1 | Out |
| ---- || --- | --- |
| A    || A1 | = "A1" == "A1" |
`.trim();

    expect(scalarAt(doc, "A", "V1")).toEqual({ kind: "string", value: "A1" });
    expect(scalarAt(doc, "A", "Out")).toEqual({ kind: "boolean", value: true });
  });

  it("matches evaluation with equivalent @-style references", () => {
    const spreadsheetDoc = `
# Sheet
| Item || V1 | V2 | Out |
| ---- || --- | --- | --- |
| A    || 1  | 2  | = B2 + C2 |
| B    || 3  | 4  | = sum(B2:C3) |
| C    || 5  | 6  | = sum(B:B) |
`.trim();

    const ordinateDoc = `
# Sheet
| Item || V1 | V2 | Out |
| ---- || --- | --- | --- |
| A    || 1  | 2  | = @[#2,#2] + @[#2,#3] |
| B    || 3  | 4  | = sum(@[#2:#3,#2:#3]) |
| C    || 5  | 6  | = sum(@[:,#2]) |
`.trim();

    expect(scalarAt(spreadsheetDoc, "A", "Out")).toEqual(scalarAt(ordinateDoc, "A", "Out"));
    expect(scalarAt(spreadsheetDoc, "B", "Out")).toEqual(scalarAt(ordinateDoc, "B", "Out"));
    expect(scalarAt(spreadsheetDoc, "C", "Out")).toEqual(scalarAt(ordinateDoc, "C", "Out"));
  });

  it("round-trips with per-reference style preservation", () => {
    const doc = `
# Sheet
| Item || V1 | V2 | Out |
| ---- || --- | --- | --- |
| A    || 1  | 2  | = B2 + C2 |
| B    || 3  | 4  | = B2 + @[A,V1] |
`.trim();

    const state = DocumentState.fromText(doc);
    state.evaluate();
    const output = serializeDocumentState(state);

    expect(output).toContain("3 = B2 + C2");
    expect(output).toContain("2 = B2 + @[A,V1]");
  });

  it("round-trips row and column selections in A1 style", () => {
    const doc = `
# Sheet
| Item || V1 | V2 | Out |
| ---- || --- | --- | --- |
| A    || 1  | 2  | = sum(B:B) |
| B    || 3  | 4  | = sum(2:2) |
`.trim();

    const state = DocumentState.fromText(doc);
    state.evaluate();
    const output = serializeDocumentState(state);

    expect(output).toContain("4 = sum(B:B)");
    expect(output).toContain("7 = sum(2:2)");
  });

  it("falls back to @-style when a spreadsheet-style hint is not representable", () => {
    const doc = `
# Sheet
| Item || V1 | Out |
| ---- || --- | --- |
| A    || 1  | = A2 |
`.trim();

    const state = DocumentState.fromText(doc);
    state.evaluate();
    const sheet = state.sheets[0];
    const outCol = sheet.colLabels.indexOf("Out");
    const rowAAbs = sheet.bodyStart + sheet.rowPaths.indexOf("A");
    const body = sheet.cells[rowAAbs][outCol].body;
    if (!body.valid || body.kind !== "formula") {
      throw new Error("expected formula body");
    }
    body.expression = {
      kind: "reference",
      value: {
        rowSelector: { kind: "label", value: ["Revenue"] },
        colSelector: { kind: "absolute", value: 1 },
        style: "spreadsheet",
      },
    };
    sheet.cells[rowAAbs][outCol].dirty = true;
    sheet.cells[rowAAbs][outCol].cachedValue = null;

    const output = serializeDocumentState(state);
    const expected = formatDocument(`
# Sheet
| Item || V1 | Out |
| ---- || --- | --- |
| A    || 1  | = @[Revenue,#2] |
`.trim() + "\n");
    expect(output).toBe(expected);
  });
});
