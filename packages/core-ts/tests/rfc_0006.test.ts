import { describe, expect, it } from "vitest";

import { evaluateDocument } from "../src";
import { fixturePath, loadSpecCases } from "./spec_loader";

const fixtureDir = fixturePath("rfc_0006");

function parseScalar(value: string): string | number | boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value.includes(".") ? Number.parseFloat(value) : Number.parseInt(value, 10);
  }
  return value;
}

describe("RFC-0006 types and operators", () => {
  it("types and operators cases", () => {
    const cases = loadSpecCases(`${fixtureDir}/types_and_operators.cases`);
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
});
