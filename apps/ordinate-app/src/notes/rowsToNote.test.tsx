import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DocumentState, serializeSheetNote } from "@ordinate/core";
import { RowsToNoteMenuItem } from "./RowsToNoteMenuItem";
import { getRowsToNoteRange, rowsToNoteAction } from "./useRowsToNoteCommand";
import { makeRangeSelection, makeRowSelection } from "../utils/selectionModel";
import { useEditorStore } from "../store/editorStore";

describe("row-to-note context action", () => {
  it("uses the full mixed row selection and hides unsupported conversion without an explanation", () => {
    expect(getRowsToNoteRange(makeRowSelection(1,3),2)).toEqual({first:0,last:2});
    const document = DocumentState.fromText('# Data\n| Header |\n|---|\n| 2 |\n| End |');
    expect(rowsToNoteAction(document,"Data",0,1,vi.fn())).toBeNull();
  });
  it("still offers a valid text-only mixed prefix using the core conversion plan", () => {
    const document = DocumentState.fromText('# Data\n| Header |\n|---|\n| Intro |\n| 2 |');
    const run = vi.fn();
    rowsToNoteAction(document,"Data",0,1,run)!.run();
    expect(run).toHaveBeenCalledWith(document.sheets[0].rowIds.slice(0,2));
  });
  it("uses zero-based core indices for full-width cell selections, including headers", () => {
    const selection = makeRangeSelection({rAbs:1,cAbs:0},{rAbs:2,cAbs:1});
    expect(getRowsToNoteRange(selection,2)).toEqual({first:0,last:1});
    expect(getRowsToNoteRange(selection,3)).toBeNull();
  });
  it("offers matching before/after actions, but not an interior selection", () => {
    const document = DocumentState.fromText('# Data\n| Intro |\n| 2 |\n| Footer |');
    expect(rowsToNoteAction(document,"Data",0,0,vi.fn())?.label).toBe('Convert to note before table');
    expect(rowsToNoteAction(document,"Data",2,2,vi.fn())?.label).toBe('Convert to note after table');
    expect(rowsToNoteAction(document,"Data",1,1,vi.fn())).toBeNull();
  });
  it("passes stable selected row identities to one command", () => {
    const document = DocumentState.fromText('# Data\n| Intro |\n| Detail |\n| 2 |');
    const run = vi.fn();
    rowsToNoteAction(document,"Data",0,1,run)!.run();
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(document.sheets[0].rowIds.slice(0,2));
  });
  it.each([
    '# Data\n| Intro |',
    '# Data\n| Intro |\n| Detail |\n| Footer |',
    '# Data\nIntro note.\n\n| 2 |\n| = A1 |',
  ])("hides the action and explanation when every row is selected", source => {
    const document = DocumentState.fromText(source);
    const run = vi.fn();
    const action = rowsToNoteAction(document,"Data",0,document.sheets[0].rowCount-1,run);
    expect(action).toBeNull();
    expect(renderToStaticMarkup(<RowsToNoteMenuItem action={action} />)).toBe('');
    expect(run).not.toHaveBeenCalled();
  });
  it("uses Add to for an existing note without mutating it during preview", () => {
    const document = DocumentState.fromText('# Data\nOriginal.\n\n| Intro |\n| 2 |');
    expect(rowsToNoteAction(document,"Data",0,0,vi.fn())?.label).toBe('Add to note before table');
    expect(serializeSheetNote(document.sheets[0].getSheetNote('beforeTable'))).toBe('Original.');
  });
  it.each([
    ['# Data\n| 2 |\n| 3 |','Only text'],
    ['# Data\n| Intro |\n| = A1 |','Referenced by'],
  ])("disables an unsafe selection and explains why", (source,message) => {
    const run = vi.fn();
    const action = rowsToNoteAction(DocumentState.fromText(source),"Data",0,0,run)!;
    expect(action.disabledReason).toContain(message);
    const html = renderToStaticMarkup(<RowsToNoteMenuItem action={action} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('rows-to-note-reason');
    expect(html).toContain(message);
    expect(run).not.toHaveBeenCalled();
  });
  it("shares the normal menu semantics for enabled actions and renders nothing for non-edge rows", () => {
    const action = rowsToNoteAction(DocumentState.fromText('# Data\n| Intro |\n| 2 |'),"Data",0,0,vi.fn())!;
    const html = renderToStaticMarkup(<RowsToNoteMenuItem action={action} />);
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('menu-surface-option-icon');
    expect(html).toContain('viewBox="0 0 20 20" aria-hidden="true"');
    expect(html).not.toContain('disabled');
    expect(renderToStaticMarkup(<RowsToNoteMenuItem action={null} />)).toBe('');
  });
  it("records one history entry for content transfer, and restores rows and note on undo/redo", () => {
    const source = '# Data\nOriginal intro.\n\n| Intro |\n| 2 |';
    useEditorStore.getState().replaceDocumentText(source);
    const store = useEditorStore.getState();
    const rowIds = [store.docState!.sheets[0].rowIds[0]];
    store.applyCoreEdits('Convert rows to sheet note',[{op:'convert_rows_to_note',sheet:'Data',rowIds}]);
    expect(useEditorStore.getState().historyCursor).toBe(1);
    expect(useEditorStore.getState().docState!.sheets[0].rowCount).toBe(1);
    expect(serializeSheetNote(useEditorStore.getState().docState!.sheets[0].getSheetNote('beforeTable'))).toBe('Original intro.\n\nIntro');
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().docState!.sheets[0].rowCount).toBe(2);
    expect(serializeSheetNote(useEditorStore.getState().docState!.sheets[0].getSheetNote('beforeTable'))).toBe('Original intro.');
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().docState!.sheets[0].rowCount).toBe(1);
  });
});
