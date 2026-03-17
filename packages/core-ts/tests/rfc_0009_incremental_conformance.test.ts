import { describe, expect, it } from "vitest";

import { ChangeKind, DocumentState, evaluateDocument, type EvaluationResult } from "../src";
import { escapeCellText, parseDocument, parseTableRow } from "../src/parser";
import { buildBodyRows, headerRowCountFrom, separatorRowIndex } from "../src/runtime/eval";

type SheetRows = [string, string[]];

function rebuildDoc(sheets: SheetRows[]): string {
  const lines: string[] = [];
  for (const [name, rows] of sheets) {
    lines.push(`# ${name}`);
    lines.push(...rows);
  }
  return lines.join("\n");
}

function updateCellText(doc: string, sheetName: string, rowPath: string, colLabel: string, newText: string): string {
  const parsed = parseDocument(doc);
  const sheets: SheetRows[] = [];

  for (const sheet of parsed) {
    const rows = sheet.table ? [...sheet.table.rows] : [];
    if (sheet.name === sheetName && sheet.table) {
      const parsedRows = rows.map((r) => parseTableRow(r));
      const sepIdx = separatorRowIndex(parsedRows);
      const logicalRows = parsedRows.filter((_, idx) => idx !== sepIdx);
      const colCount = logicalRows.reduce((m, r) => Math.max(m, r.cells.length), 0);
      const headerRowCount = headerRowCountFrom(parsedRows);
      const bodyStart = headerRowCount > 0 ? headerRowCount : 0;
      const headerLabels = headerRowCount > 0 ? logicalRows[headerRowCount - 1].cells : [];
      const colLabels: string[] = [];
      for (let c = 0; c < colCount; c += 1) {
        if (c < headerLabels.length && headerLabels[c] !== "") {
          colLabels.push(headerLabels[c]);
        } else {
          colLabels.push(`C${c + 1}`);
        }
      }
      const { rowPaths } = buildBodyRows(logicalRows, bodyStart);

      if (!rowPaths.includes(rowPath)) {
        throw new Error(`unknown row path '${rowPath}'`);
      }
      if (!colLabels.includes(colLabel)) {
        throw new Error(`unknown column label '${colLabel}'`);
      }

      const rowRel = rowPaths.indexOf(rowPath);
      const rAbs = bodyStart + rowRel;
      const parsedIndex = sepIdx === null || rAbs < sepIdx ? rAbs : rAbs + 1;
      const colIndex = colLabels.indexOf(colLabel);

      const row = parsedRows[parsedIndex];
      const rawCells = [...row.rawCells];
      if (rawCells.length < colCount) {
        rawCells.push(...Array(colCount - rawCells.length).fill(""));
      }
      rawCells[colIndex] = escapeCellText(newText);

      const segments = [...rawCells];
      if (row.boundary !== null && row.boundary <= segments.length) {
        segments.splice(row.boundary, 0, "");
      }

      rows[parsedIndex] = `|${segments.join("|")}|`;
    }
    sheets.push([sheet.name, rows]);
  }

  return rebuildDoc(sheets);
}

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

describe("RFC-0009 incremental conformance", () => {
  const doc = () =>
    `
# Sheet
| Item  || 2024 | 2025 | Sum |
| ----  || ---- | ---- | --- |
| A     || 1    | 2    | = sum(@[A,2024:2025]) |
| B     || 3    | 4    | = sum(@[B,2024:2025]) |
| Total || = sum(@[#2:#3,2024:2025]) |  |  |
`.trim();

  const docCurrentAndOffset = () =>
    `
# Sheet
| Item || 2024 | 2025 |
| ---- || ---- | ---- |
| A    || 1    | 2 |
| B    || = @[_-1,2024] + 1 | = @[_-1,2025] + @[_,2024] |
| C    || = @[_-1,2025] + 1 | = @[_-1,2025] + 1 |
`.trim();

  const docLabelsWithSpaces = () =>
    `
# Sheet
| Item            || 2024 | 2025 | Total |
| ----            || ---- | ---- | ----- |
| Revenue         || 5    | 6    | = sum(@[Revenue,2024:2025]) |
| Cost of Sales   || 2    | 3    | = sum(@["Cost of Sales",2024:2025]) |
| Profit          || = @[Revenue,2024] - @["Cost of Sales",2024] | = @[Revenue,2025] - @["Cost of Sales",2025] | = sum(@[Profit,2024:2025]) |
`.trim();

  const docMixedTypes = () =>
    `
# Sheet
| Item  || 2024 | 2025 | Sum |
| ----  || ---- | ---- | --- |
| A     || 1    |      | = sum(@[A,2024:2025]) |
| B     || true | false | = sum(@[B,2024:2025]) |
| C     || = 1 / 0 | 3 | = sum(@[C,2024:2025]) |
| Total || = sum(@[#2:#4,2024:2025]) |  |  |
`.trim();

  const docSections = () =>
    `
# Sheet
| Item        || 2024 | 2025 | Total |
| ----        || ---- | ---- | ----- |
| [Revenue]   ||      |      |       |
|   Product A  || 2    | 3    | = sum(@["Revenue"."Product A",2024:2025]) |
| [Cost]      ||      |      |       |
|   Materials  || 1    | 1    | = sum(@["Cost"."Materials",2024:2025]) |
| Profit      || = @["Revenue"."Product A",2024] - @["Cost"."Materials",2024] | = @["Revenue"."Product A",2025] - @["Cost"."Materials",2025] | = sum(@[Profit,2024:2025]) |
`.trim();

  const docRangeEdges = () =>
    `
# Sheet
| Item  || 2024 | 2025 | 2026 | Sum |
| ----  || ---- | ---- | ---- | --- |
| A     || 1    | 2    | 3    | = sum(@[A,2024:]) |
| B     || 4    | 5    | 6    | = sum(@[B,:2025]) |
| Total || = sum(@[:,"2025"]) |  |  |
`.trim();

  const assertConformance = (docText: string, updates: Array<[string, string, string, string]>) => {
    const state = DocumentState.fromText(docText);
    let updated = docText;
    for (const [sheet, row, col, text] of updates) {
      updated = updateCellText(updated, sheet, row, col, text);
      state.setCell(sheet, row, col, text, ChangeKind.VALUE, false);
    }
    const expected = evaluateDocument(updated);
    const actual = state.evaluate();
    assertSameEvaluation(actual, expected);
  };

  it("matches full recalculation after value edit", () => {
    assertConformance(doc(), [["Sheet", "A", "2024", "10"]]);
  });

  it("matches full recalculation after formula edit", () => {
    assertConformance(doc(), [["Sheet", "A", "Sum", "= sum(@[A,2024:2025]) + 1"]]);
  });

  it("matches full recalculation after batch edits", () => {
    assertConformance(doc(), [
      ["Sheet", "A", "2024", "10"],
      ["Sheet", "B", "2025", "8"],
    ]);
  });

  it("handles current and offset references", () => {
    assertConformance(docCurrentAndOffset(), [
      ["Sheet", "A", "2024", "10"],
      ["Sheet", "A", "2025", "5"],
    ]);
  });

  it("handles labels with spaces", () => {
    assertConformance(docLabelsWithSpaces(), [
      ["Sheet", "Cost of Sales", "2024", "4"],
      ["Sheet", "Revenue", "2025", "8"],
    ]);
  });

  it("handles mixed types and error recovery", () => {
    assertConformance(docMixedTypes(), [
      ["Sheet", "A", "2025", "5"],
      ["Sheet", "C", "2024", "1"],
    ]);
  });

  it("handles section row paths", () => {
    assertConformance(docSections(), [
      ["Sheet", "Revenue.Product A", "2025", "4"],
      ["Sheet", "Cost.Materials", "2024", "2"],
    ]);
  });

  it("handles range edge selectors", () => {
    assertConformance(docRangeEdges(), [
      ["Sheet", "A", "2026", "10"],
      ["Sheet", "B", "2024", "8"],
    ]);
  });
});
