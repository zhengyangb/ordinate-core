import { describe, expect, it } from "vitest";

import { DocumentState, evaluateDocument, isError, serializeDocumentState } from "../src";
import { type RuntimeValue } from "../src/runtime";
import { parseCellInput } from "../src/runtime";

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

describe("RFC-0015 error model", () => {
  it("parses error[kind] in literal/formula/cache contexts", () => {
    const literal = parseCellInput("error[type_error]");
    const literalErr = mustError(literal.literal);
    expect(literalErr.errorKind).toBe("type_error");
    expect(literalErr.internalKind).toBe("literal_error_literal");

    const formula = parseCellInput("= error[div_by_zero]");
    expect(formula.kind).toBe("formula");
    const formulaErr = mustError((formula.expression as { value: RuntimeValue }).value);
    expect(formulaErr.errorKind).toBe("div_by_zero");

    const cached = parseCellInput("error[some_future_kind] = 1 + 1");
    const cachedErr = mustError(cached.cached);
    expect(cachedErr.errorKind).toBe("some_future_kind");
  });

  it("rejects malformed error literal syntax and keeps quoted strings", () => {
    const invalidLiteral = parseCellInput("error[]");
    const invalidLiteralErr = mustError(invalidLiteral.literal);
    expect(invalidLiteralErr.errorKind).toBe("parse_error");
    expect(invalidLiteralErr.internalKind).toBe("parse_error_literal_invalid_syntax");

    const invalidCase = parseCellInput("error[BadCase]");
    const invalidCaseErr = mustError(invalidCase.literal);
    expect(invalidCaseErr.errorKind).toBe("parse_error");

    const invalidFormula = parseCellInput("= error[]");
    const invalidFormulaErr = mustError((invalidFormula.expression as { value: RuntimeValue }).value);
    expect(invalidFormulaErr.errorKind).toBe("parse_error");

    const invalidFormulaCase = parseCellInput("= error[BadCase]");
    const invalidFormulaCaseErr = mustError((invalidFormulaCase.expression as { value: RuntimeValue }).value);
    expect(invalidFormulaCaseErr.errorKind).toBe("parse_error");

    const quoted = parseCellInput('"error[type_error]"');
    expect(quoted.literal?.kind).toBe("string");
    expect(quoted.literal?.value).toBe("error[type_error]");

    const bare = parseCellInput("error");
    expect(bare.literal?.kind).toBe("string");
    expect(bare.literal?.value).toBe("error");
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
