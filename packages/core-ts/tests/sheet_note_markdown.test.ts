import { describe, expect, it } from "vitest";
import { DocumentState, SheetNoteError, applyBatchWithUndo, applyCoreEditMemento, matchNoteListItem, parseSheetNote, serializeDocumentState, serializeSheetNote, validateDocument } from "../src";

function roundTrip(source:string) {
  const note=parseSheetNote(source),canonical=serializeSheetNote(note);
  expect(parseSheetNote(canonical)).toEqual(note);
  expect(serializeSheetNote(parseSheetNote(canonical))).toBe(canonical);
  return note;
}

describe("note list and rule boundaries", () => {
  it.each(['- ', '+ ', '* ', '1. ', '3) ', '-\t', '-    '])('recognizes an unfinished editor list item %j without admitting it as saved Markdown', source => {
    expect(matchNoteListItem(source)).toMatchObject({content:''});
    expect(()=>parseSheetNote(source)).toThrow(SheetNoteError);
  });
  it.each(['---', '- - -', '* * *', '___', '1.23', '1.One', '    - Nested', '1.     Code', '1234567890. Long'])('does not confuse %j with a supported editor list marker', source => {
    expect(matchNoteListItem(source)).toBeNull();
  });
  it.each(['1. One\n2. **Two**','1) One\n2) *Two*','7. One\n99. Two','0. Zero','0003. Three','999999999. One\n1. Two'])('round trips numbered lists %j', source=>{
    expect(roundTrip(source).blocks[0].kind).toBe('orderedList');
  });
  it('retains the starting number, while subsequent markers follow Markdown numbering',()=>{
    expect(parseSheetNote('7. First\n1. Next')).toEqual({blocks:[{kind:'orderedList',start:7,items:[[{kind:'text',text:'First'}],[{kind:'text',text:'Next'}]]}]});
  });
  it.each(['- Item','+ Item','* Item','-  Item','1.  Item','1)\tItem'])('accepts flat list marker spacing %j',source=>{
    expect(roundTrip(source).blocks[0].kind).toMatch(/^(list|orderedList)$/);
  });
  it('keeps list families and delimiter changes separate',()=>{
    expect(roundTrip('- Bullet\n+ Another\n1. Number\n2) Other\n\nParagraph').blocks.map(block=>block.kind)).toEqual(['list','list','orderedList','orderedList','paragraph']);
  });
  it.each(['---','----','-----','----------','***','___','* * *','- - -','_ _ _','   -----','-----   ','***\t'])('accepts a rule %j, including at note edges',source=>{
    expect(roundTrip(source)).toEqual({blocks:[{kind:'rule'}]});
    expect(serializeSheetNote(parseSheetNote(source))).toBe('---');
    expect(roundTrip('Before\n'+source+'\nAfter').blocks.map(block=>block.kind)).toEqual(['paragraph','rule','paragraph']);
  });
  it('gives rules precedence over list markers and emphasis, with identical separator semantics',()=>{
    expect(roundTrip('1. Left\n\n---\n\nRight\n\n-----\n\n* Last').blocks.map(block=>block.kind)).toEqual(['orderedList','rule','paragraph','rule','list']);
    expect(roundTrip('***Both***').blocks[0].kind).toBe('paragraph');
  });
  it.each(['1.23','1.one','2026-01-01','--- not a rule','a ----- b','account_name','1234567890. Account'])('does not misclassify ordinary text %j',source=>{
    expect(roundTrip(source).blocks.every(block=>block.kind==='paragraph')).toBe(true);
  });
  it.each([String.raw`\-----`,String.raw`\- - -`,String.raw`\*\*\*`,String.raw`1\. Literal`,String.raw`2\) Literal`,String.raw`\<ol\>literal\</ol\>`])('keeps escaped structures literal %j',source=>{
    expect(roundTrip(source).blocks.every(block=>block.kind==='paragraph')).toBe(true);
  });
  it.each(['1.     Indented code','    -----','1. <script>bad</script>','+ [link](url)','* `code`'])('still rejects unsupported structure %j',source=>{
    expect(()=>parseSheetNote(source)).toThrow(SheetNoteError);
  });
  it.each([-1,1.5,1000000000,NaN,Infinity,undefined,'1'])('rejects malformed ordered list start %j',start=>{
    expect(()=>serializeSheetNote({blocks:[{kind:'orderedList',start,items:[[{kind:'text',text:'Item'}]]}]} as never)).toThrow(SheetNoteError);
  });
  it('rejects an empty structured ordered list',()=>{
    expect(()=>serializeSheetNote({blocks:[{kind:'orderedList',start:1,items:[]}]})).toThrow(SheetNoteError);
  });
  it.each(['beforeTable','afterTable'] as const)('preserves lists and rules in %s through save, reload and undo',position=>{
    const original=DocumentState.fromText('# Data\n| 2 | 3 | = A1 + B1 |'),syntax='3. **First**\n4. Second\n\n-----\n\n* Footer';
    const result=applyBatchWithUndo(original,[{op:'set_sheet_note',sheet:'Data',position,markdown:syntax}]);
    if(!result.ok) throw new Error(JSON.stringify(result));
    const output=serializeDocumentState(result.nextDocument),reopened=DocumentState.fromText(output);
    expect(reopened.sheets[0].getSheetNote(position)).toEqual(parseSheetNote(syntax));
    expect(validateDocument(output).ok).toBe(true);
    expect(serializeDocumentState(reopened)).toBe(output);
    const undone=applyCoreEditMemento(result.nextDocument,result.memento,'undo');
    if(!undone.ok) throw new Error(JSON.stringify(undone));
    expect(undone.nextDocument.sheets[0].getSheetNote(position)).toEqual({blocks:[]});
    expect(reopened.sheets[0].cells).toEqual(original.sheets[0].cells);
  });
});

describe('note editor literal authoring policy', () => {
  const literal = (source: string) => parseSheetNote(source, {unsupportedSyntax:'literal'});
  it.each([
    '# Heading', '## Heading', '> Quote', '| A | B |',
    '<ol><li>First</li></ol>', '<script>alert(1)</script>',
    '[label](https://example.invalid)', '![image](url)', '`code`', '```js',
    '~~strike~~', '_italic_', '**unclosed', '*unclosed', '** padded**', '**padded **',
    String.raw`C:\reports`, 'text\\', 'text\\q', '-', '+', '1.', '1)', '1.     Code',
    '    - Nested', '\t-\tNested', '    2) Nested', '\t2)\tNested',
    '    -----', '    - - -', '    ***', 'text  ', '-\u00a0Nested', '2)\u00a0Nested',
  ])('escapes unsupported %j into round-trippable ordinary text', source => {
    const note = literal(source), canonical = serializeSheetNote(note);
    expect(note).toEqual({blocks:[{kind:'paragraph',children:[{kind:'text',text:source.trim()}]}]});
    expect(parseSheetNote(canonical)).toEqual(note);
    expect(serializeSheetNote(parseSheetNote(canonical))).toBe(canonical);
  });
  it('preserves supported blocks when another block uses unsupported syntax', () => {
    const note = literal('**Title**\n\n1. **First**\n2. [link](url)\n\n-----\n\n# Literal heading');
    expect(note.blocks.map(block=>block.kind)).toEqual(['paragraph','orderedList','rule','paragraph']);
    expect(note.blocks[0]).toMatchObject({children:[{kind:'strong'}]});
    expect(note.blocks[1]).toMatchObject({items:[[{kind:'strong'}],[{kind:'text',text:'[link](url)'}]]});
    expect(parseSheetNote(serializeSheetNote(note))).toEqual(note);
  });
  it('makes nested content ordinary text and separates list continuations', () => {
    const note = literal('- First\n  - Nested\n\n1. First\ncontinuation');
    expect(note.blocks.map(block=>block.kind)).toEqual(['list','paragraph','orderedList','paragraph']);
    expect(parseSheetNote(serializeSheetNote(note))).toEqual(note);
  });
  it.each([null, undefined, 42, {}, 'text\u0000', 'text\u000b', 'text\u001f'])('still fails early on invalid data %j', source => {
    expect(()=>literal(source as never)).toThrow(SheetNoteError);
  });
  it.each(['beforeTable','afterTable'] as const)('saves, reloads and undoes escaped %s without changing tables or sheets', position => {
    const original = DocumentState.fromText('# Data\n| 2 | 3 | = A1 + B1 |');
    const note = literal('# Not a new sheet\n\n| Not | a table |\n\n<script>literal</script>');
    const result = applyBatchWithUndo(original, [{op:'set_sheet_note',sheet:'Data',position,markdown:serializeSheetNote(note)}]);
    if (!result.ok) throw new Error(JSON.stringify(result));
    const saved = serializeDocumentState(result.nextDocument), reopened = DocumentState.fromText(saved);
    expect(reopened.sheets).toHaveLength(1);
    expect(reopened.sheets[0].cells).toEqual(original.sheets[0].cells);
    expect(reopened.sheets[0].getSheetNote(position)).toEqual(note);
    expect(validateDocument(saved).ok).toBe(true);
    const undo = applyCoreEditMemento(result.nextDocument, result.memento, 'undo');
    if (!undo.ok) throw new Error(JSON.stringify(undo));
    expect(serializeDocumentState(undo.nextDocument)).toBe(serializeDocumentState(original));
  });
});
