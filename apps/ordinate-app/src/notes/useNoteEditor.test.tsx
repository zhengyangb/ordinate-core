import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { serializeDocumentState } from "@ordinate/core";
import { useEditorStore } from "../store/editorStore";
import { readNote } from "./noteModel";
import { useNoteEditor } from "./useNoteEditor";

const source = '# Data\n| 2 | 3 | = A1 + B1 |';
beforeEach(() => useEditorStore.getState().replaceDocumentText(source));
function editor() {
  let value!: ReturnType<typeof useNoteEditor>;
  function Harness() { value = useNoteEditor(); return null; }
  renderToStaticMarkup(<Harness/>);
  value.begin(useEditorStore.getState().docState!.sheets[0].sheetId, 'beforeTable');
  return value;
}
const markdown = () => readNote(useEditorStore.getState().docState!.sheets[0], 'beforeTable').markdown;

describe('note editor commit boundary', () => {
  it.each(['<script>literal</script>', '# Not a sheet', '| Not | a table |', '[link](url)'])('saves unsupported %s as escaped text', draft => {
    const note = editor(); note.change(draft);
    expect(note.save()).toBe(true);
    expect(markdown()).toContain('\\');
    expect(useEditorStore.getState().docState!.sheets).toHaveLength(1);
    expect(useEditorStore.getState().docState!.sheets[0].rowCount).toBe(1);
    useEditorStore.getState().undo();
    expect(markdown()).toBe('');
  });
  it('commits escaped text through prepare before file commands', () => {
    const note = editor(); note.change('`literal`'); note.prepare();
    expect(markdown()).toBe('\\`literal\\`');
  });
  it('does not add history when canonical content is unchanged', () => {
    const note = editor(); note.change('First\n\n-----\n\nSecond'); note.save();
    const length = useEditorStore.getState().history.length;
    const same = editor(); same.save();
    expect(useEditorStore.getState().history).toHaveLength(length);
  });
  it('rejects invalid data, retaining the draft for repair', () => {
    const note = editor(); note.change('bad\u0000');
    expect(note.save()).toBe(false);
    expect(()=>note.prepare()).toThrow('Finish editing');
    expect(markdown()).toBe('');
    note.change('Repaired');
    expect(note.save()).toBe(true);
    expect(markdown()).toBe('Repaired');
  });
  it('does not literalize a conflict or overwrite another edit', () => {
    const note = editor(); note.change('<script>draft</script>');
    useEditorStore.getState().applyCoreEdits('External edit', [{op:'set_sheet_note',sheet:'Data',position:'beforeTable',markdown:'External'}]);
    expect(note.save()).toBe(false);
    expect(markdown()).toBe('External');
  });
  it('fails on a missing sheet without mutating the replacement document', () => {
    useEditorStore.getState().replaceDocumentText(source + '\n\n# Other\n| 8 |');
    const note = editor(); note.change('<b>draft</b>');
    useEditorStore.getState().deleteSheet('Data');
    const before = serializeDocumentState(useEditorStore.getState().docState!);
    expect(note.save()).toBe(false);
    expect(serializeDocumentState(useEditorStore.getState().docState!)).toBe(before);
  });
  it('repairs unsupported source even when the editor text is unchanged', () => {
    useEditorStore.getState().replaceDocumentText('# Data\n<script>literal</script>\n\n| 2 |');
    const note = editor();
    expect(note.save()).toBe(true);
    expect(markdown()).toBe(String.raw`\<script\>literal\</script\>`);
  });
});
