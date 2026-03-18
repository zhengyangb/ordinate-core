import { describe, expect, it } from "vitest";

import { DocumentState, formatDocument, serializeDocumentState } from "../src";

describe("RFC-0012 reference rebasing (tentative)", () => {
  const expectSerialized = (state: DocumentState, expected: string) => {
    const output = serializeDocumentState(state);
    expect(output).toBe(formatDocument(`${expected}\n`));
  };

  it("inserting a row shifts # references but keeps _ offsets", () => {
    const doc = `
# Sheet
| Item || 2024 | Sum |
| ---- || ---- | --- |
| A    || 10   |     |
| B    || 20   | = @[#2,2024] |
| C    || 0    | = @[_-1,2024] |
`.trim();

    const state = DocumentState.fromText(doc);
    const before = state.evaluate().sheets[0];
    const colSum = before.colLabels.indexOf("Sum");
    const rowB = before.rowPaths.indexOf("B");
    const rowC = before.rowPaths.indexOf("C");
    expect(before.values[rowB][colSum].value).toBe(10);
    expect(before.values[rowC][colSum].value).toBe(20);

    const bodyStart = state.sheets[0].bodyStart;
    state.insertRow("Sheet", bodyStart, true);

    const after = state.evaluate().sheets[0];
    const rowBAfter = after.rowPaths.indexOf("B");
    const rowCAfter = after.rowPaths.indexOf("C");
    expect(after.values[rowBAfter][colSum].value).toBe(10);
    expect(after.values[rowCAfter][colSum].value).toBe(20);

    expectSerialized(
      state,
      `
# Sheet
| Item || 2024 | Sum |
| ---- || ---- | --- |
|      ||      |     |
| A    || 10   |     |
| B    || 20   | 10 = @[#3,2024] |
| C    || 0    | 20 = @[_-1,2024] |
`.trim(),
    );
  });

  it("renaming a label rebinds references when unique", () => {
    const doc = `
# Sheet
| Item || 2024 | Sum |
| ---- || ---- | --- |
| A    || 5    | = @[A,2024] |
| B    || 3    | = @[A,2024] |
`.trim();

    const state = DocumentState.fromText(doc);
    state.renameRowLabel("Sheet", "A", "Alpha", true);
    const after = state.evaluate().sheets[0];
    const rowAlpha = after.rowPaths.indexOf("Alpha");
    const rowB = after.rowPaths.indexOf("B");
    const colSum = after.colLabels.indexOf("Sum");
    expect(after.values[rowAlpha][colSum].value).toBe(5);
    expect(after.values[rowB][colSum].value).toBe(5);

    expectSerialized(
      state,
      `
# Sheet
| Item  || 2024 | Sum |
| ----  || ---- | --- |
| Alpha || 5    | 5 = @[A,2024] |
| B     || 3    | 5 = @[A,2024] |
`.trim(),
    );
  });

  it("ambiguous renames leave old label references unresolved", () => {
    const doc = `
# Sheet
| Item || 2024 | Sum |
| ---- || ---- | --- |
| A    || 5    |     |
| B    || 3    |     |
| C    || 0    | = @[A,2024] |
`.trim();

    const state = DocumentState.fromText(doc);
    state.renameRowLabel("Sheet", "A", "B", true);
    const after = state.evaluate().sheets[0];
    const rowC = after.rowPaths.indexOf("C");
    const colSum = after.colLabels.indexOf("Sum");
    expect(after.values[rowC][colSum].kind).toBe("error");

    expectSerialized(
      state,
      `
# Sheet
| Item || 2024 | Sum |
| ---- || ---- | --- |
| B    || 5    |     |
| B    || 3    |     |
| C    || 0    | error = @[A,2024] |
`.trim(),
    );
  });
});
