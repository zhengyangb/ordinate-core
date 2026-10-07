import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeStorage } from "../../desktop/fileStorage";
import { watchDocument } from "../../desktop/fileWatcher";
import { startFileSync } from "../platform/fileSync";
import type { StorageAdapter } from "../platform/storage";
import { createFileSessionStore, createMemoryLocalDraftStore, getPersistableText } from "../store/fileSessionStore";
import { useSheetViewModel } from "../hooks/useSheetViewModel";
import { useEditorStore } from "../store/editorStore";
import { buildDocumentSearchCells, findDocumentMatches } from "./searchModel";
import { createCellDisplayFormatter } from "../preferences/temporalDisplay";
const displayCell = createCellDisplayFormatter("locale", "en-US");

describe("document-wide search", () => {
  const document = `# First
| Item || Value |
| ---- || ----- |
| Revenue || 123 |

# Second
| Item || Value |
| ---- || ----- |
| Revenue || 456 |`;
  beforeEach(() => useEditorStore.getState().replaceDocumentText(document));
  const search = () => findMatches(buildDocumentSearchCells(useEditorStore.getState(), "en-US", displayCell), "Revenue", false);
  it("indexes every sheet with unique stable IDs and sheet-local coordinates", () => {
    const matches = search();
    expect(matches.map(match => match.sheet)).toEqual(["First", "Second"]);
    expect(new Set(matches.map(match => match.id)).size).toBe(2);
    expect(matches[0].row).toBe(matches[1].row);
    useEditorStore.getState().setActiveSheet("Second");
    expect(search()).toEqual(matches);
  });
  it("updates inactive sheet results after edits and undo", () => {
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Second", rowIndex: 1, colIndex: 0 }, "Costs");
    expect(search().map(match => match.sheet)).toEqual(["First"]);
    useEditorStore.getState().undo();
    expect(search()).toHaveLength(2);
  });
  it("switches scope without changing the query and follows the current sheet", () => {
    const cells = buildDocumentSearchCells(useEditorStore.getState(), "en-US", displayCell);
    expect(findDocumentMatches(cells, "Revenue", false, "all", "First").map(match => match.sheet)).toEqual(["First", "Second"]);
    expect(findDocumentMatches(cells, "Revenue", false, "current", "First").map(match => match.sheet)).toEqual(["First"]);
    expect(findDocumentMatches(cells, "Revenue", false, "current", "Second").map(match => match.sheet)).toEqual(["Second"]);
    expect(findDocumentMatches(cells, "123", false, "current", "Second")).toEqual([]);
    expect(findDocumentMatches(cells, "123", false, "all", "Second")).toHaveLength(1);
    expect(findDocumentMatches(cells, "revenue", true, "current", "Second")).toEqual([]);
    expect(findDocumentMatches(cells, "", false, "current", "First")).toEqual([]);
  });
  it("recalculates current-sheet results after editing and undo", () => {
    const current = () => findDocumentMatches(buildDocumentSearchCells(useEditorStore.getState(), "en-US", displayCell), "Revenue", false, "current", "Second");
    expect(current()).toHaveLength(1);
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Second", rowIndex: 1, colIndex: 0 }, "Costs");
    expect(current()).toEqual([]);
    useEditorStore.getState().undo();
    expect(current()).toHaveLength(1);
  });
});
import type { HeaderOverlayCell } from "../types/ui";
import { buildSearchCells, findMatches, resolveActiveMatch, stepMatch, type SearchCell } from "./searchModel";

const cell = (text: string, id = "1:1"): SearchCell => ({ id, row: 1, col: 0, text });
describe("literal displayed-value search", () => {
  it("handles empty and unmatched queries", () => {
    expect(findMatches([cell("Revenue")], "", false)).toEqual([]);
    expect(findMatches([cell("Revenue")], "missing", false)).toEqual([]);
  });
  it("counts cells, but marks every occurrence, with optional case sensitivity", () => {
    expect(findMatches([cell("Revenue revenue")], "Revenue", false)[0].ranges).toEqual([{ start: 0, end: 7 }, { start: 8, end: 15 }]);
    expect(findMatches([cell("Revenue revenue")], "Revenue", true)[0].ranges).toHaveLength(1);
  });
  it("treats regex syntax as literal text and preserves Unicode offsets", () => {
    expect(findMatches([cell("[a]+ ($) \\ .*")], "[a]+", false)[0].ranges).toEqual([{ start: 0, end: 4 }]);
    expect(findMatches([cell("İ 你好 🙂 Café café")], "café", false)[0].ranges).toEqual([{ start: 8, end: 12 }, { start: 13, end: 17 }]);
    expect(findMatches([cell("İx")], "x", false)[0].ranges).toEqual([{ start: 1, end: 2 }]);
    expect(findMatches([cell("a\nb")], "\n", false)[0].ranges).toEqual([{ start: 1, end: 2 }]);
  });
  it("wraps both ways and reconciles deleted or reordered active results", () => {
    const matches = findMatches([cell("a", "a"), cell("a", "b")], "a", false);
    expect(resolveActiveMatch(matches, "b")).toBe(1);
    expect(resolveActiveMatch([...matches].reverse(), "b")).toBe(0);
    expect(resolveActiveMatch(matches.slice(0, 1), "b")).toBe(0);
    expect(resolveActiveMatch([], "b")).toBe(-1);
    expect(stepMatch(1, 2, 1)).toBe(0);
    expect(stepMatch(0, 2, -1)).toBe(1);
    expect(stepMatch(-1, 0, 1)).toBe(-1);
  });
  it("indexes a visually merged header exactly once", () => {
    const header: HeaderOverlayCell = { key: "h", rowNumber: 1, label: "2025", startCol: 1, endCol: 3, left: 0, width: 300, top: 0, height: 40 };
    const cells = buildSearchCells([], [header], [10, 11, 12, 13], [20], "en-US");
    expect(findMatches(cells, "2025", false)).toMatchObject([{ id: "20:11", row: 1, col: 1 }]);
    expect(cells).toHaveLength(1);
  });
});

const source = `# Sheet
| Item || Amount | Description |
| ---- || ------ | ----------- |
| Group || | |
| * A || 12.34 | Revenue |
| * B || 56 | Revenue total |`;
function index() {
  let projection!: ReturnType<typeof useSheetViewModel>;
  function Harness() { projection = useSheetViewModel({ ...useEditorStore.getState(), displayCell }); return null; }
  renderToStaticMarkup(<Harness />);
  const sheet = projection.currentSheetState!;
  return buildSearchCells(projection.allRowData, [], sheet.colIds, sheet.rowIds, "en-US");
}
describe("live search over the editor's projection", () => {
  beforeEach(() => useEditorStore.getState().replaceDocumentText(source));
  const find = (query = "Revenue") => findMatches(index(), query, false);
  it("updates after an edit, undo and redo without maintaining a second document", () => {
    expect(find()).toHaveLength(2);
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 2 }, "Costs");
    expect(find()).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(find()).toHaveLength(2);
    useEditorStore.getState().redo();
    expect(find()).toHaveLength(1);
  });
  it("follows stable identities through row and column insertions, then removes deleted matches", () => {
    const before = find()[0];
    useEditorStore.getState().insertRow("Sheet", "body", 2, 1);
    useEditorStore.getState().insertColumn("Sheet", 1);
    expect(find()[0]).toMatchObject({ id: before.id, row: before.row + 1, col: before.col + 1 });
    const sheet = useEditorStore.getState().docState!.sheets[0];
    useEditorStore.getState().deleteRow("Sheet", sheet.rowIds[find()[0].row - 1]);
    expect(find()).toHaveLength(1);
    useEditorStore.getState().deleteColumn("Sheet", 3);
    expect(find()).toHaveLength(0);
  });
  it("reflects an external replacement, even when the matching text disappears entirely", () => {
    const previous = find()[0].id;
    useEditorStore.getState().replaceDocumentText(source.replaceAll("Revenue", "Costs"), { preserveView: true });
    expect(find()).toEqual([]);
    expect(resolveActiveMatch(find(), previous)).toBe(-1);
    expect(find("Costs")).toHaveLength(2);
  });
  it("searches rendered numeric values and includes child rows", () => {
    expect(find("12.34")[0]).toMatchObject({ row: 3, col: 1, text: "12.34", rowPath: "Group.A" });
    expect(find().map(match => match.rowPath)).toEqual(["Group.A", "Group.B"]);
  });
  it("searches boolean capsules and localized error labels rather than internal error codes", () => {
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "=1/0");
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 3, colIndex: 1 }, "true");
    expect(find("Divide by Zero")).toHaveLength(1);
    expect(find("true")).toHaveLength(1);
  });
  it("updates search through the desktop watcher after an external atomic replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ordinate-search-test-"));
    let dispose: (() => void) | undefined;
    try {
      const filename = join(directory, "document.ord");
      await writeFile(filename, source);
      const native = createNativeStorage({ open: async () => filename, save: async () => filename });
      const adapter: StorageAdapter = {
        ...native, kind: "electron",
        capabilities: () => ({ canWatchBackingFile: true, canReadCurrentBackingFile: true, canAutosaveToBackingFile: true, canAtomicCompareAndWrite: false }),
        watch: (file, notify) => watchDocument(native.documentPath(file), notify),
      };
      const store = createFileSessionStore({ adapter, localDraftStore: createMemoryLocalDraftStore(), editor: {
        getPersistableText: () => getPersistableText(useEditorStore.getState()),
        replaceDocumentText: (text, options) => useEditorStore.getState().replaceDocumentText(text, options),
      } });
      await store.getState().open();
      const sync = startFileSync(store, adapter, () => false);
      dispose = sync.dispose;
      expect(find()).toHaveLength(2);
      const replacement = join(directory, "replacement.tmp");
      await writeFile(replacement, source.replace("Revenue total", "Expenses total"));
      await rename(replacement, filename);
      await vi.waitFor(() => expect(find()).toHaveLength(1));
      expect(find("Expenses")).toHaveLength(1);
      expect(store.getState().conflict).toBeNull();
      await writeFile(replacement, source.replaceAll("Revenue", "Expenses"));
      await rename(replacement, filename);
      await vi.waitFor(() => expect(find()).toHaveLength(0));
      expect(find("Expenses")).toHaveLength(2);
      expect(store.getState().conflict).toBeNull();
    } finally {
      dispose?.();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
