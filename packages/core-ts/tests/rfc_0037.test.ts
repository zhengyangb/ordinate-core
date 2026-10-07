import { describe, expect, it } from "vitest";

import {
  DocumentState,
  evaluateDocument,
  formatFormulaReferencePathComponent,
  formatFormulaSheetSelector,
  inspectFormulaInput,
  parseCellText,
  parseFormulaReferenceSyntax,
  serializeDocumentState,
  type FormulaEditorInspection,
} from "../src";

function inspect(source: string, caret?: number) {
  const result = inspectFormulaInput(source, caret === undefined ? undefined : { caret });
  if (result.kind !== "formula") throw new Error(`expected formula inspection for ${JSON.stringify(source)}`);
  return result;
}

function tokenTexts(result: Extract<FormulaEditorInspection, { kind: "formula" }>) {
  return result.tokens.map((token) => result.source.slice(token.span.start, token.span.end));
}

function tokenKinds(result: Extract<FormulaEditorInspection, { kind: "formula" }>) {
  return result.tokens.map((token) => token.kind);
}

function structureSummary(result: Extract<FormulaEditorInspection, { kind: "formula" }>) {
  return result.structures.map((structure) => ({
    kind: structure.kind,
    open: result.source.slice(structure.open.start, structure.open.end),
    close: structure.close ? result.source.slice(structure.close.start, structure.close.end) : null,
    parent: structure.parent,
    name: structure.kind === "call" ? structure.name : null,
    separators: structure.kind === "call" ? structure.separatorSpans.length : null,
  }));
}

describe("RFC-0037 formula editor inspection", () => {
  describe("formula boundary and lossless tokens", () => {
    it.each(["", "   ", "value", "  value", "42 = sum(A:A)"])("rejects non-formula input %j", (source) => {
      expect(inspectFormulaInput(source)).toEqual({
        kind: "not_formula",
        source,
        tokens: [],
        structures: [],
        diagnostics: [],
        caret: null,
      });
    });

    it("preserves leading and internal whitespace as exact UTF-16 spans", () => {
      const source = " \t=  sum( A1,\n@[Rows, Cols] ) ";
      const result = inspect(source);
      expect(tokenTexts(result).join("")).toBe(source);
      expect(tokenTexts(result).filter((_, index) => result.tokens[index].kind === "whitespace")).toEqual([
        " \t",
        "  ",
        " ",
        "\n",
        " ",
        " ",
      ]);
      for (const token of result.tokens) {
        expect(token.span.start).toBeLessThan(token.span.end);
        expect(source.slice(token.span.start, token.span.end)).not.toBe("");
      }
    });

    it("uses longest operator matching and preserves every punctuation token", () => {
      const result = inspect("=+ - * / ** == != < <= > >= ( ) [ ] , : =");
      expect(tokenTexts(result).filter((_, index) => result.tokens[index].kind !== "whitespace")).toEqual([
        "=", "+", "-", "*", "/", "**", "==", "!=", "<", "<=", ">", ">=", "(", ")", "[", "]", ",", ":", "=",
      ]);
      expect(result.tokens.at(-1)?.kind).toBe("unknown");
    });

    it("returns an exact golden projection for nested call, array, reference, and index syntax", () => {
      const source = "=sum([1,2],@[R,C][0,:])";
      expect(inspectFormulaInput(source, { caret: 21 })).toEqual({
        kind: "formula",
        source,
        tokens: [
          { kind: "formula_marker", span: { start: 0, end: 1 } },
          { kind: "identifier", span: { start: 1, end: 4 } },
          { kind: "punctuation", span: { start: 4, end: 5 } },
          { kind: "punctuation", span: { start: 5, end: 6 } },
          { kind: "number", span: { start: 6, end: 7 } },
          { kind: "punctuation", span: { start: 7, end: 8 } },
          { kind: "number", span: { start: 8, end: 9 } },
          { kind: "punctuation", span: { start: 9, end: 10 } },
          { kind: "punctuation", span: { start: 10, end: 11 } },
          { kind: "ordinate_reference", span: { start: 11, end: 17 }, complete: true },
          { kind: "punctuation", span: { start: 17, end: 18 } },
          { kind: "number", span: { start: 18, end: 19 } },
          { kind: "punctuation", span: { start: 19, end: 20 } },
          { kind: "punctuation", span: { start: 20, end: 21 } },
          { kind: "punctuation", span: { start: 21, end: 22 } },
          { kind: "punctuation", span: { start: 22, end: 23 } },
        ],
        structures: [
          {
            kind: "call",
            name: "sum",
            nameSpan: { start: 1, end: 4 },
            open: { start: 4, end: 5 },
            close: { start: 22, end: 23 },
            contentSpan: { start: 5, end: 22 },
            parent: null,
            separatorSpans: [{ start: 10, end: 11 }],
          },
          {
            kind: "array",
            open: { start: 5, end: 6 },
            close: { start: 9, end: 10 },
            contentSpan: { start: 6, end: 9 },
            parent: 0,
          },
          {
            kind: "index",
            open: { start: 17, end: 18 },
            close: { start: 21, end: 22 },
            contentSpan: { start: 18, end: 21 },
            parent: 0,
          },
        ],
        diagnostics: [],
        caret: {
          offset: 21,
          tokenIndex: 14,
          referenceTokenIndex: null,
          callStructureIndex: 0,
          argumentIndex: 1,
        },
      });
    });

    it("classifies keywords separately from ordinary identifiers", () => {
      const result = inspect("=true false null truth falsey null_value");
      expect(tokenKinds(result).filter((kind) => kind !== "formula_marker" && kind !== "whitespace")).toEqual([
        "keyword", "keyword", "keyword", "identifier", "identifier", "identifier",
      ]);
    });

    it("preserves current permissive number tokenization for strict lowering", () => {
      const result = inspect("=1.2.3");
      expect(tokenTexts(result)).toEqual(["=", "1.2.3"]);
      expect(result.tokens[1].kind).toBe("number");
      const parsed = parseCellText("=1.2.3");
      expect(parsed.body.valid && parsed.body.kind === "formula" ? parsed.body.expression : null).toMatchObject({
        kind: "literal",
        value: { kind: "number", value: 1.2 },
      });
    });
  });

  describe("compound lexical tokens", () => {
    it.each([
      '="a,b[1]"',
      '="a\\\"b"',
      '="a\\\\"+1',
      '="line one\nline two"',
    ])("keeps complete strings atomic: %j", (source) => {
      const result = inspect(source);
      const strings = result.tokens.filter((token) => token.kind === "string");
      expect(strings).toHaveLength(1);
      expect(strings[0]).toMatchObject({ kind: "string", complete: true });
      expect(result.diagnostics).toEqual([]);
    });

    it.each(['="unterminated', '="trailing\\'])("reports an incomplete string through EOF: %j", (source) => {
      const result = inspect(source, source.length);
      expect(result.tokens.at(-1)).toMatchObject({ kind: "string", complete: false });
      expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(["unterminated_string"]);
      expect(result.caret?.tokenIndex).toBe(result.tokens.length - 1);
    });

    it("applies odd/even backslash parity to string termination", () => {
      const odd = inspect('="a\\\"b"');
      const even = inspect('="a\\\\"+1');
      expect(tokenTexts(odd)).toEqual(["=", '"a\\\"b"']);
      expect(tokenTexts(even)).toEqual(["=", '"a\\\\"', "+", "1"]);
    });

    it("keeps nested cross-sheet references, quotes, newlines, and escaped brackets atomic", () => {
      const references = [
        '@["Inputs"::[Revenue,Amount]]',
        '@["Sheet [A]"::["Row ] Name",Value]]',
        "@[Rows,\nCols]",
        "@[a\\],b]",
      ];
      const source = `=${references.join(" + ")}`;
      const result = inspect(source);
      expect(result.tokens.filter((token) => token.kind === "ordinate_reference").map((token) => source.slice(token.span.start, token.span.end))).toEqual(references);
      expect(result.tokens.filter((token) => token.kind === "ordinate_reference").every((token) => "complete" in token && token.complete)).toBe(true);
    });

    it("reports one incomplete cross-sheet reference through EOF", () => {
      const source = '=@["Inputs"::[Revenue,Amount]';
      const result = inspect(source, source.length);
      expect(result.tokens.at(-1)).toMatchObject({ kind: "ordinate_reference", complete: false });
      expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(["unterminated_reference"]);
      expect(result.caret?.referenceTokenIndex).toBe(result.tokens.length - 1);
    });

    it("applies odd/even escape parity and preserves a trailing reference backslash", () => {
      const escapedClose = inspect("=@[a\\],b]");
      expect(tokenTexts(escapedClose)).toEqual(["=", "@[a\\],b]"]);

      const trailing = "=@[a\\";
      const incomplete = inspect(trailing, trailing.length);
      expect(incomplete.tokens.at(-1)).toEqual({
        kind: "ordinate_reference",
        span: { start: 1, end: trailing.length },
        complete: false,
      });
    });

    it.each([
      ["=error[bad]", true, []],
      ["=error[", false, ["unterminated_error_literal"]],
      ["=error[bad", false, ["unterminated_error_literal"]],
      ["=error[Bad]", true, ["malformed_error_literal"]],
      ["=error[bad]suffix", true, ["malformed_error_literal"]],
      ["=error[bad][0]", true, ["malformed_error_literal"]],
    ] as const)("classifies error literal %s", (source, complete, diagnostics) => {
      const result = inspect(source);
      const token = result.tokens.find((candidate) => candidate.kind === "error_literal");
      expect(token).toMatchObject({ kind: "error_literal", complete });
      expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(diagnostics);
    });

    it("terminates malformed error literals at the first closing bracket", () => {
      const source = "=error[a[b]]";
      const result = inspect(source);
      expect(tokenTexts(result)).toEqual(["=", "error[a[b]", "]"]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
        "malformed_error_literal",
        "unexpected_closing_delimiter",
      ]);
    });
  });

  describe("temporal and spreadsheet references", () => {
    it.each(["2026-03-24", "2026-13-01", "14:35", "PT1H30M"])("classifies complete temporal shape %s", (literal) => {
      const result = inspect(`=${literal}`);
      expect(result.tokens[1]).toMatchObject({ kind: "temporal_literal" });
    });

    it.each(["2026-03", "14:", "PT"])("does not classify partial temporal shape %s", (literal) => {
      expect(inspect(`=${literal}`).tokens.some((token) => token.kind === "temporal_literal")).toBe(false);
    });

    it.each(["A1", "A1:B3", "A:A", "1:1"])("classifies spreadsheet reference %s", (reference) => {
      const result = inspect(`=${reference}`);
      expect(result.tokens[1]).toMatchObject({ kind: "spreadsheet_reference" });
      expect(tokenTexts(result)[1]).toBe(reference);
    });

    it.each([
      ["=A1_", ["identifier"]],
      ["=A1.", ["spreadsheet_reference", "unknown"]],
      ["=A1:B3x", ["spreadsheet_reference", "punctuation", "identifier"]],
    ] as const)("uses deterministic spreadsheet boundaries for %s", (source, expectedKinds) => {
      const result = inspect(source);
      expect(tokenKinds(result).slice(1)).toEqual(expectedKinds);
    });

    it("classifies A1 references inside arrays but not postfix index expressions", () => {
      const array = inspect("=[A1, B1]");
      const index = inspect("=@[Rows, Cols][A1]");
      expect(array.tokens.filter((token) => token.kind === "spreadsheet_reference")).toHaveLength(2);
      expect(index.tokens.some((token) => token.kind === "spreadsheet_reference")).toBe(false);
      const parsed = parseCellText("=[A1, B1]");
      expect(parsed.body.valid).toBe(true);
    });
  });

  describe("shared reference syntax projection", () => {
    it("uses strict backslash unescaping for quoted cross-sheet names", () => {
      const parsed = parseFormulaReferenceSyntax('@["A\\q"::[Revenue,Amount]]');
      expect(parsed).toMatchObject({
        style: "ordinate",
        crossSheet: true,
        sheetName: "Aq",
        reference: {
          sheetSelector: { kind: "sheet_name", value: "Aq" },
          rowSelector: { kind: "label", value: ["Revenue"] },
          colSelector: { kind: "label", value: ["Amount"] },
        },
      });
    });

    it("round-trips quoted path and sheet components with core escape semantics", () => {
      const sheetName = "Input\t\\\"Sheet";
      const rowLabel = "Revenue\n\\\"Total";
      const text = `@[${formatFormulaSheetSelector(sheetName)}::[${formatFormulaReferencePathComponent(rowLabel)},Amount]]`;
      const parsed = parseFormulaReferenceSyntax(text);

      expect(parsed?.sheetName).toBe(sheetName);
      expect(parsed?.reference?.rowSelector).toEqual({ kind: "label", value: [rowLabel] });
    });

    it.each(["_", "_0", "_1", "_01"])('quotes the reserved relative selector label %j', (label) => {
      const text = `@[${formatFormulaReferencePathComponent(label)},Amount]`;
      expect(parseFormulaReferenceSyntax(text)?.reference?.rowSelector).toEqual({ kind: "label", value: [label] });
    });

    it("projects whole-row and whole-column spreadsheet selectors", () => {
      expect(parseFormulaReferenceSyntax("A:A")?.reference).toMatchObject({
        rowSelector: { kind: "all" },
        colSelector: { kind: "range" },
      });
      expect(parseFormulaReferenceSyntax("1:1")?.reference).toMatchObject({
        rowSelector: { kind: "range" },
        colSelector: { kind: "all" },
      });
    });

    it("returns null reference semantics for complete strict-invalid Ordinate selectors", () => {
      expect(parseFormulaReferenceSyntax("@[OnlyOneAxis]")).toEqual({
        style: "ordinate",
        crossSheet: false,
        sheetName: null,
        reference: null,
      });
      expect(parseFormulaReferenceSyntax("not a reference")).toBeNull();
    });

    it.each([",", ":", ")", "]"])("preserves the original unexpected-token diagnostic for %j", (token) => {
      const parsed = parseCellText(`=${token}`);
      expect(parsed.body.valid).toBe(false);
      if (parsed.body.valid) throw new Error("expected invalid formula body");
      expect(parsed.body.issue).toEqual({
        code: "parse_expression_unexpected_token",
        context: { token },
      });
    });

    it.each(["=?", '=\"unterminated', "=error[", "=@[broken"])(
      "preserves the legacy lexical-error token context for %j",
      (source) => {
        const parsed = parseCellText(source);
        expect(parsed.body.valid).toBe(false);
        if (parsed.body.valid) throw new Error("expected invalid formula body");
        expect(parsed.body.issue).toEqual({
          code: "parse_expression_unexpected_token",
          context: { token: "ERR" },
        });
      },
    );
  });

  describe("shared structural classification", () => {
    it("classifies calls, arrays, groups, and postfix indexes in preorder", () => {
      const result = inspect("=if((sum([1,2])) > 0, @[Rows,Cols][0:2,0:1], 0)");
      expect(structureSummary(result)).toEqual([
        { kind: "call", open: "(", close: ")", parent: null, name: "if", separators: 2 },
        { kind: "group", open: "(", close: ")", parent: 0, name: null, separators: null },
        { kind: "call", open: "(", close: ")", parent: 1, name: "sum", separators: 0 },
        { kind: "array", open: "[", close: "]", parent: 2, name: null, separators: null },
        { kind: "index", open: "[", close: "]", parent: 0, name: null, separators: null },
      ]);
    });

    it.each([
      "=@[R,C][0]",
      "=@[R,C][0,1]",
      "=@[R,C][:]",
      "=@[R,C][1:]",
      "=@[R,C][:2]",
      "=@[R,C][0:2,1:3]",
    ])("classifies complete scalar and slice index matrix %s", (source) => {
      const result = inspect(source);
      expect(result.structures.at(-1)).toMatchObject({ kind: "index", close: expect.any(Object) });
      expect(parseCellText(source).body.valid).toBe(true);
    });

    it("records trailing call slots without stealing nested separators", () => {
      const source = "=sum([1,2], @[R,C], )";
      const result = inspect(source, source.length - 1);
      const call = result.structures[0];
      expect(call.kind === "call" ? call.separatorSpans : null).toEqual([
        { start: 10, end: 11 },
        { start: 18, end: 19 },
      ]);
      expect(result.caret?.argumentIndex).toBe(2);
    });

    it("treats keyword-shaped identifiers followed by parentheses as calls", () => {
      const result = inspect("=true() + false() + null()");
      expect(result.structures.map((structure) => structure.kind === "call" ? structure.name : structure.kind)).toEqual([
        "true", "false", "null",
      ]);
    });

    it.each([
      ["=1 2[3]", "index"],
      ["=foo bar(1)", "call"],
      ["=1 ? [2]", "array"],
      ["=1 + ) [2]", "array"],
      ["=error[bad][0]", "array"],
      ["=1\n [2]", "index"],
    ] as const)("recovers %s with final %s structure", (source, kind) => {
      expect(inspect(source).structures.at(-1)?.kind).toBe(kind);
    });

    it("does not cross structures while recovering mismatched closers", () => {
      const result = inspect("=f([1), 2]");
      expect(structureSummary(result)).toEqual([
        { kind: "call", open: "(", close: null, parent: null, name: "f", separators: 0 },
        { kind: "array", open: "[", close: "]", parent: 0, name: null, separators: null },
      ]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
        "unclosed_delimiter",
        "unexpected_closing_delimiter",
      ]);
      const strict = parseCellText("=f([1), 2]");
      expect(strict.body.valid ? null : strict.body.issue.code).toBe("parse_array_missing_closing_bracket");
    });

    it("orders multiple unclosed delimiter diagnostics by opening span", () => {
      const result = inspect("=f([g(");
      expect(result.structures.map((structure) => structure.close)).toEqual([null, null, null]);
      expect(result.diagnostics).toEqual([
        { kind: "unclosed_delimiter", span: { start: 2, end: 3 } },
        { kind: "unclosed_delimiter", span: { start: 3, end: 4 } },
        { kind: "unclosed_delimiter", span: { start: 5, end: 6 } },
      ]);
    });

    it("keeps the strict parser and editor projection on one classification corpus", () => {
      const formulas = [
        "=dotProduct([1, 2], [3, 4])",
        "=sum([[1, 2], [3, 4]])",
        "=if(sum(@[:, Revenue:Cost][0:2, 0:1]) > 0, @[\"Inputs\"::[Key, Value]], 0)",
        "=if(contains(\"a,b\", \",\"), sum(@[:, Revenue]), 0)",
        "=error[bad]",
      ];
      for (const source of formulas) {
        expect(inspect(source).tokens.map((token) => source.slice(token.span.start, token.span.end)).join("")).toBe(source);
        expect(parseCellText(source).body.valid).toBe(true);
      }
    });

    it("preserves evaluation and canonical serialization for the shared valid corpus", () => {
      const document = `
# InspectionCorpus
| Item || Result |
| ---- || ------ |
| Dot || = dotProduct([1, 2], [3, 4]) |
| Matrix || = sum([[1, 2], [3, 4]]) |
| Nested || = if(contains("a,b", ","), sum([1, 2]), 0) |
| ErrorLiteral || = isError(error[bad]) |
`.trim();
      const evaluation = evaluateDocument(document).sheets[0];
      expect(evaluation.values.map((row) => row[1])).toEqual([
        { kind: "number", value: 11 },
        { kind: "number", value: 10 },
        { kind: "number", value: 3 },
        { kind: "boolean", value: true },
      ]);
      const canonical = serializeDocumentState(DocumentState.fromText(document));
      expect(canonical).toContain("= dotProduct([1, 2], [3, 4])");
      expect(canonical).toContain("= sum([[1, 2], [3, 4]])");
      expect(canonical).toContain('= if(contains("a,b", ","), sum([1, 2]), 0)');
      expect(canonical).toContain("= isError(error[bad])");
    });
  });

  describe("caret context", () => {
    it("selects the innermost call and counts only its direct separators", () => {
      const source = "=outer([1,2], inner(@[A,B], [3,4]), 5)";
      const insideInnerSecondArg = source.indexOf("[3,4]") + 2;
      const result = inspect(source, insideInnerSecondArg);
      const active = result.caret?.callStructureIndex == null ? null : result.structures[result.caret.callStructureIndex];
      expect(active?.kind === "call" ? active.name : null).toBe("inner");
      expect(result.caret?.argumentIndex).toBe(1);

      const outerThirdArg = source.lastIndexOf("5");
      const outerResult = inspect(source, outerThirdArg);
      const outer = outerResult.caret?.callStructureIndex == null ? null : outerResult.structures[outerResult.caret.callStructureIndex];
      expect(outer?.kind === "call" ? outer.name : null).toBe("outer");
      expect(outerResult.caret?.argumentIndex).toBe(2);
    });

    it("includes the closing parenthesis boundary but excludes the position after it", () => {
      const source = "=sum()";
      expect(inspect(source, 5).caret?.callStructureIndex).toBe(0);
      expect(inspect(source, 5).caret?.argumentIndex).toBe(0);
      expect(inspect(source, 6).caret?.callStructureIndex).toBeNull();
    });

    it.each([
      [4, 2, null, null],
      [5, 3, 0, 0],
      [6, 3, 0, 0],
      [7, 4, 0, 0],
      [8, 5, 0, 1],
      [9, 5, 0, 1],
      [10, 6, 0, 1],
      [11, null, null, null],
    ] as const)("resolves token/reference/call ownership at caret boundary %s", (caret, tokenIndex, callIndex, argumentIndex) => {
      const result = inspect("=sum(A1,B2)", caret);
      expect(result.caret).toMatchObject({ tokenIndex, callStructureIndex: callIndex, argumentIndex });
      expect(result.caret?.referenceTokenIndex).toBe(caret >= 5 && caret < 7 || caret >= 8 && caret < 10 ? tokenIndex : null);
    });

    it("owns complete reference interiors and incomplete reference EOF", () => {
      const complete = "=sum(@[Rows,Cols])";
      const inside = inspect(complete, complete.indexOf("Rows") + 1);
      expect(inside.caret?.referenceTokenIndex).not.toBeNull();

      const incomplete = "=sum(@[Rows,Cols";
      const eof = inspect(incomplete, incomplete.length);
      expect(eof.caret?.referenceTokenIndex).not.toBeNull();
    });

    it.each([-1, 1.5, 100])("fails early for invalid caret %s", (caret) => {
      expect(() => inspectFormulaInput("=1", { caret })).toThrow(/caret/);
    });
  });

  describe("UTF-16 offset integrity", () => {
    it("uses two code units for supplementary unknown code points and one for lone surrogates", () => {
      const source = `=1+😀+\ud800+2`;
      const result = inspect(source);
      const unknowns = result.tokens.filter((token) => token.kind === "unknown");
      expect(unknowns.map((token) => token.span.end - token.span.start)).toEqual([2, 1]);
      expect(tokenTexts(result).join("")).toBe(source);
      expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(["unknown_character", "unknown_character"]);
    });
  });
});
