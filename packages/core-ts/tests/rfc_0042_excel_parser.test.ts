import { describe, expect, it } from "vitest";
import { DEFAULT_EXCEL_LIMITS, ExcelFailure, type ExcelLimits } from "../src/excel/contracts";
import type { ExcelExpression } from "../src/excel/formulaAst";
import { parseExcelFormula } from "../src/excel/formulaParser";

const n = (value: number): ExcelExpression => ({ kind: "number", value });
const text = (value: string): ExcelExpression => ({ kind: "text", value });
const bool = (value: boolean): ExcelExpression => ({ kind: "boolean", value });
const unary = (op: "+" | "-" | "%", operand: ExcelExpression): ExcelExpression => ({ kind: "unary", op, operand });
const binary = (op: string, left: ExcelExpression, right: ExcelExpression): ExcelExpression => ({ kind: "binary", op, left, right });
const call = (name: string, ...args: ExcelExpression[]): ExcelExpression => ({ kind: "call", name, args });
const missing: ExcelExpression = { kind: "missing" };
const limits = (overrides: Partial<ExcelLimits>): ExcelLimits => ({ ...DEFAULT_EXCEL_LIMITS, ...overrides });

function failure(source: string, configured = DEFAULT_EXCEL_LIMITS): ExcelFailure {
  try {
    parseExcelFormula(source, configured);
  } catch (error) {
    expect(error).toBeInstanceOf(ExcelFailure);
    if (!(error instanceof ExcelFailure)) throw error;
    expect(error.diagnostic.severity).toBe("error");
    return error;
  }
  throw new Error(`Expected Excel formula rejection: ${JSON.stringify(source)}`);
}

describe("RFC-0042 Excel expression precedence (independent AST goldens)", () => {
  it.each([
    { source: "1+2*3", expected: binary("+", n(1), binary("*", n(2), n(3))) },
    { source: "(1+2)*3", expected: binary("*", binary("+", n(1), n(2)), n(3)) },
    { source: "10-3-2", expected: binary("-", binary("-", n(10), n(3)), n(2)) },
    { source: "12/3/2", expected: binary("/", binary("/", n(12), n(3)), n(2)) },
    { source: "12/(3/2)", expected: binary("/", n(12), binary("/", n(3), n(2))) },
    { source: "2^3^2", expected: binary("^", binary("^", n(2), n(3)), n(2)) },
    { source: "2^(3^2)", expected: binary("^", n(2), binary("^", n(3), n(2))) },
    { source: "-2^2", expected: binary("^", unary("-", n(2)), n(2)) },
    { source: "-(2^2)", expected: unary("-", binary("^", n(2), n(2))) },
    { source: "2^-3^2", expected: binary("^", binary("^", n(2), unary("-", n(3))), n(2)) },
    { source: "2^3%", expected: binary("^", n(2), unary("%", n(3))) },
    { source: "(2^3)%", expected: unary("%", binary("^", n(2), n(3))) },
    { source: "1+20%", expected: binary("+", n(1), unary("%", n(20))) },
    { source: "10%%", expected: unary("%", unary("%", n(10))) },
    { source: '"a"&"b"="ab"', expected: binary("=", binary("&", text("a"), text("b")), text("ab")) },
    { source: "1&2+3", expected: binary("&", n(1), binary("+", n(2), n(3))) },
    { source: "1+2&3", expected: binary("&", binary("+", n(1), n(2)), n(3)) },
    { source: "1<2=TRUE", expected: binary("=", binary("<", n(1), n(2)), bool(true)) },
    { source: "1<=2<>FALSE", expected: binary("<>", binary("<=", n(1), n(2)), bool(false)) },
    { source: "+-1", expected: unary("+", unary("-", n(1))) },
    { source: "--1", expected: unary("-", unary("-", n(1))) },
  ])("parses $source with Excel, not JavaScript or Ordinate, precedence", ({ source, expected }) => {
    expect(parseExcelFormula(source)).toEqual(expected);
    expect(parseExcelFormula(`=${source}`)).toEqual(expected);
  });
});

describe("RFC-0042 Excel literal and quoting grammar", () => {
  it.each([
    { source: "0", expected: n(0) }, { source: "001", expected: n(1) },
    { source: ".5", expected: n(0.5) }, { source: "5.", expected: n(5) },
    { source: "1e+3", expected: n(1000) }, { source: "1.25E-2", expected: n(0.0125) },
    { source: "true", expected: bool(true) }, { source: "fAlSe", expected: bool(false) },
    { source: '""', expected: text("") },
    { source: '"say ""hi"""', expected: text('say "hi"') },
    { source: '""""', expected: text('"') },
    { source: '"\\n\\t\\u0041"', expected: text("\\n\\t\\u0041") },
    { source: '"A1+$A$1,Other!B2"', expected: text("A1+$A$1,Other!B2") },
    { source: '"row1\r\nrow2\u2028row3"', expected: text("row1\r\nrow2\u2028row3") },
    { source: '"你好😀e\u0301"', expected: text("你好😀e\u0301") },
    { source: "= 1 +\t2\r\n", expected: binary("+", n(1), n(2)) },
  ])("parses literal $source without native escape/type guessing", ({ source, expected }) => {
    expect(parseExcelFormula(source)).toEqual(expected);
  });

  it.each(["#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#NULL!", "#SPILL!", "#CALC!"])(
    "recognizes the Excel error literal %s", error => {
      expect(parseExcelFormula(error)).toEqual({ kind: "error", value: error });
      expect(parseExcelFormula(error.toLowerCase())).toEqual({ kind: "error", value: error });
    },
  );
});

describe("RFC-0042 Excel reference syntax", () => {
  it.each([
    { source: "A1", row: 0, col: 0, rowFixed: false, colFixed: false },
    { source: "$A1", row: 0, col: 0, rowFixed: false, colFixed: true },
    { source: "A$1", row: 0, col: 0, rowFixed: true, colFixed: false },
    { source: "$A$1", row: 0, col: 0, rowFixed: true, colFixed: true },
    { source: "z99", row: 98, col: 25, rowFixed: false, colFixed: false },
    { source: "$aa$12", row: 11, col: 26, rowFixed: true, colFixed: true },
    { source: "XFD1048576", row: 1048575, col: 16383, rowFixed: false, colFixed: false },
  ])("retains both locks and zero-based coordinates in $source", ({ source, row, col, rowFixed, colFixed }) => {
    expect(parseExcelFormula(source)).toEqual({ kind: "reference", reference: {
      style: "spreadsheet",
      rowSelector: { kind: "absolute", value: row, ...(rowFixed ? { copyFixed: true } : {}) },
      colSelector: { kind: "absolute", value: col, ...(colFixed ? { copyFixed: true } : {}) },
    } });
  });

  it("retains independently anchored rectangle endpoints", () => {
    expect(parseExcelFormula("$A1:B$2")).toMatchObject({ kind: "reference", reference: {
      rowSelector: { kind: "range", value: [{ kind: "absolute", value: 0 }, { kind: "absolute", value: 1, copyFixed: true }] },
      colSelector: { kind: "range", value: [{ kind: "absolute", value: 0, copyFixed: true }, { kind: "absolute", value: 1 }] },
    } });
  });

  it.each([
    { source: "$A:$B", row: { kind: "all" }, col: { kind: "range", value: [{ kind: "absolute", value: 0, copyFixed: true }, { kind: "absolute", value: 1, copyFixed: true }] } },
    { source: "$1:2", row: { kind: "range", value: [{ kind: "absolute", value: 0, copyFixed: true }, { kind: "absolute", value: 1 }] }, col: { kind: "all" } },
  ])("parses whole-axis range $source", ({ source, row, col }) => {
    expect(parseExcelFormula(source)).toMatchObject({ kind: "reference", reference: { rowSelector: row, colSelector: col } });
  });

  it.each([
    { source: "Other!$A$1", sheet: "Other" },
    { source: "Sheet1!$A$1", sheet: "Sheet1" },
    { source: "'Other Sheet'!$A$1", sheet: "Other Sheet" },
    { source: "'O''Brien'!$A$1", sheet: "O'Brien" },
    { source: "'你好😀'!$A$1", sheet: "你好😀" },
    { source: "2024!$A$1", sheet: "2024" },
    { source: "TRUE!$A$1", sheet: "TRUE" },
    { source: "'path\\name'!$A$1", sheet: "path\\name" },
  ])("resolves sheet quoting in $source without workbook lookup", ({ source, sheet }) => {
    expect(parseExcelFormula(source)).toEqual({ kind: "reference", sheet, reference: {
      style: "spreadsheet", rowSelector: { kind: "absolute", value: 0, copyFixed: true }, colSelector: { kind: "absolute", value: 0, copyFixed: true },
    } });
  });

  it("handles sheet-qualified ranges as one reference", () => {
    expect(parseExcelFormula("'O''Brien'!$A1:B$2")).toMatchObject({
      kind: "reference", sheet: "O'Brien", reference: { rowSelector: { kind: "range" }, colSelector: { kind: "range" } },
    });
  });

  it.each(["Tax_Rate", "A1_total", "_xlfn.Future", "\\Rate", "Tax.Rate"])(
    "preserves a defined-name token %s for the translator to classify", name => {
      expect(parseExcelFormula(name)).toEqual({ kind: "name", value: name });
    },
  );
});

describe("RFC-0042 Excel calls and constants", () => {
  it.each([
    { source: "SUM()", expected: call("SUM") },
    { source: "sum(1,2,3)", expected: call("SUM", n(1), n(2), n(3)) },
    { source: "SUM(,)", expected: call("SUM", missing, missing) },
    { source: "SUM(1,)", expected: call("SUM", n(1), missing) },
    { source: "SUM(,1)", expected: call("SUM", missing, n(1)) },
    { source: "SUM(1,,3)", expected: call("SUM", n(1), missing, n(3)) },
    { source: "IF(TRUE,,)", expected: call("IF", bool(true), missing, missing) },
    { source: "IF(TRUE,1,1/0)", expected: call("IF", bool(true), n(1), binary("/", n(1), n(0))) },
    { source: "SUM(1,ABS(-2))", expected: call("SUM", n(1), call("ABS", unary("-", n(2)))) },
    { source: "LOG10(100)", expected: call("LOG10", n(100)) },
    { source: "_xlfn.XLOOKUP(1,2,3)", expected: call("_XLFN.XLOOKUP", n(1), n(2), n(3)) },
    { source: 'CONCATENATE(",",")")', expected: call("CONCATENATE", text(","), text(")")) },
    { source: 'IF(TRUE,",",)', expected: call("IF", bool(true), text(","), missing) },
    { source: 'IF(FALSE,,")")', expected: call("IF", bool(false), missing, text(")")) },
    { source: '_xlfn.NUMBERVALUE("1.5",".",",")', expected: call("_XLFN.NUMBERVALUE", text("1.5"), text("."), text(",")) },
  ])("preserves call structure and omitted parameters in $source", ({ source, expected }) => {
    expect(parseExcelFormula(source)).toEqual(expected);
  });

  it("does not confuse argument separators inside text", () => {
    expect(parseExcelFormula('IF(TRUE,"a,b;c","(){}")')).toEqual(call("IF", bool(true), text("a,b;c"), text("(){}")));
  });

  it.each([
    { source: "{1}", rows: [[n(1)]] },
    { source: "{1,2;3,4}", rows: [[n(1), n(2)], [n(3), n(4)]] },
    { source: '{"a,b","c;d";"e","f"}', rows: [[text("a,b"), text("c;d")], [text("e"), text("f")]] },
    { source: "{-1,+2;TRUE,#N/A}", rows: [[unary("-", n(1)), unary("+", n(2))], [bool(true), { kind: "error", value: "#N/A" }]] },
  ])("decodes rectangular array constant $source", ({ source, rows }) => {
    expect(parseExcelFormula(source)).toEqual({ kind: "array", rows });
  });
});

describe("RFC-0042 invalid, unsupported and bounded Excel syntax", () => {
  it.each([
    "", "=", " ", "1+", "+", "(1", "1)", "1 2", "1=", "==1", "1e999", "1e+",
    '"unterminated', "'unterminated", '"a"b', "'Sheet'", "Other!", "Other!1", "Other!NamedRange",
    "SUM(1", "SUM(1;2)", "SUM(1 2)", "SUM(1,,", "(1,2)", "A1 B2", "A1,B2",
    "A1#", "@A1", "Table1[Column]", "[Other.xlsx]Sheet!A1", "'[Other.xlsx]Sheet'!A1", "Sheet1:Sheet2!A1",
    "XFE1", "A1048577", "$XFE$1", "$1:$1048577", "B2:A1", "B:A", "2:1",
    "$$A1", "A$$1", "$A0", "A1$", "1**2", "1!=2", "@[#1,#1]",
    "{}", "{1,}", "{1;}", "{1,2;3}", "{A1}", "{SUM(1)}", "{1+2}", "{{1}}", "{1%}",
  ])("rejects %j atomically with a typed formula diagnostic", source => {
    expect(["formula_syntax", "unsupported_formula"]).toContain(failure(source).diagnostic.code);
  });

  it("reports a UTF-16 offset in the original formula", () => {
    const source = '="😀"+?';
    expect(failure(source).diagnostic).toMatchObject({ formula: source, offset: source.indexOf("?") });
    const unclosed = '= "unterminated';
    expect(failure(unclosed).diagnostic).toMatchObject({ formula: unclosed, offset: unclosed.indexOf('"') });
  });

  it("checks formula length including the leading equals marker", () => {
    expect(parseExcelFormula("=1+2", limits({ maxFormulaLength: 4 }))).toEqual(binary("+", n(1), n(2)));
    expect(failure("=1+2", limits({ maxFormulaLength: 3 })).diagnostic.code).toBe("limit_exceeded");
  });

  it("bounds nested groups, nested calls and prefix operators", () => {
    for (const source of ["((((((1))))))", "ABS(ABS(ABS(ABS(ABS(1)))))", "------1"]) {
      expect(failure(source, limits({ maxFormulaDepth: 4 })).diagnostic.code).toBe("limit_exceeded");
    }
    expect(parseExcelFormula("1", limits({ maxFormulaDepth: 1 }))).toEqual(n(1));
  });

  it("bounds actual left-associated AST depth, not only recursive parse-call depth", () => {
    expect(failure("1+1+1+1+1+1+1+1", limits({ maxFormulaDepth: 4 })).diagnostic.code).toBe("limit_exceeded");
  });

  it("bounds actual postfix AST depth", () => {
    expect(failure("1%%%%%%%%", limits({ maxFormulaDepth: 4 })).diagnostic.code).toBe("limit_exceeded");
  });
});
