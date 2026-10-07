import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { DocumentState, serializeDocumentState } from "../src";
import { importExcelWorkbook, exportExcelWorkbook } from "../src/excel";
import { resolveDocumentPresentation } from "../src/presentation";
import { ExcelReport } from "../src/excel/contracts";
import { EXCEL_TEXT_COLORS, importCellStyle, exportCellStyle } from "../src/excel/styleTranslation";

async function bytes(setup: (sheet: ExcelJS.Worksheet) => void) {
  const book = new ExcelJS.Workbook();
  setup(book.addWorksheet("Data"));
  return new Uint8Array(await book.xlsx.writeBuffer());
}
async function imported(input: Uint8Array) {
  const result = await importExcelWorkbook(input);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}
async function exported(doc: DocumentState, blank = false) {
  const result = await exportExcelWorkbook(doc, { cellErrors: blank ? "blank" : "reject" });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(result.value as unknown as Parameters<typeof book.xlsx.load>[0]);
  return { book, result };
}
function effective(doc: DocumentState, row = 0, col = 0) {
  return resolveDocumentPresentation(doc).sheets[0].cells[row][col].styleLayer.effective;
}

describe("RFC-0042 basic style interchange", () => {
  it.each(["left", "center", "right"] as const)("retains %s alignment, bold and color through saved ORD and XLSX", async align => {
    const source = await bytes(sheet => {
      sheet.getCell("A1").value = "styled";
      sheet.getCell("A1").font = { bold: true, color: { argb: EXCEL_TEXT_COLORS.red } };
      sheet.getCell("A1").alignment = { horizontal: align };
    });
    const result = await imported(source);
    expect(effective(result.value)).toEqual({ align, weight: "bold", color: "red" });
    const restored = DocumentState.fromText(serializeDocumentState(result.value));
    expect(effective(restored)).toEqual(effective(result.value));
    const output = await exported(restored);
    const cell = output.book.worksheets[0].getCell("A1");
    expect(cell.font).toMatchObject({ bold: true, color: { argb: EXCEL_TEXT_COLORS.red } });
    expect(cell.alignment).toMatchObject({ horizontal: align });
    expect(cell.value).toBe("styled");
    expect(result.diagnostics).toEqual([]);
    expect(output.result.diagnostics).toEqual([]);
  });
  it("keeps formula source translation independent from its style", async () => {
    const result = await imported(await bytes(sheet => {
      sheet.getCell("A1").value = 2;
      sheet.getCell("B1").value = { formula: "A1+1" };
      sheet.getCell("B1").font = { bold: true, color: { argb: EXCEL_TEXT_COLORS.blue } };
    }));
    const output = await exported(result.value);
    result.value.sheets[0].clearCellLocalStyleByIndex(0, 1);
    const unstyled = await exported(result.value);
    expect(output.book.worksheets[0].getCell("B1").formula).toBe(unstyled.book.worksheets[0].getCell("B1").formula);
    expect(output.book.worksheets[0].getCell("B1").font.color).toEqual({ argb: EXCEL_TEXT_COLORS.blue });
  });
  it("retains styles on serialized blank cells", async () => {
    const result = await imported(await bytes(sheet => { sheet.getCell("C3").font = { bold: true }; }));
    expect(effective(result.value, 2, 2)?.weight).toBe("bold");
    const output = await exported(result.value);
    expect(output.book.worksheets[0].getCell("C3").font.bold).toBe(true);
    expect(output.book.worksheets[0].getCell("C3").value).toBeNull();
  });
  it("imports row/column inherited styles on populated cells", async () => {
    const result = await imported(await bytes(sheet => {
      sheet.getColumn(1).alignment = { horizontal: "right" };
      sheet.getRow(1).font = { bold: true };
      sheet.getCell("A1").value = 10;
    }));
    expect(effective(result.value)).toEqual({ align: "right", weight: "bold", color: null });
  });
  it("exports the existing per-axis cascade, including explicit normal weight, without mutating the document", async () => {
    const doc = DocumentState.fromText('# Data\n| One || 1 | 2 |\n| Two || 3 | 4 |');
    const sheet = doc.sheets[0];
    sheet.setColumnDefaultStyleByIndex(1, { align: "right", color: "blue", weight: "bold" });
    sheet.setRowDefaultStyleByIndex(0, { color: "red" });
    sheet.setCellLocalStyleByIndex(0, 1, { weight: "normal" });
    const before = serializeDocumentState(doc);
    const { book, result } = await exported(doc);
    expect(book.worksheets[0].getCell("B1").font).toMatchObject({ color: { argb: EXCEL_TEXT_COLORS.red } });
    expect(book.worksheets[0].getCell("B1").font.bold).not.toBe(true);
    expect(book.worksheets[0].getCell("B1").alignment.horizontal).toBe("right");
    expect(book.worksheets[0].getCell("B2").font).toMatchObject({ bold: true, color: { argb: EXCEL_TEXT_COLORS.blue } });
    expect(book.worksheets[0].getCell("C1").font.color).toEqual({ argb: EXCEL_TEXT_COLORS.red });
    expect(book.worksheets[0].getCell("A1").font).toMatchObject({ scheme: "minor", bold: true });
    expect(result.diagnostics).toEqual([]);
    expect(serializeDocumentState(doc)).toBe(before);
  });
  it("adds theme-following typography and dimensions, not borders or body fills", async () => {
    const { result, book } = await exported(DocumentState.fromText('# Data\n| 1 | "hello" |'));
    const zip = unzipSync(result.value);
    const sheet = strFromU8(zip["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("<cols>");
    expect(sheet).toContain('customHeight="1"');
    expect(book.worksheets[0].getCell("A1").font.scheme).toBe("minor");
    expect(book.worksheets[0].getCell("A1").fill.pattern).toBe("none");
    expect(book.worksheets[0].getCell("A1").border).toEqual({});
  });
  it("preserves style when a failed cell is exported blank", async () => {
    const doc = DocumentState.fromText('# Data\n| = 1/0 |');
    doc.sheets[0].setCellLocalStyleByIndex(0, 0, { weight: "bold", color: "red" });
    const { book, result } = await exported(doc, true);
    expect(book.worksheets[0].getCell("A1").value).toBeNull();
    expect(book.worksheets[0].getCell("A1").font.bold).toBe(true);
    expect(result.diagnostics.some(d => d.code === "cell_omitted")).toBe(true);
  });
  it("keeps supported styles while warning about unsupported formatting", async () => {
    const result = await imported(await bytes(sheet => {
      const cell = sheet.getCell("A1"); cell.value = 12;
      cell.font = { bold: true, italic: true, name: "Arial", size: 18 };
      cell.numFmt = "0.00";
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
      cell.border = { bottom: { style: "thin" } };
      cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
    }));
    expect(effective(result.value)).toEqual({ align: "right", weight: "bold", color: null });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "presentation_omitted", rowIndex: 0, colIndex: 0 }));
  });
  it("resolves custom theme colors and tint from the related theme part, not a hardcoded Office palette", async () => {
    const original = await bytes(sheet => {
      sheet.getCell("A1").value = 1;
      sheet.getCell("A1").font = { color: { theme: 4, tint: 0.2 } as Partial<ExcelJS.Color> };
    });
    const zip = unzipSync(original);
    zip["xl/theme/custom.xml"] = strToU8(strFromU8(zip["xl/theme/theme1.xml"]).replace(/<a:accent1>[\s\S]*?<\/a:accent1>/, '<a:accent1><a:srgbClr val="CC2233"/></a:accent1>'));
    delete zip["xl/theme/theme1.xml"];
    zip["xl/_rels/workbook.xml.rels"] = strToU8(strFromU8(zip["xl/_rels/workbook.xml.rels"]).replace("theme/theme1.xml", "theme/custom.xml"));
    const result = await imported(zipSync(zip));
    expect(effective(result.value)?.color).toBe("red");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "presentation_approximated" }));
  });
});

describe("bounded color approximation", () => {
  it.each([
    ["FFFF0000", "red", false], ["FF008000", "green", false], ["FF0000FF", "blue", false],
    ["CC2233", "red", true], ["FF22AA55", "green", true], ["FF3377CC", "blue", true],
    ["FFCC2244", "red", true], ["FFEE6644", "red", true],
  ] as const)("maps %s to %s with approximation=%s", (argb, color, approximated) => {
    const report = new ExcelReport();
    expect(importCellStyle({ font: { color: { argb } } }, new Map(), report, {})?.color).toBe(color);
    expect(report.diagnostics.length).toBe(approximated ? 1 : 0);
  });
  it.each(["FF888888", "FFFDF0F0", "FF010000", "FFFFFF00", "FFFF00FF", "FF00FFFF", "not-a-color"])("does not force unsupported %s into an accent", argb => {
    const report = new ExcelReport();
    expect(importCellStyle({ font: { color: { argb } } }, new Map(), report, {})).toBeNull();
    expect(report.diagnostics[0].code).toBe("presentation_omitted");
  });
  it.each(["FF000000", "FFFFFFFF"])("keeps neutral %s theme-adaptive", argb => {
    const report = new ExcelReport();
    expect(importCellStyle({ font: { color: { argb } } }, new Map(), report, {})).toBeNull();
    expect(report.diagnostics).toEqual([]);
  });
  it.each([{}, { theme: 99 }, { indexed: 2 }, { argb: "FFFF0000", tint: 2 }, { argb: "FFFF0000", tint: NaN }])("reports unresolved or invalid colors %j without blocking values", color => {
    const report = new ExcelReport();
    expect(importCellStyle({ font: { color } }, new Map(), report, {})).toBeNull();
    expect(report.diagnostics[0].code).toBe("presentation_omitted");
  });
  it.each([-0.3, 0.3])("maps tinted theme hue (%s)", tint => {
    const report = new ExcelReport();
    const color = { theme: 4, tint };
    expect(importCellStyle({ font: { color } }, new Map([["accent1", "CC2233"]]), report, {})?.color).toBe("red");
  });
  it("omits unsupported alignments and retains independent bold", () => {
    const report = new ExcelReport();
    expect(importCellStyle({ font: { bold: false }, alignment: { horizontal: "justify" } }, new Map(), report, {})).toEqual({ align: null, weight: "normal", color: null });
    expect(report.diagnostics[0].code).toBe("presentation_omitted");
  });
  it("exports alignment-only styles without a font override", () => {
    expect(exportCellStyle({ align: "left", color: null, weight: null })).toEqual({ alignment: { horizontal: "left" } });
    expect(exportCellStyle({ align: null, color: null, weight: null })).toEqual({});
  });
  it.each([
    { alignment: { vertical: "middle" } },
    { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } } },
    { fill: { type: "gradient", gradient: "angle", degree: 0, stops: [] } },
    { border: { bottom: { style: "thin" } } },
    { protection: { locked: false } },
    { font: { italic: true } },
  ] satisfies Partial<ExcelJS.Style>[])("reports each unsupported style independently: %j", source => {
    const report = new ExcelReport();
    expect(importCellStyle(source, new Map(), report, {})).toBeNull();
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0].code).toBe("presentation_omitted");
  });
  it("ignores empty/default style records", () => {
    const report = new ExcelReport();
    expect(importCellStyle({ numFmt: "General", fill: { type: "pattern", pattern: "none" }, font: {}, alignment: {}, border: {}, protection: {} }, new Map(), report, {})).toBeNull();
    expect(report.diagnostics).toEqual([]);
  });
});
