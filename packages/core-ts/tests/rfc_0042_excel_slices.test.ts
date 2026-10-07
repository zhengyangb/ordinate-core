import { describe, expect, it } from "vitest";
import { DocumentState, exportExcelWorkbook, serializeDocumentState } from "../src";
import { exportFormula } from "../src/excel/exportFormula";
import { DEFAULT_EXCEL_LIMITS, ExcelReport } from "../src/excel/contracts";
import { exportedFormula, formulaDocument } from "./fixtures/excelExport";

describe("RFC-0042 static reference slices export as readable A1 selections", () => {
  it.each([
    ["sum(A1:A2[0:2])", "SUM(A1:A2)"],
    ["sum(A1:C1[0:2])", "SUM(A1:B1)"],
    ["sum(A1:C1[1:])", "SUM(B1:C1)"],
    ["sum(A1:C1[:2])", "SUM(A1:B1)"],
    ["sum(A1:C1[:])", "SUM(A1:C1)"],
    ["sum(A1:C1[-2:])", "SUM(B1:C1)"],
    ["sum(A1:C1[:-1])", "SUM(A1:B1)"],
    ["sum(A1:C1[-99:99])", "SUM(A1:C1)"],
    ["sum(A1:C2[0:1,1:3])", "SUM(B1:C1)"],
    ["sum(A1:C2[:,1])", "SUM(B1:B2)"],
    ["sum(A1:C2[-1,:])", "SUM(A2:C2)"],
    ["sum(A1:C2[:,1:][:,0])", "SUM(B1:B2)"],
    ["sum(A1:C1[0:1])", "SUM(A1:A1)"],
    ["countblank($A$1:$C$2[:,1:])", "COUNTBLANK($B$1:$C$2)"],
    ["rowCount(A1:C2[:,1])", "ROWS(B1:B2)"],
    ["columnCount(A1:C2[0,:])", "COLUMNS(A1:C1)"],
    ["A1:C2[:,1][0]", "INDEX(B1:B2,1)"],
    ["sum($A1:C$2[:,:])", "SUM($A1:C$2)"],
  ])("%s → %s", async (source, target) => {
    const document = formulaDocument(source);
    const before = serializeDocumentState(document);
    const { cell } = await exportedFormula(document);
    expect(cell.formula).toBe(target);
    expect(cell.result).toBeUndefined();
    expect(serializeDocumentState(document)).toBe(before);
  });

  it("exports the reported named-column selection without type guards", async () => {
    const document = DocumentState.fromText('# Report\n| Item || Revenue |\n| --- || --- |\n| One || 12 |\n| Two || 23 |\n| Total || = sum(@[#2:#3,Revenue][0:2]) |');
    expect(document.evaluate().sheets[0].values[2][1]).toEqual({ kind: "number", value: 35 });
    const { workbook } = await exportedFormula(document);
    expect(workbook.worksheets[0].getCell("B4").formula).toBe("SUM($B2:$B3)");
  });

  it("preserves cross-sheet quoting and locks", async () => {
    const document = DocumentState.fromText("# O'Brien!\n| 1 | 2 | 3 |\n# Result\n| = sum(@[\"O'Brien!\"::[#1,#1$:#3$]][1:]) |");
    const { workbook } = await exportedFormula(document);
    expect(workbook.worksheets[1].getCell("A1").formula).toBe("SUM('O''Brien!'!$B1:$C1)");
  });

  it("never widens a sliced sparse selection to include skipped parent totals", () => {
    const document = DocumentState.fromText('# Data\n| Item || Amount |\n| --- || --- |\n| North || 1000 |\n| * One || 1 |\n| * Two || 2 |\n| South || 2000 |\n| * Three || 3 |\n| Total || = sum(@[:,Amount][1:3]) |');
    document.evaluate();
    const sheet = document.sheets[0], body = sheet.cells[6][1].body;
    if (!body.valid || body.kind !== "formula") throw new Error("Invalid fixture");
    sheet.dataRowIndices = [2, 3, 5];
    const result = exportFormula(body.expression, document, sheet,
      { sheetName: "Data", rowIndex: 6, colIndex: 1 }, DEFAULT_EXCEL_LIMITS, new ExcelReport());
    expect(result.formula).toBe("SUM($B$4,$B$6)");
  });

  it.each([
    "sum(A1:C1[1:1])", "sum(A1:C1[2:1])", "sum(A1:C1[99:])",
    "sum(A1:C1[0.5:2])", 'sum(A1:C1["0":2])', "sum(A1:C1[A2:2])",
    "sum(A1:C2[0:2])", "sum(A1:C2[:,9])", "sum((A1:C1+1)[0:2])",
    "sum(number(A1:C1)[0:2])", "sum(isNumber(A1:C1)[0:2])",
    "sum(if(true,A1:C1,A1:C1)[0:2])", "sum([1,2,3][0:2])",
  ])("reports unsupported/invalid %s without exporting another selection", async source => {
    const result = await exportExcelWorkbook(formulaDocument(source));
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_formula", rowIndex: 0, colIndex: 9 }),
    ]) });
    expect(result).not.toHaveProperty("value");
  });
});
