import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, importExcelWorkbook, exportExcelWorkbook, serializeDocumentState, resolveDocumentPresentation } from "../src";
import { calendarCellKind, importDateLiteral, exportDateValue, serialToNativeDate } from "../src/excel/temporalValues";

async function load(serial: number, format = "yyyy-mm-dd", system = 1900, formula?: string) {
  const book = new ExcelJS.Workbook(); book.properties.date1904 = system === 1904;
  const sheet = book.addWorksheet("Dates");
  sheet.getCell("A1").value = serial; sheet.getCell("A1").numFmt = format;
  if (formula) { sheet.getCell("B1").value = {formula, result:123}; sheet.getCell("B1").numFmt = format; }
  return importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
}

describe("native dates at the Excel boundary", () => {
  it.each([1900,1904])("imports June 29 as DATE, plain native input, no display metadata (%s)", async system => {
    const result = await load(system === 1900 ? 45837 : 44375,"mmm d, yyyy",system);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.evaluate().sheets[0].values[0][0]).toEqual({kind:"date",value:"2025-06-29",isOffsetQualified:false});
    expect(result.value.sheets[0].cells[0][0].body).toMatchObject({inputText:"2025-06-29"});
    expect(result.value.sheets[0].cells[0][0].localDisplay).toBeNull();
    const source = serializeDocumentState(result.value);
    expect(source).toContain("| 2025-06-29 |");
    expect(source).not.toContain("{:");
    expect(DocumentState.fromText(source).evaluate()).toEqual(result.value.evaluate());
    const exported = await exportExcelWorkbook(result.value);
    if (!exported.ok) throw new Error(JSON.stringify(exported.diagnostics));
    const book = new ExcelJS.Workbook(); await book.xlsx.load(exported.value as never);
    expect(book.worksheets[0].getCell("A1").value).toEqual(new Date("2025-06-29T00:00:00Z"));
    expect(book.worksheets[0].getCell("A1").numFmt).toBe("yyyy-mm-dd");
  });
  it.each([
    [1900,1,"1900-01-01"],[1900,59,"1900-02-28"],[1900,61,"1900-03-01"],
    [1904,0,"1904-01-01"],[1904,59,"1904-02-29"],[1900,2958465,"9999-12-31"],
  ] as const)("converts calendar %s serial %s to %s", (system,value,expected) => {
    expect(importDateLiteral(value,system,"date",{})).toBe(expected);
    expect(exportDateValue({kind:"date",value:expected,isOffsetQualified:false},{})).toBe(value+(system===1904?1462:0));
  });
  it.each([0,60,60.5,-1,2958466])("reports invalid 1900 date %s instead of inventing a date or hiding a number", async serial => {
    const result=await load(serial);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code:"unrepresentable_value",sheetName:"Dates",rowIndex:0,colIndex:0}));
  });
  it("preserves fractional days as native datetimes, even when Excel hides the time", async () => {
    const result = await load(45837.5);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.evaluate().sheets[0].values[0][0]).toMatchObject({kind:"datetime",value:"2025-06-29T12:00",isOffsetQualified:false});
    expect(resolveDocumentPresentation(result.value).sheets[0].cells[0][0].displayText).toBe("2025-06-29");
    const exported = await exportExcelWorkbook(result.value);
    if (!exported.ok) throw new Error(JSON.stringify(exported.diagnostics));
    const book=new ExcelJS.Workbook();await book.xlsx.load(exported.value as never);
    expect(book.worksheets[0].getCell("A1").value).toEqual(new Date("2025-06-29T12:00:00Z"));
    expect(book.worksheets[0].getCell("A1").numFmt).toBe("yyyy-mm-dd");
  });
  it.each([1900,1904])("recalculates formatted formula dates without using stale caches (%s)", async system => {
    const result=await load(system===1900?45837:44375,"yyyy-mm-dd",system,"A1+1");
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.evaluate().sheets[0].values[0][1]).toMatchObject({kind:"date",value:"2025-06-30"});
    expect(result.value.sheets[0].cells[0][1].localDisplay).toMatchObject({valid:true,format:{kind:"temporal",pattern:"%F"}});
    result.value.setCellByIndex("Dates",0,0,"2025-07-01");
    expect(result.value.evaluate().sheets[0].values[0][1]).toMatchObject({kind:"date",value:"2025-07-02"});
  });
  it("recalculates floating datetimes and retains time without adding a timezone", async () => {
    const result=await load(45837.5,"yyyy-mm-dd hh:mm:ss.000",1900,"A1+0.25");
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.evaluate().sheets[0].values[0][1]).toEqual({kind:"datetime",value:"2025-06-29T18:00",isOffsetQualified:false});
  });
  it("leaves ordinary numbers untyped and keeps unrelated numeric formatting", async () => {
    const result = await load(45837,"#,##0");
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.evaluate().sheets[0].values[0][0]).toEqual({kind:"number",value:45837});
    expect(result.value.sheets[0].cells[0][0].localDisplay).not.toBeNull();
  });
  it("refuses unsupported date ranges rather than silently excluding their dates from SUM", async () => {
    const result=await load(45837,"yyyy-mm-dd",1900,"SUM(A1:A2)");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.at(-1)).toMatchObject({code:"unsupported_formula",colIndex:1});
  });
  it.each(["0.00",'0" days"',"[h]:mm","hh:mm",undefined])("does not infer calendar dates from %s", format => {
    expect(calendarCellKind(format)).toBeNull();
  });
  it("rejects non-finite/overflow dates and preserves wall time when dropping offsets", () => {
    for (const value of [Infinity,NaN,2958465.9999999995]) expect(()=>importDateLiteral(value,1900,"datetime",{})).toThrow();
    expect(exportDateValue({kind:"datetime",value:"2025-06-29T00:00:00+08:00",isOffsetQualified:true},{})).toBe(45837);
    expect(()=>exportDateValue({kind:"date",value:"1899-12-31",isOffsetQualified:false},{})).toThrow(/range/);
  });
  it.each([1900,1904] as const)("rejects invalid evaluated date formulas (%s)", system => {
    const doc=DocumentState.fromText(`# Dates\n| = ${serialToNativeDate("-1","date",system)} |`);
    expect(doc.evaluate().sheets[0].values[0][0].kind).toBe("error");
  });
});
