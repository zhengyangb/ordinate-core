import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { evaluateDocument, validateDocument } from "../src";
import { fixturePath, loadSpecCases } from "./spec_loader";

const fixtureDir = fixturePath("rfc_0004");

function parseScalar(value: string): string | number | boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value.includes(".") ? Number.parseFloat(value) : Number.parseInt(value, 10);
  }
  return value;
}

describe("RFC-0004 reference cases", () => {
  it("reference spec cases", () => {
    const cases = loadSpecCases(`${fixtureDir}/reference_cases.cases`);
    for (const spec of cases) {
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

  it("invalid unquoted space in reference is rejected by validate", () => {
    const text = readFileSync(`${fixtureDir}/invalid_unquoted_space_reference.ord`, "utf-8");
    const result = validateDocument(text);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("invalid reference selector syntax"))).toBe(true);
  });
});
