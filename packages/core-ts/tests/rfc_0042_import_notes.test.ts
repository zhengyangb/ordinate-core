import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { importExcelWorkbook, prepareExcelImport, importPreparedExcelWorkbook, excelImportNoteCandidates, serializeSheetNote, serializeDocumentState } from "../src";
import { nameResolver } from "../src/excel/definedNames";
import { DEFAULT_EXCEL_LIMITS, ExcelReport } from "../src/excel/contracts";
import { parseExcelFormula } from "../src/excel/formulaParser";

async function bytes(setup:(book:ExcelJS.Workbook)=>void){const book=new ExcelJS.Workbook();setup(book);return new Uint8Array(await book.xlsx.writeBuffer());}
function ok<T>(result:{ok:true;value:T}|{ok:false;diagnostics:unknown}):T{if(!result.ok)throw new Error(JSON.stringify(result.diagnostics));return result.value;}
async function sample(reference="Data!$B$3"){
  return bytes(book=>{
    const sheet=book.addWorksheet("Data");
    sheet.addRows([["Title"],["Name","Value"],["One",5],["Two",{formula:"B3*2",result:10}],["*literal* ---"]]);
    sheet.mergeCells("A1:B1");sheet.getCell("A1").font={bold:true};
    book.addWorksheet("Other").getCell("A1").value={formula:reference,result:5};
  });
}
describe("confirmed edge-row note import",()=>{
  it("suggests edge text, leaves data and internal headings alone, and does nothing without consent",async()=>{
    const source=await sample(), prepared=ok(await prepareExcelImport(source));
    expect(excelImportNoteCandidates(prepared)).toEqual([
      {sheetName:"Data",position:"beforeTable",rowCount:1,firstRow:1,lastRow:1,markdown:"**Title**"},
      {sheetName:"Data",position:"afterTable",rowCount:1,firstRow:5,lastRow:5,markdown:"\\*literal\\* ---"},
    ]);
    const document=ok(await importPreparedExcelWorkbook(prepared));
    expect(document.sheets[0].rowCount).toBe(5);
    expect(document.sheets[0].getSheetNote("beforeTable").blocks).toEqual([]);
  });
  it("extracts approved rows, escapes literal Markdown and rebases same/cross-sheet fixed references",async()=>{
    const prepared=ok(await prepareExcelImport(await sample())), original=JSON.stringify(prepared);
    const document=ok(await importPreparedExcelWorkbook(prepared,{notes:[{sheetName:"Data",beforeRows:1,afterRows:1}],headers:[{sheetName:"Data",headerRows:1,headerColumns:1}]}));
    expect(document.sheets[0].rowCount).toBe(3);
    expect(serializeSheetNote(document.sheets[0].getSheetNote("beforeTable"))).toBe("**Title**");
    expect(serializeSheetNote(document.sheets[0].getSheetNote("afterTable"))).toBe("\\*literal\\* ---");
    expect(document.evaluate().sheets[0].values[1][1]).toEqual({kind:"number",value:10});
    expect(document.evaluate().sheets[1].values[0][0]).toEqual({kind:"number",value:5});
    expect(serializeDocumentState(document)).toContain('$B$2');
    expect(JSON.stringify(prepared)).toBe(original);
    expect(ok(await importPreparedExcelWorkbook(prepared)).sheets[0].rowCount).toBe(5);
  });
  it.each(["Data!A1","Data!A5","SUM(Data!B:B)"])("rejects removing referenced note rows: %s",async reference=>{
    const result=await importExcelWorkbook(await sample(reference),{notes:[{sheetName:"Data",beforeRows:1,afterRows:1}]});
    expect(result.ok).toBe(false);
    expect(result.diagnostics.at(-1)).toMatchObject({code:"invalid_options",message:expect.stringContaining("Keep those rows")});
  });
  it("joins literal empty/whitespace rows into a complete footer, without treating zero or formulas as blank",async()=>{
    const prepared=ok(await prepareExcelImport(await bytes(book=>{
      const sheet=book.addWorksheet("Data");
      sheet.addRows([["Name","Value"],["One",0],["Source: Example"," "],[""],["Notes:","\t"],["  "],["First footnote"]]);
      book.addWorksheet("Formula blank").addRows([["Name","Value"],["One",0],["Source: Example"],[{formula:'""',result:""}],["Last note"]]);
    })));
    const candidates=excelImportNoteCandidates(prepared);
    expect(candidates.find(c=>c.sheetName==="Data")).toMatchObject({position:"afterTable",firstRow:3,lastRow:7,rowCount:5,markdown:"Source: Example\n\nNotes:\n\nFirst footnote"});
    expect(candidates.find(c=>c.sheetName==="Formula blank")).toMatchObject({position:"afterTable",firstRow:5,rowCount:1});
    const document=ok(await importPreparedExcelWorkbook(prepared,{notes:[{sheetName:"Data",beforeRows:0,afterRows:5}]}));
    expect(document.sheets[0].rowCount).toBe(2);
    expect(document.evaluate().sheets[0].values[1][1]).toEqual({kind:"number",value:0});
    expect(serializeSheetNote(document.sheets[0].getSheetNote("afterTable"))).toBe("Source: Example\n\nNotes:\n\nFirst footnote");
  });
  it.each([
    ["Data!A1",true,false], ["Data!A5",false,true],
    ["SUM(Data!B:B)",true,true], ["SUM(Data!B2:B9)",false,true],
    ["IF(TRUE(),Data!A1,0)",true,false],
    ["-Data!A1",true,false], ["Data!A1+SUM({1,2})",true,false],
    ["Data!A10",false,false],
  ] as const)("plans the same restrictions as extraction for %s",async(reference,beforeBlocked,afterBlocked)=>{
    const prepared=ok(await prepareExcelImport(await sample(reference)));
    const candidates=excelImportNoteCandidates(prepared);
    expect(!!candidates[0].unavailableReason).toBe(beforeBlocked);
    expect(!!candidates[1].unavailableReason).toBe(afterBlocked);
    for (const candidate of candidates) {
      const result=await importPreparedExcelWorkbook(prepared,{notes:[{sheetName:"Data",beforeRows:candidate.position==="beforeTable"?candidate.rowCount:0,afterRows:candidate.position==="afterTable"?candidate.rowCount:0}]});
      expect(result.ok).toBe(!candidate.unavailableReason);
      if (candidate.unavailableReason) expect(result.diagnostics.at(-1)?.message).toBe(candidate.unavailableReason);
    }
  });
  it("detects same-sheet and case-insensitive named references before the user chooses",async()=>{
    const prepared=ok(await prepareExcelImport(await sample("Heading")));
    prepared.workbook.definedNames.push({name:"Heading",source:"dAtA!$A$1"});
    prepared.workbook.sheets[0].rows[3][1].formula="A5";
    const candidates=excelImportNoteCandidates(prepared);
    expect(candidates[0].unavailableReason).toBe("Referenced by 'Other'!A1. Keep those rows in the table.");
    expect(candidates[1].unavailableReason).toBe("Referenced by 'Data'!B4. Keep those rows in the table.");
  });
  it("does not interpret cell-looking text inside a formula as a dependency",async()=>{
    const prepared=ok(await prepareExcelImport(await sample('"Data!A1"')));
    expect(excelImportNoteCandidates(prepared).every(c=>!c.unavailableReason)).toBe(true);
  });
  it("keeps blocked rows as cells and still allows the independent footer",async()=>{
    const prepared=ok(await prepareExcelImport(await sample("Data!A1")));
    const document=ok(await importPreparedExcelWorkbook(prepared,{notes:[{sheetName:"Data",beforeRows:0,afterRows:1}]}));
    expect(document.sheets[0].rowCount).toBe(4);
    expect(document.sheets[0].getSheetNote("beforeTable").blocks).toEqual([]);
    expect(document.evaluate().sheets[1].values[0][0]).toEqual({kind:"string",value:"Title"});
  });
  it("rebases references past the used range without mistaking them for deleted rows",async()=>{
    const result=await importExcelWorkbook(await sample("Data!B10"),{notes:[{sheetName:"Data",beforeRows:1,afterRows:1}]});
    expect(result.ok,JSON.stringify(result.diagnostics)).toBe(true);
    expect(serializeDocumentState(ok(result))).toContain("B9");
  });
  it.each([-1,2,1.5])("rejects unoffered note row counts %s",async beforeRows=>{
    const result=await importExcelWorkbook(await sample(),{notes:[{sheetName:"Data",beforeRows,afterRows:0}]});
    expect(result.ok).toBe(false);expect(result.diagnostics.at(-1)?.code).toBe("invalid_options");
  });
  it("does not suggest numeric rows or a sheet made entirely of single-column text",async()=>{
    const prepared=ok(await prepareExcelImport(await bytes(book=>{book.addWorksheet("Data").addRows([["a"],["b"]]);book.addWorksheet("Numbers").addRows([[1],[2]]);}))); 
    expect(excelImportNoteCandidates(prepared)).toEqual([]);
  });
});
describe("source types and named references",()=>{
  it("keeps text, boolean and error caches typed even with a date number format",async()=>{
    const result=await importExcelWorkbook(await bytes(book=>{
      const sheet=book.addWorksheet("Data");
      sheet.addRow(["January 2023 to January 2025","0012",{formula:'"January 2023 to January 2025"',result:"January 2023 to January 2025"},{formula:"TRUE()",result:true},{formula:"1/0",result:{error:"#DIV/0!"}}]);
      sheet.getRow(1).eachCell(cell=>cell.numFmt="mmm-yy");
    }));
    expect(ok(result).evaluate().sheets[0].values[0]).toMatchObject([
      {kind:"string",value:"January 2023 to January 2025"},{kind:"string",value:"0012"},{kind:"string",value:"January 2023 to January 2025"},{kind:"boolean",value:true},{kind:"error"},
    ]);
  });
  it("resolves fixed names case-insensitively with local scope taking precedence",()=>{
    const resolve=nameResolver([{name:"Rate",source:"Data!$A$1"},{name:"Rate",source:"Data!$B$2",sheetIndex:1}],DEFAULT_EXCEL_LIMITS);
    expect(resolve(parseExcelFormula("rate",DEFAULT_EXCEL_LIMITS),0)).toEqual(parseExcelFormula("Data!$A$1",DEFAULT_EXCEL_LIMITS));
    expect(resolve(parseExcelFormula("RATE",DEFAULT_EXCEL_LIMITS),1)).toEqual(parseExcelFormula("Data!$B$2",DEFAULT_EXCEL_LIMITS));
  });
  it.each(["Data!A1","SUM(Data!$A$1)","Rate"])("rejects unsafe/unsupported name definitions %s",source=>{
    expect(()=>nameResolver([{name:"Rate",source}],DEFAULT_EXCEL_LIMITS)(parseExcelFormula("Rate",DEFAULT_EXCEL_LIMITS),0)).toThrow();
  });
  it("consolidates repeated notices without losing counts or mutating a prepared report",()=>{
    const source=new ExcelReport(true);source.warn("metadata_omitted","Same",{sheetName:"Data",rowIndex:0});source.warn("metadata_omitted","Same",{sheetName:"Data",rowIndex:1});
    const target=new ExcelReport(true);target.merge(source.diagnostics);target.merge(source.diagnostics);
    expect(source.diagnostics[0].count).toBe(2);expect(target.diagnostics[0].count).toBe(4);expect(target.diagnostics[0].rowIndex).toBe(0);
  });
});
