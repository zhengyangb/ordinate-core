import { describe, expect, it } from "vitest";

import {
  DocumentState,
  evaluateDocument,
  getStandardFunctionMetadata,
  listStandardFunctionMetadata,
  serializeDocumentState,
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

describe("RFC-0026 indexing and slicing", () => {
  it("exposes index from the registry", () => {
    const names = listStandardFunctionMetadata().map((definition) => definition.name);

    expect(names).toEqual(expect.arrayContaining(["index"]));
    expect(getStandardFunctionMetadata("INDEX")?.category).toBe("view");
    expect(getStandardFunctionMetadata("index")?.summary).toContain("zero-based");
  });

  it("evaluates index function over scalar, vector, and two-axis views", () => {
    const doc = `
# IndexFunction
| Item || A | B | Result |
| ---- || --- | --- | ------ |
| R1 || 10 | 100 | |
| R2 || 20 | 200 | |
| R3 || 30 | 300 | |
| VectorFirst || | | = index(@[#2:#4,A], 0) |
| VectorSecond || | | = index(@[#2:#4,A], 1) |
| VectorLast || | | = index(@[#2:#4,A], -1) |
| ScalarZero || | | = index(@[R1,A], 0) |
| ScalarNegative || | | = index(@[R1,A], -1) |
| MatrixTopLeft || | | = index(@[#2:#4,A:B], 0, 0) |
| MatrixTopRight || | | = index(@[#2:#4,A:B], 0, 1) |
| MatrixBottomLeft || | | = index(@[#2:#4,A:B], -1, 0) |
| MatrixBottomRight || | | = index(@[#2:#4,A:B], -1, -1) |
`.trim();

    expect(cellValue(doc, "VectorFirst", "Result")).toEqual({ kind: "number", value: 10 });
    expect(cellValue(doc, "VectorSecond", "Result")).toEqual({ kind: "number", value: 20 });
    expect(cellValue(doc, "VectorLast", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "ScalarZero", "Result")).toEqual({ kind: "number", value: 10 });
    expect(cellValue(doc, "ScalarNegative", "Result")).toEqual({ kind: "number", value: 10 });
    expect(cellValue(doc, "MatrixTopLeft", "Result")).toEqual({ kind: "number", value: 10 });
    expect(cellValue(doc, "MatrixTopRight", "Result")).toEqual({ kind: "number", value: 100 });
    expect(cellValue(doc, "MatrixBottomLeft", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "MatrixBottomRight", "Result")).toEqual({ kind: "number", value: 300 });
  });

  it("evaluates one-dimensional bracket indexing and slicing over views", () => {
    const doc = `
# OneDimensional
| Item || V | Result |
| ---- || --- | ------ |
| A || 10 | |
| B || 20 | |
| C || 30 | |
| D || 40 | |
| BracketFirst || | = @[#2:#5,V][0] |
| BracketLast || | = @[#2:#5,V][-1] |
| BracketSecond || | = @[#2:#5,V][1] |
| SliceMiddleSum || | = sum(@[#2:#5,V][1:3]) |
| SlicePrefixSum || | = sum(@[#2:#5,V][:2]) |
| SliceSuffixSum || | = sum(@[#2:#5,V][2:]) |
| SliceAllSum || | = sum(@[#2:#5,V][:]) |
| SliceNegativeSum || | = sum(@[#2:#5,V][-3:-1]) |
| SliceClampLeft || | = sum(@[#2:#5,V][-99:2]) |
| SliceClampRight || | = sum(@[#2:#5,V][2:99]) |
| SliceReversedEmpty || | = sum(@[#2:#5,V][3:1]) |
| FilterFirst || | = filter(@[#2:#5,V], @[#2:#5,V] > 20)[0] |
| ArithmeticLast || | = (@[#2:#5,V] + 1)[-1] |
| FinalViewError || | = @[#2:#5,V][1:3] |
`.trim();

    expect(cellValue(doc, "BracketFirst", "Result")).toEqual({ kind: "number", value: 10 });
    expect(cellValue(doc, "BracketLast", "Result")).toEqual({ kind: "number", value: 40 });
    expect(cellValue(doc, "BracketSecond", "Result")).toEqual({ kind: "number", value: 20 });
    expect(cellValue(doc, "SliceMiddleSum", "Result")).toEqual({ kind: "number", value: 50 });
    expect(cellValue(doc, "SlicePrefixSum", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "SliceSuffixSum", "Result")).toEqual({ kind: "number", value: 70 });
    expect(cellValue(doc, "SliceAllSum", "Result")).toEqual({ kind: "number", value: 100 });
    expect(cellValue(doc, "SliceNegativeSum", "Result")).toEqual({ kind: "number", value: 50 });
    expect(cellValue(doc, "SliceClampLeft", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "SliceClampRight", "Result")).toEqual({ kind: "number", value: 70 });
    expect(cellValue(doc, "SliceReversedEmpty", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "FilterFirst", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "ArithmeticLast", "Result")).toEqual({ kind: "number", value: 41 });
    expectError(doc, "FinalViewError", "Result");
  });

  it("evaluates two-dimensional bracket indexing and slicing over views", () => {
    const doc = `
# TwoDimensional
| Item || A | B | C | Result |
| ---- || --- | --- | --- | ------ |
| R1 || 1 | 2 | 3 | |
| R2 || 4 | 5 | 6 | |
| R3 || 7 | 8 | 9 | |
| Cell00 || | | | = @[#2:#4,A:C][0, 0] |
| Cell12 || | | | = @[#2:#4,A:C][1, 2] |
| CellNegative || | | | = @[#2:#4,A:C][-1, -2] |
| Row0Sum || | | | = sum(@[#2:#4,A:C][0, :]) |
| RowLastSum || | | | = sum(@[#2:#4,A:C][-1, :]) |
| Col1Sum || | | | = sum(@[#2:#4,A:C][:, 1]) |
| ColNegativeSum || | | | = sum(@[#2:#4,A:C][:, -1]) |
| RectSum || | | | = sum(@[#2:#4,A:C][0:2, 1:3]) |
| RectNegativeSum || | | | = sum(@[#2:#4,A:C][-2:, -2:]) |
| RectAllSum || | | | = sum(@[#2:#4,A:C][:, :]) |
| RectClampSum || | | | = sum(@[#2:#4,A:C][-99:99, 1:99]) |
| EmptyRows || | | | = sum(@[#2:#4,A:C][0:0, :]) |
| EmptyCols || | | | = sum(@[#2:#4,A:C][:, 1:1]) |
| SliceThenIndex || | | | = @[#2:#4,A:C][0:2, 1:3][1, 1] |
| RowSliceIndex || | | | = @[#2:#4,A:C][1, :][2] |
| ColSliceIndex || | | | = @[#2:#4,A:C][:, 2][1] |
| FinalRowViewError || | | | = @[#2:#4,A:C][0, :] |
| FinalRectViewError || | | | = @[#2:#4,A:C][0:2, 0:2] |
`.trim();

    expect(cellValue(doc, "Cell00", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "Cell12", "Result")).toEqual({ kind: "number", value: 6 });
    expect(cellValue(doc, "CellNegative", "Result")).toEqual({ kind: "number", value: 8 });
    expect(cellValue(doc, "Row0Sum", "Result")).toEqual({ kind: "number", value: 6 });
    expect(cellValue(doc, "RowLastSum", "Result")).toEqual({ kind: "number", value: 24 });
    expect(cellValue(doc, "Col1Sum", "Result")).toEqual({ kind: "number", value: 15 });
    expect(cellValue(doc, "ColNegativeSum", "Result")).toEqual({ kind: "number", value: 18 });
    expect(cellValue(doc, "RectSum", "Result")).toEqual({ kind: "number", value: 16 });
    expect(cellValue(doc, "RectNegativeSum", "Result")).toEqual({ kind: "number", value: 28 });
    expect(cellValue(doc, "RectAllSum", "Result")).toEqual({ kind: "number", value: 45 });
    expect(cellValue(doc, "RectClampSum", "Result")).toEqual({ kind: "number", value: 33 });
    expect(cellValue(doc, "EmptyRows", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "EmptyCols", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "SliceThenIndex", "Result")).toEqual({ kind: "number", value: 6 });
    expect(cellValue(doc, "RowSliceIndex", "Result")).toEqual({ kind: "number", value: 6 });
    expect(cellValue(doc, "ColSliceIndex", "Result")).toEqual({ kind: "number", value: 6 });
    expectError(doc, "FinalRowViewError", "Result");
    expectError(doc, "FinalRectViewError", "Result");
  });

  it("evaluates text bracket indexing and slicing using code-point indexes", () => {
    const doc = `
# TextIndexing
| Item || Result |
| ---- || ------ |
| TextFirst || = "abcdef"[0] |
| TextLast || = "abcdef"[-1] |
| TextMiddle || = "abcdef"[1:4] |
| TextPrefix || = "abcdef"[:3] |
| TextSuffix || = "abcdef"[3:] |
| TextAll || = "abcdef"[:] |
| TextNegative || = "abcdef"[-3:-1] |
| TextClamp || = "abcdef"[-99:99] |
| TextReversedEmpty || = "abcdef"[4:2] |
| TextConcat || = "abcdef"[0:3] + "X" |
| TextLen || = len("abcdef"[0:3]) |
| TextCodePointLen || = len("🙂x"[:1]) |
`.trim();

    expect(cellValue(doc, "TextFirst", "Result")).toEqual({ kind: "string", value: "a" });
    expect(cellValue(doc, "TextLast", "Result")).toEqual({ kind: "string", value: "f" });
    expect(cellValue(doc, "TextMiddle", "Result")).toEqual({ kind: "string", value: "bcd" });
    expect(cellValue(doc, "TextPrefix", "Result")).toEqual({ kind: "string", value: "abc" });
    expect(cellValue(doc, "TextSuffix", "Result")).toEqual({ kind: "string", value: "def" });
    expect(cellValue(doc, "TextAll", "Result")).toEqual({ kind: "string", value: "abcdef" });
    expect(cellValue(doc, "TextNegative", "Result")).toEqual({ kind: "string", value: "de" });
    expect(cellValue(doc, "TextClamp", "Result")).toEqual({ kind: "string", value: "abcdef" });
    expect(cellValue(doc, "TextReversedEmpty", "Result")).toEqual({ kind: "string", value: "" });
    expect(cellValue(doc, "TextConcat", "Result")).toEqual({ kind: "string", value: "abcX" });
    expect(cellValue(doc, "TextLen", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "TextCodePointLen", "Result")).toEqual({ kind: "number", value: 1 });
  });

  it("binds bracket syntax as postfix and keeps references and error literals unambiguous", () => {
    const doc = `
# Precedence
| Item || V | Result |
| ---- || --- | ------ |
| A || 2 | |
| B || 3 | |
| C || 4 | |
| AddAfterIndex || | = @[#2:#4,V][0] + 10 |
| MultiplyAfterIndex || | = @[#2:#4,V][1] * 10 |
| PowerAfterIndex || | = @[#2:#4,V][2] ** 2 |
| UnaryBeforeIndex || | = -@[#2:#4,V][0] |
| ArithmeticViewThenIndex || | = (@[#2:#4,V] + 10)[1] |
| ComparisonAfterIndex || | = @[#2:#4,V][0] < @[#2:#4,V][1] |
| ReferenceThenIndex || | = @[A,V][0] |
| ErrorLiteralStillError || | = isError(error[bad]) |
| StringErrorTextIndex || | = "error[bad]"[0:5] |
| IfBranchIndex || | = if(true, @[#2:#4,V][1], error[bad]) |
| LazyAndIndex || | = and(false, @[#2:#4,V][9] > 0) |
| LazyOrIndex || | = or(true, @[#2:#4,V][9] > 0) |
`.trim();

    expect(cellValue(doc, "AddAfterIndex", "Result")).toEqual({ kind: "number", value: 12 });
    expect(cellValue(doc, "MultiplyAfterIndex", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "PowerAfterIndex", "Result")).toEqual({ kind: "number", value: 16 });
    expect(cellValue(doc, "UnaryBeforeIndex", "Result")).toEqual({ kind: "number", value: -2 });
    expect(cellValue(doc, "ArithmeticViewThenIndex", "Result")).toEqual({ kind: "number", value: 13 });
    expect(cellValue(doc, "ComparisonAfterIndex", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "ReferenceThenIndex", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "ErrorLiteralStillError", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "StringErrorTextIndex", "Result")).toEqual({ kind: "string", value: "error" });
    expect(cellValue(doc, "IfBranchIndex", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "LazyAndIndex", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "LazyOrIndex", "Result")).toEqual({ kind: "boolean", value: true });
  });

  it("fails early for invalid indexes, axis counts, and selected errors", () => {
    const doc = `
# IndexErrors
| Item || A | B | Result |
| ---- || --- | --- | ------ |
| R1 || 1 | 10 | |
| R2 || = error[bad] | 20 | |
| R3 || 3 | 30 | |
| Index2DOneArg || | | = index(@[#2:#4,A:B], 0) |
| IndexNonView || | | = index("abc", 0) |
| IndexFraction || | | = index(@[#2:#4,A], 1.5) |
| IndexString || | | = index(@[#2:#4,A], "1") |
| IndexTooLarge || | | = index(@[#2:#4,A], 9) |
| IndexTooNegative || | | = index(@[#2:#4,A], -9) |
| IndexSelectedError || | | = index(@[#2:#4,A], 1) |
| Bracket2DOneAxis || | | = @[#2:#4,A:B][0] |
| TextTwoAxis || | | = "abc"[0, 1] |
| BracketFraction || | | = @[#2:#4,B][1.5] |
| BracketString || | | = @[#2:#4,B]["1"] |
| BracketTooLarge || | | = @[#2:#4,B][9] |
| BracketTooNegative || | | = @[#2:#4,B][-9] |
| BracketAxisError || | | = @[#2:#4,B][error[bad]] |
| SliceFractionStart || | | = sum(@[#2:#4,B][1.5:2]) |
| SliceFractionEnd || | | = sum(@[#2:#4,B][1:2.5]) |
| SliceStringBound || | | = sum(@[#2:#4,B]["x":2]) |
| TwoAxisRowOut || | | = @[#2:#4,A:B][9, 0] |
| TwoAxisColOut || | | = @[#2:#4,A:B][0, 9] |
| SliceKeepsErrorInspectable || | | = sum(isError(@[#2:#4,A][0:3])) |
`.trim();

    expectError(doc, "Index2DOneArg", "Result");
    expectError(doc, "IndexNonView", "Result");
    expectError(doc, "IndexFraction", "Result");
    expectError(doc, "IndexString", "Result");
    expectError(doc, "IndexTooLarge", "Result");
    expectError(doc, "IndexTooNegative", "Result");
    expectError(doc, "IndexSelectedError", "Result");
    expectError(doc, "Bracket2DOneAxis", "Result");
    expectError(doc, "TextTwoAxis", "Result");
    expectError(doc, "BracketFraction", "Result");
    expectError(doc, "BracketString", "Result");
    expectError(doc, "BracketTooLarge", "Result");
    expectError(doc, "BracketTooNegative", "Result");
    expectError(doc, "BracketAxisError", "Result");
    expectError(doc, "SliceFractionStart", "Result");
    expectError(doc, "SliceFractionEnd", "Result");
    expectError(doc, "SliceStringBound", "Result");
    expectError(doc, "TwoAxisRowOut", "Result");
    expectError(doc, "TwoAxisColOut", "Result");
    expect(cellValue(doc, "SliceKeepsErrorInspectable", "Result")).toEqual({ kind: "number", value: 1 });
  });

  it("fails for malformed or ambiguous bracket syntax", () => {
    const doc = `
# ParseErrors
| Item || V | Result |
| ---- || --- | ------ |
| A || 1 | |
| EmptyBracket || | = @[#2:#2,V][] |
| TooManyAxes || | = @[#2:#2,V][0, 0, 0] |
| StepSlice || | = @[#2:#2,V][0:1:2] |
| MissingSecondAxis || | = @[#2:#2,V][0,] |
| MissingFirstAxis || | = @[#2:#2,V][,0] |
| MissingSeparator || | = @[#2:#2,V][0 0] |
| MissingClosing || | = @[#2:#2,V][0 |
| ExtraClosing || | = @[#2:#2,V][0]] |
| TextStepSlice || | = "abc"[0:1:2] |
`.trim();

    expectError(doc, "EmptyBracket", "Result");
    expectError(doc, "TooManyAxes", "Result");
    expectError(doc, "StepSlice", "Result");
    expectError(doc, "MissingSecondAxis", "Result");
    expectError(doc, "MissingFirstAxis", "Result");
    expectError(doc, "MissingSeparator", "Result");
    expectError(doc, "MissingClosing", "Result");
    expectError(doc, "ExtraClosing", "Result");
    expectError(doc, "TextStepSlice", "Result");
  });

  it("round-trips bracket syntax through formula rendering", () => {
    const doc = `
# RoundTrip
| Item || V | Result |
| ---- || --- | ------ |
| A || 1 | |
| B || 2 | |
| C || 3 | |
| Vector || | = @[#2:#4,V][0] |
| Slice || | = sum(@[#2:#4,V][1:]) |
| Text || | = "abcdef"[0:3] |
| Matrix || | = index(@[#2:#4,V:Result], 0, 0) |
`.trim();

    const output = serializeDocumentState(DocumentState.fromText(doc));

    expect(output).toContain("= @[#2:#4,V][0]");
    expect(output).toContain("= sum(@[#2:#4,V][1:])");
    expect(output).toContain('= "abcdef"[0:3]');
    expect(output).toContain("= index(@[#2:#4,V:Result], 0, 0)");
  });
});
