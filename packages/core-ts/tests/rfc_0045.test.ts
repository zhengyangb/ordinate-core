import {describe,it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import {DocumentState,serializeDocumentState,resolveDocumentPresentation,configureImportedDocument,exportExcelWorkbook,applyBatchWithUndo,applyCoreEditMemento,validateDocument} from '../src';

const load=(rows:string[])=>DocumentState.fromText('# Data\n'+rows.map(r=>`| ${r} |`).join('\n'));
const reload=(d:DocumentState)=>DocumentState.fromText(serializeDocumentState(d));
const view=(d:DocumentState)=>resolveDocumentPresentation(d).sheets[0].cells;
const appearance=(d:DocumentState)=>view(d).map(row=>row.map(c=>({text:c.displayText,style:c.styleLayer.effective,errors:c.errors})));

describe('RFC 0045 row defaults',()=>{
 it('resolves cell > row > column independently without changing A1 coordinates',()=>{
  const d=load(['@meta | {::>,red} | {::>,red} | {::>,red}', '{::bold} | 1 | 2 {::normal,blue} | = A1 + B1']);
  const cells=view(reload(d))[0];
  expect(d.sheets[0].colCount).toBe(3);expect(d.sheets[0].rowCount).toBe(1);
  expect(cells[0].styleLayer.effective).toEqual({align:'right',color:'red',weight:'bold'});
  expect(cells[1].styleLayer.effective).toEqual({align:'right',color:'blue',weight:'normal'});
  expect(cells[2].displayText).toBe('3');
 });
 it('serializes label shorthand into the same canonical control frame',()=>{
  const d=load(['Total {::bold} || 1 | 2']);const text=serializeDocumentState(d);
  expect(text).toContain('@meta');expect(text).not.toContain('Total {::bold}');
  expect(appearance(reload(d))).toEqual(appearance(d));
  expect(serializeDocumentState(reload(d))).toBe(text);
 });
 it('rejects duplicate carriers and defaults on header rows',()=>{
  expect(()=>load(['@meta | ||','{::bold} | Total {::normal} || 1'])).toThrow('single source');
  expect(()=>load(['@meta |','{::bold} | Year','--- | ---','| 2025'])).toThrow('body row');
  expect(load(['@meta |','text | 1']).sheets[0].rowDisplayMetadata[0]?.valid).toBe(false);
  expect(validateDocument('# Data\n| @meta | |\n| text | 1 | 2 |').errors.length).toBeGreaterThan(0);
 });
 it('moves row defaults with stable rows and undoes as one operation',()=>{
  const d=load(['@meta | |','{::bold} | 1 | 2','| 3 | 4']);
  const edit=applyBatchWithUndo(d,[{op:'move_rows',sheet:'Data',rowIds:[d.sheets[0].rowIds[0]],targetGapIndex:1}],{recalculate:true});
  if(!edit.ok)throw new Error(edit.error.message);
  const moved=reload(edit.nextDocument);expect(view(moved)[1][0].styleLayer.effective?.weight).toBe('bold');
  const undo=applyCoreEditMemento(edit.nextDocument,edit.memento,'undo');if(!undo.ok)throw new Error(undo.error.message);
  expect(serializeDocumentState(undo.nextDocument)).toBe(serializeDocumentState(d));
 });
 it('compacts bold rows with normal exceptions and no header columns',()=>{
  const d=load(['1 {::bold} | 2 {::bold} | 3 {::bold} | 4 {::bold} | 5 {::normal}','6 | 7 | 8 | 9 | 10']);
  const compact=configureImportedDocument(d);
  expect(compact.sheets[0].rowDisplayMetadata[0]).toMatchObject({style:{weight:'bold'}});
  expect(compact.sheets[0].cells[0].slice(0,4).every(c=>c.localDisplay===null)).toBe(true);
  expect(appearance(reload(compact))).toEqual(appearance(d));
  expect(serializeDocumentState(configureImportedDocument(compact))).toBe(serializeDocumentState(compact));
 });
 it('materializes a minority column default when a new row default would override it',()=>{
  const d=load(['@meta | | | | | {::normal}','| 1 {::bold} | 2 {::bold} | 3 {::bold} | 4 {::bold} | 5','| 6 | 7 | 8 | 9 | 10']);
  const compact=configureImportedDocument(d);
  expect(compact.sheets[0].rowDisplayMetadata[0]).toMatchObject({style:{weight:'bold'}});
  expect(compact.sheets[0].cells[0][4].localDisplay).toMatchObject({style:{weight:'normal'}});
  expect(appearance(reload(compact))).toEqual(appearance(d));
 });
 it('does not override automatic exceptions or promote already-inherited column formats',()=>{
  const d=load(['1 {::bold} | 2 {::bold} | 3 {::bold} | 4 {::bold} | 5']);
  expect(configureImportedDocument(d).sheets[0].rowDisplayMetadata[0]).toBeNull();
  const inherited=load(['@meta | {:.2f} | {:.2f} | {:.2f}','| 1 | 2 | 3']);
  expect(configureImportedDocument(inherited).sheets[0].rowDisplayMetadata[0]).toBeNull();
 });
 it('compacts numeric row formats atomically and exports effective cell styles',async()=>{
  const d=load(['1 {:.2f} {::bold} | 2 {:.2f} {::bold} | 3 {:.2f} {::bold} | 4 {:.2f} {::bold} | 5 {:.1f} {::normal}']);
  const compact=configureImportedDocument(d);
  expect(compact.sheets[0].rowDisplayMetadata[0]).toMatchObject({format:{precision:2},style:{weight:'bold'}});
  expect(appearance(reload(compact))).toEqual(appearance(d));
  const result=await exportExcelWorkbook(compact);if(!result.ok)throw new Error(JSON.stringify(result.diagnostics));
  const x=new ExcelJS.Workbook();await x.xlsx.load(result.value as never);
  expect(x.worksheets[0].getCell('A1').numFmt).toBe('0.00');expect(x.worksheets[0].getCell('A1').font.bold).toBe(true);
  expect(x.worksheets[0].getCell('E1').numFmt).toBe('0.0');expect(x.worksheets[0].getCell('E1').font.bold).not.toBe(true);
 });
});
