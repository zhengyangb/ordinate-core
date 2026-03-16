import { describe, expect, it } from "vitest";

import { DocumentState, evaluateDocument, type EvaluationResult } from "../src";

function assertSameEvaluation(left: EvaluationResult, right: EvaluationResult) {
  expect(left.sheets.length).toBe(right.sheets.length);
  for (let i = 0; i < left.sheets.length; i += 1) {
    const sheetLeft = left.sheets[i];
    const sheetRight = right.sheets[i];
    expect(sheetLeft.rowPaths).toEqual(sheetRight.rowPaths);
    expect(sheetLeft.colLabels).toEqual(sheetRight.colLabels);
    expect(sheetLeft.values.length).toBe(sheetRight.values.length);
    for (let r = 0; r < sheetLeft.values.length; r += 1) {
      const rowL = sheetLeft.values[r];
      const rowR = sheetRight.values[r];
      expect(rowL.length).toBe(rowR.length);
      for (let c = 0; c < rowL.length; c += 1) {
        expect(rowL[c].kind).toBe(rowR[c].kind);
        expect(rowL[c].value).toBe(rowR[c].value);
      }
    }
  }
}

describe("RFC-0010 editing semantics", () => {
  it("clearing a cell yields blank and recalculates", () => {
    const doc = `
# Sheet
| Item  || 2024 | 2025 | Sum |
| ----  || ---- | ---- | --- |
| A     || 1    | 2    | = sum(@[A,2024:2025]) |
| B     || 3    | 4    | = sum(@[B,2024:2025]) |
| Total || = sum(@[#2:#3,2024:2025]) |  |  |
`.trim();

    const updated = `
# Sheet
| Item  || 2024 | 2025 | Sum |
| ----  || ---- | ---- | --- |
| A     ||      | 2    | = sum(@[A,2024:2025]) |
| B     || 3    | 4    | = sum(@[B,2024:2025]) |
| Total || = sum(@[#2:#3,2024:2025]) |  |  |
`.trim();

    const state = DocumentState.fromText(doc);
    state.clearCell("Sheet", "A", "2024");

    const actual = state.evaluate();
    const expected = evaluateDocument(updated);
    assertSameEvaluation(actual, expected);
  });
});
