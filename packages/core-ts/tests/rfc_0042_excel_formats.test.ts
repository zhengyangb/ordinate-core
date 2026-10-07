import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { DocumentState, resolveDocumentPresentation, serializeDocumentState } from "../src";
import { importExcelWorkbook, exportExcelWorkbook } from "../src/excel";
import { importNumberFormat, exportNumberFormat } from "../src/excel/formatTranslation";
import { ExcelReport } from "../src/excel/contracts";

describe("spreadsheet display formats (synthetic fixtures only)", () => {
  it.each([
    ["0.00", "0.00"], ["#,##0", "#,##0"], ["0.0%", "0.0%"],
    ['* #,##0.0;* (#,##0.0);* "-";_(@_)', '#,##0.0;(#,##0.0)'],
    ['"$"#,##0.00;"$"(#,##0.00)', '#,##0.00;(#,##0.00)'],
  ])("maps %s to %s without rounding underlying values", (source, target) => {
    const format = importNumberFormat(source, new ExcelReport(), {});
    expect(format && exportNumberFormat(format)).toBe(target);
  });
  it.each(['[>=100]0.0', '0.00E+00', '# ?/?', '0,,', '"day"0', '[h]:mm', '0" kg"'])("reports unsupported %s instead of guessing", source => {
    const report = new ExcelReport();
    expect(importNumberFormat(source, report, {})).toBeNull();
    expect(report.diagnostics[0].code).toBe("presentation_omitted");
  });
  it.each([1900, 1904] as const)("imports actual date values without native display metadata (%s calendar)", async system => {
    const book = new ExcelJS.Workbook(); book.properties.date1904 = system === 1904;
    const sheet = book.addWorksheet("Dates");
    sheet.getCell("A1").value = 45000;
    sheet.getCell("A1").numFmt = "mmm d, yyyy";
    sheet.getCell("B1").value = { formula: "A1+1" };
    sheet.getCell("B1").numFmt = "yyyy-mm-dd";
    sheet.getCell("C1").value = 0.12345678; sheet.getCell("C1").numFmt = "0.0%";
    const result = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const doc = DocumentState.fromText(serializeDocumentState(result.value));
    const cells = resolveDocumentPresentation(doc).sheets[0].cells[0];
    expect(cells[0].displayText).toBe(system === 1900 ? "2023-03-15" : "2027-03-16");
    expect(cells[1].displayText).toBe(system === 1900 ? "2023-03-16" : "2027-03-17");
    expect(doc.sheets[0].cells[0][0].body).toMatchObject({kind:"literal",literal:{kind:"date"}});
    expect(doc.sheets[0].cells[0][0].localDisplay).toBeNull();
    expect(doc.sheets[0].cells[0][1].localDisplay).toMatchObject({valid:true,format:{kind:"temporal",pattern:"%F"}});
    expect(cells[2].displayText).toBe("12.3%");
    expect(doc.evaluate().sheets[0].values[0][2]).toEqual({kind:"number",value:0.12345678});
    // The imported formula remains executable; literal date export is independent.
    doc.setCellByIndex("Dates",0,1,"2025-06-30");
    const out = await exportExcelWorkbook(doc);
    if (!out.ok) throw new Error(JSON.stringify(out.diagnostics));
    const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(out.value as never);
    expect(reopened.properties.date1904).toBe(false);
    expect(reopened.worksheets[0].getCell("A1").numFmt).toBe("yyyy-mm-dd");
    expect(reopened.worksheets[0].getCell("C1").numFmt).toBe("0.0%");
  });
  it("does not accept Excel calendar display presets in native syntax", () => {
    for (const pattern of ["excel1900:date","excel1904:datetime"]) {
      const doc=DocumentState.fromText(`# Dates\n| 45000 {:${pattern}} |`);
      expect(doc.sheets[0].cells[0][0].localDisplay?.valid).toBe(false);
    }
  });
});
