import ExcelJS from "exceljs";
import { describe,it,expect } from "vitest";
import {DocumentState,exportExcelWorkbook,getCellTextView,importExcelWorkbook,serializeDocumentState} from "../src";

describe("readable lookup and text import",()=>{
  it.each([
    ['MATCH(20,A1:A3,0)',2,'match(20, A1:A3) + 1'],
    ['INDEX(B1:B3,MATCH(20,A1:A3,0))',4,'index(B1:B3, match(20, A1:A3))'],
    ['SUMPRODUCT(A1:A3,B1:B3)',280,'dotProduct(A1:A3, B1:B3)'],
    ['SWITCH(A1,10,"ten",20,"twenty","other")','ten','if(A1 == 10, "ten", if(A1 == 20, "twenty", "other"))'],
    ['SWITCH(A2,10,"ten",20,"twenty")','twenty','if(A2 == 10'],
    ['"hello"&CHAR(10)&"world"','hello\nworld','"\\\\n"'],
  ])("translates %s without coercion scaffolding",async(formula,value,source)=>{
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Data");sheet.addRows([[10,2],[20,4],[30,6]]);sheet.getCell("D1").value={formula};
    const result=await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
    expect(result.ok,JSON.stringify(result.diagnostics)).toBe(true);if(!result.ok)return;
    expect(result.value.evaluate().sheets[0].values[0][3]).toEqual({kind:typeof value==="number"?"number":"string",value});
    expect(serializeDocumentState(result.value)).toContain(source);
  });
  it.each(['MATCH(2,A1:A3)','MATCH(2,A1:A3,1)','CHAR(A1)','CHAR(200)','SUMPRODUCT(A1:B3,A1:B3)'])("keeps unsupported %s inert",async formula=>{
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Data");sheet.getCell("D1").value={formula};
    const result=await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()),{unsupportedContent:"preserve-text"});
    expect(result.ok).toBe(true);if(!result.ok)return;
    expect(result.value.evaluate().sheets[0].values[0][3]).toEqual({kind:"string",value:`=${formula}`});
  });
});

describe("VLOOKUP translates to the existing scalar lookup operation", () => {
  it.each(["FALSE", "0"])("imports exact mode %s, ignores caches and survives export/reimport", async mode => {
    const book = new ExcelJS.Workbook(), data = book.addWorksheet("O'Brien"), result = book.addWorksheet("Result");
    data.addRows([[10, "first", 100], [20, "second", 200], [20, "duplicate", 999]]);
    result.getCell("A1").value = 20;
    result.getCell("B1").value = { formula: `VLOOKUP(A1,'O''Brien'!$A$1:$C$3,3,${mode})`, result: -987654321 };
    const imported = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
    expect(imported.ok, JSON.stringify(imported.diagnostics)).toBe(true);
    if (!imported.ok) throw new Error("Expected supported exact VLOOKUP");
    const document = DocumentState.fromText(serializeDocumentState(imported.value));
    expect(getCellTextView(document.sheets[1].cells[0][1]).inputText)
      .toBe('= lookup(A1, @["O\'Brien"::$A$1:$A$3], @["O\'Brien"::$C$1:$C$3])');
    expect(document.evaluate().sheets[1].values[0][1]).toEqual({ kind: "number", value: 200 });
    document.setCellByIndex("O'Brien", 1, 2, "250");
    expect(document.evaluate().sheets[1].values[0][1]).toEqual({ kind: "number", value: 250 });
    const exported = await exportExcelWorkbook(document);
    expect(exported.ok, JSON.stringify(exported.diagnostics)).toBe(true);
    if (!exported.ok) throw new Error("Export failed");
    const reimported = await importExcelWorkbook(exported.value);
    expect(reimported.ok, JSON.stringify(reimported.diagnostics)).toBe(true);
    if (!reimported.ok) throw new Error("Reimport failed");
    expect(reimported.value.evaluate().sheets[1].values[0][1]).toEqual({ kind: "number", value: 250 });
  });
  it.each([
    ['VLOOKUP(20,A1:C3,1,FALSE)', 20],
    ['VLOOKUP(10,A1:C1,3,FALSE)', 100],
    ['VLOOKUP(20,A1:A3,1,FALSE)', 20],
    ['VLOOKUP(20,{10,100;20,200},2,FALSE)', 200],
    ['VLOOKUP(10,{10,100},2,FALSE)', 100],
    ['VLOOKUP("apple",{"apple",8;"pear",6},2,FALSE)', 8],
  ])("projects %s without scaffolding", async (formula, expected) => {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Data");
    sheet.addRows([[10, "first", 100], [20, "second", 200], [30, "third", 300]]);
    sheet.getCell("J1").value = { formula };
    const imported = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
    expect(imported.ok, JSON.stringify(imported.diagnostics)).toBe(true);
    if (!imported.ok) throw new Error("Import failed");
    expect(imported.value.evaluate().sheets[0].values[0][9]).toEqual({ kind: "number", value: expected });
    expect(getCellTextView(imported.value.sheets[0].cells[0][9]).inputText).not.toMatch(/filter|isNumber|isBlank|if\(/);
  });
  it.each(['VLOOKUP(20,A1:C3,2)', 'VLOOKUP(20,A1:C3,2,TRUE)', 'VLOOKUP(20,A1:C3,2,)',
    'VLOOKUP(20,A1:C3,A1,FALSE)', 'VLOOKUP(20,A:C,2,FALSE)', 'VLOOKUP("a*",A1:C3,2,FALSE)'])
  ("preserves unsupported %s as text with a specific reason", async formula => {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Data");
    sheet.getCell("J1").value = { formula };
    const imported = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()), { unsupportedContent: "preserve-text" });
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error("Import failed");
    expect(imported.value.evaluate().sheets[0].values[0][9]).toEqual({ kind: "string", value: `=${formula}` });
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({code: "formula_preserved_as_text", message: expect.stringContaining("VLOOKUP")}));
  });
  it.each(['VLOOKUP(99,A1:C2,2,FALSE)', 'VLOOKUP(20,A1:C2,4,FALSE)'])
  ("keeps failed lookup/bounds visible for %s", async formula => {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Data");
    sheet.addRows([[10, "first", 100], [20, "second", 200]]); sheet.getCell("J1").value = { formula };
    const imported = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error("Import failed");
    expect(imported.value.evaluate().sheets[0].values[0][9].kind).toBe("error");
  });
});
