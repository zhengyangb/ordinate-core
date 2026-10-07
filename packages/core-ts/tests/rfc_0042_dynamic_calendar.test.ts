import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, exportExcelWorkbook, importExcelWorkbook, resolveDocumentPresentation, serializeDocumentState } from "../src";
import { exportFormula } from "../src/excel/exportFormula";
import { DEFAULT_EXCEL_LIMITS, ExcelReport } from "../src/excel/contracts";
import { getStandardFunctionMetadata } from "../src/runtime/functions";
import { nativeDateToSerial, serialToNativeDate } from "../src/excel/temporalValues";

async function example(system: 1900 | 1904, fraction = 0, cached?: number) {
  const book = new ExcelJS.Workbook(); book.properties.date1904 = system === 1904;
  const sheet = book.addWorksheet("Dates");
  sheet.getCell("A1").value = system === 1900 ? 46085 : 44623;
  sheet.getCell("A1").numFmt = "yyyy-mm-dd";
  sheet.getCell("B1").value = fraction;
  sheet.getCell("C1").value = {formula: "A1+B1", ...(cached === undefined ? {} : {result: cached})};
  sheet.getCell("C1").numFmt = "yyyy-mm-dd";
  sheet.getCell("D1").value = {formula: "(C1-A1)*24"};
  const result = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

const values = (doc: DocumentState) => doc.evaluate().sheets[0].values[0];
function translated(doc: DocumentState, column: number, sheet = 0): string {
  const target = doc.sheets[sheet], body = target.cells[0][column].body;
  if (!body.valid || body.kind !== "formula") throw new Error("Expected formula fixture.");
  return exportFormula(body.expression, doc, target, {sheetName: target.name, rowIndex: 0, colIndex: column}, DEFAULT_EXCEL_LIMITS, new ExcelReport()).formula;
}

describe("date display is independent of a formula's dynamic calendar type", () => {
  it.each([1900, 1904] as const)("recalculates date → datetime → date and keeps Excel hour units (%s)", async system => {
    const doc = await example(system);
    expect(values(doc)[2]).toMatchObject({kind: "date", value: "2026-03-04"});
    expect(values(doc)[3]).toEqual({kind: "number", value: 0});
    doc.setCellByIndex("Dates", 0, 1, "0.5");
    expect(values(doc)[2]).toMatchObject({kind: "datetime", value: "2026-03-04T12:00", isOffsetQualified: false});
    expect(values(doc)[3]).toEqual({kind: "number", value: 12});
    expect(resolveDocumentPresentation(doc).sheets[0].cells[0][2].displayText).toBe("2026-03-04");
    const reopened = DocumentState.fromText(serializeDocumentState(doc));
    expect(values(reopened)).toEqual(values(doc));
    doc.setCellByIndex("Dates", 0, 1, "0");
    expect(values(doc)[2].kind).toBe("date");
    expect(values(doc)[3]).toEqual({kind: "number", value: 0});
  });
  it.each([undefined, 123, 46085.5])("does not specialize date formulas from cache %s", async cache => {
    const doc = await example(1900, 0.5, cache);
    expect(values(doc)[2]).toMatchObject({kind: "datetime", value: "2026-03-04T12:00"});
    expect(values(doc)[3]).toEqual({kind: "number", value: 12});
  });
  it.each([1900, 1904] as const)("exports live formulas, not static results, and reimports hidden time (%s)", async system => {
    const doc = await example(system, 0.5);
    const exported = await exportExcelWorkbook(doc);
    if (!exported.ok) throw new Error(JSON.stringify(exported.diagnostics));
    expect(exported.diagnostics.filter(d => d.code === "formula_exported_as_value")).toEqual([]);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(exported.value as never);
    const sheet = book.worksheets[0];
    for (const address of ["C1", "D1"]) {
      const value = sheet.getCell(address).value as ExcelJS.CellFormulaValue;
      expect(value.formula).toBeTruthy();
      sheet.getCell(address).value = {formula: value.formula};
    }
    expect(sheet.getCell("C1").numFmt).toBe("yyyy-mm-dd");
    expect((sheet.getCell("D1").value as ExcelJS.CellFormulaValue).formula.length).toBeLessThan(100);
    expect(exported.diagnostics.some(d => d.message.includes("Timezone offset is removed"))).toBe(false);
    const imported = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    expect(values(imported.value)[2]).toMatchObject({kind: "datetime", value: "2026-03-04T12:00"});
    expect(values(imported.value)[3]).toEqual({kind: "number", value: 12});
    imported.value.setCellByIndex("Dates", 0, 1, "0");
    expect(values(imported.value)[2].kind).toBe("date");
    expect(values(imported.value)[3]).toEqual({kind: "number", value: 0});
  });
  it("keeps native extraction and duration semantics strict", () => {
    const doc = DocumentState.fromText(`# Data
| = time(2026-03-04) | = time(2026-03-04T12:00) | = 2026-03-04T12:00 - 2026-03-04T00:00 | = 2026-03-04T12:00 - 2026-03-04 |`);
    expect(values(doc)[0].kind).toBe("error");
    expect(values(doc)[1]).toMatchObject({kind: "time", value: "12:00"});
    expect(values(doc)[2]).toMatchObject({kind: "duration", value: "PT12H"});
    expect(values(doc)[3].kind).toBe("error");
  });
  it.each([
    [1900, 59.5, "1900-02-28T12:00"], [1900, 61.5, "1900-03-01T12:00"],
    [1904, 0.5, "1904-01-01T12:00"], [1900, 46085 + 0.001 / 86400, "2026-03-04T00:00:00.001"],
    [1900, 46085 + 0.0001 / 86400, "2026-03-04T00:00"],
  ] as const)("preserves calendar system and millisecond precision (%s, %s)", (system, serial, expected) => {
    const doc = DocumentState.fromText(`# Data\n| = ${serialToNativeDate(String(serial), "date", system)} |`);
    expect(values(doc)[0]).toMatchObject({kind: "datetime", value: expected, isOffsetQualified: false});
  });
  it.each([0, 60, 60.5, -1, 2958466])("rejects invalid dynamically evaluated 1900 serial %s", serial => {
    const doc = DocumentState.fromText(`# Data\n| = ${serialToNativeDate(String(serial), "date", 1900)} |`);
    expect(values(doc)[0].kind).toBe("error");
  });
  it("still accepts integral formula dates in financial date vectors", async () => {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Dates");
    sheet.getCell("A1").value = 46085; sheet.getCell("A1").numFmt = "yyyy-mm-dd";
    sheet.getCell("A2").value = {formula: "A1+365"}; sheet.getCell("A2").numFmt = "yyyy-mm-dd";
    sheet.getCell("B1").value = -100; sheet.getCell("B2").value = 110;
    sheet.getCell("C1").value = {formula: "XNPV(0.1,B1:B2,A1:A2)"};
    const result = await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(values(result.value)[2]).toMatchObject({kind: "number", value: expect.closeTo(0, 10)});
    result.value.setCellByIndex("Dates", 1, 0, `= ${serialToNativeDate("46450.5", "date", 1900)}`);
    expect(values(result.value)[2].kind).toBe("error"); // financial functions still require dates
  });
});

describe("exact native date type inspection", () => {
  it.each([
    ["2026-03-04", true], ["2026-03-04T00:00", false], ["2026-03-04T12:00", false],
    ['"2026-03-04"', false], ["46085", false], ["00:00", false], ["null", false], ["blank", false], ["error[type_error]", false],
  ])("isDate(%s) is %s", (source, expected) => {
    expect(values(DocumentState.fromText(`# Data\n| = isDate(${source}) |`))[0]).toEqual({kind: "boolean", value: expected});
  });
  it("registers metadata and inspects a view element-wise", () => {
    expect(getStandardFunctionMetadata("isDate")?.category).toBe("type");
    const doc = DocumentState.fromText("# Data\n| = isDate([2026-03-04,2026-03-04T00:00,46085])[0] | = isDate([2026-03-04,2026-03-04T00:00,46085])[1] |");
    expect(values(doc)).toEqual([{kind: "boolean", value: true}, {kind: "boolean", value: false}]);
  });
  it("exports midnight datetime as false, never inferring date from integer serial", () => {
    const doc = DocumentState.fromText("# Data\n| 2026-03-04T00:00 | = isDate(A1) | = isDate(46085) |");
    expect(translated(doc, 1)).toBe("FALSE");
    expect(translated(doc, 2)).toBe("FALSE");
  });
  it("retains a conditional's type decision, including errors", () => {
    const doc = DocumentState.fromText("# Data\n| true | = if(A1,2026-03-04,2026-03-04T00:00) | = isDate(B1) |");
    expect(translated(doc, 2)).toBe("IF(ISNUMBER(B1),IF(A1,TRUE,FALSE),FALSE)");
    doc.setCellByIndex("Data", 0, 0, "error[type_error]");
    expect(values(doc)[2]).toEqual({kind: "boolean", value: false});
  });
  it("uses the source cell's coordinate and sheet when inspecting cross-sheet conditions", () => {
    const doc = DocumentState.fromText('# Source\n| true | = if(@[_,#1],2026-03-04,2026-03-04T00:00) |\n\n# Output\n| false | = isDate(@["Source"::[#1,#2]]) |');
    expect(translated(doc, 1, 1)).toContain("IF('Source'!A1,TRUE,FALSE)");
  });
  it("fails early for unknown type producers, views, recursive inspection and invalid arity", () => {
    const unknown = DocumentState.fromText("# Data\n| = isDate(lookup(1,[1],[2026-03-04])) |");
    expect(() => translated(unknown, 0)).toThrow(/source syntax/);
    const view = DocumentState.fromText("# Data\n| 2026-03-04 | = isDate(A1:A1) |");
    expect(() => translated(view, 1)).toThrow(/single source cell/);
    const cyclic = DocumentState.fromText("# Data\n| = B1 | = A1 | = isDate(A1) |");
    expect(() => translated(cyclic, 2)).toThrow(/conversion limit/);
    for (const call of ["isDate()", "isDate(1,2)"]) {
      const doc = DocumentState.fromText(`# Data\n| = ${call} |`);
      expect(values(doc)[0].kind).toBe("error");
      expect(() => translated(doc, 0)).toThrow(/arguments/);
    }
  });
  it("does not erase date extraction or turn numeric type errors into valid dates during inverse export", () => {
    const doc = DocumentState.fromText(`# Data\n| 2026-03-04T12:00 | = ${nativeDateToSerial("A1", "date", 1900)} |`);
    expect(translated(doc, 1)).toBe("INT(A1)");
    doc.setCellByIndex("Data", 0, 0, "46085");
    expect(() => translated(doc, 1)).toThrow(/compatible native calendar type/);
    const date = DocumentState.fromText(`# Data\n| 2026-03-04 | = ${nativeDateToSerial("A1", "datetime", 1900)} |`);
    expect(() => translated(date, 1)).toThrow(/compatible native calendar type/);
  });
});
