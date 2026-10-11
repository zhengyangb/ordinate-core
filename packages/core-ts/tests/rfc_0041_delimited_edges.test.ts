import { describe, expect, it } from "vitest";
import {
  DocumentState,
  exportDelimitedSheet,
  importDelimitedDocument,
  serializeDocumentState,
} from "../src";

const formats = ["csv", "tsv"] as const;
const sheetName = "Imported";

function unwrap<T>(result: { ok: true; value: T } | { ok: false; diagnostics: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

function expectStrings(document: DocumentState, rows: string[][]): void {
  expect(document.sheets).toHaveLength(1);
  expect(document.sheets[0].headerRowCount).toBe(0);
  expect(document.sheets[0].headerColCount).toBe(0);
  expect(document.evaluate().sheets[0].values).toEqual(
    rows.map(row => row.map(value => ({ kind: "string", value }))),
  );
}

describe.each(formats)("RFC-0041 independent %s boundary cases", format => {
  const separator = format === "csv" ? "," : "\t";
  const read = (text: string) => importDelimitedDocument(text, { format, sheetName });
  const write = (document: DocumentState) => exportDelimitedSheet(document, {
    format, sheetName, formulaLikeText: "preserve",
  });

  it.each([
    { input: "", expected: [] },
    { input: "\uFEFF", expected: [] },
    { input: '""', expected: [[""]] },
    { input: "\n", expected: [[""]] },
    { input: "\r", expected: [[""]] },
    { input: "\r\n", expected: [[""]] },
    { input: "\n\n", expected: [[""], [""]] },
    { input: "\r\n\r\n", expected: [[""], [""]] },
    { input: "a\n", expected: [["a"]] },
    { input: "a\r", expected: [["a"]] },
    { input: "a\r\n", expected: [["a"]] },
    { input: "a\r\nb\nc\rd", expected: [["a"], ["b"], ["c"], ["d"]] },
    { input: '"a\r\nb\nc\rd"', expected: [["a\r\nb\nc\rd"]] },
    { input: '"a""b"', expected: [['a"b']] },
    { input: '""""', expected: [['"']] },
    { input: "  text  ", expected: [["  text  "]] },
    { input: '"  text  "', expected: [["  text  "]] },
    { input: "\uFEFFfirst", expected: [["first"]] },
    { input: '"\uFEFFfirst"', expected: [["\uFEFFfirst"]] },
    { input: "first\n\uFEFFsecond", expected: [["first"], ["\uFEFFsecond"]] },
    { input: "\uFEFF\uFEFFdata", expected: [["\uFEFFdata"]] },
    { input: '"\u2028\u2029"', expected: [["\u2028\u2029"]] },
    { input: "before\u2028middle\u2029after", expected: [["before\u2028middle\u2029after"]] },
    { input: "e\u0301\n\u00e9\n你好😀", expected: [["e\u0301"], ["\u00e9"], ["你好😀"]] },
    { input: "\u0000\u0001\u000b\u000c", expected: [["\u0000\u0001\u000b\u000c"]] },
    { input: '"\\n\\r\\t\\u2028"', expected: [["\\n\\r\\t\\u2028"]] },
    { input: '"C:\\files\\notes\\"', expected: [["C:\\files\\notes\\"]] },
    { input: "\ud800\n\udfff", expected: [["\ud800"], ["\udfff"]] },
    { input: '"\r\n\n\r"', expected: [["\r\n\n\r"]] },
  ])("decodes exact logical fields from $input", ({ input, expected }) => {
    const document = unwrap(read(input));
    expectStrings(document, expected);
    const restored = DocumentState.fromText(serializeDocumentState(document));
    expectStrings(restored, expected);
  });

  it("preserves leading, trailing and repeated empty fields", () => {
    const document = unwrap(read(`${separator}a${separator}${separator}\n${separator}b${separator}${separator}`));
    expectStrings(document, [["", "a", "", ""], ["", "b", "", ""]]);
    expect(unwrap(write(document)).text).toBe(
      `""${separator}a${separator}""${separator}""\r\n""${separator}b${separator}""${separator}""\r\n`,
    );
  });

  it("quotes delimiters and newlines using independently specified golden output", () => {
    const source = format === "csv"
      ? 'plain,"x,y","say ""hi""","a\r\nb",\r\n'
      : 'plain\t"x\ty"\t"say ""hi"""\t"a\r\nb"\t\r\n';
    const expected = format === "csv"
      ? 'plain,"x,y","say ""hi""","a\r\nb",""\r\n'
      : 'plain\t"x\ty"\t"say ""hi"""\t"a\r\nb"\t""\r\n';
    const result = unwrap(write(unwrap(read(source))));
    expect(result).toEqual({ text: expected, format, sheetName, rowCount: 1, columnCount: 5 });
  });

  it("keeps the other format's delimiter as ordinary data", () => {
    const field = format === "csv" ? "x\ty" : "x,y";
    const document = unwrap(read(field));
    expectStrings(document, [[field]]);
    expect(unwrap(write(document)).text).toBe(`${field}\r\n`);
  });

  it.each([
    "---", ":---", "---:", ":---:", "@meta", "* Marketing", "** Child",
    "# Another sheet", "---\nkey: value\n---", "{: .2f}", "value {: bold}",
    "true", "false", "null", "error[div_by_zero]", "00123", "2026-10-03",
    "=1/0", "99 = 1/0", "+1+1", "@SUM(A1:A2)", "-2+3", '"literal quotes"',
    "left|right", "left||right", "\\|", "\\\\", "\\n", "line1\nline2",
  ])("does not interpret Ordinate syntax in the field %j", field => {
    // Quote one transport field, independently of Ordinate's native syntax.
    const input = `"${field.replace(/"/g, '""')}"`;
    const document = unwrap(read(input));
    expectStrings(document, [[field]]);
    expect(document.sheets[0].cells[0][0].body).toMatchObject({ valid: true, kind: "literal" });
    expect(document.sheets[0].cells[0][0].localDisplay).toBeNull();
    expectStrings(DocumentState.fromText(serializeDocumentState(document)), [[field]]);
    expectStrings(unwrap(read(unwrap(write(document)).text)), [[field]]);
  });

  it("does not interpret a whole row of separators or a first-cell control marker", () => {
    const input = `@meta${separator}{: .2f}\n---${separator}---\n* Parent${separator}true\n** Child${separator}=1/0`;
    expectStrings(unwrap(read(input)), [
      ["@meta", "{: .2f}"], ["---", "---"], ["* Parent", "true"], ["** Child", "=1/0"],
    ]);
  });

  it("keeps multiple escaping layers independent within the same field", () => {
    const input = '"""quoted""\\|\\n\r\n{: bold} = 3 || @meta"';
    const field = '"quoted"\\|\\n\r\n{: bold} = 3 || @meta';
    const document = unwrap(read(input));
    expectStrings(document, [[field]]);
    const restored = DocumentState.fromText(serializeDocumentState(document));
    expectStrings(restored, [[field]]);
    expect(unwrap(write(restored)).text).toBe(`${input}\r\n`);
  });

  it("preserves full-width forms, zero-width characters, and whitespace without normalization", () => {
    const rows = ["＝1", "＋1", "－1", "＠fn", "\u200btext", "\u00a0 value \u00a0", "\t=1"];
    const input = '＝1\n＋1\n－1\n＠fn\n\u200btext\n\u00a0 value \u00a0\n"\t=1"';
    const document = unwrap(read(input));
    expectStrings(document, rows.map(field => [field]));
    expectStrings(DocumentState.fromText(serializeDocumentState(document)), rows.map(field => [field]));
  });

  it.each([
    { input: '"open', rowIndex: 0, colIndex: 0 },
    { input: 'a"b', rowIndex: 0, colIndex: 0 },
    { input: '"a"tail', rowIndex: 0, colIndex: 0 },
    { input: '"a" ', rowIndex: 0, colIndex: 0 },
    { input: ' "a"', rowIndex: 0, colIndex: 0 },
    { input: 'ok\n"a"bad', rowIndex: 1, colIndex: 0 },
    { input: '"""', rowIndex: 0, colIndex: 0 },
    { input: '"a""', rowIndex: 0, colIndex: 0 },
  ])("fails atomically on malformed quoting $input", ({ input, rowIndex, colIndex }) => {
    const result = read(input);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", rowIndex, colIndex, offset: expect.any(Number) }),
    ]));
  });

  it("reports UTF-16 syntax offsets against the original BOM-prefixed input", () => {
    const input = `\uFEFF😀${separator}"x"z`;
    const result = read(input);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", rowIndex: 0, colIndex: 1, offset: input.indexOf("z") }),
    ]));
  });

  it.each([`a${separator}b\nc`, `a\nb${separator}c`, `a${separator}b\n\n`])(
    "rejects ragged input %j without silently skipping or padding", input => {
      const result = read(input);
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("value");
      expect(result.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
    },
  );

  it("produces no phantom record for empty sheets", () => {
    const result = unwrap(write(unwrap(read(""))));
    expect(result).toEqual({ text: "", format, sheetName, rowCount: 0, columnCount: 0 });
  });

  it("honors explicit LF and BOM without changing embedded newlines", () => {
    const document = unwrap(read('"a\r\nb"\r\n"c\rd"'));
    const result = unwrap(exportDelimitedSheet(document, {
      format, sheetName, formulaLikeText: "preserve", lineEnding: "\n", bom: true,
    }));
    expect(result.text).toBe('\uFEFF"a\r\nb"\n"c\rd"\n');
    expectStrings(unwrap(read(result.text)), [["a\r\nb"], ["c\rd"]]);
  });

  it("quotes a data-leading BOM so reimport cannot swallow it", () => {
    const document = unwrap(read('"\uFEFFdata"'));
    expect(unwrap(write(document)).text).toBe('"\uFEFFdata"\r\n');
    const withBom = unwrap(exportDelimitedSheet(document, { format, sheetName, bom: true }));
    expect(withBom.text).toBe('\uFEFF"\uFEFFdata"\r\n');
    expectStrings(unwrap(read(withBom.text)), [["\uFEFFdata"]]);
  });

  it.each(["=1+2", " +1", "-42", "@test", "＝1", "＋1", "－1", "＠fn", "\ttext", "\ntext", "\rtext"])(
    "rejects formula-looking string %j by default and preserves it only explicitly", field => {
      const document = unwrap(read(`"${field}"`));
      const denied = exportDelimitedSheet(document, { format, sheetName });
      expect(denied.ok).toBe(false);
      expect(denied).not.toHaveProperty("value");
      expect(denied.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ severity: "error", rowIndex: 0, colIndex: 0 }),
      ]));
      const allowed = write(document);
      expect(allowed.ok).toBe(true);
      expect(allowed.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "formula_like_text", severity: "warning", rowIndex: 0, colIndex: 0 }),
      ]));
      expectStrings(unwrap(read(unwrap(allowed).text)), [[field]]);
    },
  );

  it("defaults to text and does not infer based on CSV quoting", () => {
    const input = `00123${separator}42${separator}"true"${separator}null${separator}2026-10-03`;
    const expected = [["00123", "42", "true", "null", "2026-10-03"]];
    expectStrings(unwrap(read(input)), expected);
    expectStrings(unwrap(importDelimitedDocument(input, { format, sheetName, valueMode: "text" })), expected);
  });

  it("infers only the explicitly specified boolean and number grammar", () => {
    const input = ["true", '"false"', "42", "-4", "1.25", "1e3", "2E-3", "-0"].join(separator);
    const result = importDelimitedDocument(input, { format, sheetName, valueMode: "infer" });
    const document = unwrap(result);
    expect(document.evaluate().sheets[0].values[0]).toEqual([
      { kind: "boolean", value: true }, { kind: "boolean", value: false },
      { kind: "number", value: 42 }, { kind: "number", value: -4 },
      { kind: "number", value: 1.25 }, { kind: "number", value: 1000 },
      { kind: "number", value: 0.002 }, { kind: "number", value: -0 },
    ]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "types_inferred", severity: "warning", count: 8 }),
    ]));
  });

  it.each([
    "", "00123", "-01", "+1", ".5", "1.", " 42", "42 ", "TRUE", "False", "null",
    "2026-10-03", "PT2H", "error[generic]", "=1+2", "42 = 1+2", "NaN", "Infinity", "0x10",
  ])("does not over-infer %j", field => {
    const result = importDelimitedDocument(`"${field}"`, { format, sheetName, valueMode: "infer" });
    expectStrings(unwrap(result), [[field]]);
    expect(result.diagnostics.some(diagnostic => diagnostic.code === "types_inferred")).toBe(false);
  });

  it.each(["9007199254740992", "-9007199254740992", "1e309", "-1e309", "1e-999", "-1e-999"])(
    "preserves hazardous numeric input %s as text with a warning", field => {
      const result = importDelimitedDocument(field, { format, sheetName, valueMode: "infer" });
      expectStrings(unwrap(result), [[field]]);
      expect(result.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "numeric_text_preserved", severity: "warning", rowIndex: 0, colIndex: 0 }),
      ]));
    },
  );

  it.each(["0e-999", "0.000e-999", "9007199254740991", "-9007199254740991", "5e-324"])(
    "accepts the exact safe numerical boundary %s", field => {
      const result = importDelimitedDocument(field, { format, sheetName, valueMode: "infer" });
      expect(unwrap(result).evaluate().sheets[0].values[0][0]).toEqual({ kind: "number", value: Number(field) });
      expect(result.diagnostics.some(diagnostic => diagnostic.code === "numeric_text_preserved")).toBe(false);
    },
  );

  it("does not mistake real negative numeric values for formula injection", () => {
    const document = unwrap(importDelimitedDocument("-42", { format, sheetName, valueMode: "infer" }));
    const result = exportDelimitedSheet(document, { format, sheetName });
    expect(unwrap(result).text).toBe("-42\r\n");
    expect(result.diagnostics.some(diagnostic => diagnostic.code === "formula_like_text")).toBe(false);
  });

  it.each(["", " Name", "Name ", "A\nB", "A\rB"])("rejects invalid sheet name %j", name => {
    const result = importDelimitedDocument("safe", { format, sheetName: name });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    expect(result.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
  });

  it("enforces the cell budget at its boundary without partial output", () => {
    const source = `a${separator}b\nc${separator}d`;
    const document = unwrap(importDelimitedDocument(source, { format, sheetName, limits: { maxCells: 4 } }));
    expectStrings(document, [["a", "b"], ["c", "d"]]);
    const failedImport = importDelimitedDocument(source, { format, sheetName, limits: { maxCells: 3 } });
    expect(failedImport.ok).toBe(false);
    expect(failedImport).not.toHaveProperty("value");
    const failedExport = exportDelimitedSheet(document, { format, sheetName, limits: { maxCells: 3 } });
    expect(failedExport.ok).toBe(false);
    expect(failedExport).not.toHaveProperty("value");
  });

  it("enforces independent row and column budgets", () => {
    const source = `a${separator}b\nc${separator}d`;
    const document = unwrap(importDelimitedDocument(source, {
      format, sheetName, limits: { maxRows: 2, maxColumns: 2 },
    }));
    for (const limits of [{ maxRows: 1 }, { maxColumns: 1 }]) {
      const imported = importDelimitedDocument(source, { format, sheetName, limits });
      expect(imported.ok).toBe(false);
      expect(imported).not.toHaveProperty("value");
      expect(imported.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "limit_exceeded", severity: "error" }),
      ]));
      const exported = exportDelimitedSheet(document, { format, sheetName, limits });
      expect(exported.ok).toBe(false);
      expect(exported).not.toHaveProperty("value");
    }
    expect(exportDelimitedSheet(document, { format, sheetName, limits: { maxRows: 2, maxColumns: 2 } }).ok).toBe(true);
  });

  it("counts decoded fields rather than transport escape characters against the field budget", () => {
    const source = '"""a"""';
    const document = unwrap(importDelimitedDocument(source, { format, sheetName, limits: { maxFieldLength: 3 } }));
    expectStrings(document, [['"a"']]);
    expect(importDelimitedDocument(source, { format, sheetName, limits: { maxFieldLength: 2 } }).ok).toBe(false);
    expect(exportDelimitedSheet(document, { format, sheetName, limits: { maxFieldLength: 3 } }).ok).toBe(true);
    expect(exportDelimitedSheet(document, { format, sheetName, limits: { maxFieldLength: 2 } }).ok).toBe(false);
  });

  it("counts UTF-16 code units rather than code points against the field budget", () => {
    expectStrings(unwrap(importDelimitedDocument("😀", { format, sheetName, limits: { maxFieldLength: 2 } })), [["😀"]]);
    expect(importDelimitedDocument("😀", { format, sheetName, limits: { maxFieldLength: 1 } }).ok).toBe(false);
  });

  it("bounds original input size and fully encoded output size", () => {
    const document = unwrap(importDelimitedDocument("abc", { format, sheetName, limits: { maxTextLength: 3 } }));
    expect(importDelimitedDocument("abc", { format, sheetName, limits: { maxTextLength: 2 } }).ok).toBe(false);
    expect(importDelimitedDocument("\uFEFFabc", { format, sheetName, limits: { maxTextLength: 3 } }).ok).toBe(false);
    expect(unwrap(exportDelimitedSheet(document, { format, sheetName, limits: { maxTextLength: 5 } })).text).toBe("abc\r\n");
    expect(exportDelimitedSheet(document, { format, sheetName, limits: { maxTextLength: 4 } }).ok).toBe(false);
    expect(exportDelimitedSheet(document, { format, sheetName, bom: true, limits: { maxTextLength: 5 } }).ok).toBe(false);
  });

  it("includes transport quote expansion in the output budget", () => {
    const document = unwrap(read('""""'));
    expect(unwrap(exportDelimitedSheet(document, { format, sheetName, limits: { maxTextLength: 6 } })).text).toBe('""""\r\n');
    const result = exportDelimitedSheet(document, { format, sheetName, limits: { maxTextLength: 5 } });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "limit_exceeded", severity: "error", limit: "maxTextLength" }),
    ]));
  });

  it.each([0, -1, 0.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid resource limit %s", maxCells => {
      const result = importDelimitedDocument("safe", { format, sheetName, limits: { maxCells } });
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("value");
      expect(result.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
    },
  );
});
