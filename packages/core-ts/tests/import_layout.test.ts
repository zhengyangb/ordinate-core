import {describe,it,expect} from "vitest";
import ExcelJS from "exceljs";
import {DocumentState, configureImportedDocument, importExcelWorkbook, exportExcelWorkbook, serializeDocumentState, resolveDocumentPresentation} from "../src";

const document = (rows:string[]) => DocumentState.fromText('# Data\n'+rows.map(row=>`| ${row} |`).join('\n'));
const visible = (doc:DocumentState) => resolveDocumentPresentation(doc).sheets.map(sheet=>sheet.cells.map(row=>row.map(cell=>({text:cell.displayText,style:cell.styleLayer.effective,errors:cell.errors}))));
const reload = (doc:DocumentState) => DocumentState.fromText(serializeDocumentState(doc));

describe('import layout and format compaction',()=>{
  it('preserves empty sheets with zero headers and rejects positive counts',async()=>{
    const book=new ExcelJS.Workbook();book.addWorksheet('Empty');
    const bytes=new Uint8Array(await book.xlsx.writeBuffer());
    const result=await importExcelWorkbook(bytes);
    if(!result.ok)throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.sheets[0].rowCount).toBe(0);
    expect(result.value.sheets[0].colCount).toBe(0);
    for(const choice of [{headerRows:1,headerColumns:0},{headerRows:0,headerColumns:1}]) {
      const invalid=await importExcelWorkbook(bytes,{headers:[{sheetName:'Empty',...choice}]});
      expect(invalid.ok).toBe(false);
    }
  });
  it('keeps General integers, fractions and dates free of format metadata',async()=>{
    const book=new ExcelJS.Workbook(), sheet=book.addWorksheet('Data');
    sheet.addRows([[12],[1.23456],[-2],[0]]);
    sheet.getCell('A5').value=45837;sheet.getCell('A5').numFmt='yyyy-mm-dd';
    const result=await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
    if(!result.ok)throw new Error(JSON.stringify(result.diagnostics));
    expect(serializeDocumentState(result.value)).not.toContain('{:');
    expect(result.value.sheets[0].columnDisplayMetadata.every(meta=>meta===null)).toBe(true);
  });
  it('extracts repeated numeric formats without needing headers and preserves exceptions',()=>{
    const source=document(['1.234 {:.2f}','2.345 {:.2f}','3.456 {:.2f}','4.567 {:.2f}','5.678 {:.4f}']);
    const original=serializeDocumentState(source), result=configureImportedDocument(source);
    expect(serializeDocumentState(source)).toBe(original);
    expect(result.sheets[0].columnDisplayMetadata[0]).toMatchObject({format:{precision:2}});
    expect(result.sheets[0].cells.slice(0,4).every(row=>row[0].localDisplay===null)).toBe(true);
    expect(result.sheets[0].cells[4][0].localDisplay).toMatchObject({format:{precision:4}});
    expect(visible(reload(result))).toEqual(visible(source));
    expect(serializeDocumentState(configureImportedDocument(result))).toBe(serializeDocumentState(result));
  });
  it('extracts style axes independently, without discarding rare bold/color/alignment exceptions',()=>{
    const source=document(['1 {::>,red}','2 {::>,red}','3 {::>,red}','4 {::>,red}','5 {::<,blue,bold}']);
    const result=configureImportedDocument(source);
    expect(result.sheets[0].columnDisplayMetadata[0]).toMatchObject({style:{align:'right',color:'red',weight:null}});
    expect(result.sheets[0].cells[4][0].localDisplay).toMatchObject({style:{align:'left',color:'blue',weight:'bold'}});
    expect(visible(reload(result))).toEqual(visible(source));
  });
  it('never makes a General numeric exception inherit fixed precision',()=>{
    const source=document(['1.234 {:.2f}','2.345 {:.2f}','3.456 {:.2f}','4.567 {:.2f}','5.6789']);
    const result=configureImportedDocument(source);
    expect(result.sheets[0].columnDisplayMetadata[0]).toBeNull();
    expect(visible(result)).toEqual(visible(source));
  });
  it('does not force automatic alignment or color exceptions to inherit',()=>{
    const source=document(['1 {::>,red}','2 {::>,red}','3 {::>,red}','4 {::>,red}','5']);
    expect(serializeDocumentState(configureImportedDocument(source))).toBe(serializeDocumentState(source));
  });
  it('preserves explicit normal-weight exceptions to a bold column',()=>{
    const source=document(['1 {::bold}','2 {::bold}','3 {::bold}','4 {::bold}','5 {::normal}']);
    const result=configureImportedDocument(source);
    expect(result.sheets[0].columnDisplayMetadata[0]).toMatchObject({style:{weight:'bold'}});
    expect(visible(reload(result))).toEqual(visible(source));
  });
  it('leaves isolated settings local and does not promote a divided column',()=>{
    for(const rows of [['1 {:.2f}','2 {:.2f}'],['1 {:.2f}','2 {:.2f}','3 {:.4f}','4 {:.4f}']]){
      const source=document(rows);
      expect(serializeDocumentState(configureImportedDocument(source))).toBe(serializeDocumentState(source));
    }
  });
  it('allows blank spacing rows without manufacturing zeros',()=>{
    const source=document(['1 {:.2f}','','2 {:.2f}','3 {:.2f}']);
    const result=configureImportedDocument(source);
    expect(result.sheets[0].columnDisplayMetadata[0]).toMatchObject({format:{precision:2}});
    expect(visible(result)).toEqual(visible(source));
    expect(result.evaluate().sheets[0].values[1][0]).toEqual({kind:'blank',value:null});
  });
  it('does not apply numeric defaults to textual labels without headers',()=>{
    const source=document(['"Amount"','1 {:.2f}','2 {:.2f}','3 {:.2f}']);
    expect(configureImportedDocument(source).sheets[0].columnDisplayMetadata[0]).toBeNull();
    const result=configureImportedDocument(source,[{sheetName:'Data',headerRows:1,headerColumns:0}]);
    expect(result.sheets[0].columnDisplayMetadata[0]).toMatchObject({format:{precision:2}});
    expect(result.sheets[0].headerRowCount).toBe(1);
  });
  it('sets rows/columns without shifting A1 references or dropping dollar locks',()=>{
    const source=document(['"Name" | "Amount" | "Total"','"First" | 2 | = $B2 * 2','"Second" | 3 | = B$3 + C2']);
    const result=configureImportedDocument(source,[{sheetName:'Data',headerRows:1,headerColumns:1}]);
    const restored=reload(result);
    expect(restored.sheets[0].headerColCount).toBe(1);
    expect(serializeDocumentState(restored)).toContain('$B2 * 2');
    expect(restored.evaluate().sheets[0].values.map(row=>row[2])).toEqual([{kind:'number',value:4},{kind:'number',value:7}]);
  });
  it.each([{headerRows:-1,headerColumns:0},{headerRows:1.5,headerColumns:0},{headerRows:2,headerColumns:0},{headerRows:0,headerColumns:2},{headerRows:0,headerColumns:NaN}])('rejects invalid boundaries %j without mutating input',choice=>{
    const source=document(['"A" | "B"','1 | 2']), text=serializeDocumentState(source);
    expect(()=>configureImportedDocument(source,[{sheetName:'Data',...choice}])).toThrow();
    expect(serializeDocumentState(source)).toBe(text);
  });
  it('rejects formulas in proposed headers and unknown/duplicate sheets',()=>{
    const source=document(['= 1+1 | 2','3 | 4']);
    expect(()=>configureImportedDocument(source,[{sheetName:'Data',headerRows:1,headerColumns:0}])).toThrow('Headers cannot contain formulas');
    expect(()=>configureImportedDocument(source,[{sheetName:'Data',headerRows:0,headerColumns:1}])).toThrow('Headers cannot contain formulas');
    expect(()=>configureImportedDocument(source,[{sheetName:'Missing',headerRows:0,headerColumns:0}])).toThrow();
    expect(()=>configureImportedDocument(source,Array(2).fill({sheetName:'Data',headerRows:0,headerColumns:0}))).toThrow();
  });
  it('lets explicit zero override Excel Table headers and regenerates original cell styles',async()=>{
    const book=new ExcelJS.Workbook(), sheet=book.addWorksheet('Data');
    sheet.addTable({name:'Items',ref:'A1',headerRow:true,columns:[{name:'Item'},{name:'Amount'}],rows:[['A',1],['B',2],['C',3]]});
    sheet.getCell('A1').font={bold:true};
    const bytes=new Uint8Array(await book.xlsx.writeBuffer());
    const auto=await importExcelWorkbook(bytes), plain=await importExcelWorkbook(bytes,{headers:[{sheetName:'Data',headerRows:0,headerColumns:0}]});
    if(!auto.ok||!plain.ok)throw new Error('Import failed');
    expect(auto.value.sheets[0].headerRowCount).toBe(1);
    expect(plain.value.sheets[0].headerRowCount).toBe(0);
    expect(resolveDocumentPresentation(plain.value).sheets[0].cells[0][0].styleLayer.effective?.weight).toBe('bold');
  });
  it('reexports factored formats as effective Excel cell styles',async()=>{
    const source=document(['1.234 {:.2f} {::>}','2.345 {:.2f} {::>}','3.456 {:.2f} {::>}','4.567 {:.2f} {::>}','5.678 {:.4f} {::<}']);
    const output=await exportExcelWorkbook(configureImportedDocument(source));
    if(!output.ok)throw new Error(JSON.stringify(output.diagnostics));
    const book=new ExcelJS.Workbook();await book.xlsx.load(output.value as never);
    expect(book.worksheets[0].getCell('A1').numFmt).toBe('0.00');
    expect(book.worksheets[0].getCell('A1').alignment.horizontal).toBe('right');
    expect(book.worksheets[0].getCell('A5').numFmt).toBe('0.0000');
    expect(book.worksheets[0].getCell('A5').alignment.horizontal).toBe('left');
  });
});
