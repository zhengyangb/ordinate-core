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

describe("RFC-0024 text function library", () => {
  it("exposes text functions from the registry", () => {
    const names = listStandardFunctionMetadata().map((definition) => definition.name);

    expect(names).toEqual(expect.arrayContaining([
      "len",
      "lower",
      "upper",
      "trim",
      "contains",
      "startsWith",
      "endsWith",
      "replace",
      "slice",
      "join",
    ]));

    expect(getStandardFunctionMetadata("LEN")?.category).toBe("text");
    expect(getStandardFunctionMetadata("startswith")?.name).toBe("startsWith");
    expect(getStandardFunctionMetadata("ENDSWITH")?.category).toBe("text");
    expect(getStandardFunctionMetadata("concat")).toBeNull();
  });

  it("evaluates scalar text transforms and LEN as text character count", () => {
    const doc = `
# ScalarText
| Item || Result |
| ---- || ------ |
| LenWord || = len("hello") |
| LenEmpty || = len("") |
| LenWithSpace || = len("a b") |
| LowerMixed || = lower("AbC") |
| UpperMixed || = upper("aBc") |
| TrimSpaces || = trim("  abc  ") |
| TrimTabs || = trim("	x	") |
| ChainNormalize || = upper(trim(" code ")) |
`.trim();

    expect(cellValue(doc, "LenWord", "Result")).toEqual({ kind: "number", value: 5 });
    expect(cellValue(doc, "LenEmpty", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "LenWithSpace", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "LowerMixed", "Result")).toEqual({ kind: "string", value: "abc" });
    expect(cellValue(doc, "UpperMixed", "Result")).toEqual({ kind: "string", value: "ABC" });
    expect(cellValue(doc, "TrimSpaces", "Result")).toEqual({ kind: "string", value: "abc" });
    expect(cellValue(doc, "TrimTabs", "Result")).toEqual({ kind: "string", value: "x" });
    expect(cellValue(doc, "ChainNormalize", "Result")).toEqual({ kind: "string", value: "CODE" });
  });

  it("evaluates scalar matching functions with case-sensitive text rules", () => {
    const doc = `
# ScalarMatch
| Item || Result |
| ---- || ------ |
| ContainsTrue || = contains("abcdef", "cd") |
| ContainsFalse || = contains("abcdef", "CD") |
| ContainsEmpty || = contains("abcdef", "") |
| StartsTrue || = startsWith("A-001", "A-") |
| StartsFalse || = startsWith("A-001", "a-") |
| StartsEmpty || = startsWith("A-001", "") |
| EndsTrue || = endsWith("report.csv", ".csv") |
| EndsFalse || = endsWith("report.csv", ".CSV") |
| EndsEmpty || = endsWith("report.csv", "") |
`.trim();

    expect(cellValue(doc, "ContainsTrue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "ContainsFalse", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "ContainsEmpty", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "StartsTrue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "StartsFalse", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "StartsEmpty", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "EndsTrue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "EndsFalse", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "EndsEmpty", "Result")).toEqual({ kind: "boolean", value: true });
  });

  it("evaluates scalar replace-all and zero-based text slices", () => {
    const doc = `
# ScalarEdit
| Item || Result |
| ---- || ------ |
| ReplaceAll || = replace("a-b-c", "-", ":") |
| ReplaceNoMatch || = replace("abc", "x", "y") |
| ReplaceCaseSensitive || = replace("AaA", "a", "x") |
| SliceMiddle || = slice("abcdef", 1, 4) |
| SliceToEnd || = slice("abcdef", 3) |
| SliceNegativeStart || = slice("abcdef", -3) |
| SliceNegativeEnd || = slice("abcdef", 0, -1) |
| SliceClampLeft || = slice("abcdef", -99, 2) |
| SliceClampRight || = slice("abcdef", 4, 99) |
| SliceReversed || = slice("abcdef", 4, 2) |
`.trim();

    expect(cellValue(doc, "ReplaceAll", "Result")).toEqual({ kind: "string", value: "a:b:c" });
    expect(cellValue(doc, "ReplaceNoMatch", "Result")).toEqual({ kind: "string", value: "abc" });
    expect(cellValue(doc, "ReplaceCaseSensitive", "Result")).toEqual({ kind: "string", value: "AxA" });
    expect(cellValue(doc, "SliceMiddle", "Result")).toEqual({ kind: "string", value: "bcd" });
    expect(cellValue(doc, "SliceToEnd", "Result")).toEqual({ kind: "string", value: "def" });
    expect(cellValue(doc, "SliceNegativeStart", "Result")).toEqual({ kind: "string", value: "def" });
    expect(cellValue(doc, "SliceNegativeEnd", "Result")).toEqual({ kind: "string", value: "abcde" });
    expect(cellValue(doc, "SliceClampLeft", "Result")).toEqual({ kind: "string", value: "ab" });
    expect(cellValue(doc, "SliceClampRight", "Result")).toEqual({ kind: "string", value: "ef" });
    expect(cellValue(doc, "SliceReversed", "Result")).toEqual({ kind: "string", value: "" });
  });

  it("broadcasts unary text functions over views and preserves final scalar rules", () => {
    const doc = `
# ViewUnary
| Item || Name | Code | Result |
| ---- || ---- | ---- | ------ |
| A    || Ann | a-001 | |
| B    || BOB | b-202 | |
| C    || cy | c-303 | |
| TotalLen || | | = sum(len(@[#2:#4,Name])) |
| AverageLen || | | = average(len(@[#2:#4,Name])) |
| LowerCount || | | = counta(lower(@[#2:#4,Code])) |
| UpperCount || | | = counta(upper(@[#2:#4,Code])) |
| PrefixJoin || | | = join(",", upper(slice(@[#2:#4,Code], 0, 1))) |
| FinalViewError || | | = len(@[#2:#4,Name]) |
`.trim();

    expect(cellValue(doc, "TotalLen", "Result")).toEqual({ kind: "number", value: 8 });
    expect(cellValue(doc, "AverageLen", "Result")).toEqual({ kind: "number", value: 8 / 3 });
    expect(cellValue(doc, "LowerCount", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "UpperCount", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "PrefixJoin", "Result")).toEqual({ kind: "string", value: "A,B,C" });
    expectError(doc, "FinalViewError", "Result");
  });

  it("broadcasts multi-argument text functions over scalars and exact-shape views", () => {
    const doc = `
# ViewMatch
| Item || Name | Code | Prefix | Suffix | Result |
| ---- || ---- | ---- | ------ | ------ | ------ |
| A    || Alice | A-001.csv | A- | .csv | |
| B    || Bob | B-202.txt | A- | .csv | |
| C    || Dana | A-303.csv | A- | .txt | |
| ContainsLowerA || | | | | = sum(contains(lower(@[#2:#4,Name]), "a")) |
| StartsWithScalar || | | | | = sum(startsWith(@[#2:#4,Code], "A-")) |
| EndsWithScalar || | | | | = sum(endsWith(@[#2:#4,Code], ".csv")) |
| ContainsScalarLeft || | | | | = sum(contains("A-001.csv", @[#2:#4,Prefix])) |
| StartsWithViewPrefix || | | | | = sum(startsWith(@[#2:#4,Code], @[#2:#4,Prefix])) |
| EndsWithViewSuffix || | | | | = sum(endsWith(@[#2:#4,Code], @[#2:#4,Suffix])) |
| ReplaceScalar || | | | | = join(",", replace(@[#2:#4,Code], "-", ":")) |
| ReplaceView || | | | | = join(",", replace(@[#2:#4,Code], @[#2:#4,Prefix], "X-")) |
`.trim();

    expect(cellValue(doc, "ContainsLowerA", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "StartsWithScalar", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "EndsWithScalar", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "ContainsScalarLeft", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "StartsWithViewPrefix", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "EndsWithViewSuffix", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "ReplaceScalar", "Result")).toEqual({ kind: "string", value: "A:001.csv,B:202.txt,A:303.csv" });
    expect(cellValue(doc, "ReplaceView", "Result")).toEqual({ kind: "string", value: "X-001.csv,B-202.txt,X-303.csv" });
  });

  it("joins text views and composes with explicit text conversion", () => {
    const doc = `
# JoinText
| Item || Tag | Id | Result |
| ---- || --- | --- | ------ |
| A    || red | 101 | |
| B    || blue | 202 | |
| C    || green | 303 | |
| JoinTags || | | = join(", ", @[#2:#4,Tag]) |
| JoinIds || | | = join("-", text(@[#2:#4,Id])) |
| JoinFiltered || | | = join("/", filter(@[#2:#4,Tag], startsWith(@[#2:#4,Tag], "g") != true)) |
| Join2D || | | = join("|", @[#2:#4,Tag:Id]) |
| JoinEmpty || | | = join(",", filter(@[#2:#4,Tag], startsWith(@[#2:#4,Tag], "z"))) |
`.trim();

    expect(cellValue(doc, "JoinTags", "Result")).toEqual({ kind: "string", value: "red, blue, green" });
    expect(cellValue(doc, "JoinIds", "Result")).toEqual({ kind: "string", value: "101-202-303" });
    expect(cellValue(doc, "JoinFiltered", "Result")).toEqual({ kind: "string", value: "red/blue" });
    expectError(doc, "Join2D", "Result");
    expect(cellValue(doc, "JoinEmpty", "Result")).toEqual({ kind: "string", value: "" });
  });

  it("fails early for invalid scalar and view text inputs", () => {
    const doc = `
# TextErrors
| Item || Text | Other | Result |
| ---- || ---- | ----- | ------ |
| TextA || abc | a | |
| TextB || def | d | |
| Num || 12 | 1 | |
| Blank || | | |
| Err || = error[bad] | x | |
| LenNumber || | | = len(12) |
| LowerBlank || | | = lower(@[Blank,Text]) |
| ContainsNumber || | | = contains(12, "1") |
| ContainsViewNumber || | | = sum(contains(@[TextA:Num,Text], "a")) |
| ContainsShapeMismatch || | | = sum(contains(@[TextA:TextB,Text], @[TextA:Num,Other])) |
| ReplaceEmptySearch || | | = replace("abc", "", "x") |
| ReplaceNonTextReplacement || | | = replace("abc", "a", 1) |
| SliceFractionalStart || | | = slice("abcdef", 1.5, 3) |
| SliceFractionalEnd || | | = slice("abcdef", 1, 3.5) |
| SliceViewStart || | | = slice("abcdef", @[TextA:TextB,Other]) |
| JoinScalarSecond || | | = join(",", "abc") |
| JoinNonTextView || | | = join(",", @[TextA:Num,Text]) |
| JoinErrorView || | | = join(",", @[TextA:Err,Text]) |
`.trim();

    expectError(doc, "LenNumber", "Result");
    expectError(doc, "LowerBlank", "Result");
    expectError(doc, "ContainsNumber", "Result");
    expectError(doc, "ContainsViewNumber", "Result");
    expectError(doc, "ContainsShapeMismatch", "Result");
    expectError(doc, "ReplaceEmptySearch", "Result");
    expectError(doc, "ReplaceNonTextReplacement", "Result");
    expectError(doc, "SliceFractionalStart", "Result");
    expectError(doc, "SliceFractionalEnd", "Result");
    expectError(doc, "SliceViewStart", "Result");
    expectError(doc, "JoinScalarSecond", "Result");
    expectError(doc, "JoinNonTextView", "Result");
    expectError(doc, "JoinErrorView", "Result");
  });
});
