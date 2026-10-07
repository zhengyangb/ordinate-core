import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import {
  DocumentState, exportExcelWorkbook, getCellTextView, importExcelWorkbook, serializeDocumentState,
} from "../src";
import { ExcelReport } from "../src/excel/contracts";

describe("RFC-0042 directional compatibility contract", () => {
  // Readable imports can be exported without generated emulation machinery.
  it.each([
    { formula: "SUM(A1:B2)", expected: 10, edited: 15, missing: /filter/ },
    { formula: "INDEX(A1:B2,2,1)", expected: 3, edited: 3, missing: /slice/i },
  ])("retains editable $formula and re-exports its operation", async test => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");
    sheet.addRows([[1, 2], [3, 4]]);
    sheet.getCell("J1").value = { formula: test.formula, result: 987654321 };
    const imported = await importExcelWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(imported.ok, JSON.stringify(imported.diagnostics)).toBe(true);
    if (!imported.ok) throw new Error("Expected a supported import");
    expect(imported.value.evaluate().sheets[0].values[0][9]).toEqual({ kind: typeof test.expected, value: test.expected });

    const document = DocumentState.fromText(serializeDocumentState(imported.value));
    document.setCellByIndex("Data", 0, 0, "6");
    expect(document.evaluate().sheets[0].values[0][9]).toEqual({ kind: typeof test.edited, value: test.edited });
    expect(document.sheets[0].cells[0][9].body).toMatchObject({ valid: true, kind: "formula" });
    const formula = getCellTextView(document.sheets[0].cells[0][9]).inputText;
    const before = serializeDocumentState(document);
    const exported = await exportExcelWorkbook(document);
    expect(exported.ok, JSON.stringify(exported.diagnostics)).toBe(true);
    if (!exported.ok) throw new Error("Export failed");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(exported.value as never);
    expect(reopened.getWorksheet("Data")!.getCell("J1").formula).not.toMatch(/ISNUMBER|ISBLANK|FILTER/);
    expect(serializeDocumentState(document)).toBe(before);
    document.setCellByIndex("Data", 0, 0, "1");
    expect(document.evaluate().sheets[0].values[0][9]).toEqual({ kind: typeof test.expected, value: test.expected });
  });

  it("exports native VALUE without promising reverse compatibility", async () => {
    const document = DocumentState.fromText('# Data\n| "12" | = number(A1) |');
    const exported = await exportExcelWorkbook(document);
    expect(exported.ok, JSON.stringify(exported.diagnostics)).toBe(true);
    if (!exported.ok) throw new Error("Expected a supported export");
    expect(exported.diagnostics).toContainEqual(expect.objectContaining({ code: "semantic_difference",
      message: expect.stringContaining("Excel's rules") }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.value.slice().buffer);
    const cell = workbook.getWorksheet("Data")!.getCell("B1");
    expect(cell.formula).toBe("VALUE(A1)");
    expect(cell.result).toBeUndefined();
    const imported = await importExcelWorkbook(exported.value);
    expect(imported).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_formula", severity: "error", sheetName: "Data",
        rowIndex: 0, colIndex: 1, formula: cell.formula }),
    ]) });
    expect(imported).not.toHaveProperty("value");
  });

  it("returns no partial workbook when a later sheet fails, preserving earlier warnings and native editing", async () => {
    const document = DocumentState.fromText('---\nfuture: metadata\n---\n# Good\n| 2 | = A1 + 1 |\n# Bad\n| = len(trim(" word ")) |');
    const before = serializeDocumentState(document);
    const state = structuredClone(document);
    const result = await exportExcelWorkbook(document);
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "metadata_omitted", severity: "warning" }),
      expect.objectContaining({ code: "unsupported_formula", severity: "error", sheetName: "Bad", rowIndex: 0, colIndex: 0 }),
    ]) });
    expect(result).not.toHaveProperty("value");
    expect(structuredClone(document)).toEqual(state);
    expect(serializeDocumentState(document)).toBe(before);
    document.setCellByIndex("Good", 0, 0, "5");
    const evaluated = document.evaluate();
    expect(evaluated.sheets[0].values[0][1]).toEqual({ kind: "number", value: 6 });
    expect(evaluated.sheets[1].values[0][0]).toEqual({ kind: "number", value: 4 });
  });

  it("does not disguise programmer invariant failures as compatibility errors", async () => {
    const report = new ExcelReport();
    const defect = new Error("Unexpected translator invariant failure");
    await expect(report.run(async () => { throw defect; })).rejects.toBe(defect);
  });

  it("loads and evaluates native documents without loading any XLSX IO dependencies", async () => {
    vi.resetModules();
    const forbidden = () => { throw new Error("Excel IO dependency loaded during native startup"); };
    vi.doMock("exceljs", forbidden);
    vi.doMock("fflate", forbidden);
    vi.doMock("saxes", forbidden);
    try {
      const core = await import("../src");
      const document = core.DocumentState.fromText('# Native\n| = len(trim(" word ")) |');
      expect(document.evaluate().sheets[0].values[0][0]).toEqual({ kind: "number", value: 4 });
    } finally {
      vi.doUnmock("exceljs");
      vi.doUnmock("fflate");
      vi.doUnmock("saxes");
      vi.resetModules();
    }
  });
});
