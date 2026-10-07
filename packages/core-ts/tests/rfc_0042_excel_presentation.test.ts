import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { DocumentState, serializeDocumentState, exportExcelWorkbook, groupHeaderSpans, resolveDocumentPresentation } from "../src";
import { applyExcelCellPresentation, resolveExcelSheetLayout, type ExcelDisplayCell, type ExcelSheetPresentation } from "../src/excel/exportPresentation";

const text = (value: string): ExcelDisplayCell => ({ text: value, numeric: false });
const number = (value: string): ExcelDisplayCell => ({ text: value, numeric: true });
const layout = (cells: ExcelDisplayCell[][], headerRows = 0, headerColumns = 0) =>
  resolveExcelSheetLayout({ cells, headerRows, headerColumns }, cells.length, cells[0].length);
async function exported(source: string | DocumentState, freezeHeaders = false) {
  const doc = typeof source === "string" ? DocumentState.fromText(source) : source;
  const before = serializeDocumentState(doc);
  const result = await exportExcelWorkbook(doc, { freezeHeaders });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(serializeDocumentState(doc)).toBe(before);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.value.slice().buffer);
  return { workbook, sheet: workbook.worksheets[0], result };
}

describe("Excel export layout policy", () => {
  it("keeps ordinary text compact and wraps long outliers instead of widening the whole column", () => {
    const cells = Array.from({ length: 10 }, (_, i) => [text(i === 9 ? "a long description ".repeat(50) : "Product A")]);
    const result = layout(cells);
    expect(result.widths).toEqual([14]);
    expect(result.heights[0]).toBe(20);
    expect(result.heights[9]).toBeGreaterThan(20);
    expect(result.heights[9]).toBeLessThanOrEqual(409);
  });
  it("caps consistently long text and gives labels more space", () => {
    expect(layout([[text("long ".repeat(60))]]).widths).toEqual([44]);
    expect(layout([[text("long ".repeat(60))]], 0, 1).widths).toEqual([36]);
    expect(layout([[text("Name")]], 0, 1).widths).toEqual([20]);
  });
  it("fits the largest numeric value, even when it is a rare outlier", () => {
    const cells = Array.from({ length: 100 }, (_, i) => [number(i === 99 ? "123,456,789,012,345.67" : "2")]);
    expect(layout(cells).widths[0]).toBeGreaterThan(20);
    expect(layout(cells).heights.every(height => height === 20)).toBe(true);
  });
  it("measures CJK, emoji, explicit line breaks and word wrapping", () => {
    expect(layout([[text("中文标题中文标题中文标题")]]).widths[0]).toBeGreaterThan(layout([[text("abcdefghijkl")]]).widths[0]);
    expect(layout([[text("hello\nworld")]]).heights).toEqual([35]);
    expect(layout([[text("🙂".repeat(20))]]).widths[0]).toBeGreaterThan(30);
    expect(layout([[text("largeword ".repeat(10))]]).heights[0]).toBeGreaterThan(20);
  });
  it("leaves empty columns narrow and respects all header levels", () => {
    const result = layout([[text("Header"), text("")], [text("Detail"), text("")], [text("Name"), number("5")]], 2, 1);
    expect(result.widths).toEqual([20, 12]);
    expect(result.heights).toEqual([24, 24, 20]);
  });
  it.each([
    { cells: [], headerRows: 0, headerColumns: 0 },
    { cells: [[text("a")]], headerRows: 2, headerColumns: 0 },
    { cells: [[text("a")]], headerRows: 0, headerColumns: -1 },
    { cells: [[text("a")]], headerRows: 0.5, headerColumns: 0 },
  ])("fails early for mismatched dimensions or headers", presentation => {
    expect(() => resolveExcelSheetLayout(presentation as ExcelSheetPresentation, 1, 1)).toThrow(/presentation must match/);
  });
});

describe("Excel export presentation integration", () => {
  it("centers automatic header rows, including merged headers, without centering body labels or data", async () => {
    const { sheet } = await exported('# Report\n| Period || 2025 | 2025 |\n| Item || H1 | H2 |\n| --- || --- | --- |\n| Revenue || 120 | 140 |');
    for (const address of ['A1', 'B1', 'C1', 'A2', 'B2', 'C2']) {
      expect(sheet.getCell(address).alignment.horizontal).toBe('center');
    }
    for (const address of ['A3', 'B3', 'C3']) {
      expect(sheet.getCell(address).alignment.horizontal).toBeUndefined();
    }
  });
  it.each(['left', 'right', 'center'] as const)("keeps explicit %s alignment over the automatic header default", alignment => {
    const sheet = new ExcelJS.Workbook().addWorksheet('Header');
    const cell = sheet.getCell('A1');
    cell.alignment = { horizontal: alignment };
    applyExcelCellPresentation(cell, { headerRows: 1, headerColumns: 0, cells: [[text('Title')]], freezeHeaders: false }, 0, 0);
    expect(cell.alignment).toMatchObject({ horizontal: alignment, vertical: 'top', wrapText: true });
  });
  it("exports two spaces per resolved hierarchy level without changing data, formulas or the source", async () => {
    const { sheet, result } = await exported('# Tree\n| Item || Amount |\n| --- || --- |\n| Parent || 10 |\n| * Child || 20 |\n| ** Grandchild || = B2 + B3 |\n| Sibling || 40 |');
    expect([2,3,4,5].map(row => sheet.getCell(row,1).value)).toEqual(['Parent','  Child','    Grandchild','Sibling']);
    expect(sheet.getCell('B4').formula).toBe('B2+B3');
    expect(sheet.getCell('B3').value).toBe(20);
    expect(result.diagnostics.filter(item => item.message.includes('Hierarchy'))).toEqual([
      expect.objectContaining({code:'presentation_approximated',sheetName:'Tree'}),
    ]);
    expect(strFromU8(unzipSync(result.value)['xl/sharedStrings.xml'])).toContain('xml:space="preserve">    Grandchild');
  });
  it("uses normalized hierarchy depth like the UI, not the raw number of markers", async () => {
    const { sheet } = await exported('# Tree\n| *** First || 1 |\n| *** Next || 2 |\n| Plain || 3 |');
    expect([1,2,3].map(row => sheet.getCell(row,1).value)).toEqual(['First','  Next','Plain']);
  });
  it("does not reinterpret unheaded text as hierarchy or indent other label columns", async () => {
    const plain = await exported('# Data\n| "* literal" | 2 |');
    expect(plain.sheet.getCell('A1').value).toBe('* literal');
    const labels = await exported('# Tree\n| Parent | Other || 1 |\n| * Child | * Literal || 2 |');
    expect(labels.sheet.getCell('A2').value).toBe('  Child');
    expect(labels.sheet.getCell('B2').value).toBe('* Literal');
  });
  it("writes the exact screen/print header groups as horizontal Excel merges, including blanks", async () => {
    const source = '# Groups\n| Same || Same | Same | Next | Next |\n| Label || H1 | H1 |  |  |\n| --- || --- | --- | --- | --- |\n| Row || 1 | 2 | 3 | 4 |\n| Row || 5 | 6 | 7 | 8 |';
    const doc = DocumentState.fromText(source), labels = resolveDocumentPresentation(doc).sheets[0].headerDisplayRows;
    const expected = labels.flatMap((row,r) => groupHeaderSpans(row.map((_,colIndex)=>({colIndex})),row,1)
      .filter(span=>span.end>span.start).map(span=>`${String.fromCharCode(65+span.start)}${r+1}:${String.fromCharCode(65+span.end)}${r+1}`));
    const { sheet, result } = await exported(doc);
    expect(sheet.model.merges).toEqual(expected);
    expect(expected).toEqual(['B1:C1','D1:E1','B2:C2','D2:E2']);
    expect(sheet.getCell('C1').master.address).toBe('B1');
    expect(sheet.getCell('C1').value).toBe('Same');
    expect(sheet.getCell('A3').isMerged).toBe(false);
    expect(sheet.getCell('A4').isMerged).toBe(false);
    expect(strFromU8(unzipSync(result.value)['xl/worksheets/sheet1.xml'])).toContain('<mergeCell ref="B1:C1"');
  });
  it("never merges repeated values in a header-column-only or plain data sheet", async () => {
    const { workbook } = await exported('# Labels\n| Same || 1 | 1 |\n| Same || 1 | 1 |\n# Plain\n| "Same" | "Same" |\n| "Same" | "Same" |');
    expect(workbook.worksheets.every(sheet=>sheet.model.merges.length===0)).toBe(true);
  });
  it("sizes merged header height from its combined width", () => {
    const title = 'A very long multi-column heading '.repeat(2);
    const header = layout([[text(title),text(title),text(title)]],1);
    const unmerged = layout([[text(title),text('Other'),text('Third')]],1);
    expect(header.heights).toEqual([24]);
    expect(unmerged.heights[0]).toBeGreaterThan(24);
  });
  it("styles and freezes multi-level header rows and label columns without creating an Excel Table", async () => {
    const { sheet } = await exported('# Report\n| Period || 2025 | 2025 |\n| Item || H1 | H2 |\n| --- || --- | --- |\n| Revenue || 120 | 140 |', true);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 1, ySplit: 2 });
    expect(sheet.getTables()).toEqual([]);
    expect(sheet.getCell("B1").value).toBe("2025");
    expect(sheet.getCell("B1").font).toMatchObject({ bold: true, scheme: "minor", size: 11 });
    expect(sheet.getCell("A3").font.bold).toBe(true);
    expect(sheet.getCell("B3").font.bold).not.toBe(true);
    expect(sheet.getCell("B1").fill).toMatchObject({ type: "pattern", pattern: "solid", fgColor: { theme: 0, tint: -0.08 } });
    expect(sheet.getCell("A3").fill).toMatchObject({ fgColor: { theme: 0, tint: -0.04 } });
    expect(sheet.getCell("B3").fill).toMatchObject({ pattern: "none" });
  });
  it("does not invent headers, filters, banding or borders", async () => {
    const { sheet } = await exported('# Data\n| "Name" | 123 |\n| "A" | 456 |');
    expect(sheet.views).toBeNull();
    expect(sheet.autoFilter).toBeUndefined();
    expect(sheet.getCell("A1").font.bold).not.toBe(true);
    expect(sheet.getCell("A1").border).toEqual({});
    expect(sheet.getCell("A1").numFmt).toBeUndefined();
    expect(sheet.getCell("B1").alignment.wrapText).not.toBe(true);
  });
  it("leaves headers unfrozen by default while retaining their decoration", async () => {
    const { sheet } = await exported('# Data\n| Item || Amount |\n| --- || --- |\n| Revenue || 100 |');
    expect(sheet.views).toBeNull();
    expect(sheet.getCell("A1").font.bold).toBe(true);
    expect(sheet.getCell("A1").fill).toMatchObject({ pattern: "solid" });
  });
  it("freezes each sheet's own bands only when opted in, including column-only headers", async () => {
    const { workbook } = await exported('# Rows\n| Name | Amount |\n| --- | --- |\n| "A" | 5 |\n# Columns\n| Revenue || 5 |\n# Plain\n| "A" | 5 |', true);
    expect(workbook.getWorksheet("Rows")!.views[0]).toMatchObject({ xSplit: 0, ySplit: 1 });
    expect(workbook.getWorksheet("Columns")!.views[0]).toMatchObject({ xSplit: 1, ySplit: 0 });
    expect(workbook.getWorksheet("Plain")!.views).toBeNull();
  });
  it.each(["true", 1, null, []])("rejects invalid freezeHeaders=%j instead of coercing it", async freezeHeaders => {
    const result = await exportExcelWorkbook(DocumentState.fromText('# Data\n| 1 |'), { freezeHeaders } as never);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "invalid_options" }));
  });
  it("sizes formula results, not long source, and still requests Excel recalculation", async () => {
    const { sheet, result } = await exported(`# Data\n| = ${Array(30).fill("1").join("+")} |`);
    expect(sheet.getColumn(1).width).toBe(12);
    expect(sheet.getCell("A1").formula).toHaveLength(59);
    expect(sheet.getCell("A1").result).toBeUndefined();
    expect(strFromU8(unzipSync(result.value)["xl/workbook.xml"])).toContain('fullCalcOnLoad="1"');
  });
  it("uses existing formatted values, including dates and grouped numbers, without imposing numeric precision", async () => {
    const doc = DocumentState.fromText('# Data\n| 123456789.125 {:,.2f} | 2026-10-06 | 1.23456789 |');
    const { sheet } = await exported(doc);
    expect(sheet.getColumn(1).width).toBeGreaterThan(14);
    expect(sheet.getColumn(2).width).toBeGreaterThanOrEqual(12);
    expect(sheet.getCell("A1").numFmt).toContain("0.00");
    expect(sheet.getCell("B1").numFmt).toBe("yyyy-mm-dd");
    expect(sheet.getCell("C1").numFmt).toBeUndefined();
    expect(sheet.getCell("C1").value).toBe(1.23456789);
  });
  it("preserves explicit normal weight, color and alignment with a complete theme font", async () => {
    const doc = DocumentState.fromText('# Data\n| "Note" | 12 |');
    doc.sheets[0].setColumnDefaultStyleByIndex(0, { weight: "bold", color: "red", align: "right" });
    doc.sheets[0].setCellLocalStyleByIndex(0, 0, { weight: "normal" });
    const { sheet } = await exported(doc);
    expect(sheet.getCell("A1").font).toMatchObject({ name: "Calibri", size: 11, family: 2, scheme: "minor", color: { argb: "FFFF0000" } });
    expect(sheet.getCell("A1").font.bold).not.toBe(true);
    expect(sheet.getCell("A1").alignment).toMatchObject({ horizontal: "right", vertical: "top", wrapText: true });
  });
  it("persists bounded width, wrapping and fitted heights on a saved workbook", async () => {
    const value = "This is a longer plain-text note that should remain readable without stretching a column across the entire screen. ".repeat(3);
    const { sheet } = await exported(`# Data\n| ${JSON.stringify(value)} | 2 |`);
    expect(sheet.getColumn(1).width).toBe(44);
    expect(sheet.getCell("A1").value).toBe(value);
    expect(sheet.getCell("A1").alignment.wrapText).toBe(true);
    expect(sheet.getRow(1).height).toBeGreaterThan(20);
  });
  it("exports edited multiline text without flattening or changing it into a formula", async () => {
    const doc = DocumentState.fromText('# Data\n| "text" |');
    doc.setCellByIndex("Data", 0, 0, JSON.stringify("Line one\nLine two"));
    const { sheet } = await exported(doc);
    expect(sheet.getCell("A1").value).toBe("Line one\nLine two");
    expect(sheet.getRow(1).height).toBe(35);
    expect(sheet.getCell("A1").alignment.wrapText).toBe(true);
  });
});
