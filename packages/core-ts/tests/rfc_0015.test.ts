import { describe, expect, it } from "vitest";

import { DocumentState, evaluateDocument, isError, serializeDocumentState } from "../src";
import { type RuntimeValue } from "../src/runtime";
import { parseCellInput, type ParsedCell } from "../src/runtime";

function mustError(value: RuntimeValue | null | undefined) {
  expect(isError(value)).toBe(true);
  if (!isError(value)) {
    throw new Error("expected error runtime value");
  }
  return value;
}

function valueAt(doc: string, rowPath: string, colLabel: string): RuntimeValue {
  const sheet = evaluateDocument(doc).sheets[0];
  const row = sheet.rowPaths.indexOf(rowPath);
  const col = sheet.colLabels.indexOf(colLabel);
  expect(row).toBeGreaterThanOrEqual(0);
  expect(col).toBeGreaterThanOrEqual(0);
  return sheet.values[row][col];
}

function literalOf(cell: ParsedCell): RuntimeValue | null {
  return cell.body.valid && cell.body.kind === "literal" ? cell.body.literal : null;
}

function formulaLiteralOf(cell: ParsedCell): RuntimeValue | null {
  return cell.body.valid && cell.body.kind === "formula" && cell.body.expression.kind === "literal"
    ? cell.body.expression.value as RuntimeValue
    : null;
}

describe("RFC-0015 error model", () => {
  it("parses error[kind] in literal/formula/cache contexts", () => {
    const literal = parseCellInput("error[type_error]");
    const literalErr = mustError(literalOf(literal));
    expect(literalErr.errorKind).toBe("type_error");
    expect(literalErr.internalKind).toBe("literal_error_literal");

    const formula = parseCellInput("= error[div_by_zero]");
    expect(formula.body.valid && formula.body.kind === "formula").toBe(true);
    const formulaErr = mustError(formulaLiteralOf(formula));
    expect(formulaErr.errorKind).toBe("div_by_zero");

    const cached = parseCellInput("error[some_future_kind] = 1 + 1");
    const cachedErr = mustError(cached.initialCachedValue);
    expect(cachedErr.errorKind).toBe("some_future_kind");
  });

  it("rejects malformed error literal syntax and keeps quoted strings", () => {
    const invalidLiteral = parseCellInput("error[]");
    const invalidLiteralErr = mustError(literalOf(invalidLiteral));
    expect(invalidLiteralErr.errorKind).toBe("parse_error");
    expect(invalidLiteralErr.internalKind).toBe("parse_error_literal_invalid_syntax");

    const invalidCase = parseCellInput("error[BadCase]");
    const invalidCaseErr = mustError(literalOf(invalidCase));
    expect(invalidCaseErr.errorKind).toBe("parse_error");

    const invalidFormula = parseCellInput("= error[]");
    expect(invalidFormula.body.valid).toBe(false);
    if (invalidFormula.body.valid) throw new Error("expected invalid formula body");
    expect(invalidFormula.body.issue.code).toBe("parse_expression_unexpected_token");

    const invalidFormulaCase = parseCellInput("= error[BadCase]");
    expect(invalidFormulaCase.body.valid).toBe(false);
    if (invalidFormulaCase.body.valid) throw new Error("expected invalid formula body");
    expect(invalidFormulaCase.body.issue.code).toBe("parse_expression_unexpected_token");

    const quoted = parseCellInput('"error[type_error]"');
    expect(literalOf(quoted)?.kind).toBe("string");
    expect((literalOf(quoted) as any)?.value).toBe("error[type_error]");

    const bare = parseCellInput("error");
    expect(literalOf(bare)?.kind).toBe("string");
    expect((literalOf(bare) as any)?.value).toBe("error");
  });

  it("maps evaluator internal failures to external error kinds", () => {
    const div = valueAt(
      `
# S
| Item || V |
| ---- || --- |
| A    || 1 |
| B    || 0 |
| C    || = @[A,_] / @[B,_] |
`.trim(),
      "C",
      "V",
    );
    const divErr = mustError(div);
    expect(divErr.errorKind).toBe("div_by_zero");
    expect(divErr.internalKind).toBe("divide_by_zero");

    const typeErrValue = valueAt(
      `
# S
| Item || V |
| ---- || --- |
| A    || "x" |
| B    || 1 |
| C    || = @[A,_] + @[B,_] |
`.trim(),
      "C",
      "V",
    );
    const typeErr = mustError(typeErrValue);
    expect(typeErr.errorKind).toBe("type_error");
    expect(typeErr.internalKind).toBe("invalid_arithmetic");
    expect(typeErr.context).toMatchObject({ operator: "+", leftKind: "string", rightKind: "number" });

    const unresolvedValue = valueAt(
      `
# S
| Item || V |
| ---- || --- |
| A    || 1 |
| C    || = @[Missing,_] |
`.trim(),
      "C",
      "V",
    );
    const unresolvedErr = mustError(unresolvedValue);
    expect(unresolvedErr.errorKind).toBe("unresolved_reference");
    expect(unresolvedErr.internalKind).toContain("unresolved_reference");
    expect(unresolvedErr.context).toHaveProperty("label");

    const ambiguousValue = valueAt(
      `
# S
| Item || V |
| ---- || --- |
| A    || 1 |
| A    || 2 |
| C    || = @[A,_] |
`.trim(),
      "C",
      "V",
    );
    const ambiguousErr = mustError(ambiguousValue);
    expect(ambiguousErr.errorKind).toBe("ambiguous_reference");
    expect(ambiguousErr.internalKind).toBe("ambiguous_reference_label");
    expect(ambiguousErr.context).toMatchObject({ matchCount: 2 });

    const cycleValue = valueAt(
      `
# S
| Item || V |
| ---- || --- |
| A    || = @[B,_] |
| B    || = @[A,_] |
`.trim(),
      "A",
      "V",
    );
    const cycleErr = mustError(cycleValue);
    expect(cycleErr.errorKind).toBe("cycle");
    expect(cycleErr.internalKind).toBe("cycle");

    const parseErrValue = valueAt(
      `
# S
| Item || V |
| ---- || --- |
| A    || = 1 + |
`.trim(),
      "A",
      "V",
    );
    const parseErr = mustError(parseErrValue);
    expect(parseErr.errorKind).toBe("parse_error");
    expect(parseErr.internalKind).toContain("parse_");
  });

  it("preserves structured parse diagnostic context on invalid formula bodies", () => {
    const invalidFormula = parseCellInput("= sum(B2");
    expect(invalidFormula.body.valid).toBe(false);
    if (invalidFormula.body.valid) throw new Error("expected invalid formula body");
    expect(invalidFormula.body.issue.code).toBe("parse_function_call_missing_closing_paren");
    expect(invalidFormula.body.issue.context).toMatchObject({ name: "sum" });

    const evalValue = valueAt(
      `
# S
| Item || V |
| ---- || --- |
| A    || = sum(B2 |
`.trim(),
      "A",
      "V",
    );
    const err = mustError(evalValue);
    expect(err.internalKind).toBe("parse_function_call_missing_closing_paren");
    expect(err.context).toMatchObject({ name: "sum" });
  });

  it("serializes error values as canonical error[kind] and preserves unknown kinds", () => {
    const doc = `
# S
| Item || V |
| ---- || --- |
| A    || error[type_error] |
| B    || error[some_future_kind] |
| C    || = error[div_by_zero] |
| D    || = 1 / 0 |
`.trim();
    const state = DocumentState.fromText(doc);
    state.evaluate();
    const output = serializeDocumentState(state);

    expect(output).toContain("error[type_error]");
    expect(output).toContain("error[some_future_kind]");
    expect(output).toContain("= error[div_by_zero]");
    expect(output).toContain("error[div_by_zero] = 1 / 0");

    const roundTrip = evaluateDocument(output).sheets[0];
    const rowB = roundTrip.rowPaths.indexOf("B");
    const colV = roundTrip.colLabels.indexOf("V");
    const valueB = mustError(roundTrip.values[rowB][colV]);
    expect(valueB.errorKind).toBe("some_future_kind");
  });
});
