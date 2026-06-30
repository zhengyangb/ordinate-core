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

const RICH_SHEET_DOC = `
# Alpha
| A |
| 1 |

# Beta
Intro paragraph that must survive.

| @display | Item || {:,.1f} {::>,blue,bold} | |
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

function expectFail(document: DocumentState, edits: CoreEdit[], category: string) {
  const before = serializeDocumentState(document);
  const result = applyBatchAtomic(document, edits);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected core edit failure");
  expect(result.error.category).toBe(category);
  expect(serializeDocumentState(document)).toBe(before);
  return result.error;
}

function sheetNames(document: DocumentState): string[] {
  return document.sheets.map((sheet) => sheet.name);
}

function expectRoundTrip(document: DocumentState): void {
  const roundTripped = DocumentState.fromText(serializeDocumentState(document));
  expect(sheetNames(roundTripped)).toEqual(sheetNames(document));
  expect(roundTripped.evaluate().sheets).toEqual(document.evaluate().sheets);
}

describe("RFC-0035 core sheet lifecycle: insert sheet", () => {
  it("inserts sheets at the beginning, middle, and end with a valid minimal table", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    const beginning = expectApply(state, [{ op: "insert_sheet", name: " Start ", sheetIndex: 0 }]);
    expect(sheetNames(beginning)).toEqual(["Start", "Alpha", "Beta", "Gamma"]);
    expect(beginning.sheets[0].rowCount).toBe(1);
    expect(beginning.sheets[0].colCount).toBe(1);

    const middle = expectApply(state, [{ op: "insert_sheet", name: "Middle", sheetIndex: 2 }]);
    expect(sheetNames(middle)).toEqual(["Alpha", "Beta", "Middle", "Gamma"]);

    const end = expectApply(state, [{ op: "insert_sheet", name: "End", sheetIndex: state.sheets.length }]);
    expect(sheetNames(end)).toEqual(["Alpha", "Beta", "Gamma", "End"]);
    expect(serializeDocumentState(end)).toContain("# End\n|  |");
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

    const backward = expectApply(state, [{ op: "move_sheet", sheet: "Gamma", targetGapIndex: 0 }]);
    expect(sheetNames(backward)).toEqual(["Gamma", "Alpha", "Beta"]);
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
  it("keeps existing rename semantics for trim, no-op, and duplicate-name failure", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    const renamed = expectApply(state, [{ op: "rename_sheet", sheet: "Alpha", newName: " Renamed " }]);
    expect(sheetNames(renamed)).toEqual(["Renamed", "Beta", "Gamma"]);

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
    const before = serializeDocumentState(state);

    const failed = applyBatchAtomic(state, [
      { op: "rename_sheet", sheet: "Alpha", newName: "Renamed" },
      { op: "insert_sheet", name: "Beta", sheetIndex: 0 },
    ]);

    expect(failed.ok).toBe(false);
    expect(serializeDocumentState(state)).toBe(before);

    const undoableSheetThenDocument = applyBatchWithUndo(state, [
      { op: "set_cell_input", target: { kind: "index", sheet: "Alpha", rowIndex: 0, colIndex: 0 }, input: "10" },
      { op: "insert_sheet", name: "Beta", sheetIndex: 0 },
    ]);
    expect(undoableSheetThenDocument.ok).toBe(false);
    expect(serializeDocumentState(state)).toBe(before);

    const undoableDocumentThenSheet = applyBatchWithUndo(state, [
      { op: "insert_sheet", name: "Delta", sheetIndex: 1 },
      { op: "set_cell_input", target: { kind: "index", sheet: "Missing", rowIndex: 0, colIndex: 0 }, input: "10" },
    ]);
    expect(undoableDocumentThenSheet.ok).toBe(false);
    expect(serializeDocumentState(state)).toBe(before);
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

    const after = serializeDocumentState(applied.nextDocument);
    const undone = applyCoreEditMemento(applied.nextDocument, applied.memento, "undo");
    expect(undone.ok, undone.ok ? undefined : undone.error.message).toBe(true);
    if (!undone.ok) throw new Error("expected undo success");
    expect(serializeDocumentState(undone.nextDocument)).toBe(serializeDocumentState(state));

    const redone = applyCoreEditMemento(undone.nextDocument, applied.memento, "redo");
    expect(redone.ok, redone.ok ? undefined : redone.error.message).toBe(true);
    if (!redone.ok) throw new Error("expected redo success");
    expect(serializeDocumentState(redone.nextDocument)).toBe(after);
    expect(sheetNames(redone.nextDocument)).toEqual(["Alpha", "RenamedGamma", "Delta"]);
  });

  it("undoes and redoes mixed document and sheet history targeting an inserted sheet", () => {
    const state = DocumentState.fromText(THREE_SHEETS_DOC);

    const applied = applyBatchWithUndo(state, [
      { op: "insert_sheet", name: "Delta", sheetIndex: 1 },
      { op: "set_cell_input", target: { kind: "index", sheet: "Delta", rowIndex: 0, colIndex: 0 }, input: "42" },
      { op: "move_sheet", sheet: "Delta", targetGapIndex: 3 },
    ]);
    expect(applied.ok, applied.ok ? undefined : applied.error.message).toBe(true);
    if (!applied.ok) throw new Error("expected mixed history success");
    expect(sheetNames(applied.nextDocument)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(applied.nextDocument.evaluate().sheets[3].values[0][0]).toMatchObject({ kind: "number", value: 42 });

    const after = serializeDocumentState(applied.nextDocument);
    const undone = applyCoreEditMemento(applied.nextDocument, applied.memento, "undo");
    expect(undone.ok, undone.ok ? undefined : undone.error.message).toBe(true);
    if (!undone.ok) throw new Error("expected undo success");
    expect(serializeDocumentState(undone.nextDocument)).toBe(serializeDocumentState(state));

    const redone = applyCoreEditMemento(undone.nextDocument, applied.memento, "redo");
    expect(redone.ok, redone.ok ? undefined : redone.error.message).toBe(true);
    if (!redone.ok) throw new Error("expected redo success");
    expect(serializeDocumentState(redone.nextDocument)).toBe(after);
    expect(redone.nextDocument.evaluate().sheets[3].values[0][0]).toMatchObject({ kind: "number", value: 42 });
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

  it("restores deleted sheets with formulas, metadata, source blocks, and stable IDs on undo", () => {
    const state = DocumentState.fromText(RICH_SHEET_DOC);
    const beta = state.sheets[1];
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
