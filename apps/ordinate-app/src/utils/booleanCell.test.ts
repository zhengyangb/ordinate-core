import { describe, expect, it } from "vitest";

import { DocumentState, type CellBodyState, type RuntimeValue } from "@ordinate/core";

import {
  isBooleanKeyboardActivation,
  resolveBooleanCellView,
  toggledBooleanInput,
} from "./booleanCell";

function parsedCell(input: string): { body: CellBodyState; value: RuntimeValue } {
  const document = DocumentState.fromText(`
# Sheet
| Item || Value |
| ---- || ----- |
| A    || ${input} |
`.trim());
  const evaluation = document.evaluate().sheets[0];
  const sheet = document.sheets[0];
  const body = sheet.cells[sheet.bodyStart]?.[1]?.body;
  const value = evaluation?.values[0]?.[1];
  if (!body || !value) throw new Error("expected parsed test cell");
  return { body, value };
}

describe("boolean cell presentation", () => {
  it.each([
    ["true", true],
    ["false", false],
  ] as const)("makes the %s literal interactive", (input, value) => {
    const cell = parsedCell(input);
    expect(resolveBooleanCellView(cell.value, cell.body)).toEqual({ value, interactive: true });
  });

  it("marks formula booleans non-interactive so the renderer can keep plain text", () => {
    const cell = parsedCell("= true == true");
    expect(resolveBooleanCellView(cell.value, cell.body)).toEqual({ value: true, interactive: false });
  });

  it("distinguishes literal and formula provenance even when both display true", () => {
    const literal = parsedCell("true");
    const formula = parsedCell("= true == true");
    expect(resolveBooleanCellView(literal.value, literal.body)?.interactive).toBe(true);
    expect(resolveBooleanCellView(formula.value, formula.body)?.interactive).toBe(false);
  });

  it("does not treat the string true as a boolean", () => {
    const cell = parsedCell('"true"');
    expect(resolveBooleanCellView(cell.value, cell.body)).toBeNull();
  });

  it("fails early when a boolean runtime value has no matching body", () => {
    expect(() => resolveBooleanCellView({ kind: "boolean", value: true }, undefined)).toThrow(
      "boolean runtime value requires a cell body",
    );

    const falseLiteral = parsedCell("false");
    expect(() => resolveBooleanCellView({ kind: "boolean", value: true }, falseLiteral.body)).toThrow(
      "boolean runtime value is stale relative to its literal cell body",
    );
  });

  it("serializes the opposite literal without coercion", () => {
    expect(toggledBooleanInput(true)).toBe("false");
    expect(toggledBooleanInput(false)).toBe("true");
  });

  it("accepts one unmodified Space keydown and rejects repeats or modifiers", () => {
    const base = {
      key: " ",
      repeat: false,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    };
    expect(isBooleanKeyboardActivation(base)).toBe(true);
    expect(isBooleanKeyboardActivation({ ...base, repeat: true })).toBe(false);
    expect(isBooleanKeyboardActivation({ ...base, shiftKey: true })).toBe(false);
    expect(isBooleanKeyboardActivation({ ...base, key: "Enter" })).toBe(false);
  });
});
