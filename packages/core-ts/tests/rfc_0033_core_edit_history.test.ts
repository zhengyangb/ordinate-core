import { describe, expect, it } from "vitest";

import {
  applyBatchAtomic,
  applyBatchWithUndo,
  applyCoreEditMemento,
  DocumentState,
  serializeDocumentState,
  type CoreEdit,
  type CoreEditHistoryMemento,
  type FormatSpec,
} from "../src";

const GROUPED_1F: FormatSpec = {
  kind: "numeric",
  sign: "default",
  padWidth: null,
  grouping: true,
  precision: 1,
  type: "f",
};

const GROUPED_2F: FormatSpec = {
  kind: "numeric",
  sign: "default",
  padWidth: null,
  grouping: true,
  precision: 2,
  type: "f",
};

const PERCENT_1: FormatSpec = {
  kind: "numeric",
  sign: "default",
  padWidth: null,
  grouping: false,
  precision: 1,
  type: "%",
};

const BASIC_DOC = `
# Sheet
| Item  || 2024 | 2025 | Out |
| ----- || ---- | ---- | --- |
| Group ||      |      |     |
| * A   || 1    | 2    | = @[Group.A,2024] + @[Group.A,2025] |
| * B   || 3    | 4    | = @[Group.B,2024] + @[Group.B,2025] |
| Total || = sum(@[Group.A:Group.B,2024]) | = sum(@[Group.A:Group.B,2025]) | = B4 + C4 |
`.trim();

const DISPLAY_DOC = `
# Sheet
| @display | Item || {:,.1f} {::>,blue,bold} | {::>} | |
|          | Item || Price                    | Qty   | Out |
| -------- | ---- || -----                    | ---   | --- |
|          | A    || 12.34 {::green}          | 2     | = B2 * C2 {:,.2f} |
|          | B    || 56.78                    | 3     | = B3 * C3 |
`.trim();

const SOURCE_BLOCK_DOC = `
# Sheet
Intro paragraph that must survive.

| Item || 2024 | 2025 |
| ---- || ---- | ---- |
| A    || 1    | 2    |
| B    || 3    | 4    |
`.trim();

function canonicalText(text: string): string {
  return canonicalDocument(DocumentState.fromText(text));
}

function canonicalDocument(document: DocumentState): string {
  document.evaluate();
  return serializeDocumentState(document);
}

function applyWithUndo(document: DocumentState, edits: CoreEdit[]) {
  const result = applyBatchWithUndo(document, edits);
  expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
  if (!result.ok) throw new Error("expected applyBatchWithUndo success");
  return result;
}

function applyMemento(document: DocumentState, memento: CoreEditHistoryMemento, direction: "undo" | "redo") {
  const result = applyCoreEditMemento(document, memento, direction);
  expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
  if (!result.ok) throw new Error(`expected ${direction} success`);
  return result.nextDocument;
}

function expectUndoRedoRestores(name: string, source: string, edits: CoreEdit[], expectedEntryCount?: number): void {
  const before = canonicalText(source);
  const applied = applyWithUndo(DocumentState.fromText(source), edits);
  if (expectedEntryCount !== undefined) {
    expect(applied.memento.entryCount, name).toBe(expectedEntryCount);
  } else {
    expect(applied.memento.entryCount, name).toBeGreaterThan(0);
  }
  const after = canonicalDocument(applied.nextDocument);

  const undone = applyMemento(applied.nextDocument, applied.memento, "undo");
  expect(canonicalDocument(undone), `${name} undo`).toBe(before);

  const redone = applyMemento(undone, applied.memento, "redo");
  expect(canonicalDocument(redone), `${name} redo`).toBe(after);

  const undoneAgain = applyMemento(redone, applied.memento, "undo");
  expect(canonicalDocument(undoneAgain), `${name} second undo`).toBe(before);
}

describe("RFC-0033 core edit history: simple edit families", () => {
  const dataCell = { kind: "index" as const, sheet: "Sheet", rowIndex: 2, colIndex: 1 };
  const headerCell = { kind: "index" as const, sheet: "Sheet", rowIndex: 0, colIndex: 1 };
  const labelCell = { kind: "index" as const, sheet: "Sheet", rowIndex: 2, colIndex: 0 };

  const cases: Array<{ name: string; source: string; edits: CoreEdit[]; entryCount?: number }> = [
    {
      name: "set data cell input",
      source: BASIC_DOC,
      edits: [{ op: "set_cell_input", target: dataCell, input: "10" }],
    },
    {
      name: "set formula input",
      source: BASIC_DOC,
      edits: [{ op: "set_cell_input", target: dataCell, input: "= 10 + 5" }],
    },
    {
      name: "set header input",
      source: BASIC_DOC,
      edits: [{ op: "set_cell_input", target: headerCell, input: "FY2024" }],
    },
    {
      name: "set label input",
      source: BASIC_DOC,
      edits: [{ op: "set_cell_input", target: labelCell, input: "* Alpha" }],
    },
    {
      name: "clear data cell",
      source: BASIC_DOC,
      edits: [{ op: "clear_cell", target: dataCell }],
    },
    {
      name: "clear header cell",
      source: BASIC_DOC,
      edits: [{ op: "clear_cell", target: headerCell }],
    },
    {
      name: "clear label cell",
      source: BASIC_DOC,
      edits: [{ op: "clear_cell", target: labelCell }],
    },
    {
      name: "rename sheet",
      source: BASIC_DOC,
      edits: [{ op: "rename_sheet", sheet: "Sheet", newName: "Renamed" }],
    },
    {
      name: "preserve non-table source blocks",
      source: SOURCE_BLOCK_DOC,
      edits: [{ op: "set_cell_input", target: { kind: "index", sheet: "Sheet", rowIndex: 1, colIndex: 1 }, input: "99" }],
    },
    {
      name: "no-op rename creates empty memento",
      source: BASIC_DOC,
      edits: [{ op: "rename_sheet", sheet: "Sheet", newName: "Sheet" }],
      entryCount: 0,
    },
  ];

  for (const item of cases) {
    it(`round-trips ${item.name}`, () => {
      expectUndoRedoRestores(item.name, item.source, item.edits, item.entryCount);
    });
  }
});

describe("RFC-0033 core edit history: display metadata edits", () => {
  it("round-trips cell-local format and style edits independently", () => {
    const metadataCell = { kind: "index" as const, sheet: "Sheet", rowIndex: 2, colIndex: 1 };
    expectUndoRedoRestores("cell format/style batch", DISPLAY_DOC, [
      {
        op: "set_cell_local_format",
        target: metadataCell,
        format: GROUPED_2F,
      },
      {
        op: "set_cell_local_style",
        target: metadataCell,
        style: { align: "right", color: "blue" },
      },
      {
        op: "clear_cell_local_style",
        target: metadataCell,
      },
      {
        op: "clear_cell_local_format",
        target: metadataCell,
      },
    ], 4);
  });

  it("round-trips column and row default format/style edits independently", () => {
    const doc = DocumentState.fromText(DISPLAY_DOC);
    const sheet = doc.sheets[0];
    const priceColId = sheet.colIds[1];
    const rowAId = sheet.rowIds[2];
    expectUndoRedoRestores("row/column defaults", DISPLAY_DOC, [
      { op: "set_column_default_format", sheet: "Sheet", colId: priceColId, format: PERCENT_1 },
      { op: "set_column_default_style", sheet: "Sheet", colId: priceColId, style: { color: "green", weight: "normal" } },
      { op: "clear_column_default_style", sheet: "Sheet", colId: priceColId },
      { op: "clear_column_default_format", sheet: "Sheet", colId: priceColId },
      { op: "set_row_default_format", sheet: "Sheet", rowId: rowAId, format: GROUPED_1F },
      { op: "set_row_default_style", sheet: "Sheet", rowId: rowAId, style: { align: "center", color: "blue" } },
      { op: "clear_row_default_style", sheet: "Sheet", rowId: rowAId },
      { op: "clear_row_default_format", sheet: "Sheet", rowId: rowAId },
    ], 8);
  });
});

describe("RFC-0033 core edit history: region and structural edits", () => {
  it("round-trips region set and clear, including reversed endpoints", () => {
    const doc = DocumentState.fromText(BASIC_DOC);
    const sheet = doc.sheets[0];
    const start = { rowId: sheet.rowIds[2], colId: sheet.colIds[1] };
    const end = { rowId: sheet.rowIds[3], colId: sheet.colIds[2] };
    expectUndoRedoRestores("region set and clear", BASIC_DOC, [
      {
        op: "set_region",
        target: { sheet: "Sheet", start: end, end: start },
        values: [["10", "20"], ["30", "40"]],
      },
      {
        op: "clear_region",
        target: { sheet: "Sheet", start, end },
      },
    ], 2);
  });

  it("round-trips header row insertion and deletion", () => {
    const doc = DocumentState.fromText(BASIC_DOC);
    const sheet = doc.sheets[0];
    expectUndoRedoRestores("header row structural edits", BASIC_DOC, [
      { op: "insert_row", sheet: "Sheet", area: "header", rowGapIndex: 1, depth: 0 },
      { op: "delete_row", sheet: "Sheet", rowId: sheet.rowIds[0], mode: "node" },
    ], 2);
  });

  it("round-trips body leaf row insertion and deletion", () => {
    const doc = DocumentState.fromText(BASIC_DOC);
    const sheet = doc.sheets[0];
    expectUndoRedoRestores("body leaf row structural edits", BASIC_DOC, [
      { op: "insert_row", sheet: "Sheet", area: "body", rowGapIndex: 3, depth: 1 },
      { op: "delete_row", sheet: "Sheet", rowId: sheet.rowIds[3], mode: "node" },
    ], 2);
  });

  it("round-trips subtree row deletion", () => {
    const doc = DocumentState.fromText(BASIC_DOC);
    const sheet = doc.sheets[0];
    expectUndoRedoRestores("subtree row deletion", BASIC_DOC, [
      { op: "delete_row", sheet: "Sheet", rowId: sheet.rowIds[1], mode: "subtree" },
    ], 1);
  });

  it("round-trips column insertion and deletion", () => {
    expectUndoRedoRestores("column structural edits", BASIC_DOC, [
      { op: "insert_column", sheet: "Sheet", colIndex: 2 },
      { op: "delete_column", sheet: "Sheet", colIndex: 2 },
      { op: "delete_column", sheet: "Sheet", colIndex: 3 },
    ], 3);
  });

  it("round-trips body/header row conversion", () => {
    const doc = DocumentState.fromText(BASIC_DOC);
    const sheet = doc.sheets[0];
    expectUndoRedoRestores("row conversion", BASIC_DOC, [
      { op: "convert_rows_to_header", sheet: "Sheet", rowIds: [sheet.rowIds[1]] },
      { op: "convert_rows_to_body", sheet: "Sheet", rowIds: [sheet.rowIds[1]], depth: 0 },
    ], 2);
  });
});

describe("RFC-0033 core edit history: composition and failure behavior", () => {
  it("preserves inserted row ids across multi-step undo and redo", () => {
    const before = DocumentState.fromText(BASIC_DOC);
    const inserted = applyWithUndo(before, [{ op: "insert_row", sheet: "Sheet", area: "body", rowGapIndex: 3, depth: 1 }]);
    const insertedSheet = inserted.nextDocument.sheets[0];
    const insertedRowId = insertedSheet.rowIds[3];
    const insertedColId = insertedSheet.colIds[1];

    const edited = applyWithUndo(inserted.nextDocument, [
      {
        op: "set_region",
        target: { sheet: "Sheet", start: { rowId: insertedRowId, colId: insertedColId }, end: { rowId: insertedRowId, colId: insertedColId } },
        values: [["77"]],
      },
    ]);

    const afterEdit = canonicalDocument(edited.nextDocument);
    const withoutEdit = applyMemento(edited.nextDocument, edited.memento, "undo");
    const withoutInsert = applyMemento(withoutEdit, inserted.memento, "undo");
    expect(canonicalDocument(withoutInsert)).toBe(canonicalText(BASIC_DOC));

    const redoneInsert = applyMemento(withoutInsert, inserted.memento, "redo");
    expect(redoneInsert.sheets[0].rowIds[3]).toBe(insertedRowId);
    expect(redoneInsert.sheets[0].colIds[1]).toBe(insertedColId);

    const redoneEdit = applyMemento(redoneInsert, edited.memento, "redo");
    expect(canonicalDocument(redoneEdit)).toBe(afterEdit);
  });

  it("does not produce a memento or mutate authoritative state when a batch fails", () => {
    const source = canonicalText(BASIC_DOC);
    const state = DocumentState.fromText(BASIC_DOC);
    const result = applyBatchWithUndo(state, [
      { op: "set_cell_input", target: { kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, input: "10" },
      { op: "set_cell_local_style", target: { kind: "index", sheet: "Sheet", rowIndex: 0, colIndex: 1 }, style: { color: "blue" } },
    ]);
    expect(result.ok).toBe(false);
    expect(canonicalDocument(state)).toBe(source);
  });

  it("fails early when applying a memento to a mismatched document state", () => {
    const applied = applyWithUndo(DocumentState.fromText(BASIC_DOC), [
      { op: "set_cell_input", target: { kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, input: "10" },
    ]);
    const mutated = applyBatchAtomic(applied.nextDocument, [
      { op: "set_cell_input", target: { kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 2 }, input: "99" },
    ]);
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) throw new Error("expected mutation success");

    const undo = applyCoreEditMemento(mutated.nextDocument, applied.memento, "undo");
    expect(undo.ok).toBe(false);
    if (undo.ok) throw new Error("expected stale memento failure");
    expect(undo.error.category).toBe("invalid_operation");
    expect(undo.error.message).toContain("does not match");
  });
});
