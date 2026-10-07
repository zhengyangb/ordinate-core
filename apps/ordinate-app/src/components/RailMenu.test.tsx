import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DocumentState } from "@ordinate/core";
import RailMenu from "./RailMenu";
import { buildRailMenu, resolveColumnHeaderAction } from "../utils/appHelpers";
import { useEditorStore } from "../store/editorStore";
import type { RailMenuView, SheetSelection } from "../types/ui";
import { makeRowSelection } from "../utils/selectionModel";

vi.mock("./RailMenuDetailPanel", () => ({default: () => null}));

const columns = (first: number, last: number): SheetSelection => ({
  kind: "column", colIndex: last, anchorColIndex: first, colStart: first, colEnd: last,
});

function renderRailMenu(menu: RailMenuView | null) {
  return renderToStaticMarkup(<RailMenu
    rowNoteMenuItem={null} open position={{top:0,left:0}} railMenu={menu} railMenuRef={createRef()}
    onInsertRowAbove={vi.fn()} onInsertRowBelow={vi.fn()} onDeleteRow={vi.fn()}
    onInsertColumnLeft={vi.fn()} onInsertColumnRight={vi.fn()} onDuplicateColumn={vi.fn()}
    onDeleteColumn={vi.fn()} onDuplicateRow={vi.fn()} onConvertRowsToHeader={vi.fn()} onConvertRowsToBody={vi.fn()}
    onSetHeaderColCount={vi.fn()} onSetColumnDefaultFormat={vi.fn()} onSetColumnDefaultStyle={vi.fn()}
    onSetRowDefaultFormat={vi.fn()} onSetRowDefaultStyle={vi.fn()}
  />);
}

describe("column header context actions", () => {
  it("promotes the selected leading columns, regardless of which selected column is right-clicked", () => {
    for (const index of [0, 1, 2]) {
      expect(resolveColumnHeaderAction(index, columns(0, 2), 0, 4)).toEqual({count: 3, label: "Use Columns as Headers"});
    }
  });

  it("promotes the first data column or the consecutive data prefix beside existing headers", () => {
    expect(resolveColumnHeaderAction(0, null, 0, 4)).toEqual({count: 1, label: "Use Column as Header"});
    expect(resolveColumnHeaderAction(1, null, 1, 4)).toEqual({count: 2, label: "Use Column as Header"});
    expect(resolveColumnHeaderAction(2, columns(1, 2), 1, 4)).toEqual({count: 3, label: "Use Columns as Headers"});
  });

  it("does not offer conversion for an interior column or a selection separated from the boundary", () => {
    expect(resolveColumnHeaderAction(2, null, 0, 4)).toBeNull();
    expect(resolveColumnHeaderAction(2, columns(1, 2), 0, 4)).toBeNull();
    expect(resolveColumnHeaderAction(0, null, 2, 4)).toBeNull();
  });

  it("ignores a selection when the right-click target is outside it", () => {
    expect(resolveColumnHeaderAction(0, columns(2, 3), 0, 4)).toEqual({count: 1, label: "Use Column as Header"});
    expect(resolveColumnHeaderAction(3, columns(0, 1), 0, 5)).toBeNull();
  });

  it("demotes only a trailing header column or suffix without leaving a gap", () => {
    expect(resolveColumnHeaderAction(1, null, 2, 4)).toEqual({count: 1, label: "Move Header Column to Data"});
    expect(resolveColumnHeaderAction(1, columns(0, 1), 2, 4)).toEqual({count: 0, label: "Move Header Columns to Data"});
  });

  it("disables conversion of every column and fails early for invalid geometry", () => {
    expect(resolveColumnHeaderAction(1, columns(0, 1), 0, 2)).toMatchObject({disabledReason: "Keep at least one data column."});
    expect(resolveColumnHeaderAction(0, null, 0, 1)).toMatchObject({disabledReason: "Keep at least one data column."});
    expect(() => resolveColumnHeaderAction(4, null, 0, 4)).toThrow("valid column");
    expect(() => resolveColumnHeaderAction(0, columns(0, 4), 0, 4)).toThrow("valid consecutive selection");
  });

  function renderMenu(colIndex: number, selection: SheetSelection | null, headerCount = 0) {
    const doc = DocumentState.fromText('# Data\n| "Sales" | "Group" | 12 |');
    const sheet = doc.sheets[0];
    sheet.setHeaderColumnCount(headerCount);
    const menu = buildRailMenu({kind: "column", colIndex}, 3, headerCount, null, sheet, null, [], selection);
    return renderRailMenu(menu);
  }

  it("renders conversion with normal menu semantics and hides it for interior columns", () => {
    const html = renderMenu(1, columns(0, 1));
    expect(html).toContain("Use Columns as Headers");
    expect(html).toContain('role="menuitem"');
    expect(renderMenu(1, null)).not.toContain("Use Column as Header");
    expect(renderMenu(0, columns(0, 2))).toContain('disabled="" title="Keep at least one data column."');
  });

  it("offers demotion on pinned headers without enabling unsupported deletion or insertion", () => {
    const html = renderMenu(1, null, 2);
    expect(html).toContain("Move Header Column to Data");
    expect(html).not.toContain("Delete Column");
    expect(html).not.toContain("Insert Left");
  });

  it("uses the existing structural edit, preserves formula targets, and supports undo/redo", () => {
    useEditorStore.getState().replaceDocumentText('# Data\n| "Sales" | "Group" | 12 | = C1+1 |');
    const originalIds = [...useEditorStore.getState().docState!.sheets[0].colIds];
    const action = resolveColumnHeaderAction(1, columns(0, 1), 0, 4)!;
    useEditorStore.getState().applyCoreEdits("Set header columns", [{op:"set_header_columns",sheet:"Data",count:action.count}]);
    const next = useEditorStore.getState().docState!;
    expect(next.sheets[0].headerColCount).toBe(2);
    expect(next.sheets[0].colIds).toEqual(originalIds);
    expect(next.evaluate().sheets[0].values[0][3]).toEqual({kind:"number",value:13});
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().docState!.sheets[0].headerColCount).toBe(0);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().docState!.sheets[0].headerColCount).toBe(2);
  });
});

describe("mixed row selection context actions", () => {
  const document = DocumentState.fromText('# Data\n| Header | Value |\n|---|---|\n| Intro | Detail |\n| End | 12 |');
  const sheet = document.sheets[0];
  const selection = makeRowSelection(1, 2);
  const menuFor = (rowNumber: number) => buildRailMenu(
    {kind:"row",rowNumber,area:rowNumber === 1 ? "header" : "body",hasChildren:false},
    2,0,null,sheet,null,[],selection,
  );

  it.each([1,2])("hides region-only actions from either selected rail without disabled explanations", rowNumber => {
    const menu = menuFor(rowNumber);
    expect(menu).toMatchObject({canEditRowRegion:false,canDisplayEdit:false,canConvertToHeader:false,canConvertToBody:false});
    const html = renderRailMenu(menu);
    expect(html).toContain("Insert Above");
    expect(html).toContain("Insert Below");
    for (const unavailable of ["Duplicate Row","Delete Row","Use Row as Header","Move Header Row to Body",">Format<",">Style<","disabled="]) {
      expect(html).not.toContain(unavailable);
    }
  });

  it("retains normal tools outside the mixed selection", () => {
    const menu = menuFor(3);
    expect(menu).toMatchObject({canEditRowRegion:true,canDisplayEdit:true});
    const html = renderRailMenu(menu);
    expect(html).toContain("Duplicate Row");
    expect(html).toContain("Delete Row");
    expect(html).toContain(">Format<");
  });
});
