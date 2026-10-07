import { describe, expect, it } from "vitest";
import {
  applyBatchAtomic,
  DocumentState,
  getCellTextView,
  inspectFormulaInput,
  parseCellText,
  parseFormulaReferenceSyntax,
  planFillRegion,
  serializeDocumentState,
  type CoreEdit,
  type CoreFillRect,
} from "../src";

const point = (row: number, col: number): CoreFillRect => ({ rowStart: row, rowEnd: row, colStart: col, colEnd: col });

function table(formula: string, row = 2, col = 2): DocumentState {
  const rows = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => String(10 * r + c + 1)));
  rows[row][col] = formula;
  return DocumentState.fromText(`# Sheet\n${rows.map(cells => `| ${cells.join(" | ")} |`).join("\n")}`);
}

function inputAt(document: DocumentState, row: number, col: number, sheet = 0): string {
  return getCellTextView(document.sheets[sheet].cells[row][col]).inputText;
}

function edit(document: DocumentState, operations: CoreEdit[]): DocumentState {
  const result = applyBatchAtomic(document, operations);
  if (!result.ok) throw new Error(result.error.message);
  return result.nextDocument;
}

function expectRoundTrip(document: DocumentState): void {
  // A headerless first data column is not a structural label: its raw text may
  // acquire canonical formula spelling or a result cache during serialization.
  const semanticSheets = (state: DocumentState) => state.evaluate().sheets.map(({ name, values }) => ({ name, values }));
  const value = semanticSheets(document);
  const restored = DocumentState.fromText(serializeDocumentState(document));
  expect(semanticSheets(restored)).toEqual(value);
}

const cellAnchors = [
  { source: "A1", rowFixed: false, colFixed: false },
  { source: "$A1", rowFixed: false, colFixed: true },
  { source: "A$1", rowFixed: true, colFixed: false },
  { source: "$A$1", rowFixed: true, colFixed: true },
];

describe("RFC-0042 copy-fixed native reference syntax", () => {
  it.each(cellAnchors)("projects separate copy locks for $source", ({ source, rowFixed, colFixed }) => {
    const syntax = parseFormulaReferenceSyntax(source);
    expect(syntax).toMatchObject({ style: "spreadsheet", crossSheet: false, sheetName: null });
    expect(syntax?.reference?.rowSelector).toEqual({ kind: "absolute", value: 0, ...(rowFixed ? { copyFixed: true } : {}) });
    expect(syntax?.reference?.colSelector).toEqual({ kind: "absolute", value: 0, ...(colFixed ? { copyFixed: true } : {}) });
    const parsed = parseCellText(`= ${source}`);
    expect(parsed.body).toMatchObject({ valid: true, kind: "formula", expression: { kind: "reference" } });
  });

  it.each([
    { source: "@[#1$,#2]", row: { kind: "absolute", value: 0, copyFixed: true }, col: { kind: "absolute", value: 1 } },
    { source: "@[#1,#2$]", row: { kind: "absolute", value: 0 }, col: { kind: "absolute", value: 1, copyFixed: true } },
    { source: "@[#1$,#2$]", row: { kind: "absolute", value: 0, copyFixed: true }, col: { kind: "absolute", value: 1, copyFixed: true } },
    { source: "@[#1!,#2$]", row: { kind: "absolute_fixed", value: 0 }, col: { kind: "absolute", value: 1, copyFixed: true } },
    { source: "@[#1$,#2!]", row: { kind: "absolute", value: 0, copyFixed: true }, col: { kind: "absolute_fixed", value: 1 } },
  ])("distinguishes copy-fixed and positional-fixed selectors in $source", ({ source, row, col }) => {
    const parsed = parseFormulaReferenceSyntax(source);
    expect(parsed?.reference).toMatchObject({ rowSelector: row, colSelector: col });
    expect(parsed?.reference?.rowSelector).toEqual(row);
    expect(parsed?.reference?.colSelector).toEqual(col);
  });

  it("projects anchors independently on both ends of a rectangle", () => {
    expect(parseFormulaReferenceSyntax("$A1:B$2")?.reference).toMatchObject({
      rowSelector: { kind: "range", value: [{ kind: "absolute", value: 0 }, { kind: "absolute", value: 1, copyFixed: true }] },
      colSelector: { kind: "range", value: [{ kind: "absolute", value: 0, copyFixed: true }, { kind: "absolute", value: 1 }] },
    });
    expect(parseFormulaReferenceSyntax("@[#1$:#2,#1:#2$]")?.reference).toMatchObject({
      rowSelector: { kind: "range", value: [{ kind: "absolute", value: 0, copyFixed: true }, { kind: "absolute", value: 1 }] },
      colSelector: { kind: "range", value: [{ kind: "absolute", value: 0 }, { kind: "absolute", value: 1, copyFixed: true }] },
    });
  });

  it.each([
    { source: "$A:$B", axis: "colSelector", other: "rowSelector", firstFixed: true, lastFixed: true },
    { source: "$A:B", axis: "colSelector", other: "rowSelector", firstFixed: true, lastFixed: false },
    { source: "A:$B", axis: "colSelector", other: "rowSelector", firstFixed: false, lastFixed: true },
    { source: "$1:$2", axis: "rowSelector", other: "colSelector", firstFixed: true, lastFixed: true },
    { source: "$1:2", axis: "rowSelector", other: "colSelector", firstFixed: true, lastFixed: false },
    { source: "1:$2", axis: "rowSelector", other: "colSelector", firstFixed: false, lastFixed: true },
  ] as const)("projects copy-fixed whole-axis endpoints in $source", ({ source, axis, other, firstFixed, lastFixed }) => {
    const reference = parseFormulaReferenceSyntax(source)?.reference;
    expect(reference?.[other]).toEqual({ kind: "all" });
    expect(reference?.[axis]).toEqual({
      kind: "range",
      value: [
        { kind: "absolute", value: 0, ...(firstFixed ? { copyFixed: true } : {}) },
        { kind: "absolute", value: 1, ...(lastFixed ? { copyFixed: true } : {}) },
      ],
    });
  });

  it.each(["$A1", "A$1", "$A$1", "$A1:B$2", "$A:$B", "$1:$2", "@[#1$,#2$]"])(
    "keeps %s as one complete reference token with accessible projected locks", reference => {
      const source = `= sum(${reference})`;
      const inspected = inspectFormulaInput(source, { caret: source.indexOf(reference) + 1 });
      expect(inspected.kind).toBe("formula");
      expect(inspected.diagnostics).toEqual([]);
      const tokens = inspected.tokens.filter(token => token.kind === "spreadsheet_reference" || token.kind === "ordinate_reference");
      expect(tokens).toHaveLength(1);
      expect(source.slice(tokens[0].span.start, tokens[0].span.end)).toBe(reference);
      expect(parseFormulaReferenceSyntax(reference)?.reference).not.toBeNull();
      expect(JSON.stringify(parseFormulaReferenceSyntax(reference)?.reference)).toContain('"copyFixed":true');
    },
  );

  it.each(["$A$0", "$$A1", "A$$1", "$A", "$1", "A1$"])(
    "rejects malformed anchored formula %s", reference => {
      expect(parseCellText(`= ${reference}`).body.valid).toBe(false);
    },
  );

  it.each(["@[#1$$,#1]", "@[#1!$,#1]", "@[#1$!,#1]"])(
    "does not reinterpret malformed Ordinate lock %s as a valid selector", reference => {
      expect(parseFormulaReferenceSyntax(reference)?.reference).toBeNull();
      expect(table(`= ${reference}`).evaluate().sheets[0].values[2][2].kind).toBe("error");
    },
  );

  it("does not add Excel sheet-bang syntax to the native formula parser", () => {
    expect(parseCellText("= Other!$A$1").body.valid).toBe(false);
    expect(parseCellText("= 'Other Sheet'!$A$1").body.valid).toBe(false);
  });
});

describe("RFC-0042 copy locks through native serialization and fill", () => {
  it.each(["$A1", "A$1", "$A$1", "@[#1$,#1]", "@[#1,#1$]", "@[#1$,#1$]"])(
    "retains anchored scalar %s through bound evaluation and serialization", reference => {
      const document = table(`= ${reference}`);
      expect(document.evaluate().sheets[0].values[2][2]).toEqual({ kind: "number", value: 1 });
      const text = serializeDocumentState(document);
      expect(text).toContain(`= ${reference}`);
      expect(inputAt(DocumentState.fromText(text), 2, 2)).toBe(`= ${reference}`);
      expectRoundTrip(document);
    },
  );

  it.each(["$A1:B$2", "$A$1:$B$2", "$A:$B", "$1:$2", "@[#1$:#2,#1:#2$]"])(
    "preserves range endpoint locks in %s", reference => {
      const document = table(`= sum(${reference})`, 4, 4);
      const before = document.evaluate().sheets[0].values[4][4];
      expect(before.kind).toBe("number");
      const text = serializeDocumentState(document);
      expect(text).toContain(`sum(${reference})`);
      expectRoundTrip(document);
    },
  );

  it("does not collapse a one-cell range with differently locked endpoints", () => {
    const document = table("= sum($A1:A$1)");
    expect(serializeDocumentState(document)).toContain("sum($A1:A$1)");
    expectRoundTrip(document);
  });

  const mixed = [
    { source: "B2", down: "B3", up: "B1", right: "C2", left: "A2" },
    { source: "$B2", down: "$B3", up: "$B1", right: "$B2", left: "$B2" },
    { source: "B$2", down: "B$2", up: "B$2", right: "C$2", left: "A$2" },
    { source: "$B$2", down: "$B$2", up: "$B$2", right: "$B$2", left: "$B$2" },
    { source: "@[#2,#2]", down: "@[#3,#2]", up: "@[#1,#2]", right: "@[#2,#3]", left: "@[#2,#1]" },
    { source: "@[#2,#2$]", down: "@[#3,#2$]", up: "@[#1,#2$]", right: "@[#2,#2$]", left: "@[#2,#2$]" },
    { source: "@[#2$,#2]", down: "@[#2$,#2]", up: "@[#2$,#2]", right: "@[#2$,#3]", left: "@[#2$,#1]" },
    { source: "@[#2$,#2$]", down: "@[#2$,#2$]", up: "@[#2$,#2$]", right: "@[#2$,#2$]", left: "@[#2$,#2$]" },
    { source: "@[#2!,#2!]", down: "@[#2!,#2!]", up: "@[#2!,#2!]", right: "@[#2!,#2!]", left: "@[#2!,#2!]" },
  ];
  for (const [direction, r, c] of [["down", 3, 2], ["up", 1, 2], ["right", 2, 3], ["left", 2, 1]] as const) {
    it.each(mixed)(`fills $source ${direction} without moving its locked axes`, item => {
      const document = table(`= ${item.source}`);
      document.evaluate();
      const before = serializeDocumentState(document);
      const result = planFillRegion(document.sheets[0], point(2, 2), point(r, c), "copy");
      expect(result.values).toEqual([[`= ${item[direction]}`]]);
      expect(serializeDocumentState(document)).toBe(before);
    });
  }

  it.each([
    { source: "$A$1:B2", down: "$A$1:B3", right: "$A$1:C2" },
    { source: "$A1:B$2", down: "$A2:B$2", right: "$A1:C$2" },
    { source: "$A:$B", down: "$A:$B", right: "$A:$B" },
    { source: "$A:B", down: "$A:B", right: "$A:C" },
    { source: "$1:$2", down: "$1:$2", right: "$1:$2" },
    { source: "$1:2", down: "$1:3", right: "$1:2" },
  ])("fills whole or rectangular range $source with independent locks", ({ source, down, right }) => {
    const document = table(`= sum(${source})`, 4, 4);
    expect(planFillRegion(document.sheets[0], point(4, 4), point(5, 4), "copy").values).toEqual([[`= sum(${down})`]]);
    expect(planFillRegion(document.sheets[0], point(4, 4), point(4, 5), "copy").values).toEqual([[`= sum(${right})`]]);
  });

  it("does not rewrite dollar text inside or outside quoted literals during fill", () => {
    const literal = table("$A$1");
    expect(literal.evaluate().sheets[0].values[2][2]).toEqual({ kind: "string", value: "$A$1" });
    expect(inspectFormulaInput("$A$1").kind).toBe("not_formula");
    const formula = table('= "$A$1 and #1$" + "$B2"');
    expect(planFillRegion(formula.sheets[0], point(2, 2), point(3, 2), "copy").values).toEqual([['= "$A$1 and #1$" + "$B2"']]);
    expect(formula.evaluate().sheets[0].values[2][2]).toEqual({ kind: "string", value: "$A$1 and #1$$B2" });
  });
});

describe("RFC-0042 copy locks do not pin structural positions", () => {
  it.each([true, false])("refreshes cross-sheet source and fill immediately after direct edits, eager=%s", eager => {
    const document = DocumentState.fromText('# Other\n| 7 | 8 |\n| 9 | 10 |\n# Sheet\n| = @[Other::[#2$,#2$]] | 0 |\n| 0 | 0 |');
    document.insertRow("Other", 0, eager);
    document.insertCol("Other", 0, eager);
    // Do not call evaluate/serialize here: either would repair stale source
    // text and conceal the editor/fill bug this direct API test exercises.
    expect(inputAt(document, 0, 0, 1)).toBe("= @[Other::[#3$,#3$]]");
    expect(planFillRegion(document.sheets[1], point(0, 0), point(1, 0), "copy").values).toEqual([["= @[Other::[#3$,#3$]]"]]);
    document.deleteRow("Other", 0, eager);
    document.deleteCol("Other", 0, eager);
    expect(inputAt(document, 0, 0, 1)).toBe("= @[Other::[#2$,#2$]]");
    expect(document.evaluate().sheets[1].values[0][0]).toEqual({ kind: "number", value: 10 });
  });

  it("binds a newly entered cross-sheet copy lock before direct structural editing", () => {
    const document = DocumentState.fromText('# Other\n| 7 |\n| 9 |\n# Sheet\n| 0 |');
    document.setCellByIndex("Sheet", 0, 0, "= @[Other::[#1$,#1$]]");
    document.insertRow("Other", 0);
    expect(inputAt(document, 0, 0, 1)).toBe("= @[Other::[#2$,#1$]]");
    expect(document.evaluate().sheets[1].values[0][0]).toEqual({ kind: "number", value: 7 });
  });

  it.each([
    { source: "$A1", after: "$B2" },
    { source: "A$1", after: "B$2" },
    { source: "$A$1", after: "$B$2" },
    { source: "@[#1$,#1$]", after: "@[#2$,#2$]" },
  ])("tracks both inserted axes for $source", ({ source, after }) => {
    const document = table(`= ${source}`);
    expect(document.evaluate().sheets[0].values[2][2]).toEqual({ kind: "number", value: 1 });
    document.insertRow("Sheet", 0, true);
    document.insertCol("Sheet", 0, true);
    expect(inputAt(document, 3, 3)).toBe(`= ${after}`);
    expect(document.evaluate().sheets[0].values[3][3]).toEqual({ kind: "number", value: 1 });
    expectRoundTrip(document);
  });

  it("keeps #n! position-fixed while #n$ follows the inserted cell identity", () => {
    const document = table("= @[#1!,#1!]");
    document.insertRow("Sheet", 0, true);
    document.insertCol("Sheet", 0, true);
    expect(inputAt(document, 3, 3)).toBe("= @[#1!,#1!]");
    expect(document.evaluate().sheets[0].values[3][3]).toEqual({ kind: "blank", value: null });
    expectRoundTrip(document);
  });

  it.each(["$A$1", "@[#1$,#1$]"])("tracks moved rows and columns for %s", reference => {
    let document = table(`= ${reference}`);
    const original = document.sheets[0];
    const rowId = original.rowIds[0];
    const colId = original.colIds[0];
    document = edit(document, [{ op: "move_rows", sheet: "Sheet", rowIds: [rowId], targetGapIndex: 1 }]);
    document = edit(document, [{ op: "move_columns", sheet: "Sheet", colIds: [colId], targetGapIndex: 1 }]);
    expect(document.evaluate().sheets[0].values[2][2]).toEqual({ kind: "number", value: 1 });
    expect(inputAt(document, 2, 2)).toBe(reference.startsWith("@") ? "= @[#2$,#2$]" : "= $B$2");
    expectRoundTrip(document);
  });

  it("retains locks after deleting a row and column before the target", () => {
    const document = table("= $B$2", 4, 4);
    expect(document.evaluate().sheets[0].values[4][4]).toEqual({ kind: "number", value: 12 });
    document.deleteRow("Sheet", 0, true);
    document.deleteCol("Sheet", 0, true);
    expect(inputAt(document, 3, 3)).toBe("= $A$1");
    expect(document.evaluate().sheets[0].values[3][3]).toEqual({ kind: "number", value: 12 });
    expectRoundTrip(document);
  });

  it("preserves copy locks on cross-sheet selectors through evaluation, insertions, and fill", () => {
    const document = DocumentState.fromText(`# Other\n| 7 | 8 |\n| 9 | 10 |\n\n# Sheet\n| = @["Other"::[#1$,#1$]] | 0 |\n| 0 | 0 |\n| 0 | 0 |`);
    expect(document.evaluate().sheets[1].values[0][0]).toEqual({ kind: "number", value: 7 });
    const syntax = parseFormulaReferenceSyntax('@["Other"::[#1$,#1$]]');
    expect(syntax).toMatchObject({ crossSheet: true, sheetName: "Other", reference: {
      rowSelector: { kind: "absolute", value: 0, copyFixed: true },
      colSelector: { kind: "absolute", value: 0, copyFixed: true },
    } });
    document.insertRow("Other", 0, true);
    document.insertCol("Other", 0, true);
    expect(serializeDocumentState(document)).toContain("= @[Other::[#2$,#2$]]");
    expect(document.evaluate().sheets[1].values[0][0]).toEqual({ kind: "number", value: 7 });
    expect(planFillRegion(document.sheets[1], point(0, 0), point(1, 0), "copy").values).toEqual([["= @[Other::[#2$,#2$]]"]]);
    expectRoundTrip(document);
  });
});
