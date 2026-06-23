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

function expectError(doc: string, rowPath: string, colLabel: string): void {
  expect(cellValue(doc, rowPath, colLabel).kind).toBe("error");
}

describe("RFC-0028 formula lookup and selection", () => {
  it("exposes lookup and selection functions from the registry", () => {
    const names = listStandardFunctionMetadata().map((definition) => definition.name);

    expect(names).toEqual(expect.arrayContaining(["match", "lookup", "take", "drop"]));
    expect(getStandardFunctionMetadata("MATCH")?.category).toBe("view");
    expect(getStandardFunctionMetadata("lookup")?.summary).toContain("values[match(key, keys)]");
    expect(getStandardFunctionMetadata("take")?.summary).toContain("take(x, n) is x[:n]");
    expect(getStandardFunctionMetadata("drop")?.summary).toContain("drop(x, n) is x[n:]");
  });

  it("matches exact values with zero-based row-major indexes", () => {
    const doc = `
# Match
| Item || Name | Score | Flag | A | B | C | Result |
| ---- || ---- | ----- | ---- | --- | --- | --- | ------ |
| R1 || Alpha | 10 | false | 1 | 2 | 3 | |
| R2 || Beta | 20 | true | 4 | 5 | 6 | |
| R3 || Beta | 30 | false | 7 | 8 | 9 | |
| MatchText || | | | | | | = match("Beta", @[#2:#4,Name]) |
| MatchNumber || | | | | | | = match(30, @[#2:#4,Score]) |
| MatchBoolean || | | | | | | = match(true, @[#2:#4,Flag]) |
| MatchMatrix || | | | | | | = match(5, @[#2:#3,A:C]) |
| Missing || | | | | | | = match("Gamma", @[#2:#4,Name]) |
`.trim();

    expect(cellValue(doc, "MatchText", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "MatchNumber", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "MatchBoolean", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "MatchMatrix", "Result")).toEqual({ kind: "number", value: 4 });
    expectError(doc, "Missing", "Result");
  });

  it("evaluates lookup as values[match(key, keys)]", () => {
    const doc = `
# Lookup
| Item || Name | Score | V1 | V2 | V3 | Result |
| ---- || ---- | ----- | --- | --- | --- | ------ |
| R1 || Alpha | 10 | | | | |
| R2 || Beta | 20 | | | | |
| R3 || Gamma | 30 | | | | |
| RowValues || | | 100 | 200 | 300 | |
| LookupScore || | | | | | = lookup("Beta", @[#2:#4,Name], @[#2:#4,Score]) |
| BracketEquivalent || | | | | | = @[#2:#4,Score][match("Beta", @[#2:#4,Name])] |
| LookupRowValues || | | | | | = lookup("Gamma", @[#2:#4,Name], @[RowValues,V1:V3]) |
| LookupMissing || | | | | | = lookup("Delta", @[#2:#4,Name], @[#2:#4,Score]) |
| LookupLengthMismatch || | | | | | = lookup("Beta", @[#2:#4,Name], @[#2:#3,Score]) |
| LookupMatrixKeys || | | | | | = lookup(2, @[#2:#3,V1:V3], @[#2:#4,Score]) |
`.trim();

    expect(cellValue(doc, "LookupScore", "Result")).toEqual({ kind: "number", value: 20 });
    expect(cellValue(doc, "BracketEquivalent", "Result")).toEqual({ kind: "number", value: 20 });
    expect(cellValue(doc, "LookupRowValues", "Result")).toEqual({ kind: "number", value: 300 });
    expectError(doc, "LookupMissing", "Result");
    expectError(doc, "LookupLengthMismatch", "Result");
    expectError(doc, "LookupMatrixKeys", "Result");
  });

  it("evaluates take and drop over text and one-dimensional views as slice equivalents", () => {
    const doc = `
# OneDimensionalSelection
| Item || V | Result |
| ---- || --- | ------ |
| A || 10 | |
| B || 20 | |
| C || 30 | |
| D || 40 | |
| TakeTextPrefix || | = take("abcdef", 3) |
| TakeTextSuffix || | = take("abcdef", -2) |
| DropTextPrefix || | = drop("abcdef", 2) |
| DropTextSuffix || | = drop("abcdef", -2) |
| TakeSum || | = sum(take(@[#2:#5,V], 2)) |
| TakeEquivalent || | = sum(@[#2:#5,V][:2]) |
| TakeLastSum || | = sum(take(@[#2:#5,V], -2)) |
| TakeLastEquivalent || | = sum(@[#2:#5,V][-2:]) |
| DropFirstSum || | = sum(drop(@[#2:#5,V], 1)) |
| DropFirstEquivalent || | = sum(@[#2:#5,V][1:]) |
| DropLastSum || | = sum(drop(@[#2:#5,V], -1)) |
| DropLastEquivalent || | = sum(@[#2:#5,V][:-1]) |
| TakeClamp || | = sum(take(@[#2:#5,V], 99)) |
| DropClamp || | = sum(drop(@[#2:#5,V], 99)) |
| TakeZeroSize || | = size(take(@[#2:#5,V], 0)) |
| DropZeroSize || | = size(drop(@[#2:#5,V], 0)) |
`.trim();

    expect(cellValue(doc, "TakeTextPrefix", "Result")).toEqual({ kind: "string", value: "abc" });
    expect(cellValue(doc, "TakeTextSuffix", "Result")).toEqual({ kind: "string", value: "ef" });
    expect(cellValue(doc, "DropTextPrefix", "Result")).toEqual({ kind: "string", value: "cdef" });
    expect(cellValue(doc, "DropTextSuffix", "Result")).toEqual({ kind: "string", value: "abcd" });
    expect(cellValue(doc, "TakeSum", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "TakeEquivalent", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "TakeLastSum", "Result")).toEqual({ kind: "number", value: 70 });
    expect(cellValue(doc, "TakeLastEquivalent", "Result")).toEqual({ kind: "number", value: 70 });
    expect(cellValue(doc, "DropFirstSum", "Result")).toEqual({ kind: "number", value: 90 });
    expect(cellValue(doc, "DropFirstEquivalent", "Result")).toEqual({ kind: "number", value: 90 });
    expect(cellValue(doc, "DropLastSum", "Result")).toEqual({ kind: "number", value: 60 });
    expect(cellValue(doc, "DropLastEquivalent", "Result")).toEqual({ kind: "number", value: 60 });
    expect(cellValue(doc, "TakeClamp", "Result")).toEqual({ kind: "number", value: 100 });
    expect(cellValue(doc, "DropClamp", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "TakeZeroSize", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "DropZeroSize", "Result")).toEqual({ kind: "number", value: 4 });
  });

  it("evaluates take and drop over matrices by selecting rows", () => {
    const doc = `
# MatrixSelection
| Item || A | B | C | Result |
| ---- || --- | --- | --- | ------ |
| R1 || 1 | 2 | 3 | |
| R2 || 4 | 5 | 6 | |
| R3 || 7 | 8 | 9 | |
| TakeRows || | | | = shape(take(@[#2:#4,A:C], 2))[0] |
| TakeCols || | | | = shape(take(@[#2:#4,A:C], 2))[1] |
| TakeSum || | | | = sum(take(@[#2:#4,A:C], 2)) |
| TakeEquivalent || | | | = sum(@[#2:#4,A:C][:2, :]) |
| TakeLastSum || | | | = sum(take(@[#2:#4,A:C], -1)) |
| TakeLastEquivalent || | | | = sum(@[#2:#4,A:C][-1:, :]) |
| DropFirstSum || | | | = sum(drop(@[#2:#4,A:C], 1)) |
| DropFirstEquivalent || | | | = sum(@[#2:#4,A:C][1:, :]) |
| DropLastSum || | | | = sum(drop(@[#2:#4,A:C], -1)) |
| DropLastEquivalent || | | | = sum(@[#2:#4,A:C][:-1, :]) |
| TakeZeroRows || | | | = shape(take(@[#2:#4,A:C], 0))[0] |
| TakeZeroCols || | | | = shape(take(@[#2:#4,A:C], 0))[1] |
`.trim();

    expect(cellValue(doc, "TakeRows", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "TakeCols", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "TakeSum", "Result")).toEqual({ kind: "number", value: 21 });
    expect(cellValue(doc, "TakeEquivalent", "Result")).toEqual({ kind: "number", value: 21 });
    expect(cellValue(doc, "TakeLastSum", "Result")).toEqual({ kind: "number", value: 24 });
    expect(cellValue(doc, "TakeLastEquivalent", "Result")).toEqual({ kind: "number", value: 24 });
    expect(cellValue(doc, "DropFirstSum", "Result")).toEqual({ kind: "number", value: 39 });
    expect(cellValue(doc, "DropFirstEquivalent", "Result")).toEqual({ kind: "number", value: 39 });
    expect(cellValue(doc, "DropLastSum", "Result")).toEqual({ kind: "number", value: 21 });
    expect(cellValue(doc, "DropLastEquivalent", "Result")).toEqual({ kind: "number", value: 21 });
    expect(cellValue(doc, "TakeZeroRows", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "TakeZeroCols", "Result")).toEqual({ kind: "number", value: 3 });
  });

  it("rejects invalid lookup and selection inputs", () => {
    const doc = `
# SelectionErrors
| Item || A | B | Result |
| ---- || --- | --- | ------ |
| R1 || 10 | 20 | |
| TakeFinalView || | | = take(@[R1,A:B], 2) |
| DropFinalView || | | = drop(@[R1,A:B], 0) |
| TakeScalar || | | = take(1, 1) |
| DropScalar || | | = drop(1, 1) |
| TakeNonInteger || | | = take(@[R1,A:B], 1.5) |
| DropTextCount || | | = drop(@[R1,A:B], "x") |
| MatchScalarKeys || | | = match(10, 10) |
| LookupScalarValues || | | = lookup(10, @[R1,A:B], 10) |
`.trim();

    expectError(doc, "TakeFinalView", "Result");
    expectError(doc, "DropFinalView", "Result");
    expectError(doc, "TakeScalar", "Result");
    expectError(doc, "DropScalar", "Result");
    expectError(doc, "TakeNonInteger", "Result");
    expectError(doc, "DropTextCount", "Result");
    expectError(doc, "MatchScalarKeys", "Result");
    expectError(doc, "LookupScalarValues", "Result");
  });
});
