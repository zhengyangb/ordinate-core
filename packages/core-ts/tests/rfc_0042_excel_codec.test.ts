import ExcelJS from "exceljs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EXCEL_LIMITS, ExcelFailure, ExcelReport, type ExcelLimits } from "../src/excel/contracts";
import { inspectXlsxArchive, readXlsx, writeXlsx, type WorkbookData } from "../src/excel/workbookCodec";

const limits = (overrides: Partial<ExcelLimits>): ExcelLimits => ({ ...DEFAULT_EXCEL_LIMITS, ...overrides });

async function independentWorkbook(setup: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  setup(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function independentlyRead(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  return workbook;
}

function packageBytes(entries: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, typeof value === "string" ? strToU8(value) : value])));
}

const minimalEntries = { "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>" };

describe("XML encoding and presentation-only names", () => {
  it.each(["utf-16le", "utf-16be"])("validates %s custom XML without rejecting a valid workbook", async encoding => {
    const bytes = await independentWorkbook(workbook => { workbook.addWorksheet("Data").getCell("A1").value = "Kept"; });
    const parts = unzipSync(bytes);
    const text = '<?xml version="1.0" encoding="UTF-16"?><notes>中文😀</notes>';
    const encoded = new Uint8Array(2 + text.length * 2);
    const view = new DataView(encoded.buffer), little = encoding === "utf-16le";
    view.setUint16(0, 0xfeff, little);
    for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), little);
    parts["customXml/item1.xml"] = encoded;
    const result = await readXlsx(zipSync(parts), DEFAULT_EXCEL_LIMITS, new ExcelReport());
    expect(result.sheets[0].rows[0][0].value).toBe("Kept");
    parts["customXml/item1.xml"] = encoded.slice(0, -1);
    await rejected(inspectXlsxArchive(zipSync(parts), DEFAULT_EXCEL_LIMITS), "invalid_workbook");
  });

  it("does not treat a reserved filter range as a formula variable", async () => {
    const bytes = await independentWorkbook(workbook => {
      workbook.addWorksheet("Data").getCell("A1").value = 42;
      workbook.definedNames.add("Data!$A$1", "_xlnm._FilterDatabase");
    });
    const report = new ExcelReport();
    expect((await readXlsx(bytes, DEFAULT_EXCEL_LIMITS, report)).sheets[0].rows[0][0].value).toBe(42);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: "metadata_omitted", message: expect.stringContaining("filters") }));
  });
});

function replacePart(bytes: Uint8Array, name: string, transform: (xml: string) => string): Uint8Array {
  const parts = unzipSync(bytes);
  expect(parts[name], `Expected fixture part ${name}`).toBeDefined();
  parts[name] = strToU8(transform(strFromU8(parts[name])));
  return zipSync(parts);
}

async function rejected(operation: Promise<unknown>, code: string): Promise<ExcelFailure> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ExcelFailure);
    if (!(error instanceof ExcelFailure)) throw error;
    expect(error.diagnostic).toMatchObject({ code, severity: "error" });
    return error;
  }
  throw new Error(`Expected rejection with ${code}`);
}

describe("RFC-0042 XLSX codec against independently constructed ExcelJS workbooks", () => {
  it("reads typed values, blanks, exact text and formula source without evaluating caches", async () => {
    const bytes = await independentWorkbook(workbook => {
      const sheet = workbook.addWorksheet("Data");
      sheet.getCell("A1").value = 12.345678901234567;
      sheet.getCell("B1").value = true;
      sheet.getCell("C1").value = false;
      sheet.getCell("D1").value = "";
      sheet.getCell("F1").value = "=1+1";
      sheet.getCell("G1").value = "  first\nsecond\t| \\ 😀  ";
      sheet.getCell("H1").value = { error: "#DIV/0!" };
      sheet.getCell("I1").value = { formula: "A1+1", result: 999 };
      sheet.getCell("J1").value = { formula: "A1*2" };
      sheet.getCell("K1").value = { formula: '"literal"', result: "stale" };
      sheet.getCell("L1").value = { formula: "TRUE", result: false };
      sheet.getCell("M1").value = { formula: "1-1", result: 0 };
    });
    const report = new ExcelReport();
    const data = await readXlsx(bytes, DEFAULT_EXCEL_LIMITS, report);
    expect(data.sheets.map(sheet => sheet.name)).toEqual(["Data"]);
    expect(data.sheets[0].rows[0].map(cell => cell.value)).toEqual([
      12.345678901234567, true, false, "", null, "=1+1", "  first\nsecond\t| \\ 😀  ",
      { error: "#DIV/0!" }, 999, null, "stale", false, 0,
    ]);
    expect(data.sheets[0].rows[0][5]).not.toHaveProperty("formula");
    expect(data.sheets[0].rows[0][8]).toMatchObject({ formula: "A1+1", value: 999 });
    expect(data.sheets[0].rows[0][9]).toMatchObject({ formula: "A1*2", value: null });
    expect(data.sheets[0].rows[0][10]).toMatchObject({ formula: '"literal"', value: "stale" });
  });

  it("expands shared formula followers using the actual master and each axis lock", async () => {
    const bytes = await independentWorkbook(workbook => {
      const sheet = workbook.addWorksheet("Shared");
      sheet.getCell("B1").value = { formula: "$A1+A$1+$A$1", result: 99, shareType: "shared", ref: "B1:B2" };
      sheet.getCell("B2").value = { sharedFormula: "B1", result: 88 };
      sheet.getCell("A1").value = 1;
      sheet.getCell("A2").value = 2;
    });
    const data = await readXlsx(bytes, DEFAULT_EXCEL_LIMITS, new ExcelReport());
    expect(data.sheets[0].rows[0][1]).toMatchObject({ formula: "$A1+A$1+$A$1", value: 99 });
    expect(data.sheets[0].rows[1][1]).toMatchObject({ formula: "$A2+A$1+$A$1", value: 88 });
  });

  it("preserves cross-sheet source spelling and sheet order", async () => {
    const bytes = await independentWorkbook(workbook => {
      workbook.addWorksheet("O'Brien").getCell("A1").value = 7;
      workbook.addWorksheet("Summary").getCell("A1").value = { formula: "'O''Brien'!$A$1+1", result: 123 };
    });
    const data = await readXlsx(bytes, DEFAULT_EXCEL_LIMITS, new ExcelReport());
    expect(data.sheets.map(sheet => sheet.name)).toEqual(["O'Brien", "Summary"]);
    expect(data.sheets[1].rows[0][0]).toMatchObject({ formula: "'O''Brien'!$A$1+1", value: 123 });
  });

  it.each([
    ["_x005F_x0041_", "_x0041_"],
    ["a_x000D_b", "a\rb"],
    ["a_x000d_b", "a\rb"],
    ["a_x0000_b", "a\u0000b"],
    ["&amp;amp;", "&amp;"],
  ])("decodes shared-string XML %j exactly once", async (encoded, expected) => {
    const bytes = await independentWorkbook(workbook => { workbook.addWorksheet("Literal").getCell("A1").value = "MARKER"; });
    const encodedFile = replacePart(bytes, "xl/sharedStrings.xml", xml => xml.replace("MARKER", encoded));
    expect((await readXlsx(encodedFile, DEFAULT_EXCEL_LIMITS, new ExcelReport())).sheets[0].rows[0][0].value).toBe(expected);
  });

  it.each([
    ["_x005F_x0041_", "_x0041_"],
    ["a_x000D_b", "a\rb"],
    ["&amp;amp;", "&amp;"],
    ["", ""],
  ])("retains typed string formula cache from XML %j without conflating it with no cache", async (encoded, expected) => {
    const bytes = await independentWorkbook(workbook => {
      workbook.addWorksheet("Cache").getCell("A1").value = { formula: '"source"', result: "MARKER" };
    });
    const encodedFile = replacePart(bytes, "xl/worksheets/sheet1.xml", xml => xml.replace("<v>MARKER</v>", `<v>${encoded}</v>`));
    const cell = (await readXlsx(encodedFile, DEFAULT_EXCEL_LIMITS, new ExcelReport())).sheets[0].rows[0][0];
    expect(cell).toMatchObject({ formula: '"source"', value: expected });
  });

  describe.each(["inlineStr", "str"])("%s text uses the same lexical decoding as shared strings", type => {
    it.each([
      ["_x005f_x000D_", "_x000D_"], ["a_x000d_b", "a\rb"], ["&amp;amp;", "&amp;"],
      [" a&#10;b ", " a\nb "], ["", ""],
    ])("decodes XML %j exactly once", async (encoded, expected) => {
      const bytes = await independentWorkbook(workbook => { workbook.addWorksheet("Text").getCell("A1").value = "MARKER"; });
      const rewritten = replacePart(bytes, "xl/worksheets/sheet1.xml", xml => xml.replace(/<c r="A1"[^>]*>[\s\S]*?<\/c>/,
        type === "inlineStr" ? `<c r="A1" t="inlineStr"><is><t xml:space="preserve">${encoded}</t></is></c>` : `<c r="A1" t="str"><v>${encoded}</v></c>`));
      expect((await readXlsx(rewritten, DEFAULT_EXCEL_LIMITS, new ExcelReport())).sheets[0].rows[0][0].value).toBe(expected);
    });
  });

  it("decodes rich text runs separately and excludes phonetic annotations", async () => {
    const bytes = await independentWorkbook(workbook => { workbook.addWorksheet("Rich").getCell("A1").value = "MARKER"; });
    const rewritten = replacePart(bytes, "xl/sharedStrings.xml", xml => xml.replace(/<si>[\s\S]*?<\/si>/,
      '<si><r><t>_x00</t></r><r><t>0D_</t></r><r><t>_x000d_</t></r><rPh sb="0" eb="1"><t>pronunciation</t></rPh></si>'));
    expect((await readXlsx(rewritten, DEFAULT_EXCEL_LIMITS, new ExcelReport())).sheets[0].rows[0][0].value).toBe("_x000D_\r");
  });

  it.each(["#N/A", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#NULL!"] as const)(
    "preserves typed Excel error %s independently of cached formula errors", async error => {
      const bytes = await independentWorkbook(workbook => {
        const sheet = workbook.addWorksheet("Errors");
        sheet.getCell("A1").value = { error };
        sheet.getCell("B1").value = { formula: "1/0", result: { error } };
      });
      const row = (await readXlsx(bytes, DEFAULT_EXCEL_LIMITS, new ExcelReport())).sheets[0].rows[0];
      expect(row[0]).toMatchObject({ value: { error } });
      expect(row[0]).not.toHaveProperty("formula");
      expect(row[1]).toMatchObject({ formula: "1/0", value: { error } });
    },
  );

  it.each([false, true])("preserves raw date serials and date1904=%s without changing number semantics", async date1904 => {
    const instant = "2024-02-29T12:34:56.000Z";
    const bytes = await independentWorkbook(workbook => {
      workbook.properties.date1904 = date1904;
      const cell = workbook.addWorksheet("Dates").getCell("A1");
      cell.value = new Date(instant);
      cell.numFmt = "yyyy-mm-dd hh:mm:ss";
    });
    const data = await readXlsx(bytes, DEFAULT_EXCEL_LIMITS, new ExcelReport());
    expect(data.dateSystem).toBe(date1904 ? 1904 : 1900);
    expect(data.sheets[0].rows[0][0].numberFormat).toBe("yyyy-mm-dd hh:mm:ss");
    expect(data.sheets[0].rows[0][0].value).toBeCloseTo((date1904 ? 43889 : 45351) + 45296 / 86400, 9);
  });

  it("does not turn every numeric cell into a date or formatted display string", async () => {
    const bytes = await independentWorkbook(workbook => {
      const sheet = workbook.addWorksheet("Formats");
      sheet.getCell("A1").value = 0.123456789;
      sheet.getCell("A1").numFmt = "0.00%";
      sheet.getCell("B1").value = 45200;
    });
    const data = await readXlsx(bytes, DEFAULT_EXCEL_LIMITS, new ExcelReport());
    expect(data.sheets[0].rows[0][0]).toMatchObject({ value: 0.123456789, numberFormat: "0.00%" });
    expect(data.sheets[0].rows[0][1].value).toBe(45200);
  });

  it.each(["NaN", "Infinity", "1e999", "12junk", "0x10"])("rejects numeric XML %s instead of a reader's partial parse", async numeric => {
    const bytes = await independentWorkbook(workbook => { workbook.addWorksheet("Numbers").getCell("A1").value = 123; });
    const rewritten = replacePart(bytes, "xl/worksheets/sheet1.xml", xml => xml.replace("<v>123</v>", `<v>${numeric}</v>`));
    const error = await rejected(readXlsx(rewritten, DEFAULT_EXCEL_LIMITS, new ExcelReport()), "unrepresentable_value");
    expect(error.diagnostic).toMatchObject({ sheetName: "Numbers", rowIndex: 0, colIndex: 0 });
  });

  it.each(["true", "1", "false", "0"])("reads the XML boolean date1904=%s rather than guessing from a converted Date", async flag => {
    const bytes = await independentWorkbook(workbook => { workbook.addWorksheet("Dates").getCell("A1").value = 60; });
    const rewritten = replacePart(bytes, "xl/workbook.xml", xml => xml.replace(/<workbookPr\b[^>]*\/>/, `<workbookPr date1904="${flag}"/>`));
    expect((await readXlsx(rewritten, DEFAULT_EXCEL_LIMITS, new ExcelReport())).dateSystem).toBe(flag === "true" || flag === "1" ? 1904 : 1900);
  });

  it("rejects an unknown calendar flag instead of treating it as the default", async () => {
    const bytes = await independentWorkbook(workbook => { workbook.addWorksheet("Dates").getCell("A1").value = 1; });
    const rewritten = replacePart(bytes, "xl/workbook.xml", xml => xml.replace(/<workbookPr\b[^>]*\/>/, '<workbookPr date1904="unknown"/>'));
    await rejected(readXlsx(rewritten, DEFAULT_EXCEL_LIMITS, new ExcelReport()), "invalid_workbook");
  });

  it("rejects ISO-date typed cells until they have an explicit calendar rule", async () => {
    const bytes = await independentWorkbook(workbook => { workbook.addWorksheet("ISO").getCell("A1").value = 1; });
    const rewritten = replacePart(bytes, "xl/worksheets/sheet1.xml", xml => xml.replace(/<c r="A1"[^>]*>[\s\S]*?<\/c>/,
      '<c r="A1" t="d"><v>2024-02-29T12:00:00Z</v></c>'));
    await rejected(readXlsx(rewritten, DEFAULT_EXCEL_LIMITS, new ExcelReport()), "unsupported_feature");
  });

  it("flattens merged values, rich text and hyperlinks with explicit omission warnings", async () => {
    const bytes = await independentWorkbook(workbook => {
      const sheet = workbook.addWorksheet("Presentation");
      sheet.getCell("A1").value = "Merged";
      sheet.mergeCells("A1:B2");
      sheet.getCell("C1").value = { richText: [{ text: "Hello ", font: { bold: true } }, { text: "world" }] };
      sheet.getCell("C2").value = { text: "Visible", hyperlink: "https://example.invalid/not-fetched" };
      sheet.getCell("C2").note = "A comment";
      sheet.getRow(2).hidden = true;
      sheet.getRow(2).outlineLevel = 1;
      sheet.state = "hidden";
      workbook.addWorksheet("Visible").getCell("A1").value = 1;
    });
    const report = new ExcelReport();
    const data = await readXlsx(bytes, DEFAULT_EXCEL_LIMITS, report);
    expect(data.sheets[0].rows.map(row => row.map(cell => cell.value))).toEqual([
      ["Merged", null, "Hello world"], [null, null, "Visible"],
    ]);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "presentation_omitted", severity: "warning", sheetName: "Presentation" }),
      expect.objectContaining({ code: "presentation_omitted", rowIndex: 0, colIndex: 2 }),
      expect.objectContaining({ code: "metadata_omitted", rowIndex: 1, colIndex: 2 }),
    ]));
  });

  it("retains sparse coordinates and empty sheets without compacting cells", async () => {
    const bytes = await independentWorkbook(workbook => {
      workbook.addWorksheet("Sparse").getCell("C3").value = 9;
      workbook.addWorksheet("Empty");
    });
    const data = await readXlsx(bytes, DEFAULT_EXCEL_LIMITS, new ExcelReport());
    expect(data.sheets[0].rows.map(row => row.map(cell => cell.value))).toEqual([[null, null, null], [null, null, null], [null, null, 9]]);
    expect(data.sheets[1]).toEqual({ name: "Empty", rows: [], headers: { headerRows: 0 }, merges:[] });
  });

  it("allows a single-cell array formula but rejects a multi-cell array/spill", async () => {
    const one = await independentWorkbook(workbook => {
      workbook.addWorksheet("Array").getCell("A1").value = { formula: "SUM({1,2})", result: 3, shareType: "array", ref: "A1" };
    });
    expect((await readXlsx(one, DEFAULT_EXCEL_LIMITS, new ExcelReport())).sheets[0].rows[0][0]).toMatchObject({ formula: "SUM({1,2})", value: 3 });
    const many = await independentWorkbook(workbook => {
      const sheet = workbook.addWorksheet("Array");
      sheet.getCell("A1").value = { formula: "{1,2}", result: 1, shareType: "array", ref: "A1:B1" };
      sheet.getCell("B1").value = 2;
    });
    const error = await rejected(readXlsx(many, DEFAULT_EXCEL_LIMITS, new ExcelReport()), "unsupported_feature");
    expect(error.diagnostic).toMatchObject({ sheetName: "Array", rowIndex: 0, colIndex: 0 });
  });

  it("retains defined names for formula translation", async () => {
    const bytes = await independentWorkbook(workbook => {
      workbook.addWorksheet("Inputs").getCell("A1").value = 9;
      workbook.definedNames.add("Inputs!$A$1", "Rate");
      workbook.addWorksheet("Output").getCell("A1").value = { formula: "Rate+1", result: 10 };
    });
    const decoded=await readXlsx(bytes, DEFAULT_EXCEL_LIMITS, new ExcelReport());
    expect(decoded.definedNames).toEqual([{name:"Rate",source:"Inputs!$A$1"}]);
  });
});

describe("RFC-0042 emitted XLSX inspected by an independent ExcelJS reader", () => {
  it("writes actual formulas and caches, typed formula-like literals, and recalculation settings", async () => {
    const data: WorkbookData = { sheets: [
      { name: "Inputs", rows: [[{ value: 7 }, { value: true }, { value: "=1+1" }, { value: "line1\nline2" }, { value: null }, { value: { error: "#N/A" } }]] },
      { name: "Summary", rows: [[{ formula: "Inputs!$A$1+1", value: 8 }, { formula: '"done"', value: "done" }, { formula: "FALSE", value: false }, { formula: "1+1", value: null }, { formula: "1-1", value: 0 }, { formula: '""', value: "" }]] },
    ] };
    const before = structuredClone(data);
    const bytes = await writeXlsx(data, DEFAULT_EXCEL_LIMITS);
    expect(data).toEqual(before);
    const workbook = await independentlyRead(bytes);
    expect(workbook.getWorksheet("Inputs")?.getCell("C1").value).toBe("=1+1");
    expect(workbook.getWorksheet("Inputs")?.getCell("C1").formula).toBeUndefined();
    expect(workbook.getWorksheet("Inputs")?.getCell("B1").value).toBe(true);
    expect(workbook.getWorksheet("Inputs")?.getCell("D1").value).toBe("line1\nline2");
    expect(workbook.getWorksheet("Inputs")?.getCell("E1").value).toBeNull();
    expect(workbook.getWorksheet("Inputs")?.getCell("F1").value).toEqual({ error: "#N/A" });
    expect(workbook.getWorksheet("Summary")?.getCell("A1").value).toMatchObject({ formula: "Inputs!$A$1+1", result: 8 });
    expect(workbook.getWorksheet("Summary")?.getCell("B1").value).toMatchObject({ formula: '"done"', result: "done" });
    // ExcelJS's value getter omits falsy caches; result exposes their actual value.
    expect(workbook.getWorksheet("Summary")?.getCell("C1").formula).toBe("FALSE");
    expect(workbook.getWorksheet("Summary")?.getCell("C1").result).toBe(false);
    expect(workbook.getWorksheet("Summary")?.getCell("D1").formula).toBe("1+1");
    expect(workbook.getWorksheet("Summary")?.getCell("E1").result).toBe(0);
    const summaryXml = strFromU8(unzipSync(bytes)["xl/worksheets/sheet2.xml"]);
    // Its reader also drops empty-string caches, so inspect the typed XML directly.
    expect(summaryXml).toMatch(/<c r="F1" t="str"><f>&quot;&quot;<\/f><v><\/v><\/c>/);
    const workbookXml = strFromU8(unzipSync(bytes)["xl/workbook.xml"]);
    expect(workbookXml).toMatch(/<calcPr\b[^>]*fullCalcOnLoad="1"/);
  });

  it("writes explicit number formats and dates without converting text numbers", async () => {
    const bytes = await writeXlsx({ sheets: [{ name: "Types", rows: [[
      { value: "00123" }, { value: 0.125, numberFormat: "0.0%" },
      { value: 45351.5, numberFormat: "yyyy-mm-dd hh:mm:ss" },
    ]] }] }, DEFAULT_EXCEL_LIMITS);
    const sheet = (await independentlyRead(bytes)).getWorksheet("Types")!;
    expect(sheet.getCell("A1").value).toBe("00123");
    expect(sheet.getCell("B1").value).toBe(0.125);
    expect(sheet.getCell("B1").numFmt).toBe("0.0%");
    expect(sheet.getCell("C1").value).toEqual(new Date("2024-02-29T12:00:00.000Z"));
  });

  it.each([
    "=SUM(A1:A2)", "+cmd", "@SUM(A1)", "-1", "  padded  ", "\nfirst\nlast\n", "A&B <C> \"D\"", "漢字 😀 e\u0301", "",
    "_x0041_", "_x005F_", "a\rb", "a\r\nb", "a\u0000b", "a\u0001b",
  ])(
    "exports text %j as literal text without inference or formula execution", async value => {
      const bytes = await writeXlsx({ sheets: [{ name: "Literal", rows: [[{ value }]] }] }, DEFAULT_EXCEL_LIMITS);
      const cell = (await independentlyRead(bytes)).getWorksheet("Literal")!.getCell("A1");
      expect(cell.value).toBe(value);
      expect(cell.formula).toBeUndefined();
    },
  );

  it.each([Number.NaN, Infinity, -Infinity])("rejects non-finite output number %s", async value => {
    await rejected(writeXlsx({ sheets: [{ name: "Number", rows: [[{ value }]] }] }, DEFAULT_EXCEL_LIMITS), "unrepresentable_value");
  });

  it("does not reinterpret early date serials through JavaScript Date on output", async () => {
    const bytes = await writeXlsx({ sheets: [{ name: "Date", rows: [[
      { value: 1, numberFormat: "yyyy-mm-dd" }, { value: 60, numberFormat: "yyyy-mm-dd" },
    ]] }] }, DEFAULT_EXCEL_LIMITS);
    const xml = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
    expect(xml).toMatch(/<c r="A1"[^>]*><v>1<\/v><\/c>/);
    expect(xml).toMatch(/<c r="B1"[^>]*><v>60<\/v><\/c>/);
  });

  it("writes single-cell array formula metadata without a multi-cell spill area", async () => {
    const bytes = await writeXlsx({ sheets: [{ name: "Array", rows: [[{ formula: "SUM({1,2})", value: 3, arrayFormula: true }]] }] }, DEFAULT_EXCEL_LIMITS);
    expect((await independentlyRead(bytes)).getWorksheet("Array")?.getCell("A1").value).toMatchObject({
      formula: "SUM({1,2})", result: 3, shareType: "array", ref: "A1",
    });
  });

  it("encodes formula string caches with the same text fidelity as ordinary string cells", async () => {
    const bytes = await writeXlsx({ sheets: [{ name: "Cache", rows: [[{ formula: '"_x0041_"', value: "_x0041_" }]] }] }, DEFAULT_EXCEL_LIMITS);
    const xml = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
    // Formula source and typed cached text both use SpreadsheetML ST_Xstring.
    expect(xml).toContain("<f>&quot;_x005F_x0041_&quot;</f>");
    expect(xml).toContain("<v>_x005F_x0041_</v>");
  });

  it.each(["", " padded", "padded ", "A/B", "A\\B", "A:B", "A?B", "A*B", "[A]", "'A", "A'", "History", "A\nB", "a".repeat(32)])(
    "refuses invalid Excel sheet name %j without renaming it", async name => {
      await rejected(writeXlsx({ sheets: [{ name, rows: [[{ value: 1 }]] }] }, DEFAULT_EXCEL_LIMITS), "invalid_sheet_name");
    },
  );

  it("rejects case-insensitive duplicate sheet names", async () => {
    await rejected(writeXlsx({ sheets: [{ name: "Sales", rows: [] }, { name: "SALES", rows: [] }] }, DEFAULT_EXCEL_LIMITS), "invalid_sheet_name");
  });

  it("treats non-rectangular adapter input as a programmer invariant failure", async () => {
    await expect(writeXlsx({ sheets: [{ name: "Bad", rows: [[{ value: 1 }], [{ value: 2 }, { value: 3 }]] }] }, DEFAULT_EXCEL_LIMITS))
      .rejects.toThrow("rectangular");
  });
});

describe("RFC-0042 XLSX archive rejection and resource budgets", () => {
  it.each([
    new Uint8Array(), new Uint8Array([0x50, 0x4b]), new Uint8Array([0x50, 0x4b, 0, 0]),
    new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), strToU8("not a workbook"),
  ])("rejects invalid or legacy bytes %j", async bytes => {
    await rejected(readXlsx(bytes, DEFAULT_EXCEL_LIMITS, new ExcelReport()), "invalid_workbook");
  });

  it("rejects incomplete and non-spreadsheet ZIPs", async () => {
    await rejected(inspectXlsxArchive(packageBytes({ "readme.txt": "hello" }), DEFAULT_EXCEL_LIMITS), "invalid_workbook");
    const complete = packageBytes(minimalEntries);
    await rejected(inspectXlsxArchive(complete.subarray(0, 45), DEFAULT_EXCEL_LIMITS), "invalid_workbook");
    await rejected(readXlsx(complete, DEFAULT_EXCEL_LIMITS, new ExcelReport()), "invalid_workbook");
  });

  it.each(["xl/vbaProject.bin", "xl/VBAPROJECT.BIN", "xl/externalLinks/externalLink1.xml", "xl/activeX/activeX1.xml", "xl/embeddings/oleObject1.bin"])(
    "rejects executable/external package part %s before workbook loading", async name => {
      await rejected(inspectXlsxArchive(packageBytes({ ...minimalEntries, [name]: "payload" }), DEFAULT_EXCEL_LIMITS), "unsupported_feature");
    },
  );

  it.each(["../outside.xml", "/absolute.xml", "xl/../../outside.xml", "xl\\workbook.xml"])(
    "rejects unsafe archive entry %s", async name => {
      await rejected(inspectXlsxArchive(packageBytes({ ...minimalEntries, [name]: "payload" }), DEFAULT_EXCEL_LIMITS), "invalid_workbook");
    },
  );

  it.each([
    "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
    "application/vnd.ms-office.vbaProject",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml",
    "application/vnd.openxmlformats-officedocument.oleObject",
  ])("rejects forbidden content type %s even with an innocuous part name", async contentType => {
    const types = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/innocent.bin" ContentType="${contentType}"/></Types>`;
    await rejected(inspectXlsxArchive(packageBytes({ ...minimalEntries, "[Content_Types].xml": types, "xl/innocent.bin": "payload" }), DEFAULT_EXCEL_LIMITS), "unsupported_feature");
  });

  it.each(["externalLink", "oleObject", "connections", "queryTable", "vbaProject", "activeX"])(
    "rejects relationship type %s without trusting part names", async type => {
      const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="innocent.bin"/></Relationships>`;
      await rejected(inspectXlsxArchive(packageBytes({ ...minimalEntries, "xl/_rels/workbook.xml.rels": rels }), DEFAULT_EXCEL_LIMITS), "unsupported_feature");
    },
  );

  it("allows inert external hyperlink targets but refuses externally loaded worksheets", async () => {
    const rels = (type: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" TargetMode="External" Target="https://example.invalid/not-fetched"/></Relationships>`;
    await expect(inspectXlsxArchive(packageBytes({ ...minimalEntries, "xl/_rels/workbook.xml.rels": rels("hyperlink") }), DEFAULT_EXCEL_LIMITS)).resolves.toHaveProperty("sheetTargets");
    await rejected(inspectXlsxArchive(packageBytes({ ...minimalEntries, "xl/_rels/workbook.xml.rels": rels("worksheet") }), DEFAULT_EXCEL_LIMITS), "unsupported_feature");
  });

  it.each([
    '<!DOCTYPE workbook SYSTEM "https://example.invalid/entity"><workbook/>',
    '<!DOCTYPE workbook [<!ENTITY attack "payload">]><workbook>&attack;</workbook>',
  ])("rejects XML entity/document type declarations %j", async xml => {
    await rejected(inspectXlsxArchive(packageBytes({ ...minimalEntries, "xl/workbook.xml": xml }), DEFAULT_EXCEL_LIMITS), "unsupported_feature");
  });

  it("rejects a standalone malformed XML entity declaration", async () => {
    await rejected(inspectXlsxArchive(packageBytes({ ...minimalEntries, "xl/workbook.xml": '<!ENTITY attack SYSTEM "file:///does-not-exist">' }), DEFAULT_EXCEL_LIMITS), "invalid_workbook");
  });

  it("rejects invalid UTF-8 in XML before handing data to the workbook library", async () => {
    await rejected(inspectXlsxArchive(packageBytes({ ...minimalEntries, "xl/workbook.xml": new Uint8Array([0xff, 0xff]) }), DEFAULT_EXCEL_LIMITS), "invalid_workbook");
  });

  it("checks relationship attributes after XML character-reference decoding", async () => {
    const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extern&#x61;lLink" Target="ordinary.bin"/></Relationships>';
    await rejected(inspectXlsxArchive(packageBytes({ ...minimalEntries, "xl/_rels/workbook.xml.rels": rels }), DEFAULT_EXCEL_LIMITS), "unsupported_feature");
  });

  it("rejects duplicate archive paths before ambiguous library resolution", async () => {
    const bytes = packageBytes({ ...minimalEntries, "xl/duplicate1.xml": "<first/>", "xl/duplicate2.xml": "<second/>" });
    const original = strToU8("xl/duplicate2.xml");
    const duplicate = strToU8("xl/duplicate1.xml");
    let replacements = 0;
    for (let i = 0; i <= bytes.length - original.length; i += 1) {
      if (original.every((byte, j) => bytes[i + j] === byte)) {
        bytes.set(duplicate, i);
        replacements += 1;
      }
    }
    expect(replacements).toBe(2); // Local header and central directory entry.
    await rejected(inspectXlsxArchive(bytes, DEFAULT_EXCEL_LIMITS), "invalid_workbook");
  });

  it.each(["NaN", "Infinity", "-Infinity", "1e999"])("rejects non-finite input number %s", async source => {
    const bytes = await independentWorkbook(workbook => { workbook.addWorksheet("Number").getCell("A1").value = 12345; });
    const corrupted = replacePart(bytes, "xl/worksheets/sheet1.xml", xml => xml.replace("<v>12345</v>", `<v>${source}</v>`));
    const error = await rejected(readXlsx(corrupted, DEFAULT_EXCEL_LIMITS, new ExcelReport()), "unrepresentable_value");
    expect(error.diagnostic).toMatchObject({ sheetName: "Number", rowIndex: 0, colIndex: 0 });
  });

  it("bounds compressed bytes, expanded bytes, and entry count independently", async () => {
    const bytes = packageBytes({ ...minimalEntries, "xl/large.xml": `<large>${"x".repeat(10000)}</large>` });
    await rejected(inspectXlsxArchive(bytes, limits({ maxInputBytes: bytes.length - 1 })), "limit_exceeded");
    await rejected(inspectXlsxArchive(bytes, limits({ maxExpandedBytes: 500 })), "limit_exceeded");
    await rejected(inspectXlsxArchive(bytes, limits({ maxArchiveEntries: 2 })), "limit_exceeded");
    await expect(inspectXlsxArchive(bytes, limits({ maxInputBytes: bytes.length, maxArchiveEntries: 3 }))).resolves.toHaveProperty("sheetTargets");
  });

  it("enforces row, column, aggregate-cell, and sheet limits on independently produced input", async () => {
    const bytes = await independentWorkbook(workbook => {
      workbook.addWorksheet("First").getCell("C3").value = 1;
      workbook.addWorksheet("Second").getCell("A1").value = 2;
    });
    for (const budget of [{ maxRows: 2 }, { maxColumns: 2 }, { maxCells: 9 }, { maxSheets: 1 }]) {
      await rejected(readXlsx(bytes, limits(budget), new ExcelReport()), "limit_exceeded");
    }
    const data = await readXlsx(bytes, limits({ maxRows: 3, maxColumns: 3, maxCells: 10, maxSheets: 2 }), new ExcelReport());
    expect(data.sheets).toHaveLength(2);
  });

  it("enforces output formula/text/byte/dimension limits without truncation", async () => {
    const formula: WorkbookData = { sheets: [{ name: "Sheet", rows: [[{ formula: "1+2", value: 3 }]] }] };
    await rejected(writeXlsx(formula, limits({ maxFormulaLength: 2 })), "limit_exceeded");
    await rejected(writeXlsx(formula, limits({ maxInputBytes: 10 })), "limit_exceeded");
    await rejected(writeXlsx({ sheets: [{ name: "Sheet", rows: [[{ value: "x".repeat(32768) }]] }] }, DEFAULT_EXCEL_LIMITS), "limit_exceeded");
    const shape: WorkbookData = { sheets: [{ name: "Sheet", rows: [[{ value: 1 }, { value: 2 }], [{ value: 3 }, { value: 4 }]] }] };
    for (const budget of [{ maxRows: 1 }, { maxColumns: 1 }, { maxCells: 3 }]) {
      await rejected(writeXlsx(shape, limits(budget)), "limit_exceeded");
    }
    expect(await writeXlsx(formula, limits({ maxFormulaLength: 3 }))).toBeInstanceOf(Uint8Array);
  });

  it("applies expanded-byte and archive-entry budgets to generated output too", async () => {
    const data: WorkbookData = { sheets: [{ name: "Text", rows: [[{ value: "repeated text ".repeat(1000) }]] }] };
    const bytes = await writeXlsx(data, DEFAULT_EXCEL_LIMITS);
    const entries = Object.values(unzipSync(bytes));
    const expanded = entries.reduce((sum, entry) => sum + entry.length, 0);
    expect(expanded).toBeGreaterThan(bytes.length);
    await rejected(writeXlsx(data, limits({ maxExpandedBytes: expanded - 1 })), "limit_exceeded");
    await rejected(writeXlsx(data, limits({ maxArchiveEntries: entries.length - 1 })), "limit_exceeded");
    await expect(writeXlsx(data, limits({ maxExpandedBytes: expanded, maxArchiveEntries: entries.length }))).resolves.toBeInstanceOf(Uint8Array);
  });

  it.each([
    '<mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells>',
    '<mergeCells><mergeCell ref="A1:CV100000"/></mergeCells>',
    '<cols><col min="1" max="2147483647" width="10"/></cols>',
    '<sheetData><row r="2147483647"/></sheetData>',
  ])("rejects allocation from metadata before the workbook reader sees %s", async content => {
    const bytes = packageBytes({ ...minimalEntries, "xl/worksheets/sheet1.xml": `<worksheet>${content}</worksheet>` });
    // Stub the reader as a tripwire: even if preflight regresses, this test must
    // never ask ExcelJS to allocate an attacker-controlled billion-row range.
    const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), "load")
      .mockRejectedValue(new Error("Preflight must reject before loading"));
    try {
      await rejected(readXlsx(bytes, DEFAULT_EXCEL_LIMITS, new ExcelReport()), "limit_exceeded");
      expect(load).not.toHaveBeenCalled();
    } finally { load.mockRestore(); }
  });

  it.each([
    '<mergeCell ref="B2:A1"/>', '<mergeCell ref="A1:B2:C3"/>', '<mergeCell ref="A0:B2"/>',
    '<mergeCell ref="A:A"/>', '<mergeCell ref=""/>',
    '<row r="0"/>', '<row r="1.5"/>', '<row r="1junk"/>',
    '<col min="3" max="2"/>', '<col min="1" max="0"/>', '<col min="1" max="2junk"/>',
  ])("rejects malformed allocation metadata %s", async content => {
    const bytes = packageBytes({ ...minimalEntries, "xl/worksheets/sheet1.xml": `<worksheet>${content}</worksheet>` });
    await rejected(inspectXlsxArchive(bytes, DEFAULT_EXCEL_LIMITS), "invalid_workbook");
  });

  it("charges merged extents to the same cumulative cell budget as serialized cells", async () => {
    const bytes = packageBytes({
      ...minimalEntries,
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><mergeCells><mergeCell ref="A1:C3"/></mergeCells></worksheet>',
      "xl/worksheets/sheet2.xml": '<worksheet><mergeCells><mergeCell ref="A1:B2"/></mergeCells></worksheet>',
    });
    await rejected(inspectXlsxArchive(bytes, limits({ maxCells: 12 })), "limit_exceeded");
    const metadata = await inspectXlsxArchive(bytes, limits({ maxCells: 13 }));
    expect(metadata.sheetDimensions.get("xl/worksheets/sheet1.xml")).toEqual({ rows: 3, columns: 3 });
    expect(metadata.sheetDimensions.get("xl/worksheets/sheet2.xml")).toEqual({ rows: 2, columns: 2 });
  });

  it("checks row and column metadata at their independent configured boundaries", async () => {
    const bytes = packageBytes({
      ...minimalEntries,
      "xl/worksheets/sheet1.xml": '<worksheet><cols><col min="1" max="4"/></cols><sheetData><row r="3"/></sheetData></worksheet>',
    });
    await rejected(inspectXlsxArchive(bytes, limits({ maxRows: 2 })), "limit_exceeded");
    await rejected(inspectXlsxArchive(bytes, limits({ maxColumns: 3 })), "limit_exceeded");
    await expect(inspectXlsxArchive(bytes, limits({ maxRows: 3, maxColumns: 4 }))).resolves.toHaveProperty("sheetDimensions");
  });

  it("does not mistake stale dimension hints or display-only columns for allocated data", async () => {
    const bytes = packageBytes({
      ...minimalEntries,
      "xl/worksheets/sheet1.xml": '<worksheet><dimension ref="A1:XFD1048576"/><cols><col min="1" max="10"/></cols><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
    });
    const metadata = await inspectXlsxArchive(bytes, limits({ maxCells: 1 }));
    expect(metadata.sheetDimensions.get("xl/worksheets/sheet1.xml")).toEqual({ rows: 1, columns: 1 });
  });

  it("retains safe merged-cell data while reporting omitted presentation", async () => {
    const bytes = await independentWorkbook(workbook => {
      const sheet = workbook.addWorksheet("Merged");
      sheet.getCell("A1").value = "Heading";
      sheet.mergeCells("A1:C3");
    });
    const report = new ExcelReport();
    const data = await readXlsx(bytes, limits({ maxRows: 3, maxColumns: 3, maxCells: 9 }), report);
    expect(data.sheets[0].rows.map(row => row.map(cell => cell.value))).toEqual([
      ["Heading", null, null], [null, null, null], [null, null, null],
    ]);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: "presentation_omitted", sheetName: "Merged" }));
  });

  it("rejects broken shared-formula masters instead of returning only their cached value", async () => {
    const bytes = await independentWorkbook(workbook => {
      const sheet = workbook.addWorksheet("Shared");
      sheet.getCell("A1").value = { formula: "1+1", result: 2, shareType: "shared", ref: "A1:A2" };
      sheet.getCell("A2").value = { sharedFormula: "A1", result: 2 };
    });
    const corrupted = replacePart(bytes, "xl/worksheets/sheet1.xml", xml => xml.replace(/<f\b[^>]*ref="A1:A2"[^>]*>[\s\S]*?<\/f>/, ""));
    await rejected(readXlsx(corrupted, DEFAULT_EXCEL_LIMITS, new ExcelReport()), "invalid_workbook");
  });
});
