import { describe, expect, it } from "vitest";

import { DocumentState, formatDocument, serializeDocumentState } from "../src";
import { withOrdFormatFrontMatter } from "../src/parser";

describe("RFC-0012 reference rebasing (tentative)", () => {
  const expectSerialized = (state: DocumentState, expected: string) => {
    const output = serializeDocumentState(state);
    expect(output).toBe(formatDocument(`${withOrdFormatFrontMatter(null)}\n\n${expected}\n`));
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

    const sheetState = state.sheets[0];
    const rebasedRowBAbs = sheetState.bodyStart + sheetState.rowPaths.indexOf("B");
    const rebasedRowCAbs = sheetState.bodyStart + sheetState.rowPaths.indexOf("C");
    const sumColIndex = sheetState.colLabels.indexOf("Sum");
    const rebasedBCell = sheetState.cells[rebasedRowBAbs][sumColIndex];
    const rebasedCCell = sheetState.cells[rebasedRowCAbs][sumColIndex];
    expect(rebasedBCell.body.valid).toBe(true);
    expect(rebasedCCell.body.valid).toBe(true);
    if (!rebasedBCell.body.valid || !rebasedCCell.body.valid) {
      throw new Error("expected rebased formula cells to remain valid");
    }
    expect(rebasedBCell.body.kind).toBe("formula");
    expect(rebasedCCell.body.kind).toBe("formula");
    if (rebasedBCell.body.kind !== "formula" || rebasedCCell.body.kind !== "formula") {
      throw new Error("expected rebased cells to be formulas");
    }
    expect(rebasedBCell.body.inputText).toBe("= @[#3,2024]");
    expect(rebasedCCell.body.inputText).toBe("= @[_-1,2024]");

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

  it("fixed positional #! does not rebase under row insertion", () => {
    const doc = `
# Sheet
| Item || 2024 | Sum |
| ---- || ---- | --- |
| A    || 10   |     |
| B    || 20   | = @[#2!,2024] |
`.trim();

    const state = DocumentState.fromText(doc);
    const before = state.evaluate().sheets[0];
    const colSum = before.colLabels.indexOf("Sum");
    const rowB = before.rowPaths.indexOf("B");
    expect(before.values[rowB][colSum].value).toBe(10);

    const bodyStart = state.sheets[0].bodyStart;
    state.insertRow("Sheet", bodyStart, true);

    const sheetState = state.sheets[0];
    const rebasedRowBAbs = sheetState.bodyStart + sheetState.rowPaths.indexOf("B");
    const sumColIndex = sheetState.colLabels.indexOf("Sum");
    const rebasedBCell = sheetState.cells[rebasedRowBAbs][sumColIndex];
    expect(rebasedBCell.body.valid).toBe(true);
    if (!rebasedBCell.body.valid) {
      throw new Error("expected fixed reference formula to remain valid");
    }
    expect(rebasedBCell.body.kind).toBe("formula");
    if (rebasedBCell.body.kind !== "formula") {
      throw new Error("expected fixed reference cell to remain a formula");
    }
    expect(rebasedBCell.body.inputText).toBe("= @[#2!,2024]");

    const after = state.evaluate().sheets[0];
    const rowBAfter = after.rowPaths.indexOf("B");
    expect(after.values[rowBAfter][colSum].kind).toBe("blank");

    expectSerialized(
      state,
      `
# Sheet
| Item || 2024 | Sum |
| ---- || ---- | --- |
|      ||      |     |
| A    || 10   |     |
| B    || 20   | = @[#2!,2024] |
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
| Alpha || 5    | 5 = @[Alpha,2024] |
| B     || 3    | 5 = @[Alpha,2024] |
`.trim(),
    );
  });

  it("ambiguous renames keep bound references and serialize with positional fallback", () => {
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
    expect(after.values[rowC][colSum].kind).toBe("number");
    expect(after.values[rowC][colSum].value).toBe(5);

    expectSerialized(
      state,
      `
# Sheet
| Item || 2024 | Sum |
| ---- || ---- | --- |
| B    || 5    |     |
| B    || 3    |     |
| C    || 0    | 5 = @[#2,2024] |
`.trim(),
    );
  });
});
