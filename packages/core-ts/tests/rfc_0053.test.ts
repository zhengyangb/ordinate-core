import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { DocumentState, evaluateDocument, exportExcelWorkbook, isError, type RuntimeValue } from "../src";
import { parseCellInput } from "../src/runtime";

function evaluateCases(cases: Record<string, string>): Map<string, RuntimeValue> {
  const source = [
    "# Broadcasting",
    "| Case || Result |",
    "| ---- || ------ |",
    ...Object.entries(cases).map(([name, formula]) => `| ${name} || = ${formula} |`),
  ].join("\n");
  const sheet = evaluateDocument(source).sheets[0];
  const resultColumn = sheet.colLabels.indexOf("Result");
  expect(resultColumn).toBeGreaterThanOrEqual(0);
  return new Map(Object.keys(cases).map((name) => {
    const row = sheet.rowPaths.indexOf(name);
    expect(row).toBeGreaterThanOrEqual(0);
    return [name, sheet.values[row][resultColumn]];
  }));
}

function expectNumber(value: RuntimeValue | undefined, expected: number): void {
  expect(value?.kind).toBe("number");
  if (value?.kind !== "number") throw new Error("expected a number");
  expect(value.value).toBeCloseTo(expected);
}

function expectInternalError(value: RuntimeValue | undefined, internalKind: string): void {
  expect(isError(value)).toBe(true);
  if (!isError(value)) throw new Error("expected an error");
  expect(value.internalKind).toBe(internalKind);
}

describe("RFC-0053 anchored broadcasting", () => {
  it("aligns Arrays with the trailing axis of Views in either operand order", () => {
    const values = evaluateCases({
      Row: "sum([1, 2, 3] + [[10, 20, 30]])",
      MatrixRight: "sum([1, 2, 3] + [[10, 20, 30], [40, 50, 60]])",
      MatrixLeft: "sum([[10, 20, 30], [40, 50, 60]] + [1, 2, 3])",
      ResultRows: "rowCount([1, 2, 3] + [[10, 20, 30], [40, 50, 60]])",
      ResultColumns: "columnCount([1, 2, 3] + [[10, 20, 30], [40, 50, 60]])",
      ResultCell: "([1, 2, 3] + [[10, 20, 30], [40, 50, 60]])[1, 2]",
      SquareArrayAxis: "([10, 20] + [[1, 2], [3, 4]])[1, 0]",
      SquareColumnAxis: "([[10], [20]] + [[1, 2], [3, 4]])[1, 0]",
      ViewMinusArray: "sum([[10, 20, 30], [40, 50, 60]] - [1, 2, 3])",
      ArrayMinusView: "sum([1, 2, 3] - [[10, 20, 30], [40, 50, 60]])",
    });
    expectNumber(values.get("Row"), 66);
    expectNumber(values.get("MatrixRight"), 222);
    expectNumber(values.get("MatrixLeft"), 222);
    expectNumber(values.get("ResultRows"), 2);
    expectNumber(values.get("ResultColumns"), 3);
    expectNumber(values.get("ResultCell"), 63);
    expectNumber(values.get("SquareArrayAxis"), 13);
    expectNumber(values.get("SquareColumnAxis"), 23);
    expectNumber(values.get("ViewMinusArray"), 198);
    expectNumber(values.get("ArrayMinusView"), -198);
  });

  it("expands one Array or View operand to an existing result shape", () => {
    const values = evaluateCases({
      ArraySingleton: "sum([5] + [1, 2, 3])",
      ArraySingletonRank: "size(shape([5] + [1, 2, 3]))",
      RowView: "sum([[1, 2, 3]] + [[10, 20, 30], [40, 50, 60]])",
      ColumnView: "sum([[1], [10]] + [[10, 20, 30], [40, 50, 60]])",
      SingleCellView: "sum([[5]] + [[10, 20, 30], [40, 50, 60]])",
      SingleCellViewRank: "size(shape([[5]] + [[10, 20, 30], [40, 50, 60]]))",
      ScalarArray: "sum(5 + [1, 2, 3])",
      ScalarView: "sum(5 + [[1, 2, 3]])",
    });
    expectNumber(values.get("ArraySingleton"), 21);
    expectNumber(values.get("ArraySingletonRank"), 1);
    expectNumber(values.get("RowView"), 222);
    expectNumber(values.get("ColumnView"), 243);
    expectNumber(values.get("SingleCellView"), 240);
    expectNumber(values.get("SingleCellViewRank"), 2);
    expectNumber(values.get("ScalarArray"), 21);
    expectNumber(values.get("ScalarView"), 21);
  });

  it("uses the same shape rule for comparisons and all arithmetic operators", () => {
    const values = evaluateCases({
      Equal: "sum([1, 2, 3] == [[1, 0, 3]])",
      NotEqual: "sum([1, 2, 3] != [[1, 0, 3]])",
      Less: "sum([1, 2, 3] < [[2, 2, 2]])",
      LessOrEqual: "sum([1, 2, 3] <= [[2, 2, 2]])",
      GreaterOrEqual: "sum([1, 2, 3] >= [[2, 2, 2]])",
      Multiply: "sum([1, 2, 3] * [[2, 3, 4]])",
      Divide: "sum([[2, 6, 12]] / [2, 3, 4])",
      Power: "sum([[2, 3, 4]] ** [2, 2, 2])",
      Concat: "join(\",\", [[\"a\", \"b\", \"c\"], [\"d\", \"e\", \"f\"]] + [\"1\", \"2\", \"3\"])",
    });
    expectNumber(values.get("Equal"), 2);
    expectNumber(values.get("NotEqual"), 1);
    expectNumber(values.get("Less"), 1);
    expectNumber(values.get("LessOrEqual"), 2);
    expectNumber(values.get("GreaterOrEqual"), 2);
    expectNumber(values.get("Multiply"), 20);
    expectNumber(values.get("Divide"), 6);
    expectNumber(values.get("Power"), 29);
    expect(values.get("Concat")).toEqual({ kind: "string", value: "a1,b2,c3,d1,e2,f3" });
  });

  it("treats reference-derived Views like literal Views", () => {
    const source = `
# Referenced broadcasting
| Row || A | B | C | Result |
| --- || --- | --- | --- | ------ |
| R1 || 10 | 20 | 30 | |
| R2 || 40 | 50 | 60 | |
| Total || | | | = sum(@[R1:R2,A:C] + [1, 2, 3]) |
| Last || | | | = (@[R1:R2,A:C] + [1, 2, 3])[1, 2] |
`.trim();
    const sheet = evaluateDocument(source).sheets[0];
    const resultColumn = sheet.colLabels.indexOf("Result");
    expectNumber(sheet.values[sheet.rowPaths.indexOf("Total")][resultColumn], 222);
    expectNumber(sheet.values[sheet.rowPaths.indexOf("Last")][resultColumn], 63);
  });

  it("rejects incompatible axes and expansion of both operands", () => {
    const values = evaluateCases({
      TrailingMismatch: "sum([1, 2] + [[10, 20, 30], [40, 50, 60]])",
      OuterArrayView: "sum([[1], [2]] + [10, 20, 30])",
      OuterViewView: "sum([[1, 2, 3]] + [[10], [20]])",
      ComparisonOuter: "sum([[1], [2]] > [10, 20, 30])",
      FilterStillExact: "sum(filter([1, 2, 3], [[true, true, true]]))",
    });
    expectInternalError(values.get("TrailingMismatch"), "invalid_view_arithmetic");
    expectInternalError(values.get("OuterArrayView"), "invalid_view_arithmetic");
    expectInternalError(values.get("OuterViewView"), "invalid_view_arithmetic");
    expectInternalError(values.get("ComparisonOuter"), "invalid_view_comparison");
    expectInternalError(values.get("FilterStillExact"), "invalid_function_call");
  });

  it("preserves empty axes, scalar result rules, and element errors", () => {
    const values = evaluateCases({
      EmptyArray: "size([] + [5])",
      EmptyView: "shape([[]] + [[], []])[0]",
      EmptyViewColumns: "shape([[]] + [[], []])[1]",
      EmptyMismatch: "sum([] + [1, 2])",
      FinalCollection: "[1, 2, 3] + [[10, 20, 30]]",
      ExplicitError: "sum([1, error[bad]] + [[2, 3]])",
      DivideByZero: "sum([1, 2] / [[1, 0]])",
    });
    expectNumber(values.get("EmptyArray"), 0);
    expectNumber(values.get("EmptyView"), 2);
    expectNumber(values.get("EmptyViewColumns"), 0);
    expectInternalError(values.get("EmptyMismatch"), "invalid_view_arithmetic");
    expectInternalError(values.get("FinalCollection"), "invalid_view");
    const explicitError = values.get("ExplicitError");
    expect(isError(explicitError)).toBe(true);
    if (isError(explicitError)) expect(explicitError.errorKind).toBe("bad");
    expectInternalError(values.get("DivideByZero"), "divide_by_zero");
  });

  it("requires every row in a two-dimensional array literal to have equal length", () => {
    const parsed = parseCellInput("= [[1, 2], [3]]");
    expect(parsed.body.valid).toBe(false);
    if (parsed.body.valid) throw new Error("expected a ragged-view parse error");
    expect(parsed.body.issue.code).toBe("parse_array_ragged_rows");
  });

  it("exports newly broadcast formulas as warned static results when requested", async () => {
    const document = DocumentState.fromText("# Export\n| = sum([1, 2, 3] + [[10, 20, 30]]) |");
    const strict = await exportExcelWorkbook(document);
    expect(strict.ok).toBe(false);
    expect(strict.diagnostics).toContainEqual(expect.objectContaining({ code: "unsupported_formula" }));

    const materialized = await exportExcelWorkbook(document, { unsupportedFormulas: "value" });
    if (!materialized.ok) throw new Error(JSON.stringify(materialized.diagnostics));
    expect(materialized.diagnostics).toContainEqual(expect.objectContaining({ code: "formula_exported_as_value" }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(materialized.value.slice().buffer);
    expect(workbook.getWorksheet("Export")?.getCell("A1").value).toBe(66);
  });
});
