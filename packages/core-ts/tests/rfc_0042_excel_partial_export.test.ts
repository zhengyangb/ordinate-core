import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, exportExcelWorkbook, serializeDocumentState } from "../src";

async function load(source: string) {
  const document = DocumentState.fromText(source);
  const before = serializeDocumentState(document);
  const result = await exportExcelWorkbook(document, { cellErrors: "blank" });
  expect(serializeDocumentState(document)).toBe(before);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.value.slice().buffer);
  return { workbook, diagnostics: result.diagnostics };
}

describe("explicit Excel blank-cell export policy", () => {
  it.each(['= 1/0', '= "x" * 2', '= A1', '= Missing(A1)', '= sum(', 'error[type_error]', '= 1e308 * 1e308', '= len(trim(" word "))'])(
    "omits %s without losing adjacent values or supported formulas", async input => {
      const { workbook, diagnostics } = await load(`# Data\n| ${input} | 4 | = B1 * 2 |`);
      const sheet = workbook.getWorksheet("Data")!;
      expect(sheet.getCell("A1").value).toBeNull();
      expect(sheet.getCell("B1").value).toBe(4);
      expect(sheet.getCell("C1").formula).toBe("B1*2");
      expect(sheet.getCell("C1").result).toBeUndefined();
      expect(diagnostics).toContainEqual(expect.objectContaining({ code:"cell_omitted", severity:"warning", sheetName:"Data", rowIndex:0, colIndex:0 }));
      expect(diagnostics.every(item => item.severity === "warning")).toBe(true);
    },
  );
  it("collects every failed cell across sheets, including propagated errors", async () => {
    const { workbook, diagnostics } = await load('# Data\n| = 1/0 | = A1 * 2 | 7 |\n# Other\n| = "x" * 2 | 8 |');
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Data", "Other"]);
    expect(workbook.getWorksheet("Data")!.getCell("B1").value).toBeNull();
    expect(workbook.getWorksheet("Other")!.getCell("B1").value).toBe(8);
    expect(diagnostics.filter(item => item.code === "cell_omitted").map(item => [item.sheetName, item.rowIndex, item.colIndex]))
      .toEqual([["Data",0,0], ["Data",0,1], ["Other",0,0]]);
  });
  it("keeps literal text that resembles an error or formula", async () => {
    const { workbook, diagnostics } = await load('# Data\n| "#VALUE!" | "=1/0" |');
    expect(workbook.getWorksheet("Data")!.getCell("A1").value).toBe("#VALUE!");
    expect(workbook.getWorksheet("Data")!.getCell("B1").value).toBe("=1/0");
    expect(diagnostics.some(item => item.code === "cell_omitted")).toBe(false);
  });
  it("retains strict export as an explicit library policy", async () => {
    const result = await exportExcelWorkbook(DocumentState.fromText('# Data\n| = len(trim(" word ")) |'), {cellErrors:"reject"});
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
  });
  it.each([{cellErrors:"ignore"}, {cellErrors:null}, {cellErrors:"blank", unknown:true}])("fails early for invalid options %j", async options => {
    const result = await exportExcelWorkbook(DocumentState.fromText('# Data\n| 1 |'), options as never);
    expect(result).toMatchObject({ok:false, diagnostics:expect.arrayContaining([expect.objectContaining({code:"invalid_options"})])});
  });
  it("does not suppress resource limits", async () => {
    const result = await exportExcelWorkbook(DocumentState.fromText('# Data\n| 1 | 2 |'), {cellErrors:"blank", limits:{maxCells:1}});
    expect(result).toMatchObject({ok:false, diagnostics:expect.arrayContaining([expect.objectContaining({code:"limit_exceeded"})])});
    expect(result).not.toHaveProperty("value");
  });
  it("does not suppress invalid sheet names", async () => {
    const result = await exportExcelWorkbook(DocumentState.fromText('# Invalid/name\n| 1 |'), {cellErrors:"blank"});
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
  });
});
