import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, importExcelWorkbook, serializeDocumentState } from "../src";
import { analyzeHeaders } from "../src/excel/headerAnalysis";
import type { WorkbookCell } from "../src/excel/workbookCodec";

async function load(setup: (sheet: ExcelJS.Worksheet, book: ExcelJS.Workbook) => void) {
  const book = new ExcelJS.Workbook();
  setup(book.addWorksheet("Data"), book);
  const result = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}
const table = (sheet: ExcelJS.Worksheet, ref = "A1", name = "Items") => sheet.addTable({
  name, ref, headerRow: true, columns: [{ name: "Item" }, { name: "Amount" }], rows: [["Sales", 12], ["Cost", 4]],
});
const grid = (values: Array<Array<string | number | null>>): WorkbookCell[][] => values.map(row => row.map(value => ({ value })));

describe("Excel header evidence", () => {
  it("adopts a whole-sheet Table header, preserving coordinates and formulas through ORD", async () => {
    const result = await load((sheet, book) => {
      table(sheet);
      sheet.getCell("B3").value = { formula: "B2*2" };
      book.addWorksheet("Other").getCell("A1").value = { formula: "Data!B3+1" };
    });
    expect(result.value.sheets[0].headerRowCount).toBe(1);
    expect(result.value.sheets[0].colLabels).toEqual(["Item", "Amount"]);
    const restored = DocumentState.fromText(serializeDocumentState(result.value));
    expect(restored.sheets[0].headerRowCount).toBe(1);
    expect(restored.evaluate().sheets[0].values[1][1]).toEqual({ kind: "number", value: 24 });
    expect(restored.evaluate().sheets[1].values[0][0]).toEqual({ kind: "number", value: 25 });
  });
  it.each(["A3", "B1"])("does not promote unrelated rows/columns for a Table at %s", async ref => {
    const result = await load(sheet => { table(sheet, ref); });
    expect(result.value.sheets[0].headerRowCount).toBe(0);
  });
  it("does not promote a Table covering only part of the worksheet", async () => {
    const result = await load(sheet => { table(sheet); sheet.getCell("D1").value = "Notes"; });
    expect(result.value.sheets[0].headerRowCount).toBe(0);
  });
  it("does not merge multiple Tables into one native header", async () => {
    const result = await load(sheet => { table(sheet); table(sheet, "A6", "More"); });
    expect(result.value.sheets[0].headerRowCount).toBe(0);
  });
  it("does not auto-promote bold labels", async () => {
    const result = await load(sheet => {
      sheet.addRows([["Item", "Amount"], ["Sales", 12]]);
      sheet.getRow(1).font = { bold: true };
    });
    expect(result.value.sheets[0].headerRowCount).toBe(0);
  });
  it("does not auto-promote filled rows", async () => {
    const result = await load(sheet => {
      sheet.addRows([["Name", "Team"], ["Alex", "Ops"]]);
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCDDEE" } };
    });
  });
  it("does not treat frozen numeric rows as authoritative headers", async () => {
    const result = await load(sheet => {
      sheet.addRows([[1, 2], [3, 4]]); sheet.views = [{ state: "frozen", ySplit: 1 }];
    });
    expect(result.value.sheets[0].headerRowCount).toBe(0);
  });
  it.each([
    { rows: [] },
    { rows: [[1, 2], [3, 4]] },
    { rows: [["A", "B"], ["C", "D"]] },
    { rows: [["Title", null], [12, 14]] },
    { rows: [["Year", "Amount"], [2025, 12]] },
    { rows: [["Sales", 12], ["Cost", 4], ["Profit", 8]] },
  ])("does not infer structure from text distribution: $rows", ({ rows }) => {
    expect(analyzeHeaders(grid(rows), [])).toEqual({ headerRows: 0 });
  });
  it("never auto-promotes headerless Tables or reserved native label syntax", () => {
    expect(analyzeHeaders(grid([["Item", "Amount"], ["Sales", 1]]), [{ range: "A1:B2", headerRow: false }]).headerRows).toBe(0);
    expect(analyzeHeaders(grid([["=1+1", "Amount"], ["Sales", 1]]), [{ range: "A1:B2", headerRow: true }])).toEqual({ headerRows: 0 });
  });
  it("keeps formula-like Table labels as literal data instead of native headers", async () => {
    const result = await load(sheet => sheet.addTable({
      name: "Items", ref: "A1", headerRow: true,
      columns: [{ name: "12 = 3*4" }, { name: "Amount" }], rows: [["Sales", 12]],
    }));
    expect(result.value.sheets[0].headerRowCount).toBe(0);
    expect(result.value.evaluate().sheets[0].values[0][0]).toEqual({ kind: "string", value: "12 = 3*4" });
  });
});
