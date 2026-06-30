import { describe, expect, it } from "vitest";

import {
  applyBatchAtomic,
  applyBatchWithUndo,
  applyCoreEditMemento,
  DocumentState,
  resolveDocumentPresentation,
  serializeDocumentState,
  type CoreEdit,
} from "../src";

const COLUMN_DOC = `
# Sheet
| Item || A         | B | C | D |
| ---- || ----      | ---- | ---- | ---- |
| R1   || 1 {::red} | 2 | 3 | 4 |
| R2   || 10        | 20 | 30 | 40 |
| Out  || = @[R1,A] | = @[R1,#2!] | = sum(@[R1,A:C]) | = @[R1,_-1] |
`.trim();

const ROW_DOC = `
# Sheet
| Item  || 2024 | 2025 | Out |
| ----- || ---- | ---- | ---- |
| Group ||      |      |     |
| * A   || 1 {::red} | 2 | = @[Group.A,2024] + @[Group.A,2025] |
| * B   || 3    | 4    | = @[_-1,2024] |
| C     || 5    | 6    | = sum(@[Group.A:C,2024]) |
| D     || 7    | 8    | = @[C,2024] |
`.trim();

const COLUMN_DISPLAY_DOC = `
# Sheet
| @display |      || {:,.1f} {::>,blue,bold} | {::>} | {::green} | |
|          | Item || A                        | B     | C         | D |
| -------- | ---- || ----                     | ----  | ----      | ---- |
|          | R1   || 1 {::red}                | 2     | 3         | 4 |
`.trim();

const HIERARCHY_DOC = `
# Sheet
| Item  || 2024 |
| ----- || ---- |
| Root  || 1    |
| * A   || 2    |
| * B   || 3    |
| Other || 4    |
| * C   || 5    |
`.trim();

const SIMPLE_DOC = `
# Sheet
| Item || A | B | C | D |
| ---- || ---- | ---- | ---- | ---- |
| R1   || 1 | 2 | 3 | 4 |
| R2   || 5 | 6 | 7 | 8 |
`.trim();

const COLUMN_DUPLICATE_DOC = `
# Sheet
| Item || A | B | C | D |
| ---- || ---- | ---- | ---- | ---- |
| R1   || 1 | = @[R2,B] + @[R2,A] | = sum(@[R2,B:C]) | = @[R2,#2!] + @[R2,_-1] |
| R2   || 10 | 20 | 30 | 40 |
`.trim();

const ROW_DUPLICATE_DOC = `
# Sheet
| Item || Val | Out |
| ---- || ---- | ---- |
| A    || 1    |     |
| B    || 2    | = @[A,Val] + @[B,Val] |
| C    || 100  |     |
`.trim();

function expectApply(document: DocumentState, edits: CoreEdit[]) {
  const result = applyBatchAtomic(document, edits);
  expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
  if (!result.ok) throw new Error("expected core edit success");
  return result.nextDocument;
}

function expectFail(document: DocumentState, edits: CoreEdit[], category: string) {
  const before = serializeDocumentState(document);
  const result = applyBatchAtomic(document, edits);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected core edit failure");
  expect(result.error.category).toBe(category);
  expect(serializeDocumentState(document)).toBe(before);
  return result.error;
}

function expectIncrementalMatchesFull(document: DocumentState): void {
  const incremental = document.evaluate();
  const reparsed = DocumentState.fromText(serializeDocumentState(document));
  const full = reparsed.evaluate();
  expect(incremental.sheets).toEqual(full.sheets);
}

function rowValues(document: DocumentState, rowPath: string): Array<unknown> {
  const evaluated = document.evaluate().sheets[0];
  const rowIndex = evaluated.rowPaths.indexOf(rowPath);
  expect(rowIndex).toBeGreaterThanOrEqual(0);
  return evaluated.values[rowIndex].map((value) => value.value);
}

describe("RFC-0034 core axis reordering: column moves", () => {
  it("moves one data column left and preserves identity, metadata, formulas, and serialization", () => {
    const state = DocumentState.fromText(COLUMN_DOC);
    const sheet = state.sheets[0];
    const colAId = sheet.colIds[1];
    const colCId = sheet.colIds[3];

    const moved = expectApply(state, [
      { op: "move_columns", sheet: "Sheet", colIds: [colCId], targetGapIndex: 1 },
    ]);
    const movedSheet = moved.sheets[0];

    expect(movedSheet.colLabels.slice(1)).toEqual(["C", "A", "B", "D"]);
    expect(movedSheet.colIds[1]).toBe(colCId);
    expect(movedSheet.colIds[2]).toBe(colAId);
    expect(rowValues(moved, "R1").slice(1)).toEqual([3, 1, 2, 4]);

    const formulaRow = movedSheet.cells[movedSheet.bodyStart + movedSheet.rowPaths.indexOf("Out")];
    expect(formulaRow[1].body.valid && formulaRow[1].body.kind === "formula" ? formulaRow[1].body.inputText : "").toBe("= sum(@[R1,C:A])");
    expect(formulaRow[2].body.valid && formulaRow[2].body.kind === "formula" ? formulaRow[2].body.inputText : "").toBe("= @[R1,A]");
    expect(formulaRow[3].body.valid && formulaRow[3].body.kind === "formula" ? formulaRow[3].body.inputText : "").toBe("= @[R1,#2!]");

    expectIncrementalMatchesFull(moved);
    expect(DocumentState.fromText(serializeDocumentState(moved)).sheets[0].colLabels.slice(1)).toEqual(["C", "A", "B", "D"]);
  });

  it("moves multiple contiguous columns right using post-removal target gaps and preserves source order", () => {
    const state = DocumentState.fromText(SIMPLE_DOC);
    const sheet = state.sheets[0];
    const colBId = sheet.colIds[2];
    const colCId = sheet.colIds[3];

    const moved = expectApply(state, [
      { op: "move_columns", sheet: "Sheet", colIds: [colCId, colBId], targetGapIndex: 3 },
    ]);

    expect(moved.sheets[0].colLabels.slice(1)).toEqual(["A", "D", "B", "C"]);
    expect(rowValues(moved, "R1").slice(1)).toEqual([1, 4, 2, 3]);
    expect(moved.sheets[0].colIds.slice(3, 5)).toEqual([colBId, colCId]);
  });

  it("moves column defaults and cell-local display metadata with the moved column", () => {
    const state = DocumentState.fromText(COLUMN_DISPLAY_DOC);
    const sheet = state.sheets[0];
    const colAId = sheet.colIds[1];
    const colCId = sheet.colIds[3];

    const moved = expectApply(state, [
      { op: "move_columns", sheet: "Sheet", colIds: [colCId], targetGapIndex: 1 },
    ]);
    const presentation = resolveDocumentPresentation(moved).sheets[0];

    expect(moved.sheets[0].colLabels.slice(1)).toEqual(["C", "A", "B", "D"]);
    expect(moved.sheets[0].colIds[2]).toBe(colAId);
    expect(presentation.columnDefaults[1].styleLayer.effective).toMatchObject({ color: "green" });
    expect(presentation.columnDefaults[2].styleLayer.effective).toMatchObject({ align: "right", color: "blue", weight: "bold" });
    expect(presentation.cells[0][2].styleLayer.local).toMatchObject({ color: "red" });
  });

  it("treats adjacent drop into the same effective column location as no-op history", () => {
    const state = DocumentState.fromText(SIMPLE_DOC);
    const sheet = state.sheets[0];
    const colBId = sheet.colIds[2];
    const colCId = sheet.colIds[3];
    const result = applyBatchWithUndo(state, [
      { op: "move_columns", sheet: "Sheet", colIds: [colBId, colCId], targetGapIndex: 2 },
    ]);

    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.memento.entryCount).toBe(0);
    expect(serializeDocumentState(result.nextDocument)).toBe(serializeDocumentState(state));
  });

  it("rejects invalid column moves atomically", () => {
    const state = DocumentState.fromText(SIMPLE_DOC);
    const sheet = state.sheets[0];
    const colAId = sheet.colIds[1];
    const colCId = sheet.colIds[3];

    expectFail(state, [{ op: "move_columns", sheet: "Sheet", colIds: [9999], targetGapIndex: 1 }], "invalid_target");
    expectFail(state, [{ op: "move_columns", sheet: "Sheet", colIds: [colAId, colAId], targetGapIndex: 1 }], "invalid_target");
    expectFail(state, [{ op: "move_columns", sheet: "Sheet", colIds: [colAId, colCId], targetGapIndex: 1 }], "invalid_operation");
    expectFail(state, [{ op: "move_columns", sheet: "Sheet", colIds: [sheet.colIds[0]], targetGapIndex: 1 }], "invalid_operation");
    expectFail(state, [{ op: "move_columns", sheet: "Sheet", colIds: [colAId], targetGapIndex: 0 }], "invalid_operation");
    expectFail(state, [{ op: "move_columns", sheet: "Sheet", colIds: [colAId], targetGapIndex: 99 }], "out_of_bounds");
  });

  it("fails atomically when a later column move edit is invalid", () => {
    const state = DocumentState.fromText(SIMPLE_DOC);
    const before = serializeDocumentState(state);
    const sheet = state.sheets[0];
    const result = applyBatchAtomic(state, [
      { op: "set_cell_input", target: { kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, input: "99" },
      { op: "move_columns", sheet: "Sheet", colIds: [sheet.colIds[1], sheet.colIds[3]], targetGapIndex: 1 },
    ]);

    expect(result.ok).toBe(false);
    expect(serializeDocumentState(state)).toBe(before);
  });
});

describe("RFC-0034 core axis reordering: row moves", () => {
  it("moves one header row and rebuilds column labels", () => {
    const state = DocumentState.fromText(`
# Sheet
| Year || 2024 | 2024 |
| Kind || Rev  | Cost |
| ---- || ---- | ---- |
| A    || 1    | 2    |
`.trim());
    const sheet = state.sheets[0];
    const moved = expectApply(state, [
      { op: "move_rows", sheet: "Sheet", rowIds: [sheet.rowIds[1]], targetGapIndex: 0 },
    ]);

    expect(moved.sheets[0].headerRowCount).toBe(2);
    expect(moved.sheets[0].rowIds[0]).toBe(sheet.rowIds[1]);
    expectIncrementalMatchesFull(moved);
  });

  it("moves one body row and preserves row identity, row defaults, and formula bindings", () => {
    const state = DocumentState.fromText(ROW_DOC);
    const sheet = state.sheets[0];
    const rowDId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("D")];

    const moved = expectApply(state, [
      { op: "move_rows", sheet: "Sheet", rowIds: [rowDId], targetGapIndex: 4 },
    ]);

    expect(moved.sheets[0].rowPaths).toEqual(["Group", "Group.A", "Group.B", "D", "C"]);
    expect(moved.sheets[0].rowIds[moved.sheets[0].bodyStart + 3]).toBe(rowDId);

    const rowDValues = rowValues(moved, "D");
    expect(rowDValues[3]).toBe(5);
    expectIncrementalMatchesFull(moved);
  });

  it("moves row defaults with the moved row", () => {
    const state = DocumentState.fromText(SIMPLE_DOC);
    const sheet = state.sheets[0];
    const rowR1Id = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("R1")];

    const withDefault = expectApply(state, [
      { op: "set_row_default_style", sheet: "Sheet", rowId: rowR1Id, style: { color: "red" } },
    ]);
    const moved = expectApply(withDefault, [
      { op: "move_rows", sheet: "Sheet", rowIds: [rowR1Id], targetGapIndex: sheet.bodyStart + 1 },
    ]);
    const presentation = resolveDocumentPresentation(moved).sheets[0];

    expect(moved.sheets[0].rowPaths).toEqual(["R2", "R1"]);
    expect(moved.sheets[0].rowIds[moved.sheets[0].bodyStart + 1]).toBe(rowR1Id);
    expect(presentation.rowDefaults[moved.sheets[0].bodyStart + 1].styleLayer.local).toMatchObject({ color: "red" });
  });

  it("moves a complete body subtree and preserves relative references", () => {
    const state = DocumentState.fromText(ROW_DOC);
    const sheet = state.sheets[0];
    const groupId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Group")];
    const aId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Group.A")];
    const bId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Group.B")];

    const moved = expectApply(state, [
      { op: "move_rows", sheet: "Sheet", rowIds: [groupId, aId, bId], targetGapIndex: 3 },
    ]);

    expect(moved.sheets[0].rowPaths).toEqual(["C", "D", "Group", "Group.A", "Group.B"]);
    expect(rowValues(moved, "Group.B")[3]).toBe(1);
    expectIncrementalMatchesFull(moved);
  });

  it("rejects invalid row moves atomically", () => {
    const state = DocumentState.fromText(HIERARCHY_DOC);
    const sheet = state.sheets[0];
    const rootId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Root")];
    const aId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Root.A")];
    const bId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Root.B")];
    const otherId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Other")];
    const cId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Other.C")];

    expectFail(state, [{ op: "move_rows", sheet: "Sheet", rowIds: [9999], targetGapIndex: 1 }], "invalid_target");
    expectFail(state, [{ op: "move_rows", sheet: "Sheet", rowIds: [aId, aId], targetGapIndex: 1 }], "invalid_target");
    expectFail(state, [{ op: "move_rows", sheet: "Sheet", rowIds: [aId, cId], targetGapIndex: 1 }], "invalid_operation");
    expectFail(state, [{ op: "move_rows", sheet: "Sheet", rowIds: [rootId], targetGapIndex: 3 }], "invalid_operation");
    expectFail(state, [{ op: "move_rows", sheet: "Sheet", rowIds: [aId], targetGapIndex: sheet.bodyStart }], "invalid_operation");
    expectFail(state, [{ op: "move_rows", sheet: "Sheet", rowIds: [otherId], targetGapIndex: sheet.bodyStart + 1 }], "invalid_operation");

    const headerState = DocumentState.fromText(ROW_DOC);
    const headerSheet = headerState.sheets[0];
    expectFail(headerState, [
      { op: "move_rows", sheet: "Sheet", rowIds: [headerSheet.rowIds[0], headerSheet.rowIds[headerSheet.bodyStart]], targetGapIndex: 0 },
    ], "invalid_operation");
  });

  it("canonicalizes rebound range endpoint order after row moves", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | Out |
| ---- || ---- | ---- |
| A    || 1    |     |
| B    || 2    |     |
| C    || 3    | = sum(@[A:C,2024]) |
`.trim());
    const sheet = state.sheets[0];
    const rowAId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("A")];

    const moved = expectApply(state, [
      { op: "move_rows", sheet: "Sheet", rowIds: [rowAId], targetGapIndex: 3 },
    ]);

    const formulaCell = moved.sheets[0].cells[moved.sheets[0].bodyStart + moved.sheets[0].rowPaths.indexOf("C")][2];
    expect(formulaCell.body.valid && formulaCell.body.kind === "formula" ? formulaCell.body.inputText : "").toBe("= sum(@[C:A,2024])");
    expect(rowValues(moved, "C")[2]).toBe(4);
    expectIncrementalMatchesFull(moved);
  });
});

describe("RFC-0034 core axis duplication: column duplicates", () => {
  it("duplicates one data column with a fresh identity and copied cell/default metadata", () => {
    const state = DocumentState.fromText(COLUMN_DISPLAY_DOC);
    const sheet = state.sheets[0];
    const colAId = sheet.colIds[1];
    const maxColId = Math.max(...sheet.colIds);

    const duplicated = expectApply(state, [
      { op: "duplicate_columns", sheet: "Sheet", colIds: [colAId], targetGapIndex: sheet.colCount },
    ]);
    const duplicatedSheet = duplicated.sheets[0];
    const newColIndex = duplicatedSheet.colCount - 1;
    const presentation = resolveDocumentPresentation(duplicated).sheets[0];

    expect(duplicatedSheet.colLabels.slice(1)).toEqual(["A", "B", "C", "D", "A"]);
    expect(duplicatedSheet.colIds[1]).toBe(colAId);
    expect(duplicatedSheet.colIds[newColIndex]).toBeGreaterThan(maxColId);
    expect(rowValues(duplicated, "R1").slice(1)).toEqual([1, 2, 3, 4, 1]);
    expect(presentation.columnDefaults[newColIndex].styleLayer.effective).toMatchObject({
      align: "right",
      color: "blue",
      weight: "bold",
    });
    expect(presentation.cells[0][newColIndex].styleLayer.local).toMatchObject({ color: "red" });
    expectIncrementalMatchesFull(duplicated);
  });

  it("duplicates multiple columns in current sheet order and remaps internal column references", () => {
    const state = DocumentState.fromText(COLUMN_DUPLICATE_DOC);
    const sheet = state.sheets[0];
    const colBId = sheet.colIds[2];
    const colCId = sheet.colIds[3];
    const maxColId = Math.max(...sheet.colIds);

    const duplicated = expectApply(state, [
      { op: "duplicate_columns", sheet: "Sheet", colIds: [colCId, colBId], targetGapIndex: sheet.colCount },
    ]);
    const duplicatedSheet = duplicated.sheets[0];

    expect(duplicatedSheet.colLabels.slice(1)).toEqual(["A", "B", "C", "D", "B", "C"]);
    expect(duplicatedSheet.colIds[2]).toBe(colBId);
    expect(duplicatedSheet.colIds[3]).toBe(colCId);
    expect(duplicatedSheet.colIds.slice(5, 7).every((id) => id > maxColId)).toBe(true);
    expect(rowValues(duplicated, "R2").slice(1)).toEqual([10, 20, 30, 40, 20, 30]);

    const formulaRow = duplicatedSheet.cells[duplicatedSheet.bodyStart + duplicatedSheet.rowPaths.indexOf("R1")];
    expect(formulaRow[5].body.valid && formulaRow[5].body.kind === "formula" ? formulaRow[5].body.inputText : "").toBe("= @[R2,#6] + @[R2,A]");
    expect(formulaRow[6].body.valid && formulaRow[6].body.kind === "formula" ? formulaRow[6].body.inputText : "").toBe("= sum(@[R2,#6:#7])");
    expect(formulaRow[4].body.valid && formulaRow[4].body.kind === "formula" ? formulaRow[4].body.inputText : "").toBe("= @[R2,#2!] + @[R2,_-1]");
    expectIncrementalMatchesFull(duplicated);
  });

  it("duplicates columns before and after the source using current-axis target gaps", () => {
    const state = DocumentState.fromText(SIMPLE_DOC);
    const sheet = state.sheets[0];
    const colBId = sheet.colIds[2];

    const beforeSource = expectApply(state, [
      { op: "duplicate_columns", sheet: "Sheet", colIds: [colBId], targetGapIndex: 2 },
    ]);
    expect(beforeSource.sheets[0].colLabels.slice(1)).toEqual(["A", "B", "B", "C", "D"]);
    expect(rowValues(beforeSource, "R1").slice(1)).toEqual([1, 2, 2, 3, 4]);

    const afterSource = expectApply(state, [
      { op: "duplicate_columns", sheet: "Sheet", colIds: [colBId], targetGapIndex: 3 },
    ]);
    expect(afterSource.sheets[0].colLabels.slice(1)).toEqual(["A", "B", "B", "C", "D"]);
    expect(rowValues(afterSource, "R1").slice(1)).toEqual([1, 2, 2, 3, 4]);
  });

  it("rejects invalid column duplicates atomically", () => {
    const state = DocumentState.fromText(SIMPLE_DOC);
    const sheet = state.sheets[0];
    const colAId = sheet.colIds[1];
    const colBId = sheet.colIds[2];
    const colCId = sheet.colIds[3];
    const colDId = sheet.colIds[4];

    expectFail(state, [{ op: "duplicate_columns", sheet: "Sheet", colIds: [9999], targetGapIndex: 1 }], "invalid_target");
    expectFail(state, [{ op: "duplicate_columns", sheet: "Sheet", colIds: [colAId, colAId], targetGapIndex: 1 }], "invalid_target");
    expectFail(state, [{ op: "duplicate_columns", sheet: "Sheet", colIds: [colAId, colCId], targetGapIndex: 1 }], "invalid_operation");
    expectFail(state, [{ op: "duplicate_columns", sheet: "Sheet", colIds: [sheet.colIds[0]], targetGapIndex: 1 }], "invalid_operation");
    expectFail(state, [{ op: "duplicate_columns", sheet: "Sheet", colIds: [colAId], targetGapIndex: 0 }], "invalid_operation");
    expectFail(state, [{ op: "duplicate_columns", sheet: "Sheet", colIds: [colAId], targetGapIndex: 99 }], "out_of_bounds");
    expectFail(state, [{ op: "duplicate_columns", sheet: "Sheet", colIds: [colBId, colCId, colDId], targetGapIndex: 3 }], "invalid_operation");
  });
});

describe("RFC-0034 core axis duplication: row duplicates", () => {
  it("duplicates one header row and rebuilds column labels", () => {
    const state = DocumentState.fromText(`
# Sheet
| Year || 2024 | 2024 |
| Kind || Rev  | Cost |
| ---- || ---- | ---- |
| A    || 1    | 2    |
`.trim());
    const sheet = state.sheets[0];
    const maxRowId = Math.max(...sheet.rowIds);

    const duplicated = expectApply(state, [
      { op: "duplicate_rows", sheet: "Sheet", rowIds: [sheet.rowIds[1]], targetGapIndex: 0 },
    ]);

    expect(duplicated.sheets[0].headerRowCount).toBe(3);
    expect(duplicated.sheets[0].rowIds[0]).toBeGreaterThan(maxRowId);
    expect(duplicated.sheets[0].rowIds[1]).toBe(sheet.rowIds[0]);
    expectIncrementalMatchesFull(duplicated);
  });

  it("duplicates body rows with fresh identities, copied row defaults, and remapped internal row references", () => {
    const state = DocumentState.fromText(ROW_DUPLICATE_DOC);
    const sheet = state.sheets[0];
    const rowAId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("A")];
    const rowBId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("B")];
    const maxRowId = Math.max(...sheet.rowIds);

    const formulaDuplicated = expectApply(state, [
      { op: "duplicate_rows", sheet: "Sheet", rowIds: [rowBId, rowAId], targetGapIndex: sheet.rowCount },
    ]);
    const formulaSheet = formulaDuplicated.sheets[0];
    const formulaClonedBIndex = formulaSheet.rowCount - 1;
    const formulaClonedB = formulaSheet.cells[formulaClonedBIndex][2];

    expect(formulaSheet.rowPaths).toEqual(["A", "B", "C", "A", "B"]);
    expect(formulaSheet.rowIds.slice(formulaClonedBIndex - 1, formulaClonedBIndex + 1).every((id) => id > maxRowId)).toBe(true);
    expect(formulaClonedB.body.valid && formulaClonedB.body.kind === "formula" ? formulaClonedB.body.inputText : "").toBe("= @[#5,Val] + @[#6,Val]");
    expectIncrementalMatchesFull(formulaDuplicated);

    const withDefault = expectApply(state, [
      { op: "set_row_default_style", sheet: "Sheet", rowId: rowBId, style: { color: "green" } },
    ]);
    const duplicated = expectApply(withDefault, [
      { op: "duplicate_rows", sheet: "Sheet", rowIds: [rowBId, rowAId], targetGapIndex: withDefault.sheets[0].rowCount },
    ]);
    const duplicatedSheet = duplicated.sheets[0];
    const presentation = resolveDocumentPresentation(duplicated).sheets[0];
    const clonedBIndex = duplicatedSheet.rowCount - 1;

    expect(duplicatedSheet.rowPaths).toEqual(["A", "B", "C", "A", "B"]);
    expect(presentation.rowDefaults[clonedBIndex].styleLayer.local).toMatchObject({ color: "green" });
  });

  it("duplicates a complete body subtree and preserves hierarchy depths", () => {
    const state = DocumentState.fromText(HIERARCHY_DOC);
    const sheet = state.sheets[0];
    const rootId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Root")];
    const aId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Root.A")];
    const bId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Root.B")];

    const duplicated = expectApply(state, [
      { op: "duplicate_rows", sheet: "Sheet", rowIds: [rootId, aId, bId], targetGapIndex: sheet.rowCount },
    ]);

    expect(duplicated.sheets[0].rowPaths).toEqual([
      "Root",
      "Root.A",
      "Root.B",
      "Other",
      "Other.C",
      "Root",
      "Root.A",
      "Root.B",
    ]);
    expectIncrementalMatchesFull(duplicated);
  });

  it("rejects invalid row duplicates atomically", () => {
    const state = DocumentState.fromText(HIERARCHY_DOC);
    const sheet = state.sheets[0];
    const rootId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Root")];
    const aId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Root.A")];
    const bId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Root.B")];
    const otherId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Other")];
    const cId = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("Other.C")];

    expectFail(state, [{ op: "duplicate_rows", sheet: "Sheet", rowIds: [9999], targetGapIndex: 1 }], "invalid_target");
    expectFail(state, [{ op: "duplicate_rows", sheet: "Sheet", rowIds: [aId, aId], targetGapIndex: 1 }], "invalid_target");
    expectFail(state, [{ op: "duplicate_rows", sheet: "Sheet", rowIds: [aId, cId], targetGapIndex: 1 }], "invalid_operation");
    expectFail(state, [{ op: "duplicate_rows", sheet: "Sheet", rowIds: [rootId], targetGapIndex: sheet.rowCount }], "invalid_operation");
    expectFail(state, [{ op: "duplicate_rows", sheet: "Sheet", rowIds: [aId], targetGapIndex: sheet.bodyStart }], "invalid_operation");
    expectFail(state, [{ op: "duplicate_rows", sheet: "Sheet", rowIds: [otherId], targetGapIndex: sheet.bodyStart + 1 }], "invalid_operation");
    expectFail(state, [{ op: "duplicate_rows", sheet: "Sheet", rowIds: [rootId, aId, bId], targetGapIndex: sheet.bodyStart + 1 }], "invalid_operation");

    const headerState = DocumentState.fromText(ROW_DOC);
    const headerSheet = headerState.sheets[0];
    expectFail(headerState, [
      {
        op: "duplicate_rows",
        sheet: "Sheet",
        rowIds: [headerSheet.rowIds[0], headerSheet.rowIds[headerSheet.bodyStart]],
        targetGapIndex: 0,
      },
    ], "invalid_operation");
  });
});

describe("RFC-0034 core axis reordering: undo and redo", () => {
  it("undoes and redoes column and row moves while preserving IDs", () => {
    const state = DocumentState.fromText(SIMPLE_DOC);
    const sheet = state.sheets[0];
    const colBId = sheet.colIds[2];
    const rowR2Id = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("R2")];

    const applied = applyBatchWithUndo(state, [
      { op: "move_columns", sheet: "Sheet", colIds: [colBId], targetGapIndex: 4 },
      { op: "move_rows", sheet: "Sheet", rowIds: [rowR2Id], targetGapIndex: 1 },
    ]);
    expect(applied.ok, applied.ok ? undefined : applied.error.message).toBe(true);
    if (!applied.ok) throw new Error("expected undoable move success");
    expect(applied.memento.entryCount).toBe(2);

    const after = serializeDocumentState(applied.nextDocument);
    const undone = applyCoreEditMemento(applied.nextDocument, applied.memento, "undo");
    expect(undone.ok, undone.ok ? undefined : undone.error.message).toBe(true);
    if (!undone.ok) throw new Error("expected undo success");
    expect(serializeDocumentState(undone.nextDocument)).toBe(serializeDocumentState(state));

    const redone = applyCoreEditMemento(undone.nextDocument, applied.memento, "redo");
    expect(redone.ok, redone.ok ? undefined : redone.error.message).toBe(true);
    if (!redone.ok) throw new Error("expected redo success");
    expect(serializeDocumentState(redone.nextDocument)).toBe(after);
    expect(redone.nextDocument.sheets[0].colIds[4]).toBe(colBId);
    expect(redone.nextDocument.sheets[0].rowIds[redone.nextDocument.sheets[0].bodyStart]).toBe(rowR2Id);
  });

  it("keeps explicitly fixed positional references bound to current position after move", () => {
    const state = DocumentState.fromText(COLUMN_DOC);
    const sheet = state.sheets[0];
    const colCId = sheet.colIds[3];

    const moved = expectApply(state, [
      { op: "move_columns", sheet: "Sheet", colIds: [colCId], targetGapIndex: 1 },
    ]);

    const fixedValue = rowValues(moved, "Out")[2];
    expect(fixedValue).toBe(1);
  });

  it("undoes and redoes column and row duplicates while preserving generated IDs", () => {
    const state = DocumentState.fromText(SIMPLE_DOC);
    const sheet = state.sheets[0];
    const colBId = sheet.colIds[2];
    const rowR2Id = sheet.rowIds[sheet.bodyStart + sheet.rowPaths.indexOf("R2")];

    const applied = applyBatchWithUndo(state, [
      { op: "duplicate_columns", sheet: "Sheet", colIds: [colBId], targetGapIndex: sheet.colCount },
      { op: "duplicate_rows", sheet: "Sheet", rowIds: [rowR2Id], targetGapIndex: sheet.rowCount },
    ]);
    expect(applied.ok, applied.ok ? undefined : applied.error.message).toBe(true);
    if (!applied.ok) throw new Error("expected undoable duplicate success");
    expect(applied.memento.entryCount).toBe(2);
    const generatedColId = applied.nextDocument.sheets[0].colIds[applied.nextDocument.sheets[0].colCount - 1];
    const generatedRowId = applied.nextDocument.sheets[0].rowIds[applied.nextDocument.sheets[0].rowCount - 1];

    const after = serializeDocumentState(applied.nextDocument);
    const undone = applyCoreEditMemento(applied.nextDocument, applied.memento, "undo");
    expect(undone.ok, undone.ok ? undefined : undone.error.message).toBe(true);
    if (!undone.ok) throw new Error("expected undo success");
    expect(serializeDocumentState(undone.nextDocument)).toBe(serializeDocumentState(state));

    const redone = applyCoreEditMemento(undone.nextDocument, applied.memento, "redo");
    expect(redone.ok, redone.ok ? undefined : redone.error.message).toBe(true);
    if (!redone.ok) throw new Error("expected redo success");
    expect(serializeDocumentState(redone.nextDocument)).toBe(after);
    expect(redone.nextDocument.sheets[0].colIds[redone.nextDocument.sheets[0].colCount - 1]).toBe(generatedColId);
    expect(redone.nextDocument.sheets[0].rowIds[redone.nextDocument.sheets[0].rowCount - 1]).toBe(generatedRowId);
  });
});
