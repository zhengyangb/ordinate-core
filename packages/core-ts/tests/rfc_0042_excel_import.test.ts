import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, getCellTextView, planFillRegion, serializeDocumentState, type RuntimeValue } from "../src";
import { importExcelWorkbook, type ExcelOptions } from "../src/excel";

type Literal = string | number | boolean | null | { error: "#DIV/0!" | "#VALUE!" | "#REF!" | "#N/A" };

async function workbookBytes(setup: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  setup(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function formulaBytes(formula: string, inputs: Literal[][] = [[2, 3]], cache?: Exclude<Literal, null>): Promise<Uint8Array> {
  return workbookBytes(workbook => {
    const sheet = workbook.addWorksheet("Data");
    inputs.forEach((row, r) => row.forEach((value, c) => { sheet.getCell(r + 1, c + 1).value = value; }));
    sheet.getCell("J1").value = { formula, ...(cache === undefined ? {} : { result: cache }) };
  });
}

async function imported(formula: string, inputs?: Literal[][], cache?: Exclude<Literal, null>) {
  const result = await importExcelWorkbook(await formulaBytes(formula, inputs, cache));
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

function output(document: DocumentState, sheet = 0, row = 0, col = 9): RuntimeValue {
  return document.evaluate().sheets[sheet].values[row][col];
}

function expectScalar(value: RuntimeValue, expected: string | number | boolean): void {
  if (typeof expected === "number") {
    expect(value.kind).toBe("number");
    if (value.kind !== "number") throw new Error(JSON.stringify(value));
    expect(value.value).toBeCloseTo(expected, 12);
  } else expect(value).toEqual({ kind: typeof expected === "string" ? "string" : "boolean", value: expected });
}

const point = (r: number, c: number) => ({ rowStart: r, rowEnd: r, colStart: c, colEnd: c });

describe("RFC-0042 readable import formulas", () => {
  it.each([
    ['"1"+"2"', 'number("1") + number("2")', 3],
    ['"1"+2', 'number("1") + 2', 3],
    ['2+"1"', '2 + number("1")', 3],
    ['"1"+A1', 'number("1") + A1', 3],
    ['A1+"1"', 'A1 + number("1")', 3],
    ['("1"+"2")+"3"', 'number("1") + number("2") + number("3")', 6],
    ['"1"+("2"+"3")', 'number("1") + (number("2") + number("3"))', 6],
    ['("1"&"2")+3', 'number("1" + "2") + 3', 15],
    ['LEFT("12",1)+2', 'number(slice("12", 0, 1)) + 2', 3],
    ['"1"+B1*4', 'number("1") + B1 * 4', 13],
    ['"1"&"2"', '"1" + "2"', "12"],
  ] as const)("converts known text only inside Excel +: %s", async (formula, source, expected) => {
    const { value } = await imported(formula);
    expect(getCellTextView(value.sheets[0].cells[0][9]).inputText).toBe("= " + source);
    expectScalar(output(value), expected);
    expectScalar(output(DocumentState.fromText(serializeDocumentState(value))), expected);
  });

  it.each([
    ['"abc"+"def"', 'number("abc") + number("def")'],
    ['"1"-"2"', '"1" - "2"'],
    ['A1=B1', 'A1 == B1'],
    ['A1<""', 'A1 < ""'],
    ['A1="x"', 'A1 == "x"'],
    ['A1=LEFT(B1,0)', 'A1 == slice(B1, 0, 0)'],
  ])("does not extend conversions or invent error fallbacks for %s", async (formula, source) => {
    const { value } = await imported(formula, [[1, "2"]], 98765);
    expect(getCellTextView(value.sheets[0].cells[0][9]).inputText).toBe("= " + source);
    expect(output(value).kind).toBe("error");
  });

  it("does not change native concatenation, stored text, or unknown reference addition", async () => {
    const native = DocumentState.fromText('# Native\n| = "1" + "2" |');
    expectScalar(output(native, 0, 0, 0), "12");
    const { value } = await imported("A1+B1", [["00123", "2"]]);
    expect(getCellTextView(value.sheets[0].cells[0][9]).inputText).toBe("= A1 + B1");
    expectScalar(output(value, 0, 0, 0), "00123");
    expectScalar(output(value), "001232");
    value.setCellByIndex("Data", 0, 0, "1");
    value.setCellByIndex("Data", 0, 1, "2");
    expectScalar(output(value), 3);
  });

  it.each([
    ['A1=""', 'text(A1) == ""', true],
    ['""=A1', '"" == text(A1)', true],
    ['A1<>""', 'text(A1) != ""', false],
    ['""<>A1', '"" != text(A1)', false],
  ] as const)("normalizes only literal empty-string comparisons: %s", async (formula, source, emptyResult) => {
    for (const [input, empty] of [[null, true], ["", true], [0, false], [false, false], [" ", false], ["0", false], [5, false]] as const) {
      const { value } = await imported(formula, [[input]]);
      expect(getCellTextView(value.sheets[0].cells[0][9]).inputText).toBe("= " + source);
      expectScalar(output(value), empty ? emptyResult : !emptyResult);
      expectScalar(output(DocumentState.fromText(serializeDocumentState(value))), empty ? emptyResult : !emptyResult);
    }
  });

  it("keeps empty-string checks editable, preserves errors and distinguishes native null", async () => {
    const { value } = await imported('IF(A1="","",A1)', [[null]], 98765);
    expect(getCellTextView(value.sheets[0].cells[0][9]).inputText).toBe('= if(text(A1) == "", "", A1)');
    expectScalar(output(value), "");
    for (const [source, expected] of [['= ""', ""], ["0", 0], ["false", false], ['" "', " "]] as const) {
      value.setCellByIndex("Data", 0, 0, source);
      expectScalar(output(value), expected);
    }
    value.setCellByIndex("Data", 0, 0, "null");
    expect(output(value).kind).toBe("null");
    value.setCellByIndex("Data", 0, 0, "= 1 / 0");
    expect(output(value).kind).toBe("error");
  });

  it("preserves view shape for empty-string comparisons without type guards", async () => {
    const { value } = await imported('SUM(A1:A3="")', [[null], [""], [0]]);
    expect(getCellTextView(value.sheets[0].cells[0][9]).inputText).toBe('= sum(text(A1:A3) == "")');
    expectScalar(output(value), 2);
    value.setCellByIndex("Data", 2, 0, '= ""');
    expectScalar(output(value), 3);
  });

  it.each([
    ["A1+B1", "A1 + B1", 5],
    ["A1+B1*4", "A1 + B1 * 4", 14],
    ["(A1+B1)*4", "(A1 + B1) * 4", 20],
    ["B1-(A1+1)", "B1 - (A1 + 1)", 0],
    ["B1/(A1*3)", "B1 / (A1 * 3)", 0.5],
    ["2^3^2", "(2 ** 3) ** 2", 64],
    ["-2^2", "(-2) ** 2", 4],
    ["-(2^2)", "-2 ** 2", -4],
    ["50%*A1", "50 / 100 * A1", 1],
    ["100%%", "100 / 100 / 100", 0.01],
    ["+A1", "A1", 2],
    ["SUM(A1:B1)", "sum(A1:B1)", 5],
    ["SUM(A1,B1,4)", "sum([A1, B1, 4])", 9],
    ["MIN(A1,B1)", "min([A1, B1])", 2],
    ["MAX(A1,B1)", "max([A1, B1])", 3],
    ['IF(A1=2,B1,0)', "if(A1 == 2, B1, 0)", 3],
    ["ROUND(A1/B1,2)", "round(A1 / B1, 2)", 0.67],
    ["ABS(-3)", "abs(-3)", 3],
    ["SIGN(-3)", "sign(-3)", -1],
    ["SQRT(9)", "sqrt(9)", 3],
    ["INT(-1.2)", "floor(-1.2)", -2],
    ["PI()", "pi()", Math.PI],
    ["POWER(2,3)", "power(2, 3)", 8],
    ["TRUNC(-1.9)", "trunc(-1.9)", -1],
    ["ROUNDUP(1.21,1)", "roundup(1.21, 1)", 1.3],
    ["ROUNDDOWN(1.29,1)", "rounddown(1.29, 1)", 1.2],
    ["IFERROR(A1/0,B1)", "if(isError(A1 / 0), B1, A1 / 0)", 3],
    ['A1&"/"&B1', 'text(A1) + "/" + text(B1)', "2/3"],
    ['CONCATENATE(A1,"!",B1)', 'text(A1) + "!" + text(B1)', "2!3"],
    ['"ab"&"cd"', '"ab" + "cd"', "abcd"],
    ["IF(FALSE,7)", "if(false, 7, false)", false],
    ["IF(TRUE,,9)", "if(true, 0, 9)", 0],
  ] as const)("translates %s to %s without emulation guards", async (formula, expectedFormula, expected) => {
    const { value } = await imported(formula, [[2, 3]], 98765);
    expect(getCellTextView(value.sheets[0].cells[0][9]).inputText).toBe("= " + expectedFormula);
    expectScalar(output(value), expected);
    expectScalar(output(DocumentState.fromText(serializeDocumentState(value))), expected);
  });

  it.each([
    ["SUM", "sum(A1:A2) + sum(B1:B2)", 14],
    ["PRODUCT", "product(A1:A2) * product(B1:B2)", 120],
    ["COUNT", "count(A1:A2) + count(B1:B2)", 4],
    ["COUNTA", "counta(A1:A2) + counta(B1:B2)", 4],
    ["AVERAGE", "(sum(A1:A2) + sum(B1:B2)) / (count(A1:A2) + count(B1:B2))", 3.5],
    ["MIN", "min([min(A1:A2), min(B1:B2)])", 2],
    ["MAX", "max([max(A1:A2), max(B1:B2)])", 5],
  ] as const)("combines disjoint ranges for %s without filtering or type guards", async (name, source, expected) => {
    const { value } = await imported(name + "(A1:A2,B1:B2)", [[2, 3], [4, 5]]);
    expect(getCellTextView(value.sheets[0].cells[0][9]).inputText).toBe("= " + source);
    expectScalar(output(value), expected);
  });

  it("keeps twelve nested IF/MIN operations linear in size", async () => {
    let formula = "A1";
    for (let i = 0; i < 12; i++) formula = i % 2 ? 'IF(B1="",0,' + formula + ")" : "MIN(9," + formula + ")";
    const { value } = await imported(formula, [[5, "x"]]);
    const text = getCellTextView(value.sheets[0].cells[0][9]).inputText;
    // Each source empty check adds exactly one conversion, not a guard tree.
    const emptyChecks = 6;
    expect(text.match(/text\(B1\)/g)).toHaveLength(emptyChecks);
    expect(text.length).toBeLessThan(formula.length * 1.5 + emptyChecks * "text()".length);
    expect(text).not.toMatch(/isBlank|isNumber|filter|number\(/);
    expectScalar(output(value), 5);
    value.setCellByIndex("Data", 0, 0, "3");
    expectScalar(output(value), 3);
  });

  // An independent, explicitly authored native formula is the evaluation oracle.
  // Import promises readable native operations, NOT every Excel coercion rule.
  it.each([
    ["A1+B1", "A1 + B1"], ["A1=B1", "A1 == B1"], ["A1<>B1", "A1 != B1"],
    ["A1<B1", "A1 < B1"], ["SUM(A1:B1)", "sum(A1:B1)"],
    ["PRODUCT(A1:B1)", "product(A1:B1)"], ["AVERAGE(A1:B1)", "average(A1:B1)"],
    ["COUNT(A1:B1)", "count(A1:B1)"], ["COUNTA(A1:B1)", "counta(A1:B1)"],
    ["MIN(A1:B1)", "min(A1:B1)"], ["MAX(A1:B1)", "max(A1:B1)"],
    ["IF(A1,B1,0)", "if(A1, B1, 0)"], ["AND(A1,B1)", "and(A1, B1)"],
    ["OR(A1,B1)", "or(A1, B1)"], ["NOT(A1)", "not(A1)"],
    ["ROUND(A1,B1)", "round(A1, B1)"], ["MOD(A1,B1)", "mod(A1, B1)"],
  ])("uses native rules, not a second evaluator, for %s", async (excel, native) => {
    for (const inputs of [[2, 3], [null, 0], ["2", 3], ["a", "A"], [true, false], [{ error: "#DIV/0!" }, 0]] as Literal[][]) {
      const { value, diagnostics } = await imported(excel, [inputs], 98765);
      const actual = output(value);
      const source = getCellTextView(value.sheets[0].cells[0][9]).inputText;
      expect(source).toBe("= " + native);
      value.setCellByIndex("Data", 0, 9, "= " + native);
      expect(actual).toEqual(output(value));
      expect(diagnostics).toContainEqual(expect.objectContaining({ code: "semantic_difference", message: expect.stringContaining("Ordinate’s calculation rules") }));
    }
  });

  it.each([
    ["ISNUMBER", 2, true], ["ISNUMBER", "2", false], ["ISTEXT", "", true],
    ["ISLOGICAL", true, true], ["ISLOGICAL", 1, false], ["ISBLANK", null, true],
    ["ISBLANK", "", false], ["ISERROR", { error: "#DIV/0!" }, true],
  ] as const)("keeps explicit source predicate %s", async (name, input, expected) => {
    expectScalar(output((await imported(name + "(A1)", [[input]])).value), expected);
  });

  it("retains blank references instead of inventing a stored zero", async () => {
    const { value } = await imported("A1", [[null]], 12345);
    expect(output(value).kind).toBe("blank");
    expect(getCellTextView(value.sheets[0].cells[0][9]).inputText).toBe("= A1");
    value.setCellByIndex("Data", 0, 0, '"kept"');
    expectScalar(output(value), "kept");
  });

  it("keeps concatenation explicit after numbers become text", async () => {
    const { value } = await imported("A1&B1", [[2, 3]]);
    expectScalar(output(value), "23");
    value.setCellByIndex("Data", 0, 0, '"Hello "');
    value.setCellByIndex("Data", 0, 1, '"world"');
    expectScalar(output(value), "Hello world");
  });

  it("ignores caches, materializes referenced blanks, and recalculates edits after save", async () => {
    const { value, diagnostics } = await imported("B5", [[7]], 12345);
    expect(value.sheets[0].rowCount).toBe(5);
    expect(output(value).kind).toBe("blank");
    expect(diagnostics.some(d => d.code === "cached_value_ignored")).toBe(true);
    const restored = DocumentState.fromText(serializeDocumentState(value));
    restored.setCellByIndex("Data", 4, 1, "9");
    expectScalar(output(restored), 9);
  });

  it("preserves explicit error handling after repair", async () => {
    const { value } = await imported("IFERROR(A1/B1,7)", [[6, 0]], 999);
    expectScalar(output(value), 7);
    value.setCellByIndex("Data", 0, 1, "2");
    expectScalar(output(value), 3);
  });
});

describe("RFC-0042 imported literal cells cannot become native syntax", () => {
  it.each([
    "=1+1", "= @[#1,#1]", "+SUM(A1)", "@display", "---", "# New Sheet", "* Parent", "** Child",
    "a|b", "a||b", 'say "hello"', "C:\\temp\\file", "literal\\n", "first\nsecond", "\nstart\n", "true", "null", "123", "2024-02-29", " leading and trailing ",
    "---\n# Injected Sheet\n| x |", "@display row 1 {color:red}", "line\u2028separator\u2029paragraph", "[1,2]", "error[type_error]",
  ])("imports %j as exact inert text and preserves it through native serialization", async literal => {
    const bytes = await workbookBytes(workbook => { workbook.addWorksheet("Literal").getCell("A1").value = literal; });
    const result = await importExcelWorkbook(bytes);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error("Import failed");
    expect(result.value.sheets).toHaveLength(1);
    expectScalar(output(result.value, 0, 0, 0), literal);
    expectScalar(output(DocumentState.fromText(serializeDocumentState(result.value)), 0, 0, 0), literal);
  });
});

describe("RFC-0042 imported cross-sheet and copy-fixed references remain editable", () => {
  it("resolves forward references, case-insensitive names and quoted apostrophes", async () => {
    const bytes = await workbookBytes(workbook => {
      workbook.addWorksheet("Summary").getCell("C3").value = { formula: "'input data'!$A$1+'O''Brien'!B1", result: 999 };
      workbook.addWorksheet("Input Data").getCell("A1").value = 7;
      const other = workbook.addWorksheet("O'Brien");
      other.getCell("B1").value = 2;
      other.getCell("B2").value = 3;
      workbook.getWorksheet("Summary")!.getCell("C4").value = 0;
    });
    const result = await importExcelWorkbook(bytes);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error("Import failed");
    const document = result.value;
    expect(document.sheets.map(sheet => sheet.name)).toEqual(["Summary", "Input Data", "O'Brien"]);
    expectScalar(output(document, 0, 2, 2), 9);
    document.setCellByIndex("Input Data", 0, 0, "10");
    expectScalar(output(document, 0, 2, 2), 12);
    const copy = planFillRegion(document.sheets[0], point(2, 2), point(3, 2), "copy").values[0][0];
    document.setCellByIndex("Summary", 3, 2, copy);
    expectScalar(output(document, 0, 3, 2), 13);
    const restored = DocumentState.fromText(serializeDocumentState(document));
    restored.insertRow("Input Data", 0);
    expectScalar(output(restored, 0, 2, 2), 12);
    expectScalar(output(restored, 0, 3, 2), 13);
    expect(getCellTextView(restored.sheets[0].cells[2][2]).inputText).toContain("$A$2");
  });

  it.each([
    ["$A1", 2, 3], ["A$1", 2, 2], ["$A$1", 2, 2],
  ] as const)("retains copy locks from imported %s after save and fill", async (ref, before, after) => {
    const { value } = await imported(ref, [[2], [3]]);
    expectScalar(output(value), before);
    const restored = DocumentState.fromText(serializeDocumentState(value));
    const formula = planFillRegion(restored.sheets[0], point(0, 9), point(1, 9), "copy").values[0][0];
    restored.setCellByIndex("Data", 1, 9, formula);
    expectScalar(output(restored, 0, 1, 9), after);
  });
});

describe("RFC-0042 public Excel import fails atomically with actionable diagnostics", () => {
  it.each(["SUMIF(A1:A2,1)", "XLOOKUP(A1,A1:A2,B1:B2,,1)", "NOW()", "TODAY()", "TRIM(A1)"])(
    "refuses unsupported %s instead of importing its cached result", async formula => {
      const bytes = await formulaBytes(formula, [[2, 3], [4, 5]], 12345);
      const result = await importExcelWorkbook(bytes);
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("value");
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "unsupported_formula", severity: "error", sheetName: "Data", rowIndex: 0, colIndex: 9, formula }));
    },
  );

  it.each(["1+", "SUM(", "A0+1"])("reports the source cell for malformed formula %s", async formula => {
    const result = await importExcelWorkbook(await formulaBytes(formula));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", sheetName: "Data", rowIndex: 0, colIndex: 9, formula }));
  });

  it("does not expose already-converted sheets when a later sheet contains an unsupported formula", async () => {
    const bytes = await workbookBytes(workbook => {
      workbook.addWorksheet("Good").getCell("A1").value = 7;
      workbook.addWorksheet("Bad").getCell("B2").value = { formula: "UNIMPLEMENTED(1)", result: 42 };
    });
    const result = await importExcelWorkbook(bytes);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "unsupported_formula", severity: "error", sheetName: "Bad", rowIndex: 1, colIndex: 1, formula: "UNIMPLEMENTED(1)" }));
  });

  it("reports the originating formula cell when a cross-sheet target does not exist", async () => {
    const formula = "Missing!A1";
    const result = await importExcelWorkbook(await formulaBytes(formula));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "invalid_reference", sheetName: "Data", rowIndex: 0, colIndex: 9, formula }));
  });

  it.each([
    { maxInputBytes: 1 }, { maxExpandedBytes: 1 }, { maxArchiveEntries: 1 }, { maxRows: 1 },
    { maxColumns: 9 }, { maxCells: 19 }, { maxFormulaLength: 2 },
  ])("enforces import resource budgets %j", async limits => {
    const result = await importExcelWorkbook(await formulaBytes("A1+B1", [[2, 3], [4, 5]]), { limits });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "limit_exceeded", severity: "error" }));
  });

  it("applies cell budgets to referenced empty cells, not just physically stored cells", async () => {
    const result = await importExcelWorkbook(await formulaBytes("XFD100000"), { limits: { maxCells: 100 } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "limit_exceeded" }));
  });

  it("bounds formula nesting before native expression expansion", async () => {
    const result = await importExcelWorkbook(await formulaBytes("1+(2*3)"), { limits: { maxFormulaDepth: 2 } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "limit_exceeded", severity: "error" }));
  });

  it.each(["A1+B1", "NOT_IMPLEMENTED(A1)"])("does not mutate input bytes while handling %s", async formula => {
    const bytes = await formulaBytes(formula);
    const original = bytes.slice();
    await importExcelWorkbook(bytes);
    expect(bytes).toEqual(original);
  });

  it.each([null, { unexpected: true }, { limits: { maxCells: 0 } }, { limits: { maxRows: Infinity } }])(
    "rejects invalid options %j before workbook conversion", async options => {
      const result = await importExcelWorkbook(await formulaBytes("1+1"), options as ExcelOptions);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "invalid_options", severity: "error" }));
    },
  );
});
