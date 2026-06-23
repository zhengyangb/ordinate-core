import { beforeEach, describe, expect, it } from "vitest";

import { serializeDocumentState, type FormatSpec } from "@ordinate/core";

import { useEditorStore } from "./editorStore";

const TEST_DOC = `
# Sheet
| Item  || 2024 | 2025 | Out |
| ----- || ---- | ---- | --- |
| Group ||      |      |     |
| * A   || 1    | 2    | = @[Group.A,2024] + @[Group.A,2025] |
| * B   || 3    | 4    | = @[Group.B,2024] + @[Group.B,2025] |
| Total || = sum(@[Group.A:Group.B,2024]) | = sum(@[Group.A:Group.B,2025]) | = B4 + C4 |
`.trim();

const MONEY_FORMAT: FormatSpec = {
  kind: "numeric",
  sign: "default",
  padWidth: null,
  grouping: true,
  precision: 2,
  type: "f",
};

function resetStore(source = TEST_DOC): void {
  const store = useEditorStore.getState();
  store.setSourceText(source);
  store.exitSourceMode();
}

function canonicalStoreDocument(): string {
  const { docState } = useEditorStore.getState();
  if (!docState) throw new Error("expected active document");
  docState.evaluate();
  return serializeDocumentState(docState);
}

describe("editor store history", () => {
  beforeEach(() => {
    resetStore();
  });

  it("pushes commands and round-trips undo and redo", () => {
    const before = canonicalStoreDocument();
    const startRevision = useEditorStore.getState().revision;

    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "10");

    const after = canonicalStoreDocument();
    expect(after).not.toBe(before);
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 1,
      canUndo: true,
      canRedo: false,
      undoLabel: "Set cell input",
      redoLabel: null,
      isDirty: true,
      revision: startRevision + 1,
    });

    useEditorStore.getState().undo();
    expect(canonicalStoreDocument()).toBe(before);
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 0,
      canUndo: false,
      canRedo: true,
      undoLabel: null,
      redoLabel: "Set cell input",
    });

    useEditorStore.getState().redo();
    expect(canonicalStoreDocument()).toBe(after);
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 1,
      canUndo: true,
      canRedo: false,
    });
  });

  it("clears redo history after a new command", () => {
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "10");
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 3, colIndex: 1 }, "30");
    expect(useEditorStore.getState()).toMatchObject({ historyCursor: 2, canRedo: false });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState()).toMatchObject({ historyCursor: 1, canRedo: true });

    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 3, colIndex: 2 }, "40");
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 2,
      canUndo: true,
      canRedo: false,
      redoLabel: null,
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
  });

  it("does not push no-op edits into history", () => {
    const before = canonicalStoreDocument();
    const startRevision = useEditorStore.getState().revision;

    useEditorStore.getState().renameSheet("Sheet", "Sheet");

    expect(canonicalStoreDocument()).toBe(before);
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 0,
      canUndo: false,
      canRedo: false,
      isDirty: false,
      revision: startRevision,
    });
    expect(useEditorStore.getState().history).toHaveLength(0);
  });

  it("clears app history after source mode reparses successfully", () => {
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "10");
    expect(useEditorStore.getState().canUndo).toBe(true);

    useEditorStore.getState().enterSourceMode();
    useEditorStore.getState().exitSourceMode();

    expect(useEditorStore.getState()).toMatchObject({
      mode: "table",
      historyCursor: 0,
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      isDirty: false,
    });
    expect(useEditorStore.getState().history).toHaveLength(0);
  });

  it("round-trips display metadata commands through the store history", () => {
    const target = { kind: "index" as const, sheet: "Sheet", rowIndex: 2, colIndex: 1 };
    const before = canonicalStoreDocument();

    useEditorStore.getState().setCellLocalFormat(target, MONEY_FORMAT);
    useEditorStore.getState().setCellLocalStyle(target, { align: "right", color: "blue" });
    const afterStyle = canonicalStoreDocument();

    useEditorStore.getState().undo();
    useEditorStore.getState().undo();
    expect(canonicalStoreDocument()).toBe(before);

    useEditorStore.getState().redo();
    useEditorStore.getState().redo();
    expect(canonicalStoreDocument()).toBe(afterStyle);

    useEditorStore.getState().clearCellLocalStyle(target);
    useEditorStore.getState().clearCellLocalFormat(target);
    const afterClear = canonicalStoreDocument();
    expect(afterClear).not.toBe(afterStyle);

    useEditorStore.getState().undo();
    useEditorStore.getState().undo();
    expect(canonicalStoreDocument()).toBe(afterStyle);
  });

  it("preserves inserted row ids across multi-step undo and redo", () => {
    const before = canonicalStoreDocument();
    const initialSheet = useEditorStore.getState().docState?.sheets[0];
    if (!initialSheet) throw new Error("expected sheet");
    const initialRowIds = new Set(initialSheet.rowIds);

    useEditorStore.getState().insertRow("Sheet", "body", 3, 1);
    const afterInsertSheet = useEditorStore.getState().docState?.sheets[0];
    if (!afterInsertSheet) throw new Error("expected sheet after insert");
    const insertedRowId = afterInsertSheet.rowIds.find((rowId) => !initialRowIds.has(rowId));
    if (insertedRowId === undefined) throw new Error("expected inserted row id");
    const dataColId = afterInsertSheet.colIds[1];

    useEditorStore.getState().setRegion(
      {
        sheet: "Sheet",
        start: { rowId: insertedRowId, colId: dataColId },
        end: { rowId: insertedRowId, colId: dataColId },
      },
      [["77"]],
    );
    const afterEdit = canonicalStoreDocument();

    useEditorStore.getState().undo();
    useEditorStore.getState().undo();
    expect(canonicalStoreDocument()).toBe(before);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().docState?.sheets[0]?.rowIds).toContain(insertedRowId);
    useEditorStore.getState().redo();
    expect(canonicalStoreDocument()).toBe(afterEdit);
  });

  it("restores the active sheet recorded by history entries", () => {
    const multiSheet = `${TEST_DOC}

# Other
| Item || 2024 |
| ---- || ---- |
| A    || 1    |
`;
    resetStore(multiSheet);
    useEditorStore.getState().setActiveSheet("Sheet");
    useEditorStore.getState().renameSheet("Sheet", "Renamed");
    expect(useEditorStore.getState().activeSheet).toBe("Renamed");

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().activeSheet).toBe("Sheet");

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().activeSheet).toBe("Renamed");
  });
});
