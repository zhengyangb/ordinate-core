import { describe, expect, it } from "vitest";

import { evaluateDocument, type RuntimeValue } from "../src";

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

function expectError(doc: string, rowPath: string, colLabel: string): void {
  expect(cellValue(doc, rowPath, colLabel).kind).toBe("error");
}

describe("RFC-0021 value broadcasting and element-wise arithmetic", () => {
  it("broadcasts scalar arithmetic over views on either side of the operator", () => {
    const doc = `
# Values
| Item || V | Result |
| ---- || --- | ------ |
| A    || 1 | |
| B    || 2 | |
| C    || 3 | |
| AddRight || | = sum(@[#2:#4,V] + 1) |
| AddLeft || | = sum(1 + @[#2:#4,V]) |
| SubRight || | = sum(@[#2:#4,V] - 1) |
| SubLeft || | = sum(10 - @[#2:#4,V]) |
| MulRight || | = sum(@[#2:#4,V] * 2) |
| MulLeft || | = sum(2 * @[#2:#4,V]) |
| DivRight || | = sum(@[#2:#4,V] / 2) |
| DivLeft || | = sum(12 / @[#2:#4,V]) |
| PowRight || | = sum(@[#2:#4,V] ** 2) |
| PowLeft || | = sum(2 ** @[#2:#4,V]) |
`.trim();

    expect(cellValue(doc, "AddRight", "Result")).toEqual({ kind: "number", value: 9 });
    expect(cellValue(doc, "AddLeft", "Result")).toEqual({ kind: "number", value: 9 });
    expect(cellValue(doc, "SubRight", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "SubLeft", "Result")).toEqual({ kind: "number", value: 24 });
    expect(cellValue(doc, "MulRight", "Result")).toEqual({ kind: "number", value: 12 });
    expect(cellValue(doc, "MulLeft", "Result")).toEqual({ kind: "number", value: 12 });
    expect(cellValue(doc, "DivRight", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "DivLeft", "Result")).toEqual({ kind: "number", value: 22 });
    expect(cellValue(doc, "PowRight", "Result")).toEqual({ kind: "number", value: 14 });
    expect(cellValue(doc, "PowLeft", "Result")).toEqual({ kind: "number", value: 14 });
  });

  it("performs exact-shape view-to-view arithmetic", () => {
    const doc = `
# Plan
| Item || Actual | Budget | Result |
| ---- || ------ | ------ | ------ |
| A    || 120 | 100 | |
| B    || 90  | 100 | |
| C    || 150 | 140 | |
| Delta || | | = sum(@[#2:#4,Actual] - @[#2:#4,Budget]) |
| Product || | | = sum(@[#2:#4,Actual] * @[#2:#4,Budget]) |
`.trim();

    expect(cellValue(doc, "Delta", "Result")).toEqual({ kind: "number", value: 20 });
    expect(cellValue(doc, "Product", "Result")).toEqual({ kind: "number", value: 42000 });
  });

  it("supports row-major arithmetic over two-dimensional views", () => {
    const doc = `
# Matrix
| Item || A | B | Result |
| ---- || --- | --- | ------ |
| R1   || 1 | 2 | |
| R2   || 3 | 4 | |
| AddOne || | | = sum(@[#2:#3,A:B] + 1) |
| Square || | | = sum(@[#2:#3,A:B] ** 2) |
`.trim();

    expect(cellValue(doc, "AddOne", "Result")).toEqual({ kind: "number", value: 14 });
    expect(cellValue(doc, "Square", "Result")).toEqual({ kind: "number", value: 30 });
  });

  it("feeds arithmetic views into filter and aggregate functions", () => {
    const doc = `
# Sales
| Item || Region | Price | Qty | Revenue |
| ---- || ------ | ----- | --- | ------- |
| A    || West | 2 | 4 | |
| B    || East | 3 | 5 | |
| C    || West | 10 | 2 | |
| TotalWest || | | | = sum(filter(@[#2:#4,Price] * @[#2:#4,Qty], @[#2:#4,Region] == "West")) |
| HighLine || | | | = sum(filter(@[#2:#4,Price] * @[#2:#4,Qty], (@[#2:#4,Price] * @[#2:#4,Qty]) > 10)) |
`.trim();

    expect(cellValue(doc, "TotalWest", "Revenue")).toEqual({ kind: "number", value: 28 });
    expect(cellValue(doc, "HighLine", "Revenue")).toEqual({ kind: "number", value: 35 });
  });

  it("keeps RFC-0006 element coercion rules for blank and boolean values", () => {
    const doc = `
# Coercion
| Item || V | Flag | Result |
| ---- || --- | ---- | ------ |
| A    || 1 | true | |
| B    ||   | false | |
| C    || 3 | true | |
| BlankPlus || | | = sum(@[#2:#4,V] + 1) |
| BoolTimes || | | = sum(@[#2:#4,Flag] * 10) |
`.trim();

    expect(cellValue(doc, "BlankPlus", "Result")).toEqual({ kind: "number", value: 7 });
    expect(cellValue(doc, "BoolTimes", "Result")).toEqual({ kind: "number", value: 20 });
  });

  it("supports string concatenation through element-wise plus", () => {
    const doc = `
# Codes
| Item || Code | Result |
| ---- || ---- | ------ |
| A    || A1 | |
| B    || B2 | |
| Count || | = counta("SKU-" + @[#2:#3,Code]) |
`.trim();

    expect(cellValue(doc, "Count", "Result")).toEqual({ kind: "number", value: 2 });
  });

  it("allows scalar-shaped views in arithmetic scalar contexts", () => {
    const doc = `
# Scalar
| Item || V |
| ---- || --- |
| A    || 3 |
| Add  || = @[A,V] + 1 |
| Pow  || = @[A,V] ** 2 |
`.trim();

    expect(cellValue(doc, "Add", "V")).toEqual({ kind: "number", value: 4 });
    expect(cellValue(doc, "Pow", "V")).toEqual({ kind: "number", value: 9 });
  });

  it("rejects non-scalar arithmetic view final results", () => {
    const doc = `
# Final
| Item || V |
| ---- || --- |
| A    || 1 |
| B    || 2 |
| Bad  || = @[#2:#3,V] + 1 |
`.trim();

    expectError(doc, "Bad", "V");
  });

  it("rejects view-to-view arithmetic shape mismatches", () => {
    const doc = `
# Shape
| Item || A | B | C |
| ---- || --- | --- | --- |
| R1   || 1 | 2 | 3 |
| R2   || 4 | 5 | 6 |
| Bad  || = sum(@[R1,A:C] + @[:,A]) | | |
`.trim();

    expectError(doc, "Bad", "A");
  });

  it("propagates divide-by-zero errors from element operations", () => {
    const doc = `
# Divide
| Item || V | D | Result |
| ---- || --- | --- | ------ |
| A    || 10 | 2 | |
| B    || 20 | 0 | |
| Bad  || | | = sum(@[#2:#3,V] / @[#2:#3,D]) |
`.trim();

    expectError(doc, "Bad", "Result");
  });

  it("propagates invalid element type errors", () => {
    const doc = `
# Types
| Item || V | Result |
| ---- || --- | ------ |
| A    || 1 | |
| B    || x | |
| Bad  || | = sum(@[#2:#3,V] - 1) |
`.trim();

    expectError(doc, "Bad", "Result");
  });

  it("propagates invalid exponentiation results", () => {
    const doc = `
# Power
| Item || V | Result |
| ---- || --- | ------ |
| A    || -1 | |
| Bad  || | = sum(@[#2:#2,V] ** 0.5) |
`.trim();

    expectError(doc, "Bad", "Result");
  });

  it("propagates errors from arithmetic inputs", () => {
    const doc = `
# Errors
| Item || V | Result |
| ---- || --- | ------ |
| A    || 1 | |
| B    || = error[bad] | |
| Bad  || | = sum(@[#2:#3,V] + 1) |
`.trim();

    expectError(doc, "Bad", "Result");
  });
});
