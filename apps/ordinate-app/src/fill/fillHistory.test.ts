import { describe, expect, it } from "vitest";
import { getCellTextView, serializeDocumentState, type CoreEdit } from "@ordinate/core";
import { useEditorStore } from "../store/editorStore";
import { excludedFillRows, resolveFillRowGroups } from "./fillRows";

describe("fill option replacement", () => {
  it("restores parent formulas and composes both row options in one undo entry", () => {
    const store = () => useEditorStore.getState();
    store().replaceDocumentText("# Sheet\n| Name || Value |\n| --- || --- |\n| A || 1 |\n| B || 2 |\n| Group || = 40 + 50 |\n| * Nested || 80 |\n| ** Leaf || 99 |\n| End || 88 |");
    const original = serializeDocumentState(store().docState!);
    const sheet = store().docState!.sheets[0];
    const cell = (r: number) => ({ rowId: sheet.rowIds[r], colId: sheet.colIds[1] });
    const groups = resolveFillRowGroups(sheet, { rowStart: 2, rowEnd: 7, colStart: 1, colEnd: 1 }, new Set([2, 3, 4, 7]));
    const edit = (parents: boolean, collapsed: boolean): CoreEdit => ({ op: "fill_region", mode: "auto",
      source: { sheet: sheet.name, start: cell(1), end: cell(2) }, target: { sheet: sheet.name, start: cell(3), end: cell(6) },
      excludedRowIds: excludedFillRows(groups, { parents, collapsed }).map(row => sheet.rowIds[row]),
    });
    const values = () => store().docState!.sheets[0].cells.slice(3).map(row => getCellTextView(row[1]).inputText);
    store().applyCoreEdits("Fill cells", [edit(true, true)]);
    const id = store().history[0].id;
    expect(values()).toEqual(["3", "4", "5", "6"]);
    store().applyCoreEdits("Fill cells", [edit(false, true)], undefined, id);
    expect(values()).toEqual(["= 40 + 50", "80", "3", "4"]);
    store().applyCoreEdits("Fill cells", [edit(false, false)], undefined, id);
    expect(values()).toEqual(["= 40 + 50", "80", "99", "3"]);
    store().applyCoreEdits("Fill cells", [edit(true, false)], undefined, id);
    expect(values()).toEqual(["3", "80", "99", "4"]);
    expect(store().history).toHaveLength(1);
    const final = serializeDocumentState(store().docState!);
    store().undo();
    expect(serializeDocumentState(store().docState!)).toBe(original);
    store().redo();
    expect(serializeDocumentState(store().docState!)).toBe(final);
  });
  it("restores hidden values, recomputes series and keeps a single undo/redo step", () => {
    const store = () => useEditorStore.getState();
    store().replaceDocumentText("# Sheet\n| 1 |\n| 2 |\n| 99 |\n| 80 |\n| 90 |");
    const original = serializeDocumentState(store().docState!);
    const sheet = store().docState!.sheets[0];
    const cell = (r: number) => ({ rowId: sheet.rowIds[r], colId: sheet.colIds[0] });
    const edit = (exclude: boolean): CoreEdit => ({ op: "fill_region", mode: "auto",
      source: { sheet: sheet.name, start: cell(0), end: cell(1) },
      target: { sheet: sheet.name, start: cell(2), end: cell(4) },
      excludedRowIds: exclude ? [sheet.rowIds[2]] : [],
    });
    const values = () => store().docState!.sheets[0].cells.map(row => getCellTextView(row[0]).inputText);
    store().applyCoreEdits("Fill cells", [edit(false)]);
    const id = store().history[0].id;
    expect(values()).toEqual(["1", "2", "3", "4", "5"]);
    useEditorStore.setState({ savedHistoryCursor: 1 });
    store().applyCoreEdits("Fill cells", [edit(true)], undefined, id);
    expect(values()).toEqual(["1", "2", "99", "3", "4"]);
    expect(store().savedHistoryCursor).toBe(-1);
    expect(store().history).toHaveLength(1);
    store().applyCoreEdits("Fill cells", [edit(false)], undefined, id);
    store().applyCoreEdits("Fill cells", [edit(true)], undefined, id);
    const final = serializeDocumentState(store().docState!);
    store().undo();
    expect(serializeDocumentState(store().docState!)).toBe(original);
    store().redo();
    expect(serializeDocumentState(store().docState!)).toBe(final);
    const current = store().docState;
    expect(() => store().applyCoreEdits("Fill cells", [{ ...edit(true), excludedRowIds: [-100] } as CoreEdit], undefined, id)).toThrow();
    expect(store().docState).toBe(current);
    expect(() => store().applyCoreEdits("Fill cells", [edit(false)], undefined, id + 100)).toThrow("stale");
  });
});
