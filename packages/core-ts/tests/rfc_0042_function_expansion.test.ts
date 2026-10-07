import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, exportExcelWorkbook, getCellTextView, importExcelWorkbook, serializeDocumentState } from "../src";
import { functionTranslations, importedFunctions } from "../src/excel/functionTranslation";
import { exportedFormula, formulaDocument, type Input } from "./fixtures/excelExport";

async function bytes(formula: string, inputs: Input[][] = [[2, 4], [4, 8], [8, 16]], dates = false, date1904 = false) {
  const book = new ExcelJS.Workbook(); book.properties.date1904 = date1904;
  const sheet = book.addWorksheet("Data"); sheet.addRows(inputs);
  if (dates) inputs.forEach((_, i) => { sheet.getCell(i + 1, 2).numFmt = "yyyy-mm-dd"; });
  sheet.getCell("J1").value = { formula, result: 987654321 };
  return new Uint8Array(await book.xlsx.writeBuffer());
}
async function imported(formula: string, inputs?: Input[][], dates = false, date1904 = false) {
  const result = await importExcelWorkbook(await bytes(formula, inputs, dates, date1904));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
const value = (document: DocumentState) => document.evaluate().sheets[0].values[0][9];
const source = (document: DocumentState) => getCellTextView(document.sheets[0].cells[0][9]).inputText;

describe("shared Excel function signatures", () => {
  it("has unique executable Excel aliases and all 21 native finance functions", () => {
    expect([...importedFunctions.keys()].length).toBe(Object.values(functionTranslations).filter(rule => rule.inbound !== false).reduce((n, rule) => n + 1 + rule.aliases.length, 0));
    expect(Object.values(functionTranslations).filter(rule => rule.financial)).toHaveLength(21);
  });
  it.each(Object.entries(functionTranslations))("exports %s without guards or caches", async (native, rule) => {
    const args = rule.args.slice(0, rule.required).map(kind => kind === "scalar" ? "2" : "A1:A3");
    const { cell } = await exportedFormula(formulaDocument(`${native}(${args.join(",")})`, [[2, 4], [4, 8], [8, 16]]));
    const expected = rule.argumentOrder
      ? rule.argumentOrder.map(slot => typeof slot === 'string' ? slot : args[slot]) : args.slice();
    if (rule.argumentOrder) {
      while(expected.length>(rule.excelRequired??rule.required)&&expected[expected.length-1]===undefined)expected.pop();
      expected.forEach((item,i)=>{if(item===undefined)expected[i]=rule.defaults![rule.argumentOrder![i] as number];});
    } else for (let i = expected.length; i < (rule.excelRequired ?? expected.length); i++) expected.push(rule.defaults![i]);
    expect(cell.formula).toBe(`${rule.excel}(${expected.join(",")})`);
    expect(cell.result).toBeUndefined();
  });
});

const statistics = [
  ["MEDIAN(A1:A3)", 4], ["PERCENTILE.INC(A1:A3,0.5)", 4], ["QUARTILE.INC(A1:A3,1)", 3],
  ["VAR.S(A1:A3)", 28 / 3], ["VAR.P(A1:A3)", 56 / 9],
  ["STDEV.S(A1:A3)", Math.sqrt(28 / 3)], ["STDEV.P(A1:A3)", Math.sqrt(56 / 9)],
  ["AVEDEV(A1:A3)", 20 / 9], ["DEVSQ(A1:A3)", 56 / 3], ["GEOMEAN(A1:A3)", 4],
  ["HARMEAN(A1:A3)", 24 / 7], ["LARGE(A1:A3,2)", 4], ["SMALL(A1:A3,2)", 4],
  ["RANK.EQ(4,A1:A3)", 2], ["RANK.EQ(4,A1:A3,1)", 2],
  ["CORREL(A1:A3,B1:B3)", 1], ["COVARIANCE.S(A1:A3,B1:B3)", 56 / 3],
  ["COVARIANCE.P(A1:A3,B1:B3)", 112 / 9], ["SLOPE(B1:B3,A1:A3)", 2],
  ["INTERCEPT(B1:B3,A1:A3)", 0], ["FORECAST.LINEAR(6,B1:B3,A1:A3)", 12],
  ["STANDARDIZE(10,8,2)", 1], ["SUMSQ(A1:A3)", 84], ["COUNTBLANK(C1:C3)", 3],
  ["MEDIAN(2,4,8)", 4], ["MODE.SNGL(2,4,4)", 4],
] as const;
describe("statistical formulas keep their operation", () => {
  it.each(statistics)("imports %s and ignores poisoned caches", async (formula, expected) => {
    const document = await imported(formula);
    expect(value(document)).toMatchObject({ kind: "number", value: expect.closeTo(expected, 10) });
    expect(value(DocumentState.fromText(serializeDocumentState(document)))).toEqual(value(document));
  });
  it("recalculates after source edits and native reopening", async () => {
    const document = DocumentState.fromText(serializeDocumentState(await imported("MEDIAN($A$1:$A$3)")));
    document.setCellByIndex("Data", 1, 0, "6");
    expect(value(document)).toEqual({ kind: "number", value: 6 });
    expect(source(document)).toBe("= median($A$1:$A$3)");
  });
});

const finance = [
  ["RATE(2,-60,100)", Math.sqrt(0.6 * 0.6 + 4 * 0.6) / 2 - 0.7],
  ["IPMT(0.1,1,2,100)", -10], ["PPMT(0.1,1,2,100)", -100 / 2.1],
  ["CUMIPMT(0.1,2,100,1,2,0)", -10 - 110 / 21],
  ["CUMPRINC(0.1,2,100,1,2,0)", -100], ["ISPMT(0.1,1,2,100)", -5],
  ["NPV(0.1,100,121)", 100 / 1.1 + 100], ["IRR({-100,121})", 0.21],
  ["MIRR({-100,121},0.1,0.1)", 0.21], ["DB(100,0,4,1)", 100],
  ["DDB(100,0,4,1)", 50], ["DDB(100,0,4,1,)", 50], ["DB(100,0,4,1,)", 100],
] as const;
describe("extended financial operations", () => {
  it.each(finance)("imports live %s", async (formula, expected) => {
    const document = await imported(formula);
    expect(value(document)).toMatchObject({ kind: "number", value: expect.closeTo(expected, 9) });
  });
  it.each([false, true])("uses native typed dates for XNPV and XIRR (1904=%s)", async date1904 => {
    const first = date1904 ? 43830 : 45292;
    const inputs = [[-100, first], [121, first + 365]];
    for (const [formula, expected] of [["XNPV(0.1,A1:A2,B1:B2)", 10], ["XIRR(A1:A2,B1:B2)", 0.21]] as const) {
      const document = await imported(formula, inputs, true, date1904);
      expect(value(document)).toMatchObject({ kind: "number", value: expect.closeTo(expected, 9) });
      expect(source(document)).toBe(`= ${formula.toLowerCase().replaceAll("a", "A").replaceAll("b", "B").replaceAll(",", ", ")}`);
      expect(document.evaluate().sheets[0].values[0][1].kind).toBe("date");
      const restored = DocumentState.fromText(serializeDocumentState(document));
      restored.setCellByIndex("Data", 1, 0, "110");
      expect(value(restored)).toMatchObject({ kind: "number", value: expect.closeTo(formula.startsWith("XIRR") ? 0.1 : 0, 9) });
    }
  });
  it("decodes explicit Excel serial-date arrays, but never parses source text as dates", async () => {
    const document = await imported("XNPV(0.1,{-100,121},{45292,45657})");
    expect(value(document)).toMatchObject({ kind: "number", value: expect.closeTo(10, 9) });
    expect(source(document)).toContain("2024-01-01");
    expect(value(await imported('XIRR({-100,121},{"2024-01-01","2024-12-31"})')).kind).toBe("error");
  });
  it("exports native date literals inside financial arrays", async () => {
    const { cell } = await exportedFormula(formulaDocument("xnpv(0.1,[-100,121],[2024-01-01,2024-12-31])"));
    expect(cell.formula).toBe("XNPV(0.1,{-100,121},{45292,45657})");
  });
  it("supports a single dated cash flow without serial-date scaffolding", async () => {
    const document = await imported("XNPV(0.1,A1,B1)", [[100, 45292]], true);
    expect(value(document)).toEqual({ kind: "number", value: 100 });
    expect(source(document)).toBe("= xnpv(0.1, A1, B1)");
  });
  it("uses native DATE constructors in an explicitly dated finance argument", async () => {
    const document = await imported("XNPV(0.1,100,DATE(2024,1,1))");
    expect(value(document)).toEqual({ kind: "number", value: 100 });
    expect(source(document)).toBe("= xnpv(0.1, [100], [date(2024, 1, 1)])");
  });
});

describe("readable text and view operations", () => {
  it.each([
    ["TEXTJOIN(\",\",FALSE,{\"a\",\"\",\"b\"})", "a,,b"],
    ["TEXTJOIN(\",\",TRUE,{\"a\",\"\",\"b\"})", "a,b"],
    ["TEXTJOIN(\",\",TRUE,A1:A3)", "2,4,8"],
    ["XLOOKUP(4,A1:A3,B1:B3)", 8], ["XLOOKUP(4,A1:A3,B1:B3,,0,1)", 8],
    ["SUM(FILTER(A1:A3,A1:A3>2))", 12], ["INDEX(FILTER(A1:A3,A1:A3>2),2)", 8],
    ["SUM(FILTER(A1:A3,A1:A3>2),1)", 13],
    ["ROWS(FILTER(A1:A3,A1:A3>2))", 2], ["COLUMNS(FILTER(A1:A3,A1:A3>2))", 1],
    ["SUM(TAKE(FILTER(A1:A3,A1:A3>2),1))", 4],
    ["SUM(_xlfn._xlws.FILTER(A1:A3,A1:A3>2))", 12],
    ["SUM(TAKE(A1:A3,2))", 6], ["SUM(DROP(A1:A3,-1))", 6],
    ["SUM(TAKE(A1:B1,,1))", 2], ["SUM(DROP(A1:B1,,-1))", 2],
    ["SUM(TAKE(A1:A3,B1))", 14], ["SUM(DROP(A1:A3,B1))", 0],
    ["TEXTJOIN(\",\",FALSE,\"a\",\"b\")", "a,b"],
    ["TEXTJOIN(\",\",FALSE,A1)", "2"], ["MEDIAN(A1)", 2],
    ["NPV(0.1,A1)", 2 / 1.1],
  ] as const)("imports %s", async (formula, expected) => {
    const actual = value(await imported(formula));
    if (typeof expected === "number") expect(actual).toMatchObject({ kind: "number", value: expect.closeTo(expected, 10) });
    else expect(actual).toEqual({ kind: "string", value: expected });
  });
  it.each([
    ['join(",",text(A1:A3))', '_xlfn.TEXTJOIN(",",FALSE,A1:A3)'],
    ["match(4,A1:A3)", "MATCH(4,A1:A3,0)-1"],
    ["index(B1:B3,match(4,A1:A3))", "INDEX(B1:B3,MATCH(4,A1:A3,0))"],
    ["lookup(4,A1:A3,B1:B3)", "_xlfn.XLOOKUP(4,A1:A3,B1:B3)"],
    ["dotProduct(A1:A3,B1:B3)", "SUMPRODUCT(A1:A3,B1:B3)"],
    ["sum(filter(A1:A3,A1:A3>2))", "SUM(TRANSPOSE(_xlfn._xlws.FILTER(A1:A3,A1:A3>2)))"],
    ["index(filter(A1:A3,A1:A3>2),1)", "INDEX(TRANSPOSE(_xlfn._xlws.FILTER(A1:A3,A1:A3>2)),1,2)"],
    ["sum(take(A1:A3,2))", "SUM(_xlfn.TAKE(A1:A3,2))"],
    ["sum(drop(A1:C1,-1))", "SUM(_xlfn.DROP(A1:C1,,-1))"],
    ["sum(filter(A1:C1,A1:C1>2))", "SUM(_xlfn._xlws.FILTER(A1:C1,A1:C1>2))"],
    ["sum(take(A1:A3,B1))", "SUM(_xlfn.TAKE(A1:A3,B1))"],
    ["sum(drop(A1:A3,B1))", "SUM(_xlfn.DROP(A1:A3,B1))"],
  ])("exports %s without opaque scaffolding", async (formula, expected) => {
    expect((await exportedFormula(formulaDocument(formula, [[2, 4, 6], [4, 8], [8, 16]]))).cell.formula).toBe(expected);
  });
  it("does not change native trim semantics or pretend Excel TRIM is equivalent", async () => {
    const document = formulaDocument('trim("  a  b  ")');
    expect(value(document)).toEqual({ kind: "string", value: "a  b" });
    const result = await importExcelWorkbook(await bytes('TRIM("  a  b  ")'), { unsupportedContent: "preserve-text" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(value(result.value)).toEqual({ kind: "string", value: '=TRIM("  a  b  ")' });
  });
  it("does not discard transformations around MATCH during index simplification", async () => {
    const { cell } = await exportedFormula(formulaDocument("index(B1:B3,if(false,match(4,A1:A3),0))", [[2, 4], [4, 8], [8, 16]]));
    expect(cell.formula).toContain("IF(FALSE,MATCH(4,A1:A3,0)-1,0)");
    expect(cell.formula).not.toBe("INDEX(B1:B3,MATCH(4,A1:A3,0))");
  });
  it("does not discard a source predicate around MATCH during import", async () => {
    const document = await imported("INDEX(B1:B3,ISNUMBER(MATCH(4,A1:A3,0)))");
    expect(source(document)).toContain("isNumber(match(4, A1:A3) + 1)");
    expect(value(document).kind).toBe("error");
  });
  it.each(["filter(A1:A3,A1:A3>2)", "if(true,1,filter(A1,A1>0))", "dotProduct(A1:A3,B1:B2)",
    "sum(filter(A1:B3,A1:B3>0))", "sum(filter(A1:A3,A1:A2>0))", 'join(",",1)',
    "median(2)", "sum(take(2,1))"])("rejects unsupported exported shape %s", async formula => {
    const document = formulaDocument(formula, [[2, 4], [4, 8], [8, 16]]);
    const before = serializeDocumentState(document);
    const result = await exportExcelWorkbook(document);
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unsupported_formula" })]) });
    expect(serializeDocumentState(document)).toBe(before);
  });
});

describe("unsupported forms fail early and stay recoverable as text only with consent", () => {
  it.each([
    "IRR(A1:A3,0.2)", "RATE(2,-60,100,0,0,0.2)", "XIRR(A1:A3,B1:B3,0.2)",
    "XNPV(0.1,A1:A3,B1:B3)", "FILTER(A1:B3,A1:A3>2)", "FILTER(A1:A3,A1:A3>2,0)",
    'XLOOKUP(4,A1:A3,B1:B3,"missing")', "XLOOKUP(4,A1:A3,B1:B3,,1)",
    "XLOOKUP(4,A1:A3,B1:B3,,0,-1)", "SUM(TAKE(A1:B3,2,1))",
    "MEDIAN(A1:A3,B1:B3)", "NPV(0.1,A1:A3,B1:B3)",
    'TEXTJOIN(",",A1,B1:B3)', 'TEXTJOIN(",",TRUE,A1:A3,B1:B3)',
    "FILTER(A1:A3,A1:A3>2)", "INDEX(FILTER(A1:A3,A1:A3>2),0)",
    "TAKE(A1:A3,0)", "DROP(A1:A3,3)",
  ])("does not silently discard options in %s", async formula => {
    const data = await bytes(formula);
    const rejected = await importExcelWorkbook(data);
    expect(rejected).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unsupported_formula", rowIndex: 0, colIndex: 9 })]) });
    const preserved = await importExcelWorkbook(data, { unsupportedContent: "preserve-text" });
    expect(preserved.ok).toBe(true);
    if (preserved.ok) expect(value(preserved.value)).toEqual({ kind: "string", value: `=${formula}` });
  });
});
