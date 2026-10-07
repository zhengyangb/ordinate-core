import { describe, expect, it, vi } from "vitest";
import { parseSheetNote, serializeSheetNote } from "@ordinate/core";
import { insertNoteEnter, noteEnterEdit } from "./noteTextEditing";

const apply = (source: string, from = source.length, to = from) => {
  const edit = noteEnterEdit(source, from, to);
  return { source: source.slice(0, edit.from) + edit.text + source.slice(edit.to), caret: edit.from + edit.text.length };
};

describe('note Enter editing', () => {
  it.each(['', 'Paragraph', '**Bold**', '\\- Literal', '\\1. Literal', '1.23', 'account_name', '1234567890. Literal', '---', '-----', '* * *', '- - -', '_ _ _', '    - Nested'])('starts a paragraph after %j', source => {
    expect(apply(source)).toEqual({source: source + '\n\n', caret: source.length + 2});
  });
  it('splits a paragraph at the caret without deleting either side', () => {
    expect(apply('Hello world', 5)).toEqual({source:'Hello\n\n world',caret:7});
  });
  it('replaces a selection, retaining all unselected text', () => {
    expect(apply('Hello OLD world', 6, 10)).toEqual({source:'Hello \n\nworld',caret:8});
  });
  it.each(['- ', '+ ', '* ', '-  ', '-\t', '1. ', '3) ', '0. ', '999999999. '])('continues supported %j markers', prefix => {
    const source = prefix + 'Item';
    expect(apply(source)).toEqual({source:source + '\n' + prefix,caret:source.length + 1 + prefix.length});
  });
  it('splits an item at the caret and moves its suffix to the next item', () => {
    expect(apply('3) First second\n\nFooter', 9)).toEqual({source:'3) First \n3) second\n\nFooter',caret:13});
  });
  it('does not copy a marker when the caret is inside the marker', () => {
    expect(apply('1. Item', 1)).toEqual({source:'1\n\n. Item',caret:3});
  });
  it.each(['- ', '+ ', '* ', '1. ', '3) ', '-   ', '-\t'])('exits an empty %j item at the end', marker => {
    const source = '- First\n' + marker;
    expect(apply(source)).toEqual({source:'- First\n\n',caret:9});
  });
  it.each(['- ', '3) ', '-\t'])('clears a first empty %j item without creating another marker', source => {
    expect(apply(source)).toEqual({source:'',caret:0});
  });
  it('exits a middle empty item without deleting the following source', () => {
    expect(apply('- First\n- \nNext', 10)).toEqual({source:'- First\n\nNext',caret:8});
  });
  it('removes an entire empty marker when the caret is before trailing spacing', () => {
    expect(apply('- First\n-   \nNext', 10)).toEqual({source:'- First\n\nNext',caret:8});
  });
  it('uses the effective current line after a multi-line selection is replaced', () => {
    expect(apply('- First\nOLD\nsecond', 7, 12)).toEqual({source:'- First\n- second',caret:10});
  });
  it('inserts at the very beginning of a source starting with a newline', () => {
    expect(apply('\nParagraph', 0)).toEqual({source:'\n\n\nParagraph',caret:2});
  });
  it('creates source that saves as separate paragraphs', () => {
    const edited = apply('First').source + 'Second';
    expect(parseSheetNote(edited).blocks.map(block=>block.kind)).toEqual(['paragraph','paragraph']);
    expect(serializeSheetNote(parseSheetNote(edited))).toBe(edited);
  });
  it('continues Markdown numbering without creating separate ordered lists', () => {
    const edited = apply('7) First').source + 'Second';
    expect(parseSheetNote(edited)).toMatchObject({blocks:[{kind:'orderedList',start:7,items:[expect.any(Array),expect.any(Array)]}]});
  });
  it('keeps edits in the native undo buffer rather than replacing textarea.value', () => {
    const input = {
      value:'Text',selectionStart:4,selectionEnd:4,
      setSelectionRange:vi.fn(),ownerDocument:{execCommand:vi.fn(()=>true)},
    };
    insertNoteEnter(input as unknown as HTMLTextAreaElement);
    expect(input.setSelectionRange).toHaveBeenCalledWith(4,4);
    expect(input.ownerDocument.execCommand).toHaveBeenCalledWith('insertText',false,'\n\n');
    expect(input.value).toBe('Text');
  });
  it('fails early if the native text operation is rejected', () => {
    const input = {value:'Text',selectionStart:4,selectionEnd:4,setSelectionRange:vi.fn(),ownerDocument:{execCommand:()=>false}};
    expect(()=>insertNoteEnter(input as unknown as HTMLTextAreaElement)).toThrow('could not insert');
  });
});
