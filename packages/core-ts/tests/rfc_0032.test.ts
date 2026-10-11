import { describe, expect, it } from "vitest";

import {
  DocumentState,
  evaluateDocument,
  isError,
  serializeDocumentState,
  type RuntimeValue,
} from "../src";
import { parseCellInput } from "../src/runtime";

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

function expectNumber(doc: string, rowPath: string, colLabel: string, expected: number): void {
  const value = cellValue(doc, rowPath, colLabel);
  expect(value.kind).toBe("number");
  if (value.kind !== "number") throw new Error(`expected number at ${rowPath}, ${colLabel}`);
  expect(value.value).toBeCloseTo(expected);
}

function expectErrorReason(doc: string, rowPath: string, colLabel: string, reason: string): void {
  const value = cellValue(doc, rowPath, colLabel);
  expect(isError(value)).toBe(true);
  if (!isError(value)) throw new Error(`expected error at ${rowPath}, ${colLabel}`);
  expect(value.context.reason).toBe(reason);
}

function expectInvalidFormula(input: string, internalKind: string): void {
  const parsed = parseCellInput(input);
  expect(parsed.body.valid).toBe(false);
  if (parsed.body.valid) throw new Error(`expected invalid formula ${input}`);
  expect(parsed.body.issue.code).toBe(internalKind);
}

describe("RFC-0032 formula array literals", () => {
  it("keeps array rank separate from two-axis views while sharing aggregate inputs", () => {
    const doc = `
# Array and view shapes
| Item || Result |
| ---- || ------ |
| ArrayRank || = size(shape([1, 2, 3])) |
| ArrayLength || = shape([1, 2, 3])[0] |
| ViewRank || = size(shape([[1, 2, 3]])) |
| ViewRows || = shape([[1, 2, 3]])[0] |
| ViewColumns || = shape([[1, 2, 3]])[1] |
| ArraySum || = sum([1, 2, 3]) |
| ViewSum || = sum([[1, 2, 3]]) |
| MatrixSum || = sum([[1, 2], [3, 4]]) |
| ArrayRows || = rowCount([1, 2, 3]) |
| ArrayColumns || = columnCount([1, 2, 3]) |
| ArrayTwoAxes || = [1, 2, 3][0, 1] |
| ArraySliceRank || = size(shape([1, 2, 3][1:])) |
| ViewSliceRank || = size(shape([[1, 2, 3]][0, 1:])) |
| FilterRank || = size(shape(filter([1, 2, 3], [true, false, true]))) |
| FilterLength || = shape(filter([1, 2, 3], [true, false, true]))[0] |
| MixedKind || = sum([1, 2, 3] + [[1, 2, 3]]) |
`.trim();

    expectNumber(doc, "ArrayRank", "Result", 1);
    expectNumber(doc, "ArrayLength", "Result", 3);
    expectNumber(doc, "ViewRank", "Result", 2);
    expectNumber(doc, "ViewRows", "Result", 1);
    expectNumber(doc, "ViewColumns", "Result", 3);
    expectNumber(doc, "ArraySum", "Result", 6);
    expectNumber(doc, "ViewSum", "Result", 6);
    expectNumber(doc, "MatrixSum", "Result", 10);
    expectErrorReason(doc, "ArrayRows", "Result", "grid_view_required");
    expectErrorReason(doc, "ArrayColumns", "Result", "grid_view_required");
    expectErrorReason(doc, "ArrayTwoAxes", "Result", "array_requires_one_axis");
    expectNumber(doc, "ArraySliceRank", "Result", 1);
    expectNumber(doc, "ViewSliceRank", "Result", 2);
    expectNumber(doc, "FilterRank", "Result", 1);
    expectNumber(doc, "FilterLength", "Result", 2);
    expectNumber(doc, "MixedKind", "Result", 12);
  });

  it("evaluates one-dimensional arrays and empty arrays without scalar coercion", () => {
    const doc = `
# Arrays
| Item || Result |
| ---- || ------ |
| Sum || = sum([1, 2, 3]) |
| Product || = product([2, 3, 4]) |
| Count || = count([1, true, "x"]) |
| CountA || = counta([1, true, "x"]) |
| SumEmpty || = sum([]) |
| ProductEmpty || = product([]) |
| CountEmpty || = count([]) |
| AverageEmpty || = average([]) |
| EmptyIndex || = [][0] |
| ScalarArray || = [1] |
`.trim();

    expectNumber(doc, "Sum", "Result", 6);
    expectNumber(doc, "Product", "Result", 24);
    expectNumber(doc, "Count", "Result", 2);
    expectNumber(doc, "CountA", "Result", 3);
    expectNumber(doc, "SumEmpty", "Result", 0);
    expectNumber(doc, "ProductEmpty", "Result", 1);
    expectNumber(doc, "CountEmpty", "Result", 0);
    expectErrorReason(doc, "AverageEmpty", "Result", "empty_numeric_input");
    expectErrorReason(doc, "EmptyIndex", "Result", "index_out_of_bounds");
    expectErrorReason(doc, "ScalarArray", "Result", "final_result");
  });

  it("evaluates two-dimensional arrays and preserves shape through shape functions", () => {
    const doc = `
# MatrixArrays
| Item || Result |
| ---- || ------ |
| MatrixCell || = [[1, 2], [3, 4]][1, 0] |
| MatrixSum || = sum([[1, 2], [3, 4]]) |
| MatrixRows || = rowCount([[1, 2], [3, 4]]) |
| MatrixCols || = columnCount([[1, 2], [3, 4]]) |
| SingleRowRows || = rowCount([[1, 2]]) |
| SingleRowCols || = columnCount([[1, 2]]) |
| SingleColRows || = rowCount([[1], [2]]) |
| SingleColCols || = columnCount([[1], [2]]) |
| ScalarMatrix || = [[1]] |
| EmptyRowRows || = rowCount([[]]) |
| EmptyRowCols || = columnCount([[]]) |
| EmptyMatrixRows || = rowCount([[], []]) |
| EmptyMatrixCols || = columnCount([[], []]) |
| EmptyMatrixSize || = size([[], []]) |
`.trim();

    expectNumber(doc, "MatrixCell", "Result", 3);
    expectNumber(doc, "MatrixSum", "Result", 10);
    expectNumber(doc, "MatrixRows", "Result", 2);
    expectNumber(doc, "MatrixCols", "Result", 2);
    expectNumber(doc, "SingleRowRows", "Result", 1);
    expectNumber(doc, "SingleRowCols", "Result", 2);
    expectNumber(doc, "SingleColRows", "Result", 2);
    expectNumber(doc, "SingleColCols", "Result", 1);
    expectNumber(doc, "ScalarMatrix", "Result", 1);
    expectNumber(doc, "EmptyRowRows", "Result", 1);
    expectNumber(doc, "EmptyRowCols", "Result", 0);
    expectNumber(doc, "EmptyMatrixRows", "Result", 2);
    expectNumber(doc, "EmptyMatrixCols", "Result", 0);
    expectNumber(doc, "EmptyMatrixSize", "Result", 0);
  });

  it("uses array literals with existing indexing, slicing, arithmetic, comparison, vector, and financial functions", () => {
    const doc = `
# ArrayOperations
| Item || Result |
| ---- || ------ |
| First || = [10, 20, 30][0] |
| Last || = [10, 20, 30][-1] |
| SliceSum || = sum([10, 20, 30][1:]) |
| AddScalar || = sum([1, 2, 3] + 1) |
| ElementwiseProduct || = sum([1, 2, 3] * [4, 5, 6]) |
| ComparisonCount || = sum([1, 2, 3] > 1) |
| DotProduct || = dotProduct([1, 2, 3], [4, 5, 6]) |
| IRR || = irr([-100, 30, 40, 50]) |
| MIRR || = mirr([-100, 30, 40, 50], 0.08, 0.12) |
| XIRR || = xirr([-100, 110], [date(2026, 1, 1), date(2027, 1, 1)]) |
| ShapeMismatch || = sum([1, 2] + [1, 2, 3]) |
`.trim();

    expectNumber(doc, "First", "Result", 10);
    expectNumber(doc, "Last", "Result", 30);
    expectNumber(doc, "SliceSum", "Result", 50);
    expectNumber(doc, "AddScalar", "Result", 9);
    expectNumber(doc, "ElementwiseProduct", "Result", 32);
    expectNumber(doc, "ComparisonCount", "Result", 2);
    expectNumber(doc, "DotProduct", "Result", 32);
    expectNumber(doc, "IRR", "Result", 0.08896339469335035);
    expectNumber(doc, "MIRR", "Result", ((30 * 1.12 ** 2 + 40 * 1.12 + 50) / 100) ** (1 / 3) - 1);
    expectNumber(doc, "XIRR", "Result", 0.1);
    expect(cellValue(doc, "ShapeMismatch", "Result").kind).toBe("error");
  });

  it("allows explicit Ordinate scalar references and rejects view-valued array elements", () => {
    const doc = `
# ArrayReferences
| Item || Revenue | Active | Result |
| ---- || ------- | ------ | ------ |
| R1 || 10 | true | |
| R2 || 20 | false | |
| R3 || 30 | true | |
| ScalarRefs || | | = sum([@[R1, Revenue], @[R2, Revenue], @[R3, Revenue]]) |
| ExpressionRefs || | | = sum([@[R1, Revenue] + 1, @[R2, Revenue] + 2]) |
| RangeElement || | | = sum([@[:, Revenue]]) |
| ViewReturningCallElement || | | = sum([take([1, 2, 3], 2)]) |
`.trim();

    expectNumber(doc, "ScalarRefs", "Result", 60);
    expectNumber(doc, "ExpressionRefs", "Result", 33);
    expectErrorReason(doc, "RangeElement", "Result", "non_scalar_element");
    expectErrorReason(doc, "ViewReturningCallElement", "Result", "non_scalar_element");
  });

  it("keeps explicit error literals as array values and propagates computed errors", () => {
    const doc = `
# ArrayErrors
| Item || Result |
| ---- || ------ |
| InspectExplicitError || = isError([error[bad]][0]) |
| SumExplicitError || = sum([1, error[bad]]) |
| ComputedError || = [1, 1 / 0, 3][1] |
`.trim();

    expect(cellValue(doc, "InspectExplicitError", "Result")).toEqual({ kind: "boolean", value: true });
    const explicit = cellValue(doc, "SumExplicitError", "Result");
    expect(isError(explicit)).toBe(true);
    if (isError(explicit)) expect(explicit.errorKind).toBe("bad");
    expect(cellValue(doc, "ComputedError", "Result").kind).toBe("error");
  });

  it("rejects malformed arrays, ragged arrays, and over-deep arrays", () => {
    expectInvalidFormula("= [1, 2", "parse_array_missing_closing_bracket");
    expectInvalidFormula("= [1,]", "parse_array_trailing_comma");
    expectInvalidFormula("= [,1]", "parse_array_missing_element");
    expectInvalidFormula("= [1,,2]", "parse_array_missing_element");
    expectInvalidFormula("= [[1, 2], [3]]", "parse_array_ragged_rows");
    expectInvalidFormula("= [[], [1]]", "parse_array_ragged_rows");
    expectInvalidFormula("= [[1, 2], 3]", "parse_array_mixed_rows_and_scalars");
    expectInvalidFormula("= [[[1]]]", "parse_array_too_deep");

    const doc = `
# SpreadsheetRefs
| Item || V1 | V2 | Result |
| ---- || --- | --- | ------ |
| R1 || 10 | 20 | = B2 + C2 |
`.trim();

    expectNumber(doc, "R1", "Result", 30);
  });

  it("fails final non-scalar array results without introducing spill behavior", () => {
    const doc = `
# FinalArrays
| Item || Result |
| ---- || ------ |
| VectorFinal || = [1, 2, 3] |
| SliceFinal || = [1, 2, 3][1:] |
| MatrixFinal || = [[1, 2], [3, 4]] |
| ScalarVectorFinal || = [1] |
| ScalarMatrixFinal || = [[1]] |
`.trim();

    expectErrorReason(doc, "VectorFinal", "Result", "final_result");
    expectErrorReason(doc, "SliceFinal", "Result", "final_result");
    expectErrorReason(doc, "MatrixFinal", "Result", "final_result");
    expectErrorReason(doc, "ScalarVectorFinal", "Result", "final_result");
    expectNumber(doc, "ScalarMatrixFinal", "Result", 1);
  });

  it("round-trips array literal formulas through serialization", () => {
    const doc = `
# ArrayRoundTrip
| Item || Result |
| ---- || ------ |
| Sum || = sum([1, 2, 3]) |
| Matrix || = [[1, 2], [3, 4]][0, 1] |
| Empty || = count([]) |
| NestedEmpty || = size([[], []]) |
`.trim();

    const output = serializeDocumentState(DocumentState.fromText(doc));

    expect(output).toContain("= sum([1, 2, 3])");
    expect(output).toContain("= [[1, 2], [3, 4]][0, 1]");
    expect(output).toContain("= count([])");
    expect(output).toContain("= size([[], []])");
  });
});
