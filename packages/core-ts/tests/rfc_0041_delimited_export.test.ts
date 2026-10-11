import { describe, expect, it } from "vitest";
import {
  applyBatchAtomic, DocumentState, exportDelimitedSheet, importDelimitedDocument,
  serializeDocumentState, SheetState, type DelimitedDiagnosticCode,
  type DelimitedExportOptions, type DelimitedResult,
} from "../src";
import { escapeCellText } from "../src/parser";

function unwrap<T>(result: DelimitedResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

function expectFailure<T>(result: DelimitedResult<T>, code: DelimitedDiagnosticCode): void {
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("value");
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, severity: "error" }));
}

const REPORT = `---
future: opaque
---
# Data
Notes outside the table.
| @meta |         || {:.1f} {::bold} | {:d} |
|          | Item    || 2024 | 2025 |
|          | ------- || ---- | ---- |
|          | Parent  || 12.345 | 20 |
|          | * Child || = 1 / 3 | null |
|          | Total   || = 2 + 3 |  |
`;

describe.each(["csv", "tsv"] as const)("RFC-0041 %s document export", format => {
  const separator = format === "csv" ? "," : "\t";
  const write = (document: DocumentState, sheetName = "Data", rest: Partial<DelimitedExportOptions> = {}) =>
    exportDelimitedSheet(document, { format, sheetName, ...rest });

  it.each(["-0", "0.12345678901234566", "1e-7", "-1.2345678901234567e-12", "5e-324"])(
    "keeps inferred numeric %s intact after native save and reopen", field => {
      const document = unwrap(importDelimitedDocument(field, { format, sheetName: "Data", valueMode: "infer" }));
      const reopened = DocumentState.fromText(serializeDocumentState(document));
      expect(reopened.evaluate().sheets[0].values[0][0]).toEqual({ kind: "number", value: Number(field) });
      expect(unwrap(write(reopened)).text).toBe(`${Object.is(Number(field), -0) ? "-0" : String(Number(field))}\r\n`);
    },
  );

  it("exports headers, parent and child rows, not serialization/control rows or rounded display strings", () => {
    const document = DocumentState.fromText(REPORT);
    const before = structuredClone(document);
    const result = write(document);
    expect(unwrap(result)).toEqual({
      text: [
        ["Item", "2024", "2025"],
        ["Parent", "12.345", "20"],
        ["Child", "0.3333333333333333", '""'],
        ["Total", "5", '""'],
      ].map(row => row.join(separator)).join("\r\n") + "\r\n",
      format, sheetName: "Data", rowCount: 4, columnCount: 3,
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "front_matter_omitted", count: 1 }),
      expect.objectContaining({ code: "sheet_content_omitted", count: 1 }),
      expect.objectContaining({ code: "display_metadata_omitted", count: 2 }),
      expect.objectContaining({ code: "hierarchy_omitted", rowIndex: 2, colIndex: 0, count: 1 }),
      expect.objectContaining({ code: "formulas_as_values", rowIndex: 2, colIndex: 1, count: 2 }),
      expect.objectContaining({ code: "null_as_empty", rowIndex: 2, colIndex: 2, count: 1 }),
      expect.objectContaining({ code: "types_not_preserved", count: 6 }),
    ]));
    expect(structuredClone(document)).toEqual(before);
  });

  it("keeps all levels of headers and label columns in original positions", () => {
    const document = DocumentState.fromText(`# Data
|             |        || 2024 |      |
| Region      | Metric || Q1   | Q2   |
| ----------- | ------ || ---- | ---- |
| North       | Sales  || 10   | 20   |
| * Child     | Cost   || 3    | 4    |
`);
    expect(unwrap(write(document)).text).toBe([
      ['""', '""', "2024", '""'], ["Region", "Metric", "Q1", "Q2"],
      ["North", "Sales", "10", "20"], ["Child", "Cost", "3", "4"],
    ].map(row => row.join(separator)).join("\r\n") + "\r\n");
  });

  it("exports structural labels literally even when a header resembles a formula", () => {
    const document = DocumentState.fromText("# Data\n| Name || = 1 / 0 |\n| --- || --- |\n| Item || 42 |");
    expectFailure(write(document), "formula_like_text");
    expect(unwrap(write(document, "Data", { formulaLikeText: "preserve" })).text)
      .toBe(`Name${separator}= 1 / 0\r\nItem${separator}42\r\n`);
  });

  it("recalculates stale formula caches and cross-sheet dependencies without altering source state", () => {
    const source = `# Inputs
| Name || Value |
| --- || --- |
| A || 7 |
# Data
| Name || Value |
| --- || --- |
| Answer || 999 = @["Inputs"::[A,Value]] * 2 |
`;
    const document = DocumentState.fromText(source);
    const before = structuredClone(document);
    const nativeBefore = serializeDocumentState(document);
    const result = write(document);
    expect(unwrap(result).text).toBe(`Name${separator}Value\r\nAnswer${separator}14\r\n`);
    expect(structuredClone(document)).toEqual(before);
    expect(serializeDocumentState(document)).toBe(nativeBefore);
    expect(write(document)).toEqual(result);
    expect(document.evaluate().sheets[1].values[0][1]).toEqual({ kind: "number", value: 14 });
  });

  it("preserves hidden reference bindings through clone after structural edits", () => {
    const document = DocumentState.fromText(`# Inputs
| Name || Value |
| --- || --- |
| A || 7 |
| B || 9 |
# Data
| Name || Value |
| --- || --- |
| Answer || = @["Inputs"::[#2!,Value]] * 2 |
`);
    const edited = applyBatchAtomic(document, [{ op: "rename_sheet", sheet: "Inputs", newName: "Renamed" }]);
    if (!edited.ok) throw new Error(edited.error.message);
    const before = structuredClone(edited.nextDocument);
    expect(unwrap(write(edited.nextDocument)).text).toBe(`Name${separator}Value\r\nAnswer${separator}14\r\n`);
    expect(structuredClone(edited.nextDocument)).toEqual(before);
  });

  it("does not fail because an unselected, unrelated sheet has evaluation errors", () => {
    const document = DocumentState.fromText("# Broken\n| = 1 / 0 |\n# Data\n| 42 |");
    expect(unwrap(write(document)).text).toBe("42\r\n");
  });

  it.each([
    ["= 1 / 0", "Divide by Zero"], ["error[type_error]", "Type Error"],
    ['= "x" * 2', "Type Error"], ["= 1 +", "Parse Error"],
    ["= @[Missing,Missing]", "Unresolved Reference"], ["= @[#1,#1]", "Cycle"],
    ["error[ambiguous_reference]", "Ambiguous Reference"], ["error[generic]", "Generic Error"],
    ["error[custom_failure]", "error[custom_failure]"],
  ])("exports error value %s as text with a warning and location", (input, label) => {
    const document = DocumentState.fromText(`# Data\n| ${input} |`);
    const before = structuredClone(document);
    const result = write(document);
    expect(unwrap(result).text).toBe(`${label}\r\n`);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "errors_as_text", severity: "warning", sheetName: "Data", rowIndex: 0, colIndex: 0 }));
    expect(structuredClone(document)).toEqual(before);
  });

  it("exports a cross-sheet dependency error as text, not its stale cache", () => {
    const document = DocumentState.fromText('# Source\n| Name || Value |\n| --- || --- |\n| A || = 1/0 |\n# Data\n| 123 = @["Source"::[A,Value]] |');
    expect(unwrap(write(document)).text).toBe("Divide by Zero\r\n");
  });

  it("retains healthy cells around errors and aggregates warnings", () => {
    const result = write(DocumentState.fromText('# Data\n| 42 | = "x"*2 | hello | = 1/0 |\n| 7 | 8 | 9 | 10 |'));
    expect(unwrap(result).text).toBe([
      ["42", "Type Error", "hello", "Divide by Zero"].join(separator),
      ["7", "8", "9", "10"].join(separator),
    ].join("\r\n") + "\r\n");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "errors_as_text", count: 2, rowIndex: 0, colIndex: 1 }));
    expect(result.diagnostics.every(item => item.severity === "warning")).toBe(true);
  });

  it.each([
    ["2026-10-03", "2026-10-03"], ["14:30:00", "14:30"],
    ["2026-10-03T14:30:00Z", "2026-10-03T14:30:00Z"],
    ["PT25H", "PT25H"], ["-0", "-0"], ["true", "true"], ["false", "false"],
    ["= 1 / 10000000", "1e-7"], ["= 1 / 3", "0.3333333333333333"],
    ["= 1000000000000000000000", "1e+21"],
  ])("exports the actual value of %s without display rounding", (input, expected) => {
    const document = DocumentState.fromText(`# Data\n| ${input} |`);
    expect(unwrap(write(document)).text).toBe(`${expected}\r\n`);
  });

  it("distinguishes negative numeric data from dangerous text, including formula string results", () => {
    const document = DocumentState.fromText('# Data\n| -12 |\n| = "-" + "12" |');
    const before = structuredClone(document);
    const blocked = write(document);
    expectFailure(blocked, "formula_like_text");
    expect(blocked.diagnostics.at(-1)).toMatchObject({ rowIndex: 1, colIndex: 0 });
    const preserved = write(document, "Data", { formulaLikeText: "preserve" });
    expect(unwrap(preserved).text).toBe("-12\r\n-12\r\n");
    expect(preserved.diagnostics).toContainEqual(expect.objectContaining({ code: "formula_like_text", severity: "warning", count: 1 }));
    expect(structuredClone(document)).toEqual(before);
  });

  it("documents collapse of blank, null, and empty string without inventing missing cells", () => {
    const document = DocumentState.fromText('# Data\n|   | null | "" |');
    const result = write(document);
    expect(unwrap(result).text).toBe(['""', '""', '""'].join(separator) + "\r\n");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "null_as_empty", rowIndex: 0, colIndex: 1 }));
  });

  it("reports local, row and column display metadata but exports unformatted numbers", () => {
    const document = DocumentState.fromText("# Data\n| Item || Value |\n| --- || --- |\n| Total {::bold} || 0.125 {:.1%} {::blue} |");
    const result = write(document);
    expect(unwrap(result).text).toBe(`Item${separator}Value\r\nTotal${separator}0.125\r\n`);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "display_metadata_omitted" }));
  });

  it("requires explicit, unique sheet selection", () => {
    const document = DocumentState.fromText("# A\n| 1 |\n# B\n| 2 |");
    expectFailure(write(document), "sheet_not_found");
    expect(unwrap(write(document, "B")).text).toBe("2\r\n");
    const duplicate = DocumentState.fromText("# Data\n| 1 |\n# Data\n| 2 |");
    expectFailure(write(duplicate), "ambiguous_sheet");
    expectFailure(write(new DocumentState([])), "sheet_not_found");
  });

  it("rejects additional table blocks instead of silently losing data", () => {
    const document = DocumentState.fromText("# Data\n| 1 |\n\nBetween\n\n| 2 |");
    expectFailure(write(document), "multiple_tables");
  });

  it("exports an empty sheet and allows an explicit BOM without inventing records", () => {
    const document = new DocumentState([SheetState.fromTableRows("Data", [])]);
    expect(unwrap(write(document))).toMatchObject({ text: "", rowCount: 0, columnCount: 0 });
    expect(unwrap(write(document, "Data", { bom: true })).text).toBe("\uFEFF");
  });

  it("enforces the whole-workbook evaluation cell budget before cloning", () => {
    const document = DocumentState.fromText("# Data\n| 1 |\n# Dependency\n| 2 | 3 |");
    const before = structuredClone(document);
    expectFailure(write(document, "Data", { limits: { maxCells: 2 } }), "limit_exceeded");
    expect(unwrap(write(document, "Data", { limits: { maxCells: 3 } })).text).toBe("1\r\n");
    expect(structuredClone(document)).toEqual(before);
  });

  it("fails before returning a prefix when output grows beyond the budget", () => {
    const document = DocumentState.fromText('# Data\n| "abc" |\n| "def" |');
    const before = structuredClone(document);
    expectFailure(write(document, "Data", { limits: { maxTextLength: 9 } }), "limit_exceeded");
    expect(unwrap(write(document, "Data", { limits: { maxTextLength: 10 } })).text).toBe("abc\r\ndef\r\n");
    expect(structuredClone(document)).toEqual(before);
  });

  it.each([Infinity, -Infinity, NaN])("rejects non-finite numerical results %s", value => {
    const document = DocumentState.fromText("# Data\n| 1 |");
    const body = document.sheets[0].cells[0][0].body;
    if (!body.valid || body.kind !== "literal" || body.literal.kind !== "number") throw new Error("fixture type");
    body.literal.value = value;
    expectFailure(write(document), "non_finite_number");
  });

  it.each([
    { format: "pipe" }, { sheetName: undefined }, { sheetName: "" },
    { formulaLikeText: "escape" }, { formulaLikeText: null },
    { lineEnding: "\r" }, { lineEnding: "invalid" }, { bom: "true" },
    { limits: null }, { limits: { typo: 10 } }, { unknown: true },
  ])("rejects invalid export options %j", options => {
    const document = DocumentState.fromText("# Data\n| 1 |");
    expectFailure(exportDelimitedSheet(document, { format, sheetName: "Data", ...options } as DelimitedExportOptions), "invalid_options");
  });

  it("generated transport checks preserve exact fields, not formula or type semantics", () => {
    let seed = 4180;
    const alphabet = ["a", "0", " ", ",", "\t", "\r", "\n", '"', "\\", "|", "😀", "\u2028", "\uFEFF", "=", "\0"];
    const rows = Array.from({ length: 100 }, () => Array.from({ length: 6 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const length = seed % 30;
      let value = "";
      for (let i = 0; i < length; i += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        value += alphabet[seed % alphabet.length];
      }
      return value;
    }));
    // Build .ord directly; expected fields are generated independently of CSV/TSV.
    const document = DocumentState.fromText("# Data\n" + rows.map(row =>
      "| " + row.map(field => escapeCellText(JSON.stringify(field))).join(" | ") + " |",
    ).join("\n"));
    const text = unwrap(write(document, "Data", { formulaLikeText: "preserve" })).text;
    const imported = unwrap(importDelimitedDocument(text, { format, sheetName: "Result" }));
    expect(imported.evaluate().sheets[0].values).toEqual(rows.map(row => row.map(value => ({ kind: "string", value }))));
  });
});
