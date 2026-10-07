import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, importExcelWorkbook, serializeDocumentState, getCellTextView, type RuntimeValue } from "../src";

type Literal = number | string | boolean | null;
type FinancialCase = {
  name: string;
  inputs: number[];
  expected: number;
  edit: { index: number; value: number; expected: number };
};

const cases: FinancialCase[] = [
  { name: "FV", inputs: [0.1, 2, -100, -1000, 0], expected: 1420, edit: { index: 0, value: 0.2, expected: 1660 } },
  { name: "PV", inputs: [0.1, 2, -100, -1000, 0], expected: 1000, edit: { index: 2, value: -200, expected: 1420 / 1.21 } },
  { name: "PMT", inputs: [0.1, 2, 1000, 0, 0], expected: -12100 / 21, edit: { index: 2, value: 2000, expected: -24200 / 21 } },
  { name: "NPER", inputs: [0.1, -100, 0, 210, 0], expected: 2, edit: { index: 3, value: 331, expected: 3 } },
  { name: "SLN", inputs: [100, 20, 4], expected: 20, edit: { index: 0, value: 180, expected: 40 } },
  { name: "SYD", inputs: [100, 20, 4, 2], expected: 24, edit: { index: 3, value: 3, expected: 16 } },
  { name: "EFFECT", inputs: [0.2, 2], expected: 0.21, edit: { index: 0, value: 0.4, expected: 0.44 } },
  { name: "NOMINAL", inputs: [0.21, 2], expected: 0.2, edit: { index: 0, value: 0.44, expected: 0.4 } },
];

const address = (index: number) => `${String.fromCharCode(65 + index)}1`;
const referenceCall = (test: FinancialCase) => `${test.name}(${test.inputs.map((_, index) => address(index)).join(",")})`;

function resultValue(document: DocumentState): RuntimeValue {
  return document.evaluate().sheets[0].values[0][9];
}

function expectNumber(value: RuntimeValue, expected: number): void {
  expect(value.kind, JSON.stringify(value)).toBe("number");
  if (value.kind !== "number") throw new Error(JSON.stringify(value));
  expect(value.value).toBeCloseTo(expected, 9);
}

async function excelBytes(formula: string, inputs: Literal[] = [], cache?: number): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  inputs.forEach((value, index) => { sheet.getCell(address(index)).value = value; });
  sheet.getCell("J1").value = { formula, ...(cache === undefined ? {} : { result: cache }) };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function imported(formula: string, inputs: Literal[] = [], cache?: number): Promise<DocumentState> {
  const result = await importExcelWorkbook(await excelBytes(formula, inputs, cache));
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.value.sheets[0].cells[0][9].body).toMatchObject({ valid: true, kind: "formula" });
  return result.value;
}

describe("RFC-0042 financial formulas survive independent import and export", () => {
  it.each([
    ["CUMIPMT", 10 + 110 / 21],
    ["CUMPRINC", 100],
  ] as const)("imports the mortgage-style empty guard around %s without financial-specific coercions", async (name, expected) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Loan");
    sheet.getCell("D7").value = 100;
    sheet.getCell("D8").value = 1.2;
    sheet.getCell("D9").value = 1 / 6;
    sheet.getCell("G21").value = 1 / 6;
    sheet.getCell("H21").value = { formula: `IF(G21="","",-${name}($D$8/12,$D$9*12,$D$7,1,G21*12,0))`, result: 98765 };
    const result = await importExcelWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const document = DocumentState.fromText(serializeDocumentState(result.value));
    const value = () => document.evaluate().sheets[0].values[20][7];
    expect(getCellTextView(document.sheets[0].cells[20][7]).inputText).toBe(
      `= if(text(G21) == "", "", -${name.toLowerCase()}($D$8 / 12, $D$9 * 12, $D$7, 1, G21 * 12, 0))`,
    );
    expectNumber(value(), expected);
    document.setCellByIndex("Loan", 20, 6, "");
    expect(value()).toEqual({ kind: "string", value: "" });
    document.setCellByIndex("Loan", 20, 6, '= ""');
    expect(value()).toEqual({ kind: "string", value: "" });
    // Zero is present: the financial function must see the invalid end period,
    // rather than a truthiness guard silently treating it as an empty cell.
    document.setCellByIndex("Loan", 20, 6, "0");
    expect(value().kind).toBe("error");
    document.setCellByIndex("Loan", 20, 6, "= 1 / 0");
    expect(value().kind).toBe("error");
    document.setCellByIndex("Loan", 20, 6, String(1 / 6));
    expectNumber(value(), expected);
  });

  it.each(cases)("imports independently authored $name, ignores stale caches, and remains editable after native save", async test => {
    const document = await imported(referenceCall(test), test.inputs, 987654321);
    expectNumber(resultValue(document), test.expected);
    const restored = DocumentState.fromText(serializeDocumentState(document));
    restored.setCellByIndex("Data", 0, test.edit.index, String(test.edit.value));
    expectNumber(resultValue(restored), test.edit.expected);
  });

  it.each(cases)("keeps $name as one native call, including strict native argument types", async test => {
    const source = test.name.toLowerCase() + "(" + test.inputs.map((_, i) => address(i)).join(", ") + ")";
    const document = await imported(referenceCall(test), test.inputs.map(String));
    expect(getCellTextView(document.sheets[0].cells[0][9]).inputText).toBe("= " + source);
    expect(resultValue(document).kind).toBe("error");
    test.inputs.forEach((n, i) => document.setCellByIndex("Data", 0, i, String(n)));
    expectNumber(resultValue(document), test.expected);
  });

});

const annuityGoldens = [
  ["FV(0,2,-100)", 200], ["FV(0,2,-100,-1000)", 1200], ["FV(0,2,-100,-1000,1)", 1200],
  ["FV(0.1,2,-100)", 210], ["FV(0.1,2,-100,-1000,1)", 1441],
  ["PV(0,2,-100)", 200], ["PV(0,2,-100,-1000)", 1200], ["PV(0,2,-100,-1000,1)", 1200],
  ["PV(0.1,2,-100)", 210 / 1.21], ["PV(0.1,2,-100,-1000,1)", 1231 / 1.21],
  ["PMT(0,2,1000)", -500], ["PMT(0,2,1000,200)", -600], ["PMT(0,2,1000,200,1)", -600],
  ["PMT(0.1,2,1000)", -12100 / 21], ["PMT(0.1,2,1000,0,1)", -11000 / 21],
  ["NPER(0,-100,1000)", 10], ["NPER(0,-100,1000,200)", 12], ["NPER(0,-100,1000,200,1)", 12],
  ["NPER(0.1,-100,0,210)", 2], ["NPER(0.1,-100,0,231,1)", 2],
] as const;

describe("RFC-0042 annuity defaults and payment timing", () => {

  it.each(annuityGoldens)("imports %s without a formula cache", async (formula, expected) => {
    expectNumber(resultValue(await imported(formula)), expected);
  });

  it.each([
    ["FV(0.1,2,,100)", -121], ["PV(0.1,2,,121)", -100],
    ["PMT(0,2,100,,1)", -50], ["NPER(0,-50,100,,1)", 2],
    ["FV(,2,-100)", 200], ["FV(0,2,-100,,)", 200],
  ] as const)("preserves omitted Excel argument slots in %s", async (formula, expected) => {
    expectNumber(resultValue(await imported(formula)), expected);
  });

});

describe("RFC-0042 imported finance uses native domains without emulation", () => {
  it.each([
    "FV(0.1,2,-100,-1000,2)", "PV(0.1,2,-100,-1000,-1)", "PMT(0.1,2,1000,0,0.25)",
    "NPER(0.1,-100,0,231,0.5)", "EFFECT(0.2,2.9)", "NOMINAL(0.21,2.9)",
    "EFFECT(0,2)", "NOMINAL(-0.2,2)", "SLN(0,20,4)", "SLN(100,120,4)",
    "SLN(100,20,-4)", "SYD(100,20,4,2.5)", "SYD(100,20,4.5,2)",
  ])("preserves the operation in %s, even where Excel's domain differs", async formula => {
    const document = await imported(formula, [], 999999);
    const expectedSource = formula.toLowerCase().replaceAll(",", ", ");
    expect(getCellTextView(document.sheets[0].cells[0][9]).inputText).toBe("= " + expectedSource);
    const actual = resultValue(document);
    document.setCellByIndex("Data", 0, 9, "= " + expectedSource);
    expect(actual).toEqual(resultValue(document));
  });
});

describe("RFC-0042 financial errors remain errors rather than frozen numeric caches", () => {
  it.each([
    "PMT(0,0,100)", "PV(-1,2,100)", "NPER(0,0,100)", "NPER(-1,-100,100)",
    "SLN(100,20,0)", "SYD(100,20,0,1)", "SYD(100,20,4,0)", "SYD(100,20,4,5)",
    'FV("not numeric",2,-100)', 'SLN(100,"text",4)', "FV(0,2,#DIV/0!)", "EFFECT(#N/A,2)",
  ])("imports %s as a live erroneous formula despite its stale cache", async formula => {
    expect(resultValue(await imported(formula, [], 12345)).kind).toBe("error");
  });

  it.each(cases)("rejects unsupported $name arity atomically with a source location", async test => {
    const formula = `${test.name}(${[...test.inputs, 99, 99].join(",")})`;
    const result = await importExcelWorkbook(await excelBytes(formula, [], 12345));
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([
      expect.objectContaining({ severity: "error", sheetName: "Data", rowIndex: 0, colIndex: 9, formula }),
    ]) });
    expect(result).not.toHaveProperty("value");
  });
});
