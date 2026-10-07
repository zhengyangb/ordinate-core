import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  DocumentState, exportExcelWorkbook, importExcelWorkbook,
  resolveDocumentPresentation, serializeDocumentState,
} from "../src";
import { importCalendarDisplayFormat } from "../src/excel/formatTranslation";

async function imported(value: number | string, format: string, system: 1900 | 1904 = 1900) {
  const book = new ExcelJS.Workbook();
  book.properties.date1904 = system === 1904;
  const sheet = book.addWorksheet("Dates");
  sheet.getCell("A1").value = value;
  sheet.getCell("A1").numFmt = format;
  const result = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

describe("ISO calendar display policy without guessing a locale", () => {
  it.each([
    ["date", false, null], ["date", true, "%F"],
    ["datetime", false, null], ["datetime", true, null],
  ] as const)("projects %s with possible time=%s to %s", (kind, time, pattern) => {
    const format = importCalendarDisplayFormat(kind, time);
    expect(format?.kind === "temporal" ? format.pattern : null).toBe(pattern);
  });

  it.each(["mm-dd-yy", "d-mmm-yy", "[$-F800]dddd, mmmm dd, yyyy", "[$-409]mmm d, yyyy"])(
    "uses a plain ISO date for %s without format or an invented clock", async format => {
      const doc = await imported(45837, format);
      expect(doc.evaluate().sheets[0].values[0][0]).toMatchObject({kind:"date",value:"2025-06-29"});
      expect(doc.sheets[0].cells[0][0].localDisplay).toBeNull();
      expect(resolveDocumentPresentation(doc).sheets[0].cells[0][0].displayText).toBe("2025-06-29");
      expect(serializeDocumentState(doc)).not.toContain("{:");
    },
  );

  it.each([1900, 1904] as const)("hides but retains clock data through ORD and XLSX (%s)", async system => {
    const doc = await imported((system === 1900 ? 45837 : 44375) + 0.5, "mm-dd-yy", system);
    const reopened = DocumentState.fromText(serializeDocumentState(doc));
    expect(reopened.evaluate().sheets[0].values[0][0]).toEqual({kind:"datetime",value:"2025-06-29T12:00",isOffsetQualified:false});
    expect(resolveDocumentPresentation(reopened).sheets[0].cells[0][0].displayText).toBe("2025-06-29");
    const output = await exportExcelWorkbook(reopened);
    if (!output.ok) throw new Error(JSON.stringify(output.diagnostics));
    const xlsx = new ExcelJS.Workbook(); await xlsx.xlsx.load(output.value as never);
    expect(xlsx.worksheets[0].getCell("A1").value).toEqual(new Date("2025-06-29T12:00:00Z"));
    expect(xlsx.worksheets[0].getCell("A1").numFmt).toBe("yyyy-mm-dd");
    const reimported = await importExcelWorkbook(output.value);
    if (!reimported.ok) throw new Error(JSON.stringify(reimported.diagnostics));
    expect(reimported.value.evaluate().sheets[0].values).toEqual(reopened.evaluate().sheets[0].values);
    expect(resolveDocumentPresentation(reimported.value).sheets[0].cells[0][0].displayText).toBe("2025-06-29");
  });

  it("keeps a displayed clock with the default datetime display", async () => {
    const doc = await imported(45837.5, "m/d/yy h:mm");
    expect(doc.evaluate().sheets[0].values[0][0]).toMatchObject({kind:"datetime",value:"2025-06-29T12:00"});
    expect(doc.sheets[0].cells[0][0].localDisplay).toBeNull();
    expect(resolveDocumentPresentation(doc).sheets[0].cells[0][0].displayText).toBe("2025-06-29T12:00");
  });

  it.each(["03/04/2026", "2026-03-04", "2026-03-04T14:30"])("retains original text %s despite a calendar format", async value => {
    const doc = await imported(value, "mm-dd-yy");
    expect(doc.evaluate().sheets[0].values[0][0]).toEqual({kind:"string",value});
    expect(doc.sheets[0].cells[0][0].localDisplay).toBeNull();
    expect(resolveDocumentPresentation(doc).sheets[0].cells[0][0].displayText).toBe(value);
  });

  it("compacts shared hidden-time display into the existing column default", async () => {
    const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("Dates");
    for (let r = 1; r <= 4; r++) {
      sheet.getCell(r,1).value = 45836 + r + 0.5;
      sheet.getCell(r,1).numFmt = "mm-dd-yy";
    }
    const result = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.sheets[0].columnDisplayMetadata[0]).toMatchObject({valid:true,format:{kind:"temporal",pattern:"%F"}});
    expect(result.value.sheets[0].cells.every(row => row[0].localDisplay === null)).toBe(true);
    expect(resolveDocumentPresentation(result.value).sheets[0].cells.map(row => row[0].displayText)).toEqual([
      "2025-06-29", "2025-06-30", "2025-07-01", "2025-07-02",
    ]);
  });
});
