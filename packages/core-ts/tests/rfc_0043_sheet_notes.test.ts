import { describe, expect, it, vi } from "vitest";
import {
  DocumentState, SheetNoteError, applyBatchAtomic, applyBatchWithUndo, applyCoreEditMemento,
  evaluateAndFormatDocument, exportDelimitedSheet, exportExcelWorkbook, formatDocument,
  parseDocumentModel, parseSheetNote, serializeDocumentState, serializeSheetNote, validateDocument,
  type CoreEdit, type SheetNotePosition,
} from "../src";
import { cloneDocumentState } from "../src/document_clone";

const table = '| 2 | 3 | = A1 + B1 |';
const base = `# Data\n${table}\n\n# Other\n| = @["Data"::C1] * 2 |\n`;
const edit = (position: SheetNotePosition, markdown: string): CoreEdit => ({ op: 'set_sheet_note', sheet: 'Data', position, markdown });
function requireSuccess<T extends {ok:boolean}>(result:T): Extract<T,{ok:true}> {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T,{ok:true}>;
}
const noteText = (document:DocumentState, position:SheetNotePosition) => serializeSheetNote(document.sheets[0].getSheetNote(position));

describe('RFC-0043 restricted note syntax', () => {
  it('round trips separators without confusing table separators or front matter', () => {
    const note=parseSheetNote('Left\n\n---\n\n**Right**\n\n- Detail');
    expect(note.blocks[1]).toEqual({kind:'rule'});
    expect(serializeSheetNote(note)).toBe('Left\n\n---\n\n**Right**\n\n- Detail');
    const source='---\ntitle: test\n---\n\n# Data\nLeft\n\n---\n\nRight\n\n| A |\n| --- |\n| 1 |';
    const document=DocumentState.fromText(source);
    expect(document.frontMatter).toContain('title: test');
    expect(document.sheets[0].getSheetNote('beforeTable').blocks[1]).toEqual({kind:'rule'});
    expect(document.sheets[0].headerRowCount).toBe(1);
    expect(DocumentState.fromText(serializeDocumentState(document)).sheets[0].getSheetNote('beforeTable')).toEqual(document.sheets[0].getSheetNote('beforeTable'));
  });
  it.each(['---\nRight','Left\n---','Left\n---\n---\nRight'])('preserves edge and consecutive separators %j', source => {
    const note = parseSheetNote(source);
    expect(parseSheetNote(serializeSheetNote(note))).toEqual(note);
  });
  it('keeps escaped dashes as literal text, not a column break', () => {
    const note=parseSheetNote(String.raw`\---`);
    expect(note.blocks[0]).toMatchObject({kind:'paragraph'});
    expect(serializeSheetNote(note)).toBe(String.raw`\---`);
  });
  it.each([
    '', 'Plain text.', '中文备注：百万欧元 🌱', '**Units: EUR million.**', '*Unaudited*',
    '**Bold and *italic* text**', '*Italic and **bold** text*', '***Both***', '*one***two**',
    'First paragraph.\n\nSecond paragraph.', '- First\n- **Second**',
    'Intro\n\n- One\n- Two\n\nAfter.', '=SUM(A1:A3)', '2025-06-29',
    'https://example.invalid/source', 'account_name', String.raw`\# Not a sheet`,
    String.raw`\| not a table \|`, String.raw`\<script\> text \</script\>`,
    String.raw`\[link\](url) \*literal\* \_literal\_`, String.raw`C:\\reports`,
    String.raw`\- not a list`, String.raw`1\. not a numbered list`, String.raw`\---`,
  ])('round trips supported source %j', source => {
    const note=parseSheetNote(source), serialized=serializeSheetNote(note);
    expect(parseSheetNote(serialized)).toEqual(note);
    expect(serializeSheetNote(parseSheetNote(serialized))).toBe(serialized);
  });

  it('exposes structured paragraphs, list items and marks rather than duplicate Markdown',()=>{
    expect(parseSheetNote('Hello **world**.\n\n- *Note*')).toEqual({blocks:[
      {kind:'paragraph',children:[{kind:'text',text:'Hello '},{kind:'strong',children:[{kind:'text',text:'world'}]},{kind:'text',text:'.'}]},
      {kind:'list',items:[[{kind:'emphasis',children:[{kind:'text',text:'Note'}]}]]},
    ]});
  });

  it('normalizes soft wrapping and CRLF without creating hard breaks',()=>{
    expect(serializeSheetNote(parseSheetNote('First\r\nsecond\r\n\r\n- List'))).toBe('First second\n\n- List');
  });

  it.each([
    '# New Sheet', '## Heading', '| A | B |', '<script>alert(1)</script>',
    '[label](https://example.invalid)', '![image](url)', '`code`', '```js', '> Quote',
    '~~strike~~',
    '    code', '- First\n  - Nested', '- First\ncontinuation', '-  ', '- ',
    '1. ', '1) ', '1. First\n  2. Nested', '1. First\ncontinuation',
    '**unclosed', '*unclosed', '** padded**', '**padded **', '_italic_',
    'text  \nnext', 'text\\', 'text\\q', 'text\u0000',
  ])('rejects unsupported syntax in strict source parsing %j', source=>{
    expect(()=>parseSheetNote(source)).toThrow(SheetNoteError);
  });

  it.each([null,undefined,42,{},[]])('rejects non-text input %j',source=>{
    expect(()=>parseSheetNote(source as never)).toThrow('must be a string');
  });

  it.each([
    null, {}, {blocks:[{kind:'html',text:'<b>'}]},
    {blocks:[{kind:'columnBreak'}]},
    {blocks:[{kind:'paragraph',children:[]}]}, {blocks:[{kind:'list',items:[]}]},
    {blocks:[{kind:'paragraph',children:[{kind:'text',text:'one\ntwo'}]}]},
    {blocks:[{kind:'paragraph',children:[{kind:'text',text:' padded'}]}]},
    {blocks:[{kind:'paragraph',children:[{kind:'strong',children:[{kind:'text',text:' padded'}]}]}]},
  ])('fails early for malformed structured note %j',note=>{
    expect(()=>serializeSheetNote(note as never)).toThrow(SheetNoteError);
  });
});

describe('RFC-0043 document structure',()=>{
  it('preserves both positions, multiple sheets, front matter and formulas through formatting and save/reload',()=>{
    const source=`---\nowner: sample\n---\n# Data\n\n**Before**\n\n${table}\n\n- After\n\n# Other\n\n*Other intro*\n\n| = @["Data"::C1] * 2 |\n\nOther footer.\n`;
    const document=DocumentState.fromText(source);
    expect(validateDocument(source).ok).toBe(true);
    expect(noteText(document,'beforeTable')).toBe('**Before**');
    expect(noteText(document,'afterTable')).toBe('- After');
    const output=serializeDocumentState(document), reopened=DocumentState.fromText(output);
    expect(serializeDocumentState(reopened)).toBe(output);
    expect(formatDocument(formatDocument(source))).toBe(formatDocument(source));
    expect(reopened.frontMatter).toBe('---\nowner: sample\n---');
    expect(serializeSheetNote(reopened.sheets[1].getSheetNote('beforeTable'))).toBe('*Other intro*');
    expect(reopened.evaluate().sheets.map(sheet=>sheet.values)).toEqual(document.evaluate().sheets.map(sheet=>sheet.values));
    expect(evaluateAndFormatDocument(source)).toContain('**Before**');
    const ir=parseDocumentModel(output);
    expect(ir.sheets[0].notes.beforeTable.some(block=>block.kind==='note')).toBe(true);
    expect(ir.sheets[0].notes.afterTable.some(block=>block.kind==='note')).toBe(true);
    expect(ir.sheets[0].table?.columnCount).toBe(3);
  });

  it('keeps invalid source verbatim with a validation diagnostic and allows explicit replacement',()=>{
    const source=`# Data\n<script>unsafe</script>\n${table}\n`;
    const document=DocumentState.fromText(source);
    expect(serializeDocumentState(document)).toContain('<script>unsafe</script>');
    expect(validateDocument(source).errors).toContainEqual(expect.objectContaining({code:'invalid_sheet_note',sheet:'Data'}));
    expect(()=>document.sheets[0].getSheetNote('beforeTable')).toThrow(SheetNoteError);
    document.sheets[0].setSheetNote('beforeTable','Safe **text**');
    expect(validateDocument(serializeDocumentState(document)).ok).toBe(true);
  });

  it('does not silently fix unsupported trailing hard-break source during save',()=>{
    const source=`# Data\n${table}\n\nBad break  \n`;
    const document=DocumentState.fromText(source), output=serializeDocumentState(document);
    expect(output).toContain('Bad break  \n');
    expect(validateDocument(output).errors.some(error=>error.code==='invalid_sheet_note')).toBe(true);
    expect(formatDocument(output)).toBe(output);
  });

  it('escaped structural text stays a note, not a new table or sheet',()=>{
    const document=DocumentState.fromText(base);
    document.sheets[0].setSheetNote('beforeTable',String.raw`\# Heading`+'\n\n'+String.raw`\| cells \|`);
    const reopened=DocumentState.fromText(serializeDocumentState(document));
    expect(reopened.sheets).toHaveLength(2);
    expect(reopened.sheets[0].sourceBlocks.filter(block=>block.kind==='table')).toHaveLength(1);
    expect(reopened.sheets[0].rowCount).toBe(1);
  });

  it.each(['# Empty\nNotes only.', `# Multiple\n${table}\n\nNotes\n\n| 1 |`])('rejects ambiguous or missing table when editing notes', source=>{
    const document=DocumentState.fromText(source);
    expect(()=>document.sheets[0].setSheetNote('afterTable','New')).toThrow('exactly one nonempty table');
    expect(validateDocument(source).ok).toBe(false);
  });
});

describe('RFC-0043 note editing and history',()=>{
  it.each(['beforeTable','afterTable'] as const)('sets, reads and clears %s without mutating caller-owned state',position=>{
    const original=DocumentState.fromText(base);
    const applied=requireSuccess(applyBatchAtomic(original,[edit(position,'**A note**')]));
    expect(noteText(original,position)).toBe('');
    expect(noteText(applied.nextDocument,position)).toBe('**A note**');
    const detached=applied.nextDocument.sheets[0].getSheetNote(position);detached.blocks.length=0;
    expect(noteText(applied.nextDocument,position)).toBe('**A note**');
    const cleared=requireSuccess(applyBatchAtomic(applied.nextDocument,[edit(position,'')]));
    expect(noteText(cleared.nextDocument,position)).toBe('');
    expect(cleared.nextDocument.sheets[0].primaryTableBlockIndex).toBeGreaterThanOrEqual(0);
  });

  it('does not bind, recalculate, change references/IDs or dirty cached cells on edit, undo or redo',()=>{
    const document=DocumentState.fromText(base);document.evaluate();
    const before=document.sheets.map(sheet=>structuredClone({cells:sheet.cells,rows:sheet.rowIds,cols:sheet.colIds,views:sheet.viewDependencies}));
    const evaluate=vi.spyOn(DocumentState.prototype,'evaluate');
    const bind=vi.spyOn(DocumentState.prototype,'bindCrossSheetFormulas');
    try {
      const result=requireSuccess(applyBatchWithUndo(document,[edit('beforeTable','Intro'),edit('afterTable','- Footer')]));
      const undone=requireSuccess(applyCoreEditMemento(result.nextDocument,result.memento,'undo'));
      const redone=requireSuccess(applyCoreEditMemento(undone.nextDocument,result.memento,'redo'));
      for(const state of [result.nextDocument,undone.nextDocument,redone.nextDocument]){
        expect(state.sheets.map(sheet=>({cells:sheet.cells,rows:sheet.rowIds,cols:sheet.colIds,views:sheet.viewDependencies}))).toEqual(before);
      }
      expect(noteText(undone.nextDocument,'beforeTable')).toBe('');
      expect(noteText(redone.nextDocument,'afterTable')).toBe('- Footer');
      expect(evaluate).not.toHaveBeenCalled();expect(bind).not.toHaveBeenCalled();
    } finally {evaluate.mockRestore();bind.mockRestore();}
  });

  it('retains explicit recalculation and mixed cell/note batch history',()=>{
    const document=DocumentState.fromText(base);
    const result=requireSuccess(applyBatchWithUndo(document,[edit('beforeTable','Intro'),{op:'set_cell_input',target:{kind:'index',sheet:'Data',rowIndex:0,colIndex:0},input:'8'},edit('afterTable','End')],{recalculate:true}));
    expect(result.nextDocument.evaluate().sheets[0].values[0][2]).toEqual({kind:'number',value:11});
    const undone=requireSuccess(applyCoreEditMemento(result.nextDocument,result.memento,'undo',{recalculate:true}));
    expect(noteText(undone.nextDocument,'beforeTable')).toBe('');
    expect(undone.nextDocument.evaluate().sheets[1].values[0][0]).toEqual({kind:'number',value:10});
    const redone=requireSuccess(applyCoreEditMemento(undone.nextDocument,result.memento,'redo',{recalculate:true}));
    expect(noteText(redone.nextDocument,'afterTable')).toBe('End');
  });

  it('rolls back the whole batch on invalid note syntax',()=>{
    const document=DocumentState.fromText(base), before=serializeDocumentState(document);
    const result=applyBatchWithUndo(document,[edit('beforeTable','Good'),edit('afterTable','<html>')]);
    expect(result.ok).toBe(false);expect(serializeDocumentState(document)).toBe(before);
  });

  it('rejects invalid position, unknown sheet and stale history',()=>{
    const document=DocumentState.fromText(base);
    expect(applyBatchAtomic(document,[{...edit('beforeTable','Hi'),position:'middle'} as CoreEdit]).ok).toBe(false);
    expect(applyBatchAtomic(document,[{op:'set_sheet_note',sheet:'missing',position:'beforeTable',markdown:'Hi'}]).ok).toBe(false);
    const result=requireSuccess(applyBatchWithUndo(document,[edit('beforeTable','First')]));
    result.nextDocument.sheets[0].setSheetNote('beforeTable','Changed');
    expect(applyCoreEditMemento(result.nextDocument,result.memento,'undo').ok).toBe(false);
  });

  it('does not create history entries for an unchanged note',()=>{
    const document=DocumentState.fromText(base);
    document.sheets[0].setSheetNote('beforeTable','Same');
    const result=requireSuccess(applyBatchWithUndo(document,[edit('beforeTable','Same')]));
    expect(result.memento.entryCount).toBe(0);
    const empty=DocumentState.fromText(base);
    expect(requireSuccess(applyBatchWithUndo(empty,[edit('beforeTable',''),edit('afterTable','')])).memento.entryCount).toBe(0);
  });

  it('survives cloning, sheet rename/move/delete undo, and column edits',()=>{
    const document=DocumentState.fromText(base);document.sheets[0].setSheetNote('beforeTable','**Intro**');
    const clone=cloneDocumentState(document);clone.sheets[0].setSheetNote('beforeTable','Different');
    expect(noteText(document,'beforeTable')).toBe('**Intro**');
    const renamed=requireSuccess(applyBatchAtomic(document,[{op:'rename_sheet',sheet:'Data',newName:'Renamed'},{op:'move_sheet',sheet:'Renamed',targetGapIndex:1},{op:'insert_column',sheet:'Renamed',colIndex:1}]));
    expect(serializeSheetNote(renamed.nextDocument.sheets[1].getSheetNote('beforeTable'))).toBe('**Intro**');
    const deleted=requireSuccess(applyBatchWithUndo(document,[{op:'delete_sheet',sheet:'Data'}]));
    const restored=requireSuccess(applyCoreEditMemento(deleted.nextDocument,deleted.memento,'undo'));
    expect(noteText(restored.nextDocument,'beforeTable')).toBe('**Intro**');
    restored.nextDocument.insertRow('Data',0);
    expect(noteText(restored.nextDocument,'beforeTable')).toBe('**Intro**');
    expect(restored.nextDocument.evaluate().sheets[1].values[0][0]).toEqual({kind:'number',value:10});
  });
});

describe('RFC-0043 interchange',()=>{
  it.each(['csv','tsv'] as const)('warns when %s omits notes without moving cells',format=>{
    const document=DocumentState.fromText(base);
    document.sheets[0].setSheetNote('beforeTable','**Private note**');
    const result=exportDelimitedSheet(document,{sheetName:'Data',format});
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some(d=>d.code==='sheet_content_omitted')).toBe(true);
    if(result.ok)expect(result.value.text).toBe(format==='csv'?'2,3,5\r\n':'2\t3\t5\r\n');
  });
  it('warns when Excel omits notes and leaves formula coordinates unchanged',async()=>{
    const document=DocumentState.fromText(base);document.sheets[0].setSheetNote('afterTable','**Footnote**');
    const result=await exportExcelWorkbook(document);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some(d=>d.code==='metadata_omitted'&&d.message.includes('notes'))).toBe(true);
    if(!result.ok)throw new Error('Export failed');
    const ExcelJS=await import('exceljs'), wb=new ExcelJS.default.Workbook();await wb.xlsx.load(result.value as never);
    expect(wb.worksheets[0].getCell('C1').formula).toBe('A1+B1');
    expect(wb.worksheets[0].rowCount).toBe(1);
  });
});
