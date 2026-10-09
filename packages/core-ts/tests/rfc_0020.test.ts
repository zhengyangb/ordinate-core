import { describe, expect, it } from "vitest";

import {
  evaluateDocument,
  getStandardFunctionMetadata,
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

function expectError(doc: string, rowPath: string, colLabel: string): void {
  expect(cellValue(doc, rowPath, colLabel).kind).toBe("error");
}

describe("RFC-0020 formula views, broadcasting, and filtering", () => {
  it("exposes filter metadata from the function registry", () => {
    const filter = getStandardFunctionMetadata("FILTER");
    expect(filter?.name).toBe("filter");
    expect(filter?.category).toBe("view");
    expect(filter?.signatures[0].returns).toBe("array");
  });

  it("supports conditional sum through scalar equality broadcasting and filter", () => {
    const doc = `
# Sales
| Item || Region | Revenue |
| ---- || ------ | ------- |
| A    || West   | 100 |
| B    || East   | 200 |
| C    || West   | 300 |
| Total ||        | = sum(filter(@[#2:#4,Revenue], @[#2:#4,Region] == "West")) |
`.trim();

    expect(cellValue(doc, "Total", "Revenue")).toEqual({ kind: "number", value: 400 });
  });

  it("supports scalar-on-left comparison broadcasting", () => {
    const doc = `
# Sales
| Item || Revenue |
| ---- || ------- |
| A    || 100 |
| B    || 200 |
| C    || 300 |
| Count || = count(filter(@[#2:#4,Revenue], 100 < @[#2:#4,Revenue])) |
`.trim();

    expect(cellValue(doc, "Count", "Revenue")).toEqual({ kind: "number", value: 2 });
  });

  it("supports view-to-view comparison when shapes match exactly", () => {
    const doc = `
# Plan
| Item || Actual | Budget | Result |
| ---- || ------ | ------ | ------ |
| A    || 120 | 100 | |
| B    || 90  | 100 | |
| C    || 150 | 140 | |
| Total ||    |     | = sum(filter(@[#2:#4,Actual], @[#2:#4,Actual] >= @[#2:#4,Budget])) |
`.trim();

    expect(cellValue(doc, "Total", "Result")).toEqual({ kind: "number", value: 270 });
  });

  it("filters two-dimensional values in row-major order", () => {
    const doc = `
# Matrix
| Item || A | B | C | Result |
| ---- || --- | --- | --- | ------ |
| V1   || 1 | 2 | 3 | |
| V2   || 4 | 5 | 6 | |
| M1   || true | false | true | |
| M2   || false | true | false | |
| Total || | | | = sum(filter(@[#2:#3,A:C], @[#4:#5,A:C])) |
`.trim();

    expect(cellValue(doc, "Total", "Result")).toEqual({ kind: "number", value: 9 });
  });

  it("allows filtered views to feed multiple aggregate functions", () => {
    const doc = `
# Sales
| Item || Region | Revenue | Customer |
| ---- || ------ | ------- | -------- |
| A    || West   | 100 | Alice |
| B    || East   | 200 | Bob |
| C    || West   | 300 | Cara |
| Sum || | = sum(filter(@[#2:#4,Revenue], @[#2:#4,Region] == "West")) | |
| Avg || | = average(filter(@[#2:#4,Revenue], @[#2:#4,Revenue] > 100)) | |
| CountA || | | = counta(filter(@[#2:#4,Customer], @[#2:#4,Revenue] > 100)) |
`.trim();

    expect(cellValue(doc, "Sum", "Revenue")).toEqual({ kind: "number", value: 400 });
    expect(cellValue(doc, "Avg", "Revenue")).toEqual({ kind: "number", value: 250 });
    expect(cellValue(doc, "CountA", "Customer")).toEqual({ kind: "number", value: 2 });
  });

  it("supports empty filtered views in aggregate contexts", () => {
    const doc = `
# Sales
| Item || Revenue | Result |
| ---- || ------- | ------ |
| A    || 100 | |
| B    || 200 | |
| SumNone || | = sum(filter(@[#2:#3,Revenue], @[#2:#3,Revenue] > 999)) |
| CountNone || | = count(filter(@[#2:#3,Revenue], @[#2:#3,Revenue] > 999)) |
| AverageNone || | = average(filter(@[#2:#3,Revenue], @[#2:#3,Revenue] > 999)) |
`.trim();

    expect(cellValue(doc, "SumNone", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "CountNone", "Result")).toEqual({ kind: "number", value: 0 });
    expectError(doc, "AverageNone", "Result");
  });

  it("rejects non-scalar view final results", () => {
    const doc = `
# Sales
| Item || Region | Revenue |
| ---- || ------ | ------- |
| A    || West | 100 |
| B    || East | 200 |
| Compare || | = @[#2:#3,Region] == "West" |
| Filter || | = filter(@[#2:#3,Revenue], @[#2:#3,Region] == "West") |
`.trim();

    expectError(doc, "Compare", "Revenue");
    expectError(doc, "Filter", "Revenue");
  });

  it("rejects view-to-view comparison when shapes differ", () => {
    const doc = `
# Shape
| Item || A | B | C |
| ---- || --- | --- | --- |
| R1   || 1 | 2 | 3 |
| R2   || 1 | 2 | 3 |
| Bad  || = sum(filter(@[R1,A:C], @[R1,A:C] == @[:,A])) | | |
`.trim();

    expectError(doc, "Bad", "A");
  });

  it("rejects filter masks with non-boolean values", () => {
    const doc = `
# Mask
| Item || V | Mask | Result |
| ---- || --- | ---- | ------ |
| A    || 1 | true | |
| B    || 2 | 1 | |
| Bad  || | | = sum(filter(@[#2:#3,V], @[#2:#3,Mask])) |
`.trim();

    expectError(doc, "Bad", "Result");
  });

  it("rejects filter shape mismatches", () => {
    const doc = `
# Shape
| Item || A | B | Result |
| ---- || --- | --- | ------ |
| R1   || 1 | 2 | |
| R2   || 3 | 4 | |
| Mask || true | false | |
| Bad  || | | = sum(filter(@[#2:#3,A:B], @[Mask,A:B])) |
`.trim();

    expectError(doc, "Bad", "Result");
  });

  it("propagates errors from values and masks", () => {
    const doc = `
# Errors
| Item || V | Mask | Result |
| ---- || --- | ---- | ------ |
| A    || 1 | true | |
| B    || = error[bad] | false | |
| C    || 3 | = error[bad] | |
| ValueError || | | = sum(filter(@[#2:#3,V], @[#2:#3,Mask])) |
| MaskError || | | = sum(filter(@[#2:#4,V], @[#2:#4,Mask])) |
`.trim();

    expectError(doc, "ValueError", "Result");
    expectError(doc, "MaskError", "Result");
  });

  it("rejects invalid scalar comparisons during broadcasting", () => {
    const doc = `
# BadCompare
| Item || V | Result |
| ---- || --- | ------ |
| A    || 1 | |
| B    || 2 | |
| Bad  || | = sum(filter(@[#2:#3,V], @[#2:#3,V] > "1")) |
`.trim();

    expectError(doc, "Bad", "Result");
  });

  it("rejects non-scalar arithmetic view final results", () => {
    const doc = `
# Arithmetic
| Item || V |
| ---- || --- |
| A    || 1 |
| B    || 2 |
| Bad  || = @[#2:#3,V] + 1 |
`.trim();

    expectError(doc, "Bad", "V");
  });

  it("still allows scalar-shaped views in scalar contexts", () => {
    const doc = `
# Scalar
| Item || V |
| ---- || --- |
| A    || -3 |
| Abs  || = abs(@[A,V]) |
| Eq   || = @[A,V] == -3 |
`.trim();

    expect(cellValue(doc, "Abs", "V")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "Eq", "V")).toEqual({ kind: "boolean", value: true });
  });
});
