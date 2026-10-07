import { describe, expect, it } from "vitest";
import { DocumentState, getCellTextView, parseFormulaReferenceSyntax, planFillRegion, serializeDocumentState } from "../src";

const point = (r: number, c: number) => ({ rowStart: r, rowEnd: r, colStart: c, colEnd: c });

describe("A1 composition uses the existing reference model", () => {
  it("retains mixed copy locks inside arrays through copy and structural edits", () => {
    const doc = DocumentState.fromText('# Data\n| 2 | 3 | = min([$A1, B$1]) |\n| 4 | 5 | |');
    expect(doc.evaluate().sheets[0].values[0][2]).toEqual({ kind: "number", value: 2 });
    const copy = planFillRegion(doc.sheets[0], point(0, 2), point(1, 2), "copy").values[0][0];
    expect(copy).toBe("= min([$A2, B$1])");
    doc.setCellByIndex("Data", 1, 2, copy);
    const restored = DocumentState.fromText(serializeDocumentState(doc));
    expect(restored.evaluate().sheets[0].values[1][2]).toEqual({ kind: "number", value: 3 });
    restored.insertRow("Data", 0);
    expect(restored.evaluate().sheets[0].values[2][2]).toEqual({ kind: "number", value: 3 });
    expect(getCellTextView(restored.sheets[0].cells[2][2]).inputText).toBe("= min([$A3, B$2])");
  });

  it("parses a sheet-qualified A1 range and preserves its locks and syntax", () => {
    expect(parseFormulaReferenceSyntax('@["Input Data"::$A1:B$2]')).toMatchObject({
      style: "spreadsheet", crossSheet: true, sheetName: "Input Data",
      reference: { style: "spreadsheet", colSelector: { kind: "range" }, rowSelector: { kind: "range" } },
    });
    const doc = DocumentState.fromText('# Input Data\n| 1 | 2 |\n| 3 | 4 |\n---\n# Result\n| = sum(@["Input Data"::$A1:B$2]) |');
    expect(doc.evaluate().sheets[1].values[0][0]).toEqual({ kind: "number", value: 10 });
    expect(serializeDocumentState(doc)).toContain('@["Input Data"::$A1:B$2]');
  });

  it.each([
    ["(2 ** 3) ** 2", 64], ["2 ** (3 ** 2)", 512], ["(-2) ** 2", 4],
    ["-(2 ** 2)", -4], ["2 ** -2", 0.25], ["(2 + 1) ** (4 - 2)", 9],
  ])("preserves the expression tree of %s on serialization", (formula, expected) => {
    const doc = DocumentState.fromText(`# Data\n| = ${formula} |`);
    const restored = DocumentState.fromText(serializeDocumentState(doc));
    expect(doc.evaluate().sheets[0].values[0][0]).toEqual({ kind: "number", value: expected });
    expect(restored.evaluate().sheets[0].values[0][0]).toEqual({ kind: "number", value: expected });
  });
});
