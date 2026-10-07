import { describe, expect, it, beforeEach } from "vitest";
import { DocumentState, serializeDocumentState } from "@ordinate/core";
import { readNote, savesNote, distributeNoteScroll, noteColumns } from "./noteModel";
import { parseSheetNote } from "@ordinate/core";
import { useEditorStore } from "../store/editorStore";

const source = '# Report\n| 2 | 3 | = A1 + B1 |\n\n# Other\n| 4 |';
describe('sheet note UI model', () => {
  it('groups separator sections without losing rules, paragraphs or list order', () => {
    const columns=noteColumns(parseSheetNote('Left\n\n- One\n\n---\n\nRight'));
    expect(columns.map(column=>column.map(block=>block.kind))).toEqual([['paragraph','list'],['rule','paragraph']]);
  });
  it.each(['---', '-----', '***', '_ _ _'])('uses the same layout sections for %s', separator => {
    const note = parseSheetNote(`Left\n\n${separator}\n\nRight`);
    expect(noteColumns(note).map(column=>column.map(block=>block.kind))).toEqual([['paragraph'], ['rule','paragraph']]);
    expect(noteColumns(note).flat()).toEqual(note.blocks);
  });
  it.each(['---', '---\nLeft', 'Left\n---', '---\n---', 'Left\n---\n---\nRight\n---'])('does not manufacture empty columns or lose edge/consecutive rules %j', source => {
    const note = parseSheetNote(source), columns = noteColumns(note);
    expect(columns.flat()).toEqual(note.blocks);
    expect(columns.every(column=>column.length > 0)).toBe(true);
  });
  it('reads both sides without including the table', () => {
    const doc = DocumentState.fromText('# Report\n**Before**\n\n| 1 |\n\n- After');
    expect(readNote(doc.sheets[0], 'beforeTable').markdown).toBe('**Before**');
    expect(readNote(doc.sheets[0], 'afterTable').markdown).toBe('- After');
  });
  it('keeps invalid Markdown repairable instead of hiding it', () => {
    const doc = DocumentState.fromText('# Report\n<script>bad</script>\n\n| 1 |');
    expect(readNote(doc.sheets[0], 'beforeTable')).toMatchObject({markdown:'<script>bad</script>',note:null});
    expect(readNote(doc.sheets[0], 'beforeTable').error).toBeTruthy();
  });
  it.each(['beforeTable','afterTable'] as const)('reads an absent %s note as empty', position => {
    expect(readNote(DocumentState.fromText(source).sheets[0], position)).toEqual({markdown:'',note:{blocks:[]},error:null});
  });
  it.each([
    ['Enter',false,false,false,false,false],
    ['Enter',true,false,false,false,false],
    ['Enter',false,true,false,false,true],
    ['Enter',false,false,true,false,true],
    ['Escape',false,false,false,false,true],
    ['Enter',false,true,false,true,false],
    ['Escape',false,false,false,true,false],
    ['a',false,true,false,false,false],
  ] as const)('handles %s with modifiers %s/%s/%s and composition %s', (key,shiftKey,ctrlKey,metaKey,isComposing,expected) => {
    expect(savesNote({key,shiftKey,ctrlKey,metaKey,isComposing})).toBe(expected);
  });
  it.each([
    [60,0,100,0,60,0], [160,0,100,0,100,60], [60,100,100,20,100,60],
    [-60,100,100,0,40,0], [-160,100,100,0,0,-60], [-60,100,100,200,100,-60],
    [60,0,0,0,0,60], [-60,0,0,0,0,-60], [0,50,100,0,50,0],
  ])('routes wheel %s at intro %s/%s and grid %s', (delta,intro,max,grid,next,remaining) => {
    expect(distributeNoteScroll(delta,intro,max,grid)).toEqual({intro:next,remaining});
  });
});

describe('notes through editor history and persistence', () => {
  beforeEach(() => useEditorStore.getState().replaceDocumentText(source));
  it('keeps formula addresses and cells unchanged through edit, undo, redo and reload', () => {
    const original = structuredClone(useEditorStore.getState().docState!.sheets[0].cells);
    useEditorStore.getState().applyCoreEdits('Edit sheet note', [{op:'set_sheet_note',sheet:'Report',position:'beforeTable',markdown:'**Units**\n\n- Millions'}]);
    expect(useEditorStore.getState().docState!.sheets[0].cells).toEqual(original);
    expect(useEditorStore.getState().activeSheet).toBe('Report');
    const saved = serializeDocumentState(useEditorStore.getState().docState!);
    useEditorStore.getState().undo();
    expect(readNote(useEditorStore.getState().docState!.sheets[0],'beforeTable').markdown).toBe('');
    useEditorStore.getState().redo();
    expect(serializeDocumentState(useEditorStore.getState().docState!)).toBe(saved);
    useEditorStore.getState().replaceDocumentText(saved);
    expect(readNote(useEditorStore.getState().docState!.sheets[0],'beforeTable').markdown).toBe('**Units**\n\n- Millions');
    expect(useEditorStore.getState().docState!.sheets[0].cells).toEqual(original);
  });
  it('deletion is undoable without changing the other note', () => {
    for (const position of ['beforeTable','afterTable'] as const) useEditorStore.getState().applyCoreEdits('Edit sheet note', [{op:'set_sheet_note',sheet:'Report',position,markdown:position}]);
    useEditorStore.getState().applyCoreEdits('Delete sheet note', [{op:'set_sheet_note',sheet:'Report',position:'afterTable',markdown:''}]);
    expect(readNote(useEditorStore.getState().docState!.sheets[0],'afterTable').markdown).toBe('');
    expect(readNote(useEditorStore.getState().docState!.sheets[0],'beforeTable').markdown).toBe('beforeTable');
    useEditorStore.getState().undo();
    expect(readNote(useEditorStore.getState().docState!.sheets[0],'afterTable').markdown).toBe('afterTable');
  });
});
