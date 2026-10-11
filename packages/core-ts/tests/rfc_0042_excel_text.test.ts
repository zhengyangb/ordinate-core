import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, exportExcelWorkbook, importExcelWorkbook, serializeDocumentState, getCellTextView, type RuntimeValue } from "../src";

type Literal = string | number | boolean | null | { error: "#N/A" | "#DIV/0!" | "#VALUE!" };

function native(formula: string, inputs: Literal[] = []): DocumentState {
  const document = DocumentState.fromText(`# Data\n| | | | | | | | | | = ${formula} |`);
  inputs.forEach((value, index) => {
    const input = value === null ? "" : typeof value === "object" ? "error[type_error]" : typeof value === "string" ? JSON.stringify(value) : String(value);
    document.setCellByIndex("Data", 0, index, input);
  });
  return document;
}

function value(document: DocumentState): RuntimeValue {
  return document.evaluate().sheets[0].values[0][9];
}

function expectValue(actual: RuntimeValue, expected: string | boolean): void {
  expect(actual).toEqual({ kind: typeof expected === "string" ? "string" : "boolean", value: expected });
}

async function excelBytes(formula: string, inputs: Literal[] = [], cached?: string): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  inputs.forEach((input, index) => { sheet.getCell(1, index + 1).value = input; });
  sheet.getCell("J1").value = { formula, ...(cached === undefined ? {} : { result: cached }) };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function imported(formula: string, inputs: Literal[] = [], cached?: string) {
  const result = await importExcelWorkbook(await excelBytes(formula, inputs, cached));
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.value.sheets[0].cells[0][9].body).toMatchObject({ valid: true, kind: "formula" });
  return result;
}

const replacements: Array<[string, string, string, string]> = [
  ["red red RED", "red", "blue", "blue blue RED"],
  ["aaaaa", "aa", "x", "xxa"],
  ["no match", "z", "!", "no match"],
  ["a.b.[c]", ".", "$&", "a$&b$&[c]"],
  ["a*a?~a", "a", "$1$$", "$1$$*$1$$?~$1$$"],
  ["a\\b\\c", "\\", "/", "a/b/c"],
  ['He said "x" and "x"', '"x"', "", "He said  and "],
  ["", "x", "y", ""],
];

describe("RFC-0042 independently authored LEFT RIGHT and MID import", () => {
  // https://support.microsoft.com/en-us/excel/functions/left-function
  // https://support.microsoft.com/en-us/excel/functions/mid-function
  it.each([
    ["LEFT(A1)", "a"], ["RIGHT(A1)", "f"], ["LEFT(A1,0)", ""], ["RIGHT(A1,0)", ""],
    ["LEFT(A1,99)", "abcdef"],
    ["RIGHT(A1,99)", "abcdef"], ["LEFT(A1,)", ""], ["RIGHT(A1,)", ""],
    ["MID(A1,1,1)", "a"], ["MID(A1,2,3)", "bcd"],
    ["MID(A1,4,99)", "def"], ["MID(A1,99,3)", ""], ["MID(A1,2,0)", ""],
    ["MID(A1,2,)", ""],
  ] as const)("imports %s without off-by-one, padding, or rounding", async (formula, expected) => {
    expectValue(value((await imported(formula, ["abcdef"])).value), expected);
  });

  it.each([
    ["LEFT(A1,B1)", ["abcdef", 2], "ab", 0, '"XYZuvw"', "XY"],
    ["RIGHT(A1,B1)", ["abcdef", 2], "ef", 1, "3", "def"],
    ["MID(A1,B1,C1)", ["abcdef", 2, 3], "bcd", 1, "4", "def"],
  ] as const)("keeps imported %s editable after stale-cache replacement and native save", async (formula, inputs, expected, index, input, updated) => {
    const result = await imported(formula, [...inputs], "outdated answer");
    expectValue(value(result.value), expected);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "cached_value_ignored", sheetName: "Data", rowIndex: 0, colIndex: 9 }));
    const restored = DocumentState.fromText(serializeDocumentState(result.value));
    restored.setCellByIndex("Data", 0, index, input);
    expectValue(value(restored), updated);
  });

  it.each([
    ["LEFT(A1,B1)", "slice(A1, 0, B1)"],
    ["RIGHT(A1,B1)", "slice(A1, max([0, len(A1) - (B1)]))"],
    ["MID(A1,B1,C1)", "slice(A1, (B1) - 1, (B1) - 1 + (C1))"],
    ["SUBSTITUTE(A1,B1,C1)", "replace(A1, B1, C1)"],
  ])("translates %s as one operation with necessary coordinate conversion", async (excel, source) => {
    for (const inputs of [["abcdef", 2, 3], [12345, 2, 3], [null, 2, 3], ["abc", -1, 2], ["abc", 2.9, 2.9]] as Literal[][]) {
      const result = await imported(excel, inputs, "stale");
      expect(getCellTextView(result.value.sheets[0].cells[0][9]).inputText).toBe("= " + source);
      expect(value(result.value)).toEqual(value(native(source, inputs)));
    }
  });

  it("warns on imported Unicode slicing and uses the stated native code-point model", async () => {
    const result = await imported("MID(A1,2,1)", ["A😀B"]);
    expectValue(value(result.value), "😀");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "semantic_difference", severity: "warning", sheetName: "Data", rowIndex: 0, colIndex: 9,
      message: expect.stringMatching(/calculation rules/i),
    }));
  });
});

describe("RFC-0042 SUBSTITUTE import uses native literal replacement", () => {
  it.each(replacements)("imports replace-all %j / %j / %j", async (text, search, replacement, expected) => {
    expectValue(value((await imported("SUBSTITUTE(A1,B1,C1)", [text, search, replacement])).value), expected);
  });

  it("keeps replacement live after edits without an empty-pattern special case", async () => {
    const result = await imported("SUBSTITUTE(A1,B1,C1)", ["red red", "red", "blue"], "stale");
    expectValue(value(result.value), "blue blue");
    const restored = DocumentState.fromText(serializeDocumentState(result.value));
    restored.setCellByIndex("Data", 0, 1, '""');
    expect(value(restored)).toEqual(value(native("replace(A1, B1, C1)", ["red red", "", "blue"])));
    restored.setCellByIndex("Data", 0, 1, '"e"');
    restored.setCellByIndex("Data", 0, 2, '"$&"');
    expectValue(value(restored), "r$&d r$&d");
  });

  it.each(['SUBSTITUTE("abc","",#N/A)', 'SUBSTITUTE("abc","z",#DIV/0!)', 'SUBSTITUTE(#VALUE!,"","x")'])("does not hide errors in a no-op %s", async formula => {
    expect(value((await imported(formula)).value).kind).toBe("error");
  });

  it("preserves pipe, backslash, quotes, newline and native syntax as ordinary string content", async () => {
    const result = await imported("SUBSTITUTE(A1,B1,C1)", ['| \\ "\n# Sheet\n@meta', "Sheet", "Table"]);
    const expected = '| \\ "\n# Table\n@meta';
    expectValue(value(result.value), expected);
    expectValue(value(DocumentState.fromText(serializeDocumentState(result.value))), expected);
  });
});

describe("RFC-0042 text conversion rejects unsupported executable shapes atomically", () => {
  it.each([
    "LEFT()", "RIGHT()", 'LEFT("abc",1,2)', 'RIGHT("abc",1,2)', 'MID("abc",1)',
    'MID("abc",1,2,3)', 'SUBSTITUTE("abc","a")', 'SUBSTITUTE("abc","a","x",1)',
    'SUBSTITUTE("abc","a","x",)', "LEFT(A1:A2,1)", "MID(A1,1,B1:B2)",
  ])("rejects Excel %s with the exact source location, not its cache", async formula => {
    const result = await importExcelWorkbook(await excelBytes(formula, ["abc", 1], "do not preserve"));
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([
      expect.objectContaining({ severity: "error", sheetName: "Data", rowIndex: 0, colIndex: 9, formula }),
    ]) });
    expect(result).not.toHaveProperty("value");
  });

  it.each(['contains(A1:B1,"x")', 'startsWith(A1:B1,"x")', 'endsWith(A1:B1,"x")', 'replace(A1:B1,"x","y")', "slice(A1:B1,1)"])("rejects unsupported native view operation %s with its cell location", async formula => {
    const result = await exportExcelWorkbook(native(formula, ["ax", "bx"]));
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([
      expect.objectContaining({ severity: "error", sheetName: "Data", rowIndex: 0, colIndex: 9 }),
    ]) });
    expect(result).not.toHaveProperty("value");
  });
});
