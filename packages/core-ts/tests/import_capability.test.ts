import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { importWorkbook, inspectWorkbook, evaluateWorkbook } from "../src";

describe("shared workbook import capability", () => {
  it("imports CSV as data, preserving text by default and explicit headers", async () => {
    const bytes = new TextEncoder().encode("id,amount\n001,12\n002,7\n");
    const result = await importWorkbook(bytes, { format: "csv", sheetName: "Data", headers: [{ sheetName: "Data", headerRows: 1, headerColumns: 0 }] });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const inspected = await inspectWorkbook(result.data.candidate.source, { sheet: "Data" });
    expect(inspected.status).toBe("completed");
    if (inspected.status !== "completed") return;
    expect(inspected.data.sheets[0]).toMatchObject({ headerRowCount: 1, headerColumnCount: 0 });
    expect(inspected.data.selection?.cells[1].map(cell => cell.input)).toEqual(['"001"', '"12"']);
  });

  it("imports XLSX formulas through core without trusting cached values", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Numbers");
    sheet.addRow([2, 3, { formula: "A1+B1", result: 999 }]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const result = await importWorkbook(bytes, { format: "xlsx" });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const evaluation = await evaluateWorkbook(result.data.candidate.source, { query: { sheet: "Numbers" } });
    expect(evaluation.status).toBe("completed");
    if (evaluation.status !== "completed") return;
    expect(evaluation.data.selection?.values[0][2]).toEqual({ kind: "number", value: "5" });
  });

  it("rejects ambiguous or invalid requests before conversion", async () => {
    const bytes = new TextEncoder().encode("a,b\n1,2\n");
    expect((await importWorkbook(bytes, { format: "csv", sheetName: "Data", mystery: true })).status).toBe("rejected");
    expect((await importWorkbook(bytes, { format: "csv" })).status).toBe("rejected");
    expect((await importWorkbook(bytes, { format: "xlsx" })).status).toBe("rejected");
    const invalidUtf8 = await importWorkbook(new Uint8Array([0xff]), { format: "csv", sheetName: "Data" });
    expect(invalidUtf8.status).toBe("rejected");
    if (invalidUtf8.status === "rejected") expect(invalidUtf8.failure).toMatchObject({ stage: "import", code: "invalid_utf8" });
  });
});
