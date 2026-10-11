import { beforeEach, describe, expect, it } from "vitest";

import { ORD_FORMAT_VERSION, serializeDocumentState, type FormatSpec } from "@ordinate/core";

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

describe("external document replacement", () => {
  it("opens front matter in table mode and keeps it through edits, history, and source-mode saves", () => {
    const metadata = "---\n# not a sheet\nfuture:\n  title: unknown field  \n---";
    const serializedMetadata = `---\nord-format: "${ORD_FORMAT_VERSION}"\n# not a sheet\nfuture:\n  title: unknown field  \n---`;
    useEditorStore.getState().replaceDocumentText(`${metadata}\n\n${TEST_DOC}`);
    expect(useEditorStore.getState()).toMatchObject({ mode: "table", error: null, activeSheet: "Sheet" });
    expect(useEditorStore.getState().docState?.frontMatter).toBe(metadata);
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "10");
    expect(canonicalStoreDocument().startsWith(`${serializedMetadata}\n\n`)).toBe(true);
    useEditorStore.getState().undo();
    expect(canonicalStoreDocument().startsWith(`${serializedMetadata}\n\n`)).toBe(true);
    useEditorStore.getState().redo();
    useEditorStore.getState().enterSourceMode();
    expect(useEditorStore.getState().sourceText.startsWith(`${serializedMetadata}\n\n`)).toBe(true);
    useEditorStore.getState().exitSourceMode();
    expect(useEditorStore.getState().docState?.frontMatter).toBe(metadata);
  });
  it("keeps the active sheet and drops obsolete undo entries", () => {
    const source = `${TEST_DOC}\n\n# Second\n| Item || Value |\n| B || 9 |\n`;
    useEditorStore.getState().replaceDocumentText(source);
    useEditorStore.getState().setActiveSheet("Second");
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Second", rowIndex: 1, colIndex: 1 }, "10");
    useEditorStore.getState().replaceDocumentText(source.replace("9", "11"), { preserveView: true });
    expect(useEditorStore.getState()).toMatchObject({ activeSheet: "Second", mode: "table", canUndo: false, canRedo: false });
  });
  it("preserves source mode and selects an existing sheet when the active sheet was removed", () => {
    useEditorStore.getState().replaceDocumentText(TEST_DOC);
    useEditorStore.getState().enterSourceMode();
    useEditorStore.getState().replaceDocumentText(TEST_DOC.replace("# Sheet", "# Renamed"), { preserveView: true });
    expect(useEditorStore.getState()).toMatchObject({ activeSheet: "Renamed", mode: "source" });
  });
});

describe("editor store history", () => {
  beforeEach(() => {
    resetStore();
  });

  it("applies an AI document rewrite as one undoable change and preserves earlier history", () => {
    const before = canonicalStoreDocument();
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "10");
    const edited = canonicalStoreDocument();
    const rewritten = edited.replace("| * B   || 3", "| * B   || 30");
    useEditorStore.getState().applyDocumentTextChange("AI edit", rewritten);
    expect(useEditorStore.getState()).toMatchObject({ undoLabel: "AI edit", canUndo: true });
    expect(canonicalStoreDocument()).toContain("| * B   || 30");
    useEditorStore.getState().undo();
    expect(canonicalStoreDocument()).toBe(edited);
    useEditorStore.getState().undo();
    expect(canonicalStoreDocument()).toBe(before);
    useEditorStore.getState().redo();
    useEditorStore.getState().redo();
    expect(canonicalStoreDocument()).toContain("| * B   || 30");
  });

  it("keeps exact source text through an AI rewrite, undo, and redo", () => {
    useEditorStore.getState().enterSourceMode();
    const before = `${TEST_DOC}\n\n`;
    const after = `${TEST_DOC.replace("| * B   || 3", "| * B   || 30")}\n\n`;
    useEditorStore.getState().setSourceText(before);
    useEditorStore.getState().applyDocumentTextChange("AI edit", after);
    expect(useEditorStore.getState()).toMatchObject({ mode: "source", sourceText: after });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().sourceText).toBe(before);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().sourceText).toBe(after);
  });

  it("focuses a newly proposed sheet and restores that focus through redo", () => {
    const before = canonicalStoreDocument();
    const after = `${before}\n# Assistant Demo\n| Item || Value |\n| --- || --- |\n| Revenue || 42 |\n`;
    useEditorStore.getState().applyDocumentTextChange("AI edit", after, "Assistant Demo");
    expect(useEditorStore.getState().activeSheet).toBe("Assistant Demo");
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().activeSheet).toBe("Sheet");
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().activeSheet).toBe("Assistant Demo");
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

  it("round-trips a literal boolean toggle without dropping display metadata", () => {
    resetStore(`
# Sheet
| Item    || Enabled |
| ------- || ------- |
| Product || true {::>,blue} |
`.trim());
    const store = useEditorStore.getState();
    const sheet = store.docState?.sheets[0];
    if (!sheet) throw new Error("expected boolean test sheet");
    const target = {
      kind: "index" as const,
      sheet: sheet.name,
      rowIndex: sheet.bodyStart,
      colIndex: 1,
    };
    const before = canonicalStoreDocument();

    store.setCellInput(target, "false");
    const after = canonicalStoreDocument();
    expect(after).toContain("false {::>,blue}");
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 1,
      canUndo: true,
      undoLabel: "Set cell input",
    });

    useEditorStore.getState().undo();
    expect(canonicalStoreDocument()).toBe(before);
    useEditorStore.getState().redo();
    expect(canonicalStoreDocument()).toBe(after);
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

  it("preserves app history when source mode exits without source changes", () => {
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "10");
    const before = canonicalStoreDocument();
    const startRevision = useEditorStore.getState().revision;
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 1,
      canUndo: true,
      isDirty: true,
    });

    useEditorStore.getState().enterSourceMode();
    useEditorStore.getState().exitSourceMode();

    expect(canonicalStoreDocument()).toBe(before);
    expect(useEditorStore.getState()).toMatchObject({
      mode: "table",
      historyCursor: 1,
      canUndo: true,
      canRedo: false,
      undoLabel: "Set cell input",
      redoLabel: null,
      isDirty: true,
      revision: startRevision,
    });
    expect(useEditorStore.getState().history).toHaveLength(1);
  });

  it("clears app history after changed source mode text reparses successfully", () => {
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "10");
    expect(useEditorStore.getState().canUndo).toBe(true);

    useEditorStore.getState().enterSourceMode();
    useEditorStore.getState().setSourceText(useEditorStore.getState().sourceText.replace("| * A   || 10", "| * A   || 11"));
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

  it("inserts multiple rows as one history command", () => {
    const before = canonicalStoreDocument();
    const beforeSheet = useEditorStore.getState().docState?.sheets[0];
    if (!beforeSheet) throw new Error("expected sheet");
    const beforeRowIds = new Set(beforeSheet.rowIds);

    useEditorStore.getState().insertRows("Sheet", "body", beforeSheet.rowIds.length, 3, 0);
    const after = canonicalStoreDocument();
    const afterSheet = useEditorStore.getState().docState?.sheets[0];
    if (!afterSheet) throw new Error("expected sheet after insert");
    const insertedRowIds = afterSheet.rowIds.filter((rowId) => !beforeRowIds.has(rowId));

    expect(insertedRowIds).toHaveLength(3);
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 1,
      undoLabel: "Insert rows",
    });

    useEditorStore.getState().undo();
    expect(canonicalStoreDocument()).toBe(before);

    useEditorStore.getState().redo();
    expect(canonicalStoreDocument()).toBe(after);
    expect(useEditorStore.getState().docState?.sheets[0]?.rowIds).toEqual(afterSheet.rowIds);
  });

  it("inserts multiple columns as one history command", () => {
    const before = canonicalStoreDocument();
    const beforeSheet = useEditorStore.getState().docState?.sheets[0];
    if (!beforeSheet) throw new Error("expected sheet");
    const beforeColIds = new Set(beforeSheet.colIds);

    useEditorStore.getState().insertColumns("Sheet", beforeSheet.colIds.length, 2);
    const after = canonicalStoreDocument();
    const afterSheet = useEditorStore.getState().docState?.sheets[0];
    if (!afterSheet) throw new Error("expected sheet after insert");
    const insertedColIds = afterSheet.colIds.filter((colId) => !beforeColIds.has(colId));

    expect(insertedColIds).toHaveLength(2);
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 1,
      undoLabel: "Insert columns",
    });

    useEditorStore.getState().undo();
    expect(canonicalStoreDocument()).toBe(before);

    useEditorStore.getState().redo();
    expect(canonicalStoreDocument()).toBe(after);
    expect(useEditorStore.getState().docState?.sheets[0]?.colIds).toEqual(afterSheet.colIds);
  });

  it("fails early for invalid batch insert counts", () => {
    const before = canonicalStoreDocument();
    expect(() => useEditorStore.getState().insertRows("Sheet", "body", 3, 0, 0)).toThrow(
      "insertRows requires a positive integer count",
    );
    expect(() => useEditorStore.getState().insertColumns("Sheet", 2, -1)).toThrow(
      "insertColumns requires a positive integer count",
    );
    expect(canonicalStoreDocument()).toBe(before);
    expect(useEditorStore.getState().history).toHaveLength(0);
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
