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

describe("RFC-0027 view shape functions", () => {
  it("exposes shape functions and aliases from the registry", () => {
    const names = listStandardFunctionMetadata().map((definition) => definition.name);

    expect(names).toEqual(expect.arrayContaining(["shape", "size", "rowCount", "columnCount"]));
    expect(getStandardFunctionMetadata("shape")?.category).toBe("view");
    expect(getStandardFunctionMetadata("size")?.category).toBe("view");
    expect(getStandardFunctionMetadata("ROWS")?.name).toBe("rowCount");
    expect(getStandardFunctionMetadata("cols")?.name).toBe("columnCount");
    expect(getStandardFunctionMetadata("columns")?.summary).toContain("columns(x)");
  });

  it("reports scalar-shaped, row-vector, column-vector, and matrix shapes", () => {
    const doc = `
# Shapes
| Item || A | B | Result |
| ---- || --- | --- | ------ |
| R1 || 10 | 20 | |
| R2 || 30 | 40 | |
| ScalarRows || | | = rowCount(@[R1,A]) |
| ScalarCols || | | = columnCount(@[R1,A]) |
| ScalarSize || | | = size(@[R1,A]) |
| RowVectorRows || | | = shape(@[R1,A:B])[0] |
| RowVectorCols || | | = shape(@[R1,A:B])[1] |
| ColumnVectorRows || | | = rows(@[#2:#3,A]) |
| ColumnVectorCols || | | = cols(@[#2:#3,A]) |
| MatrixRows || | | = rowCount(@[#2:#3,A:B]) |
| MatrixCols || | | = columns(@[#2:#3,A:B]) |
| MatrixSize || | | = size(@[#2:#3,A:B]) |
`.trim();

    expect(cellValue(doc, "ScalarRows", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "ScalarCols", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "ScalarSize", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "RowVectorRows", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "RowVectorCols", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "ColumnVectorRows", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "ColumnVectorCols", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "MatrixRows", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "MatrixCols", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "MatrixSize", "Result")).toEqual({ kind: "number", value: 4 });
  });

  it("reports empty filter and empty slice shapes without inspecting contents", () => {
    const doc = `
# EmptyShapes
| Item || Name | Score | A | B | C | Result |
| ---- || ---- | ----- | --- | --- | --- | ------ |
| R1 || Alpha | 10 | 1 | 2 | 3 | |
| R2 || Beta | 20 | 4 | 5 | 6 | |
| R3 || Gamma | = error[bad] | 7 | 8 | 9 | |
| EmptyFilterRows || | | | | | = shape(filter(@[#2:#4,Name], @[#2:#4,A] > 999))[0] |
| EmptyFilterCols || | | | | | = shape(filter(@[#2:#4,Name], @[#2:#4,A] > 999))[1] |
| EmptyFilterSize || | | | | | = size(filter(@[#2:#4,Name], @[#2:#4,A] > 999)) |
| EmptyVectorRows || | | | | | = rowCount(@[#2:#4,A][2:1]) |
| EmptyVectorCols || | | | | | = columnCount(@[#2:#4,A][2:1]) |
| EmptyRowSliceRows || | | | | | = rowCount(@[#2:#4,A:C][0:0, :]) |
| EmptyRowSliceCols || | | | | | = columnCount(@[#2:#4,A:C][0:0, :]) |
| EmptyColSliceRows || | | | | | = rowCount(@[#2:#4,A:C][:, 1:1]) |
| EmptyColSliceCols || | | | | | = columnCount(@[#2:#4,A:C][:, 1:1]) |
| ErrorContentsRows || | | | | | = rowCount(@[#2:#4,Score]) |
| ErrorContentsSize || | | | | | = size(@[#2:#4,Score]) |
`.trim();

    expect(cellValue(doc, "EmptyFilterRows", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "EmptyFilterCols", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "EmptyFilterSize", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "EmptyVectorRows", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "EmptyVectorCols", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "EmptyRowSliceRows", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "EmptyRowSliceCols", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "EmptyColSliceRows", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "EmptyColSliceCols", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "ErrorContentsRows", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "ErrorContentsSize", "Result")).toEqual({ kind: "number", value: 3 });
  });

  it("allows shape results to feed bracket indexing and lazy guards", () => {
    const doc = `
# ShapeComposition
| Item || Name | Score | Result |
| ---- || ---- | ----- | ------ |
| A || Alpha | 10 | |
| B || Beta | 20 | |
| ShapeFirst || | | = shape(@[#2:#3,Name])[0] |
| ShapeSecond || | | = shape(@[#2:#3,Name])[1] |
| GuardEmpty || | | = if(size(filter(@[#2:#3,Name], @[#2:#3,Score] > 999)) > 0, filter(@[#2:#3,Name], @[#2:#3,Score] > 999)[0], "") |
| GuardFound || | | = if(size(filter(@[#2:#3,Name], @[#2:#3,Score] > 15)) > 0, filter(@[#2:#3,Name], @[#2:#3,Score] > 15)[0], "") |
`.trim();

    expect(cellValue(doc, "ShapeFirst", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "ShapeSecond", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "GuardEmpty", "Result")).toEqual({ kind: "string", value: "" });
    expect(cellValue(doc, "GuardFound", "Result")).toEqual({ kind: "string", value: "Beta" });
  });

  it("rejects scalar arguments and final shape views", () => {
    const doc = `
# ShapeErrors
| Item || A | Result |
| ---- || --- | ------ |
| R1 || 10 | |
| ShapeFinal || | = shape(@[R1,A]) |
| ShapeScalar || | = shape(1) |
| SizeScalar || | = size(1) |
| RowCountScalar || | = rowCount(1) |
| ColumnCountScalar || | = columnCount(1) |
| ShapeArity || | = shape(@[R1,A], @[R1,A]) |
| SizeArity || | = size() |
`.trim();

    expectError(doc, "ShapeFinal", "Result");
    expectError(doc, "ShapeScalar", "Result");
    expectError(doc, "SizeScalar", "Result");
    expectError(doc, "RowCountScalar", "Result");
    expectError(doc, "ColumnCountScalar", "Result");
    expectError(doc, "ShapeArity", "Result");
    expectError(doc, "SizeArity", "Result");
  });
});
