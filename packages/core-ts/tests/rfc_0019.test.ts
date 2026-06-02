import { describe, expect, it } from "vitest";

import {
  evaluateDocument,
  getStandardFunctionMetadata,
  listStandardFunctionMetadata,
  type RuntimeValue,
} from "../src";

function cellValue(doc: string, rowPath: string, colLabel: string): RuntimeValue {
  const result = evaluateDocument(doc);
  const sheet = result.sheets[0];
  const row = sheet.rowPaths.indexOf(rowPath);
  const col = sheet.colLabels.indexOf(colLabel);
  if (row < 0 || col < 0) {
    throw new Error(
      `missing cell ${rowPath}, ${colLabel}; rows=${JSON.stringify(sheet.rowPaths)} cols=${JSON.stringify(sheet.colLabels)}`,
    );
  }
  return sheet.values[row][col];
}

describe("RFC-0019 standard function library v1", () => {
  it("exposes standard function metadata from the registry", () => {
    const functions = listStandardFunctionMetadata();
    const names = functions.map((definition) => definition.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      "sum",
      "product",
      "average",
      "min",
      "max",
      "count",
      "counta",
      "sumsq",
      "and",
      "or",
      "abs",
      "sign",
      "round",
      "roundup",
      "rounddown",
      "trunc",
      "floor",
      "ceil",
      "mod",
      "power",
      "sqrt",
      "pi",
      "gcd",
      "lcm",
      "not",
      "dotProduct",
    ]));

    const sum = getStandardFunctionMetadata("SUM");
    expect(sum?.name).toBe("sum");
    expect(sum?.category).toBe("aggregate");
    expect(sum?.signatures[0].returns).toBe("number");
    expect("evaluator" in (sum as unknown as Record<string, unknown>)).toBe(false);

    const dotProduct = getStandardFunctionMetadata("dotproduct");
    expect(dotProduct?.name).toBe("dotProduct");
    expect(dotProduct?.aliases).toContain("sumproduct");
    expect(getStandardFunctionMetadata("SUMPRODUCT")?.name).toBe("dotProduct");
  });

  it("evaluates numeric aggregate functions over views", () => {
    const doc = `
# Sheet
| Item || V |
| ---- || --- |
| A    || 2 |
| B    ||   |
| C    || 4 |
| D    || true |
| Sum  || = sum(@[#2:#5,V]) |
| Product || = product(@[#2:#4,V]) |
| Average || = AVERAGE(@[#2:#4,V]) |
| Min || = min(@[#2:#4,V]) |
| Max || = max(@[#2:#4,V]) |
| Count || = count(@[#2:#5,V]) |
| CountA || = counta(@[#2:#5,V]) |
| SumSq || = sumsq(@[#2:#4,V]) |
`.trim();

    expect(cellValue(doc, "Sum", "V")).toEqual({ kind: "number", value: 7 });
    expect(cellValue(doc, "Product", "V")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "Average", "V")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "Min", "V")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "Max", "V")).toEqual({ kind: "number", value: 4 });
    expect(cellValue(doc, "Count", "V")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "CountA", "V")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "SumSq", "V")).toEqual({ kind: "number", value: 20 });
  });

  it("rejects non-numeric elements for numeric aggregates that define strict numeric input", () => {
    const doc = `
# Sheet
| Item || V |
| ---- || --- |
| A    || 2 |
| B    || true |
| C    || = average(@[#2:#3,V]) |
| D    || = min(@[#2:#3,V]) |
`.trim();

    expect(cellValue(doc, "C", "V").kind).toBe("error");
    expect(cellValue(doc, "D", "V").kind).toBe("error");
  });

  it("evaluates boolean aggregate functions eagerly over boolean views", () => {
    const doc = `
# Sheet
| Item || V |
| ---- || --- |
| A    || true |
| B    || false |
| C    || 1 |
| And  || = and(@[#2:#3,V]) |
| Or   || = or(@[#2:#3,V]) |
| Bad  || = and(@[#2:#4,V]) |
`.trim();

    expect(cellValue(doc, "And", "V")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "Or", "V")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "Bad", "V").kind).toBe("error");
  });

  it("evaluates scalar numeric functions", () => {
    const doc = `
# Sheet
| Item || V |
| ---- || --- |
| Abs || = abs(-3) |
| SignNeg || = sign(-3) |
| SignZero || = sign(0) |
| SignPos || = sign(3) |
| Round || = round(12.345, 2) |
| RoundNeg || = round(1234, -2) |
| RoundUp || = roundup(12.341, 2) |
| RoundUpNeg || = roundup(-12.341, 2) |
| RoundDown || = rounddown(12.349, 2) |
| RoundDownNeg || = rounddown(-12.349, 2) |
| Trunc || = trunc(12.9) |
| TruncDigits || = trunc(12.987, 2) |
| TruncNeg || = trunc(-12.987, 2) |
| Floor || = floor(12.9) |
| Ceil || = ceil(12.1) |
| Mod || = mod(10, 3) |
| Power || = power(2, 8) |
| Sqrt || = sqrt(81) |
| Pi || = pi() |
`.trim();

    expect(cellValue(doc, "Abs", "V")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "SignNeg", "V")).toEqual({ kind: "number", value: -1 });
    expect(cellValue(doc, "SignZero", "V")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "SignPos", "V")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "Round", "V")).toEqual({ kind: "number", value: 12.35 });
    expect(cellValue(doc, "RoundNeg", "V")).toEqual({ kind: "number", value: 1200 });
    expect(cellValue(doc, "RoundUp", "V")).toEqual({ kind: "number", value: 12.35 });
    expect(cellValue(doc, "RoundUpNeg", "V")).toEqual({ kind: "number", value: -12.35 });
    expect(cellValue(doc, "RoundDown", "V")).toEqual({ kind: "number", value: 12.34 });
    expect(cellValue(doc, "RoundDownNeg", "V")).toEqual({ kind: "number", value: -12.34 });
    expect(cellValue(doc, "Trunc", "V")).toEqual({ kind: "number", value: 12 });
    expect(cellValue(doc, "TruncDigits", "V")).toEqual({ kind: "number", value: 12.98 });
    expect(cellValue(doc, "TruncNeg", "V")).toEqual({ kind: "number", value: -12.98 });
    expect(cellValue(doc, "Floor", "V")).toEqual({ kind: "number", value: 12 });
    expect(cellValue(doc, "Ceil", "V")).toEqual({ kind: "number", value: 13 });
    expect(cellValue(doc, "Mod", "V")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "Power", "V")).toEqual({ kind: "number", value: 256 });
    expect(cellValue(doc, "Sqrt", "V")).toEqual({ kind: "number", value: 9 });
    const pi = cellValue(doc, "Pi", "V");
    expect(pi.kind).toBe("number");
    if (pi.kind !== "number") {
      throw new Error("expected pi() to return a number");
    }
    expect(pi.value).toBeCloseTo(Math.PI);
  });

  it("evaluates integer aggregate functions", () => {
    const doc = `
# Sheet
| Item || V |
| ---- || --- |
| A    || 12 |
| B    || 18 |
| C    || 30 |
| D    || 1.5 |
| Gcd  || = gcd(@[#2:#4,V]) |
| Lcm  || = lcm(@[#2:#4,V]) |
| Bad  || = gcd(@[#2:#5,V]) |
`.trim();

    expect(cellValue(doc, "Gcd", "V")).toEqual({ kind: "number", value: 6 });
    expect(cellValue(doc, "Lcm", "V")).toEqual({ kind: "number", value: 180 });
    expect(cellValue(doc, "Bad", "V").kind).toBe("error");
  });

  it("evaluates exponentiation syntax with RFC-0019 precedence", () => {
    const doc = `
# Sheet
| Item || V |
| ---- || --- |
| AddPower || = 2 + 3 ** 2 |
| Grouped || = (2 + 3) ** 2 |
| RightAssoc || = 2 ** 3 ** 2 |
| Unary || = -2 ** 2 |
| ParenUnary || = (-2) ** 2 |
`.trim();

    expect(cellValue(doc, "AddPower", "V")).toEqual({ kind: "number", value: 11 });
    expect(cellValue(doc, "Grouped", "V")).toEqual({ kind: "number", value: 25 });
    expect(cellValue(doc, "RightAssoc", "V")).toEqual({ kind: "number", value: 512 });
    expect(cellValue(doc, "Unary", "V")).toEqual({ kind: "number", value: -4 });
    expect(cellValue(doc, "ParenUnary", "V")).toEqual({ kind: "number", value: 4 });
  });

  it("evaluates sumproduct as a dotProduct alias", () => {
    const doc = `
# Sheet
| Item || 2024 | 2025 | Result |
| ---- || ---- | ---- | ------ |
| Price || 2 | 3 | |
| Qty || 4 | 5 | |
| Total || | | = sumproduct(@[Price,2024:2025], @[Qty,2024:2025]) |
`.trim();

    expect(cellValue(doc, "Total", "Result")).toEqual({ kind: "number", value: 23 });
  });
});
