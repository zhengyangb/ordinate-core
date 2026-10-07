import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, exportExcelWorkbook, getCellTextView, importExcelWorkbook, serializeDocumentState } from "../src";
import { standardNormalCdf, standardNormalInverse } from "../src/runtime/functions/normalKernel";
import { listStandardFunctionMetadata } from "../src/runtime/functions";
import { parseCellText } from "../src/runtime/parse";

const evaluate = (expression: string) => DocumentState.fromText(`# Data\n| = ${expression} |`).evaluate().sheets[0].values[0][0];
describe("RFC 0046 strict elementary functions", () => {
  it.each([
    ["exp(1)", Math.E], ["ln(exp(2))", 2], ["log(8,2)", 3], ["log(8,0.5)", -3],
    ["log(100)", 2], ["log10(100)", 2], ["exp(-1000)", 0], ["ln(1)", 0],
  ])("evaluates %s", (expression, expected) => expect(evaluate(expression)).toMatchObject({ kind: "number", value: expect.closeTo(expected, 13) }));
  it.each(['ln(0)', 'ln(-1)', 'log(10,1)', 'log(10,0)', 'log10(-1)', 'exp(1000)', 'exp("1")', 'ln(true)', 'log(10,2,3)', 'exp()', 'ln(error[div_by_zero])'])
  ("rejects or propagates invalid %s", expression => expect(evaluate(expression).kind).toBe("error"));
  it("disambiguates function names ending in digits without special-casing known functions", () => {
    expect(parseCellText("= log10(100)").body.valid).toBe(true);
    expect(parseCellText("= future123(100)").body.valid).toBe(true);
    const body = parseCellText("= log10").body;
    expect(body.valid && body.kind === "formula" && body.expression.kind).toBe("reference");
  });
});

describe("RFC 0047 independent normal reference values", () => {
  // CPython libm erfc and statistics.NormalDist (AS241) are independent of
  // our incomplete-gamma / bounded log-tail solver. Compare relative tails,
  // not an absolute tolerance which would accept zero for tiny probabilities.
  it.each([
    [-20, 2.7536241186063314e-89], [-10, 7.619853024160593e-24], [-8, 6.22096057427182e-16],
    [-3, 0.0013498980316300957], [-1, 0.15865525393145705], [0, 0.5], [1, 0.8413447460685429],
  ])("CDF at %s preserves center/tail accuracy", (z, expected) => {
    const actual = standardNormalCdf(z);
    expect(actual).not.toBeNull();
    expect(Math.abs(actual! / expected - 1)).toBeLessThan(1e-12);
  });
  it.each([
    [Number.MIN_VALUE, -38.467405617144344], [1e-300, -37.0470962993612], [1e-100, -21.273453560965322],
    [1e-20, -9.262340089798407], [1e-10, -6.361340902404057], [0.001, -3.090232306167813],
    [0.1, -1.2815515655446006], [0.5, 0], [0.9, 1.2815515655446006], [0.999, 3.090232306167813],
  ])("inverse at %s preserves independent AS241 quantiles", (p, expected) => expect(standardNormalInverse(p)).toBeCloseTo(expected, 12));
  it.each([
    ["normalCdf(0)", 0.5], ["normalPdf(0)", 0.3989422804014327], ["normalInv(0.5)", 0],
    ["normalCdf(12,10,2)", 0.8413447460685429], ["normalPdf(10,10,2)", 0.19947114020071635],
    ["normalInv(0.5,10,2)", 10], ["lognormalCdf(1,0,1)", 0.5], ["lognormalPdf(1,0,1)", 0.3989422804014327],
    ["lognormalInv(0.5,2,1)", Math.exp(2)],
  ])("evaluates %s", (expression, expected) => expect(evaluate(expression)).toMatchObject({ kind: "number", value: expect.closeTo(expected, 13) }));
  it.each(['normalCdf(0,0,0)', 'normalPdf(0,0,-1)', 'normalInv(0)', 'normalInv(1)', 'normalCdf("0")',
    'normalCdf(true)', 'lognormalCdf(0,0,1)', 'lognormalPdf(-1,0,1)', 'lognormalInv(0.5,0,0)',
    'normalCdf(error[div_by_zero])', 'normalCdf()', 'lognormalCdf(1)'])
  ("fails early on %s", expression => expect(evaluate(expression).kind).toBe("error"));
  it("exposes all new functions through the existing metadata catalog", () => {
    const names = listStandardFunctionMetadata().map(metadata => metadata.name);
    for (const name of ['exp','ln','log','log10','normalPdf','normalCdf','normalInv','lognormalPdf','lognormalCdf','lognormalInv']) expect(names).toContain(name);
  });
});

const cases = [
  ['EXP(A1)', 'exp(A1)', Math.exp(1)], ['LN(A1)', 'ln(A1)', 0], ['LOG(A1)', 'log(A1)', 0],
  ['LOG(A1,)', 'log(A1, 10)', 0], ['LOG10(A1)', 'log10(A1)', 0],
  ['NORMSDIST(A1)', 'normalCdf(A1)', 0.8413447460685429],
  ['NORM.S.DIST(A1,TRUE)', 'normalCdf(A1)', 0.8413447460685429],
  ['NORM.S.DIST(A1,FALSE)', 'normalPdf(A1)', 0.24197072451914337],
  ['NORMDIST(A1,0,1,TRUE)', 'normalCdf(A1, 0, 1)', 0.8413447460685429],
  ['NORM.DIST(A1,0,1,FALSE)', 'normalPdf(A1, 0, 1)', 0.24197072451914337],
  ['NORM.INV(0.5,A1,1)', 'normalInv(0.5, A1, 1)', 1], ['NORMINV(0.5,A1,1)', 'normalInv(0.5, A1, 1)', 1],
  ['NORM.S.INV(0.5)', 'normalInv(0.5)', 0], ['NORMSINV(0.5)', 'normalInv(0.5)', 0],
  ['LOGNORMDIST(A1,0,1)', 'lognormalCdf(A1, 0, 1)', 0.5],
  ['LOGNORM.DIST(A1,0,1,FALSE)', 'lognormalPdf(A1, 0, 1)', 0.3989422804014327],
  ['LOGNORM.INV(0.5,A1,1)', 'lognormalInv(0.5, A1, 1)', Math.E], ['LOGINV(0.5,A1,1)', 'lognormalInv(0.5, A1, 1)', Math.E],
] as const;
describe("bidirectional elementary/probability Excel normalization", () => {
  it.each(cases)("imports, recalculates and round-trips %s", async (formula, source, expected) => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Data");
    sheet.getCell("A1").value = 1; sheet.getCell("B1").value = { formula, result: -987654321 };
    const imported = await importExcelWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(imported.ok, JSON.stringify(imported.diagnostics)).toBe(true);
    if (!imported.ok) throw new Error("Import failed");
    expect(getCellTextView(imported.value.sheets[0].cells[0][1]).inputText).toBe(`= ${source}`);
    expect(imported.value.evaluate().sheets[0].values[0][1]).toMatchObject({ kind: "number", value: expect.closeTo(expected, 12) });
    const document = DocumentState.fromText(serializeDocumentState(imported.value));
    const exported = await exportExcelWorkbook(document);
    expect(exported.ok, JSON.stringify(exported.diagnostics)).toBe(true);
    if (!exported.ok) throw new Error("Export failed");
    const reimported = await importExcelWorkbook(exported.value);
    expect(reimported.ok, JSON.stringify(reimported.diagnostics)).toBe(true);
    if (!reimported.ok) throw new Error("Reimport failed");
    expect(reimported.value.evaluate().sheets[0].values[0][1]).toMatchObject({ kind: "number", value: expect.closeTo(expected, 12) });
    document.setCellByIndex("Data", 0, 0, "2");
    const edited = document.evaluate().sheets[0].values[0][1];
    expect(edited.kind).toBe("number");
    if (formula.includes("A1")) expect(edited).not.toEqual(imported.value.evaluate().sheets[0].values[0][1]);
  });
  it("uses one choice conditional for a dynamic cumulative flag and responds to edits", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Data");
    sheet.addRows([[0, true]]); sheet.getCell("C1").value = { formula: "NORM.S.DIST(A1,B1)" };
    const imported = await importExcelWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    expect(getCellTextView(imported.value.sheets[0].cells[0][2]).inputText)
      .toBe('= if(boolean(B1), normalCdf(A1), normalPdf(A1))');
    expect(imported.value.evaluate().sheets[0].values[0][2]).toEqual({ kind: "number", value: 0.5 });
    imported.value.setCellByIndex("Data", 0, 1, "false");
    expect(imported.value.evaluate().sheets[0].values[0][2]).toMatchObject({ kind: "number", value: expect.closeTo(0.3989422804014327, 14) });
    const exported = await exportExcelWorkbook(imported.value);
    expect(exported.ok, JSON.stringify(exported.diagnostics)).toBe(true);
  });
});
