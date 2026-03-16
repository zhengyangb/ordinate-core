import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { evaluateAndFormatDocument, evaluateDocument, validateDocument } from "../src";
import { fixturePath, loadSpecCases } from "./spec_loader";

const fixtureDir = fixturePath("rfc_0005");

function parseScalar(value: string): string | number | boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value.includes(".") ? Number.parseFloat(value) : Number.parseInt(value, 10);
  }
  return value;
}

describe("RFC-0005 formula evaluation", () => {
  it("formula eval spec cases", () => {
    const cases = loadSpecCases(`${fixtureDir}/formula_eval_cases.cases`);
    for (const spec of cases) {
      const v = validateDocument(spec.doc);
      const expectedValidateOk = parseScalar(spec.expect_validate_ok ?? "true");
      expect(v.ok).toBe(expectedValidateOk);

      const result = evaluateDocument(spec.doc);
      const sheet = result.sheets[0];

      const rowPath = spec.target_row;
      const colLabel = spec.target_col;
      const r = sheet.rowPaths.indexOf(rowPath);
      const c = sheet.colLabels.indexOf(colLabel);
      const value = sheet.values[r][c];

      expect(value.kind).toBe(spec.expect_kind);
      if (spec.expect_value !== undefined) {
        expect(value.value).toBe(parseScalar(spec.expect_value));
      }
    }
  });

  it("profit statement ord input to ord output", () => {
    const inputText = readFileSync(`${fixtureDir}/profit_statement_input.ord`, "utf-8");
    const expectedText = readFileSync(`${fixtureDir}/profit_statement_expected.ord`, "utf-8");

    const outputText = evaluateAndFormatDocument(inputText);
    expect(outputText).toBe(expectedText);

    const v = validateDocument(outputText);
    expect(v.ok).toBe(true);

    const evaluated = evaluateDocument(outputText);
    const sheet = evaluated.sheets[0];
    const grossProfitRow = sheet.rowPaths.indexOf("Gross Profit");
    const col2025 = sheet.colLabels.indexOf("2025");
    expect(sheet.values[grossProfitRow][col2025].value).toBe(315);
  });
});
