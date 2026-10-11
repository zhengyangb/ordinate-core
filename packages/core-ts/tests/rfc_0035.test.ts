import { describe, expect, it } from "vitest";

import {
  applyBatchAtomic,
  applyBatchWithUndo,
  applyCoreEditMemento,
  DocumentState,
  serializeDocumentState,
  type CoreEdit,
} from "../src";

const THREE_SHEETS_DOC = `
# Alpha
| A |
| 1 |

# Beta
| B |
| 2 |

# Gamma
| C |
| 3 |
`.trim();

const DEFAULT_GRID_ROWS = [
  "|      ||      |      |      |      |",
  "| ---- || ---- | ---- | ---- | ---- |",
  ...Array.from({ length: 9 }, () => "|      ||      |      |      |      |"),
].join("\n");

const RICH_SHEET_DOC = `
# Alpha
| A |
| 1 |

# Beta
Intro paragraph that must survive.

| @meta | Item || {:,.1f} {::>,blue,bold} | |
|          | Item || Value                    | Out |
| -------- | ---- || -----                    | --- |
|          | Row  || 12.34 {::green}          | = @[Row,Value] |

# Gamma
| C |
| 3 |
`.trim();

function expectApply(document: DocumentState, edits: CoreEdit[]) {
  const result = applyBatchAtomic(document, edits);
  expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
  if (!result.ok) throw new Error("expected core edit success");
  return result.nextDocument;
}

function documentIdentitySnapshot(document: DocumentState) {
  return {
    serialized: serializeDocumentState(document),
    sheetIds: sheetIds(document),
    nextSheetId: document.nextSheetId,
  };
}

function expectFail(document: DocumentState, edits: CoreEdit[], category: string) {
  const before = documentIdentitySnapshot(document);
  const result = applyBatchAtomic(document, edits);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected core edit failure");
  expect(result.error.category).toBe(category);
  expect(documentIdentitySnapshot(document)).toEqual(before);
  return result.error;
}

function sheetNames(document: DocumentState): string[] {
  return document.sheets.map((sheet) => sheet.name);
}

function sheetIds(document: DocumentState): number[] {
  return document.sheets.map((sheet) => sheet.sheetId);
}

function expectUniqueSheetIds(document: DocumentState): void {
  expect(new Set(sheetIds(document)).size).toBe(document.sheets.length);
}

function expectRoundTrip(document: DocumentState): void {
  const roundTripped = DocumentState.fromText(serializeDocumentState(document));
  expect(sheetNames(roundTripped)).toEqual(sheetNames(document));
  expect(sheetIds(roundTripped)).toEqual(document.sheets.map((_, index) => index + 1));
  expect(roundTripped.nextSheetId).toBe(document.sheets.length + 1);
  expect(roundTripped.evaluate().sheets).toEqual(document.evaluate().sheets);
}

describe("RFC-0035 core sheet lifecycle: insert sheet", () => {
  it("inserts sheets at the beginning, middle, and end with a default editable grid", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);
    expect(sheetIds(state)).toEqual([1, 2, 3]);
    expect(state.nextSheetId).toBe(4);

    const beginning = expectApply(state, [{ op: "insert_sheet", name: " Start ", sheetIndex: 0 }]);
    expect(sheetNames(beginning)).toEqual(["Start", "Alpha", "Beta", "Gamma"]);
    expect(sheetIds(beginning)).toEqual([4, 1, 2, 3]);
    expect(beginning.nextSheetId).toBe(5);
    expectUniqueSheetIds(beginning);
    expect(beginning.sheets[0].rowCount).toBe(10);
    expect(beginning.sheets[0].colCount).toBe(5);
    expect(beginning.sheets[0].headerRowCount).toBe(1);
    expect(beginning.sheets[0].headerColCount).toBe(1);

    const middle = expectApply(state, [{ op: "insert_sheet", name: "Middle", sheetIndex: 2 }]);
    expect(sheetNames(middle)).toEqual(["Alpha", "Beta", "Middle", "Gamma"]);
    expect(sheetIds(middle)).toEqual([1, 2, 4, 3]);
    expect(middle.nextSheetId).toBe(5);

    const end = expectApply(state, [{ op: "insert_sheet", name: "End", sheetIndex: state.sheets.length }]);
    expect(sheetNames(end)).toEqual(["Alpha", "Beta", "Gamma", "End"]);
    expect(sheetIds(end)).toEqual([1, 2, 3, 4]);
    expect(end.nextSheetId).toBe(5);
    expect(serializeDocumentState(end)).toContain("# End\n|     ||     |     |     |     |");
    expectRoundTrip(end);
  });

  it("rejects invalid sheet inserts atomically", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    expectFail(state, [{ op: "insert_sheet", name: "  ", sheetIndex: 0 }], "invalid_operation");
    expectFail(state, [{ op: "insert_sheet", name: "Alpha", sheetIndex: 0 }], "invalid_operation");
    expectFail(state, [{ op: "insert_sheet", name: "New", sheetIndex: 1.5 }], "invalid_target");
    expectFail(state, [{ op: "insert_sheet", name: "New", sheetIndex: -1 }], "out_of_bounds");
    expectFail(state, [{ op: "insert_sheet", name: "New", sheetIndex: 99 }], "out_of_bounds");
  });
});

describe("RFC-0035 core sheet lifecycle: delete sheet", () => {
  it("deletes a middle sheet and preserves remaining sheet order", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    const deleted = expectApply(state, [{ op: "delete_sheet", sheet: "Beta" }]);

    expect(sheetNames(deleted)).toEqual(["Alpha", "Gamma"]);
    expectRoundTrip(deleted);
  });

  it("does not reuse deleted sheet IDs when inserting new sheets", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);
    const inserted = expectApply(state, [{ op: "insert_sheet", name: "Delta", sheetIndex: 1 }]);
    const deltaId = inserted.sheets[1].sheetId;

    const deleted = expectApply(inserted, [{ op: "delete_sheet", sheet: "Delta" }]);
    const reinserted = expectApply(deleted, [{ op: "insert_sheet", name: "Epsilon", sheetIndex: 1 }]);

    expect(sheetNames(reinserted)).toEqual(["Alpha", "Epsilon", "Beta", "Gamma"]);
    expect(reinserted.sheets[1].sheetId).toBeGreaterThan(deltaId);
    expect(reinserted.sheets[1].sheetId).toBe(5);
    expect(reinserted.nextSheetId).toBe(6);
    expectUniqueSheetIds(reinserted);
  });

  it("rejects unknown sheet deletion and deleting the last sheet", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);
    const oneSheet = DocumentState.fromText(`
# Only
| A |
`.trim());

    expectFail(state, [{ op: "delete_sheet", sheet: "Missing" }], "invalid_target");
    expectFail(oneSheet, [{ op: "delete_sheet", sheet: "Only" }], "invalid_operation");
  });
});

describe("RFC-0035 core sheet lifecycle: move sheet", () => {
  it("moves sheets forward and backward using post-removal target gaps", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    const forward = expectApply(state, [{ op: "move_sheet", sheet: "Alpha", targetGapIndex: 2 }]);
    expect(sheetNames(forward)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(sheetIds(forward)).toEqual([2, 3, 1]);

    const backward = expectApply(state, [{ op: "move_sheet", sheet: "Gamma", targetGapIndex: 0 }]);
    expect(sheetNames(backward)).toEqual(["Gamma", "Alpha", "Beta"]);
    expect(sheetIds(backward)).toEqual([3, 1, 2]);
    expectRoundTrip(backward);
  });

  it("treats same effective sheet location as no-op history", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);
    const result = applyBatchWithUndo(state, [{ op: "move_sheet", sheet: "Beta", targetGapIndex: 1 }]);

    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.memento.entryCount).toBe(0);
    expect(serializeDocumentState(result.nextDocument)).toBe(serializeDocumentState(state));

    const first = applyBatchWithUndo(state, [{ op: "move_sheet", sheet: "Alpha", targetGapIndex: 0 }]);
    expect(first.ok, first.ok ? undefined : first.error.message).toBe(true);
    if (!first.ok) throw new Error("expected first no-op success");
    expect(first.memento.entryCount).toBe(0);

    const last = applyBatchWithUndo(state, [{ op: "move_sheet", sheet: "Gamma", targetGapIndex: 2 }]);
    expect(last.ok, last.ok ? undefined : last.error.message).toBe(true);
    if (!last.ok) throw new Error("expected last no-op success");
    expect(last.memento.entryCount).toBe(0);
  });

  it("rejects invalid sheet moves atomically", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    expectFail(state, [{ op: "move_sheet", sheet: "Missing", targetGapIndex: 0 }], "invalid_target");
    expectFail(state, [{ op: "move_sheet", sheet: "Alpha", targetGapIndex: 1.5 }], "invalid_target");
    expectFail(state, [{ op: "move_sheet", sheet: "Alpha", targetGapIndex: -1 }], "out_of_bounds");
    expectFail(state, [{ op: "move_sheet", sheet: "Alpha", targetGapIndex: 99 }], "out_of_bounds");
  });
});

describe("RFC-0035 core sheet lifecycle: rename and history", () => {
  it("rejects invalid document sheet identity state", () => {
    const duplicateIds = DocumentState.fromText(`
# A
| 1 |

# B
| 2 |
`.trim());
    duplicateIds.sheets[1].sheetId = duplicateIds.sheets[0].sheetId;
    expect(() => new DocumentState(duplicateIds.sheets, 3)).toThrow("duplicate sheetId");

    const invalidNextId = DocumentState.fromText(THREE_SHEETS_DOC);
    expect(() => new DocumentState(invalidNextId.sheets, invalidNextId.sheets[2].sheetId)).toThrow(
      "nextSheetId must be greater than every existing sheetId",
    );

    const invalidSheetId = DocumentState.fromText(THREE_SHEETS_DOC);
    invalidSheetId.sheets[0].sheetId = 0;
    expect(() => new DocumentState(invalidSheetId.sheets, 4)).toThrow("sheetId must be a positive integer");

    const invalidCounter = DocumentState.fromText(THREE_SHEETS_DOC);
    expect(() => new DocumentState(invalidCounter.sheets, 0)).toThrow("nextSheetId must be a positive integer");
  });

  it("keeps existing rename semantics for trim, no-op, and duplicate-name failure", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    const renamed = expectApply(state, [{ op: "rename_sheet", sheet: "Alpha", newName: " Renamed " }]);
    expect(sheetNames(renamed)).toEqual(["Renamed", "Beta", "Gamma"]);
    expect(sheetIds(renamed)).toEqual([1, 2, 3]);

    const noOp = applyBatchWithUndo(state, [{ op: "rename_sheet", sheet: "Alpha", newName: "Alpha" }]);
    expect(noOp.ok, noOp.ok ? undefined : noOp.error.message).toBe(true);
    if (!noOp.ok) throw new Error("expected no-op rename success");
    expect(noOp.memento.entryCount).toBe(0);

    expectFail(state, [{ op: "rename_sheet", sheet: "Alpha", newName: "Beta" }], "invalid_operation");
    expectFail(state, [{ op: "rename_sheet", sheet: "Alpha", newName: "   " }], "invalid_operation");
    expectFail(state, [{ op: "rename_sheet", sheet: "Missing", newName: "New" }], "invalid_target");
    expectFail(state, [{ op: "rename_sheet", sheet: "Gamma", newName: " Beta " }], "invalid_operation");
    expectFail(state, [{ op: "insert_sheet", name: " Alpha ", sheetIndex: 0 }], "invalid_operation");
  });

  it("rolls back earlier edits when a later sheet edit fails in atomic and undoable batches", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);
    const before = documentIdentitySnapshot(state);

    const failed = applyBatchAtomic(state, [
      { op: "rename_sheet", sheet: "Alpha", newName: "Renamed" },
      { op: "insert_sheet", name: "Beta", sheetIndex: 0 },
    ]);

    expect(failed.ok).toBe(false);
    expect(documentIdentitySnapshot(state)).toEqual(before);

    const undoableSheetThenDocument = applyBatchWithUndo(state, [
      { op: "set_cell_input", target: { kind: "index", sheet: "Alpha", rowIndex: 0, colIndex: 0 }, input: "10" },
      { op: "insert_sheet", name: "Beta", sheetIndex: 0 },
    ]);
    expect(undoableSheetThenDocument.ok).toBe(false);
    expect(documentIdentitySnapshot(state)).toEqual(before);

    const undoableDocumentThenSheet = applyBatchWithUndo(state, [
      { op: "insert_sheet", name: "Delta", sheetIndex: 1 },
      { op: "set_cell_input", target: { kind: "index", sheet: "Missing", rowIndex: 0, colIndex: 0 }, input: "10" },
    ]);
    expect(undoableDocumentThenSheet.ok).toBe(false);
    expect(documentIdentitySnapshot(state)).toEqual(before);
  });

  it("undoes and redoes insert, delete, move, and rename sheet edits", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    const applied = applyBatchWithUndo(state, [
      { op: "insert_sheet", name: "Delta", sheetIndex: 1 },
      { op: "rename_sheet", sheet: "Gamma", newName: "RenamedGamma" },
      { op: "move_sheet", sheet: "Delta", targetGapIndex: 3 },
      { op: "delete_sheet", sheet: "Beta" },
    ]);
    expect(applied.ok, applied.ok ? undefined : applied.error.message).toBe(true);
    if (!applied.ok) throw new Error("expected undoable sheet lifecycle success");
    expect(applied.memento.entryCount).toBe(4);
    expect(sheetNames(applied.nextDocument)).toEqual(["Alpha", "RenamedGamma", "Delta"]);
    expect(sheetIds(applied.nextDocument)).toEqual([1, 3, 4]);
    expect(applied.nextDocument.nextSheetId).toBe(5);

    const after = serializeDocumentState(applied.nextDocument);
    const afterIds = sheetIds(applied.nextDocument);
    const afterNextSheetId = applied.nextDocument.nextSheetId;
    const undone = applyCoreEditMemento(applied.nextDocument, applied.memento, "undo");
    expect(undone.ok, undone.ok ? undefined : undone.error.message).toBe(true);
    if (!undone.ok) throw new Error("expected undo success");
    expect(serializeDocumentState(undone.nextDocument)).toBe(serializeDocumentState(state));
    expect(sheetIds(undone.nextDocument)).toEqual(sheetIds(state));
    expect(undone.nextDocument.nextSheetId).toBe(state.nextSheetId);

    const redone = applyCoreEditMemento(undone.nextDocument, applied.memento, "redo");
    expect(redone.ok, redone.ok ? undefined : redone.error.message).toBe(true);
    if (!redone.ok) throw new Error("expected redo success");
    expect(serializeDocumentState(redone.nextDocument)).toBe(after);
    expect(sheetNames(redone.nextDocument)).toEqual(["Alpha", "RenamedGamma", "Delta"]);
    expect(sheetIds(redone.nextDocument)).toEqual(afterIds);
    expect(redone.nextDocument.nextSheetId).toBe(afterNextSheetId);
  });

  it("undoes and redoes mixed document and sheet history targeting an inserted sheet", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    const applied = applyBatchWithUndo(state, [
      { op: "insert_sheet", name: "Delta", sheetIndex: 1 },
      { op: "set_cell_input", target: { kind: "index", sheet: "Delta", rowIndex: 1, colIndex: 1 }, input: "42" },
      { op: "move_sheet", sheet: "Delta", targetGapIndex: 3 },
    ]);
    expect(applied.ok, applied.ok ? undefined : applied.error.message).toBe(true);
    if (!applied.ok) throw new Error("expected mixed history success");
    expect(sheetNames(applied.nextDocument)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(sheetIds(applied.nextDocument)).toEqual([1, 2, 3, 4]);
    expect(applied.nextDocument.evaluate().sheets[3].values[0][1]).toMatchObject({ kind: "number", value: 42 });

    const after = serializeDocumentState(applied.nextDocument);
    const afterIds = sheetIds(applied.nextDocument);
    const undone = applyCoreEditMemento(applied.nextDocument, applied.memento, "undo");
    expect(undone.ok, undone.ok ? undefined : undone.error.message).toBe(true);
    if (!undone.ok) throw new Error("expected undo success");
    expect(serializeDocumentState(undone.nextDocument)).toBe(serializeDocumentState(state));
    expect(sheetIds(undone.nextDocument)).toEqual(sheetIds(state));

    const redone = applyCoreEditMemento(undone.nextDocument, applied.memento, "redo");
    expect(redone.ok, redone.ok ? undefined : redone.error.message).toBe(true);
    if (!redone.ok) throw new Error("expected redo success");
    expect(serializeDocumentState(redone.nextDocument)).toBe(after);
    expect(sheetIds(redone.nextDocument)).toEqual(afterIds);
    expect(redone.nextDocument.evaluate().sheets[3].values[0][1]).toMatchObject({ kind: "number", value: 42 });
  });

  it("applies sheet-level history to the same sheet ID after sheet reorder", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);
    const betaId = state.sheets[1].sheetId;

    const edited = applyBatchWithUndo(state, [
      { op: "set_cell_input", target: { kind: "index", sheet: "Beta", rowIndex: 1, colIndex: 0 }, input: "20" },
    ]);
    expect(edited.ok, edited.ok ? undefined : edited.error.message).toBe(true);
    if (!edited.ok) throw new Error("expected sheet-level edit success");

    const reordered = applyBatchAtomic(edited.nextDocument, [
      { op: "move_sheet", sheet: "Alpha", targetGapIndex: 2 },
    ]);
    expect(reordered.ok, reordered.ok ? undefined : reordered.error.message).toBe(true);
    if (!reordered.ok) throw new Error("expected reorder success");
    expect(sheetNames(reordered.nextDocument)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(reordered.nextDocument.sheets[0].sheetId).toBe(betaId);

    const undone = applyCoreEditMemento(reordered.nextDocument, edited.memento, "undo");
    expect(undone.ok, undone.ok ? undefined : undone.error.message).toBe(true);
    if (!undone.ok) throw new Error("expected reordered sheet-level undo success");
    expect(sheetNames(undone.nextDocument)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(undone.nextDocument.sheets[0].sheetId).toBe(betaId);
    expect(undone.nextDocument.evaluate().sheets[0].values[1][0]).toMatchObject({ kind: "number", value: 2 });

    const redone = applyCoreEditMemento(undone.nextDocument, edited.memento, "redo");
    expect(redone.ok, redone.ok ? undefined : redone.error.message).toBe(true);
    if (!redone.ok) throw new Error("expected reordered sheet-level redo success");
    expect(sheetNames(redone.nextDocument)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(redone.nextDocument.sheets[0].sheetId).toBe(betaId);
    expect(redone.nextDocument.evaluate().sheets[0].values[1][0]).toMatchObject({ kind: "number", value: 20 });
  });

  it("fails early when applying stale document history mementos", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);
    const applied = applyBatchWithUndo(state, [{ op: "move_sheet", sheet: "Alpha", targetGapIndex: 2 }]);
    expect(applied.ok, applied.ok ? undefined : applied.error.message).toBe(true);
    if (!applied.ok) throw new Error("expected move success");

    const mutated = applyBatchAtomic(applied.nextDocument, [
      { op: "insert_sheet", name: "Delta", sheetIndex: 0 },
    ]);
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) throw new Error("expected mutation success");

    const undo = applyCoreEditMemento(mutated.nextDocument, applied.memento, "undo");
    expect(undo.ok).toBe(false);
    if (undo.ok) throw new Error("expected stale document memento failure");
    expect(undo.error.category).toBe("invalid_operation");
    expect(undo.error.message).toContain("does not match");
  });

  it("treats nextSheetId-only changes as stale document history", () => {
    const state = DocumentState.fromText(`
# A
| 1 |

# B
| 2 |
`.trim());
    const renamed = applyBatchWithUndo(state, [{ op: "rename_sheet", sheet: "A", newName: "C" }]);
    expect(renamed.ok, renamed.ok ? undefined : renamed.error.message).toBe(true);
    if (!renamed.ok) throw new Error("expected rename success");

    const perturbed = applyBatchAtomic(renamed.nextDocument, [
      { op: "insert_sheet", name: "Temp", sheetIndex: 2 },
      { op: "delete_sheet", sheet: "Temp" },
    ]);
    expect(perturbed.ok, perturbed.ok ? undefined : perturbed.error.message).toBe(true);
    if (!perturbed.ok) throw new Error("expected nextSheetId perturbation success");
    expect(serializeDocumentState(perturbed.nextDocument)).toBe(serializeDocumentState(renamed.nextDocument));
    expect(perturbed.nextDocument.nextSheetId).toBeGreaterThan(renamed.nextDocument.nextSheetId);

    const undo = applyCoreEditMemento(perturbed.nextDocument, renamed.memento, "undo");
    expect(undo.ok).toBe(false);
    if (undo.ok) throw new Error("expected nextSheetId-only stale memento failure");
    expect(undo.error.category).toBe("invalid_operation");
    expect(undo.error.message).toContain("does not match");
  });

  it("keeps rename sheet history document-scoped to prevent stale duplicate-name undo", () => {
    const state = DocumentState.fromText(`
# A
| 1 |

# B
| 2 |
`.trim());
    const renamed = applyBatchWithUndo(state, [{ op: "rename_sheet", sheet: "A", newName: "C" }]);
    expect(renamed.ok, renamed.ok ? undefined : renamed.error.message).toBe(true);
    if (!renamed.ok) throw new Error("expected rename success");

    const inserted = applyBatchAtomic(renamed.nextDocument, [{ op: "insert_sheet", name: "A", sheetIndex: 0 }]);
    expect(inserted.ok, inserted.ok ? undefined : inserted.error.message).toBe(true);
    if (!inserted.ok) throw new Error("expected insert success");

    const undo = applyCoreEditMemento(inserted.nextDocument, renamed.memento, "undo");
    expect(undo.ok).toBe(false);
    if (undo.ok) throw new Error("expected stale rename undo failure");
    expect(undo.error.category).toBe("invalid_operation");
    expect(undo.error.message).toContain("does not match");
  });

  it("uses sheet IDs to reject stale sheet-level history against a same-name replacement", () => {
    const state = DocumentState.fromText(`
# A
| 1 |

# B
| 2 |
`.trim());
    const originalAId = state.sheets[0].sheetId;

    const edited = applyBatchWithUndo(state, [
      { op: "set_cell_input", target: { kind: "index", sheet: "A", rowIndex: 0, colIndex: 0 }, input: "99" },
    ]);
    expect(edited.ok, edited.ok ? undefined : edited.error.message).toBe(true);
    if (!edited.ok) throw new Error("expected sheet edit success");

    const replaced = applyBatchAtomic(edited.nextDocument, [
      { op: "delete_sheet", sheet: "A" },
      { op: "insert_sheet", name: "A", sheetIndex: 0 },
    ]);
    expect(replaced.ok, replaced.ok ? undefined : replaced.error.message).toBe(true);
    if (!replaced.ok) throw new Error("expected same-name replacement success");
    expect(sheetNames(replaced.nextDocument)).toEqual(["A", "B"]);
    expect(replaced.nextDocument.sheets[0].sheetId).not.toBe(originalAId);

    const undo = applyCoreEditMemento(replaced.nextDocument, edited.memento, "undo");
    expect(undo.ok).toBe(false);
    if (undo.ok) throw new Error("expected stale sheet-level undo failure");
    expect(undo.error.category).toBe("invalid_operation");
    expect(undo.error.message).toContain(`sheetId ${originalAId}`);
  });

  it("rejects stale sheet-level history against a same-name same-content replacement", () => {
    const state = DocumentState.fromText(`
# A
${DEFAULT_GRID_ROWS}

# B
| 2 |
`.trim());
    const originalAId = state.sheets[0].sheetId;

    const edited = applyBatchWithUndo(state, [
      { op: "set_cell_input", target: { kind: "index", sheet: "A", rowIndex: 1, colIndex: 1 }, input: "99" },
    ]);
    expect(edited.ok, edited.ok ? undefined : edited.error.message).toBe(true);
    if (!edited.ok) throw new Error("expected sheet edit success");

    const replaced = applyBatchAtomic(edited.nextDocument, [
      { op: "delete_sheet", sheet: "A" },
      { op: "insert_sheet", name: "A", sheetIndex: 0 },
      { op: "set_cell_input", target: { kind: "index", sheet: "A", rowIndex: 1, colIndex: 1 }, input: "99" },
    ]);
    expect(replaced.ok, replaced.ok ? undefined : replaced.error.message).toBe(true);
    if (!replaced.ok) throw new Error("expected identical same-name replacement success");
    expect(sheetNames(replaced.nextDocument)).toEqual(sheetNames(edited.nextDocument));
    expect(replaced.nextDocument.evaluate().sheets).toEqual(edited.nextDocument.evaluate().sheets);
    expect(replaced.nextDocument.sheets[0].sheetId).not.toBe(originalAId);

    const undo = applyCoreEditMemento(replaced.nextDocument, edited.memento, "undo");
    expect(undo.ok).toBe(false);
    if (undo.ok) throw new Error("expected stale sheet-level undo failure");
    expect(undo.error.category).toBe("invalid_operation");
    expect(undo.error.message).toContain(`sheetId ${originalAId}`);
  });

  it("restores deleted sheets with formulas, metadata, source blocks, and stable IDs on undo", () => {
    const state = DocumentState.fromText(RICH_SHEET_DOC);
    const beta = state.sheets[1];
    const betaSheetId = beta.sheetId;
    const rowId = beta.rowIds[beta.bodyStart];
    const valueColId = beta.colIds[1];
    const before = serializeDocumentState(state);

    const deleted = applyBatchWithUndo(state, [{ op: "delete_sheet", sheet: "Beta" }]);
    expect(deleted.ok, deleted.ok ? undefined : deleted.error.message).toBe(true);
    if (!deleted.ok) throw new Error("expected delete success");

    const undone = applyCoreEditMemento(deleted.nextDocument, deleted.memento, "undo");
    expect(undone.ok, undone.ok ? undefined : undone.error.message).toBe(true);
    if (!undone.ok) throw new Error("expected undo success");
    expect(serializeDocumentState(undone.nextDocument)).toBe(before);
    expect(undone.nextDocument.sheets[1].sheetId).toBe(betaSheetId);
    expect(undone.nextDocument.sheets[1].rowIds[undone.nextDocument.sheets[1].bodyStart]).toBe(rowId);
    expect(undone.nextDocument.sheets[1].colIds[1]).toBe(valueColId);

    const edited = applyBatchAtomic(undone.nextDocument, [
      { op: "set_cell_input", target: { kind: "index", sheet: "Beta", rowIndex: undone.nextDocument.sheets[1].bodyStart, colIndex: 1 }, input: "99" },
    ]);
    expect(edited.ok, edited.ok ? undefined : edited.error.message).toBe(true);
    if (!edited.ok) throw new Error("expected restored sheet edit success");
    expect(edited.nextDocument.evaluate().sheets[1].values[0][2]).toMatchObject({ kind: "number", value: 99 });
  });

  it("rejects ambiguous sheet lifecycle targets", () => {
    const ambiguous = DocumentState.fromText(`
# Dup
| 1 |

# Dup
| 2 |

# Other
| 3 |
`.trim());

    expectFail(ambiguous, [{ op: "delete_sheet", sheet: "Dup" }], "ambiguous_target");
    expectFail(ambiguous, [{ op: "move_sheet", sheet: "Dup", targetGapIndex: 0 }], "ambiguous_target");
    expectFail(ambiguous, [{ op: "rename_sheet", sheet: "Dup", newName: "New" }], "ambiguous_target");
  });

  it("undoes and redoes rename followed by moving the renamed sheet", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    const applied = applyBatchWithUndo(state, [
      { op: "rename_sheet", sheet: "Gamma", newName: "Delta" },
      { op: "move_sheet", sheet: "Delta", targetGapIndex: 0 },
    ]);
    expect(applied.ok, applied.ok ? undefined : applied.error.message).toBe(true);
    if (!applied.ok) throw new Error("expected rename and move success");
    expect(sheetNames(applied.nextDocument)).toEqual(["Delta", "Alpha", "Beta"]);

    const after = serializeDocumentState(applied.nextDocument);
    const undone = applyCoreEditMemento(applied.nextDocument, applied.memento, "undo");
    expect(undone.ok, undone.ok ? undefined : undone.error.message).toBe(true);
    if (!undone.ok) throw new Error("expected undo success");
    expect(serializeDocumentState(undone.nextDocument)).toBe(serializeDocumentState(state));

    const redone = applyCoreEditMemento(undone.nextDocument, applied.memento, "redo");
    expect(redone.ok, redone.ok ? undefined : redone.error.message).toBe(true);
    if (!redone.ok) throw new Error("expected redo success");
    expect(serializeDocumentState(redone.nextDocument)).toBe(after);
  });
});
