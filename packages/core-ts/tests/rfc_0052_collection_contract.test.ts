import { describe, expect, it } from "vitest";

import { evaluateDocument, isError, type RuntimeValue } from "../src";

const collections = [
  { label: "Array", expression: "[2, 3, 5, 7]" },
  { label: "RowView", expression: "[[2, 3, 5, 7]]" },
  { label: "ColumnView", expression: "[[2], [3], [5], [7]]" },
  { label: "MatrixView", expression: "[[2, 3], [5, 7]]" },
  { label: "ReferenceView", expression: "@[#2:#5,Value]" },
] as const;

function evaluateForEachShape(formula: (collection: string) => string): Map<string, RuntimeValue> {
  const document = [
    "# Collection contract",
    "| Item || Value | Result |",
    "| ---- || ----- | ------ |",
    "| R1 || 2 | |",
    "| R2 || 3 | |",
    "| R3 || 5 | |",
    "| R4 || 7 | |",
    ...collections.map(({ label, expression }) => `| ${label} || | = ${formula(expression)} |`),
  ].join("\n");
  const sheet = evaluateDocument(document).sheets[0];
  const resultColumn = sheet.colLabels.indexOf("Result");
  expect(resultColumn).toBeGreaterThanOrEqual(0);
  return new Map(collections.map(({ label }) => {
    const row = sheet.rowPaths.indexOf(label);
    expect(row).toBeGreaterThanOrEqual(0);
    return [label, sheet.values[row][resultColumn]];
  }));
}

describe("RFC-0052 collection contract", () => {
  it.each([
    ["sum", (x: string) => `sum(${x})`, 17],
    ["product", (x: string) => `product(${x})`, 210],
    ["average", (x: string) => `average(${x})`, 4.25],
    ["min", (x: string) => `min(${x})`, 2],
    ["max", (x: string) => `max(${x})`, 7],
    ["count", (x: string) => `count(${x})`, 4],
    ["counta", (x: string) => `counta(${x})`, 4],
    ["countblank", (x: string) => `countblank(${x})`, 0],
    ["sumsq", (x: string) => `sumsq(${x})`, 87],
    ["median", (x: string) => `median(${x})`, 4],
    ["percentile", (x: string) => `percentile(${x}, 0.5)`, 4],
    ["quartile", (x: string) => `quartile(${x}, 2)`, 4],
    ["variance", (x: string) => `variance(${x})`, 14.75 / 3],
    ["variancep", (x: string) => `variancep(${x})`, 14.75 / 4],
    ["stdev", (x: string) => `stdev(${x})`, Math.sqrt(14.75 / 3)],
    ["stdevp", (x: string) => `stdevp(${x})`, Math.sqrt(14.75 / 4)],
    ["avedev", (x: string) => `avedev(${x})`, 1.75],
    ["devsq", (x: string) => `devsq(${x})`, 14.75],
    ["geomean", (x: string) => `geomean(${x})`, 210 ** (1 / 4)],
    ["harmean", (x: string) => `harmean(${x})`, 4 / (1 / 2 + 1 / 3 + 1 / 5 + 1 / 7)],
    ["large", (x: string) => `large(${x}, 2)`, 5],
    ["small", (x: string) => `small(${x}, 2)`, 3],
    ["gcd", (x: string) => `gcd(${x})`, 1],
    ["lcm", (x: string) => `lcm(${x})`, 210],
  ] as const)("%s accepts arrays and all view shapes with the same result", (_name, formula, expected) => {
    for (const [shape, value] of evaluateForEachShape(formula)) {
      expect(value.kind, shape).toBe("number");
      if (value.kind !== "number") throw new Error(`${shape} did not produce a number`);
      expect(value.value, shape).toBeCloseTo(expected);
    }
  });

  it("keeps the Array/View distinction even when aggregation gives the same number", () => {
    const sum = evaluateForEachShape((x) => `sum(${x})`);
    expect(sum.get("Array")).toEqual(sum.get("RowView"));
    expect(sum.get("Array")).toEqual(sum.get("ColumnView"));
    expect(sum.get("Array")).toEqual(sum.get("MatrixView"));

    const ranks = evaluateForEachShape((x) => `size(shape(${x}))`);
    expect(ranks.get("Array")).toEqual({ kind: "number", value: 1 });
    for (const shape of ["RowView", "ColumnView", "MatrixView", "ReferenceView"]) {
      expect(ranks.get(shape)).toEqual({ kind: "number", value: 2 });
    }

    const rowCounts = evaluateForEachShape((x) => `rowCount(${x})`);
    expect(isError(rowCounts.get("Array"))).toBe(true);
    expect(rowCounts.get("RowView")).toEqual({ kind: "number", value: 1 });
    expect(rowCounts.get("ColumnView")).toEqual({ kind: "number", value: 4 });
    expect(rowCounts.get("MatrixView")).toEqual({ kind: "number", value: 2 });
  });
});
