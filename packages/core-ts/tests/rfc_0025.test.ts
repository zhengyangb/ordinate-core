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

describe("RFC-0025 conditional lazy evaluation", () => {
  it("exposes lazy logical special forms in the registry", () => {
    const names = listStandardFunctionMetadata().map((definition) => definition.name);

    expect(names).toEqual(expect.arrayContaining(["if", "and", "or"]));
    expect(getStandardFunctionMetadata("IF")?.category).toBe("logical");
    expect(getStandardFunctionMetadata("if")?.summary).toContain("Lazy conditional special form");
    expect(getStandardFunctionMetadata("and")?.summary).toContain("evaluated lazily");
    expect(getStandardFunctionMetadata("or")?.summary).toContain("evaluated lazily");
    expect(getStandardFunctionMetadata("all")?.name).toBe("and");
    expect(getStandardFunctionMetadata("any")?.name).toBe("or");
  });

  it("selects scalar branches based on scalar boolean conditions", () => {
    const doc = `
# ScalarIf
| Item || Result |
| ---- || ------ |
| TrueNumber || = if(true, 10, 20) |
| FalseNumber || = if(false, 10, 20) |
| TrueText || = if(true, "yes", "no") |
| FalseText || = if(false, "yes", "no") |
| ComparisonTrue || = if(3 > 2, "gt", "le") |
| ComparisonFalse || = if(3 < 2, "lt", "ge") |
| PredicateTrue || = if(isText("abc"), len("abc"), 0) |
| PredicateFalse || = if(isNumber("abc"), number("abc"), 0) |
`.trim();

    expect(cellValue(doc, "TrueNumber", "Result")).toEqual({ kind: "number", value: 10 });
    expect(cellValue(doc, "FalseNumber", "Result")).toEqual({ kind: "number", value: 20 });
    expect(cellValue(doc, "TrueText", "Result")).toEqual({ kind: "string", value: "yes" });
    expect(cellValue(doc, "FalseText", "Result")).toEqual({ kind: "string", value: "no" });
    expect(cellValue(doc, "ComparisonTrue", "Result")).toEqual({ kind: "string", value: "gt" });
    expect(cellValue(doc, "ComparisonFalse", "Result")).toEqual({ kind: "string", value: "ge" });
    expect(cellValue(doc, "PredicateTrue", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "PredicateFalse", "Result")).toEqual({ kind: "number", value: 0 });
  });

  it("does not evaluate the unselected branch", () => {
    const doc = `
# LazyIf
| Item || Value | Result |
| ---- || ----- | ------ |
| TextValue || abc | |
| BlankValue || | |
| TrueSkipsError || | = if(true, 1, error[bad]) |
| FalseSkipsError || | = if(false, error[bad], 2) |
| GuardNumberFalse || | = if(isNumber(@[TextValue,Value]), number(@[TextValue,Value]), 0) |
| GuardTextTrue || | = if(isText(@[TextValue,Value]), len(@[TextValue,Value]), number(@[TextValue,Value])) |
| GuardBlankFalse || | = if(isText(@[BlankValue,Value]), len(@[BlankValue,Value]), "blank") |
| DivideSkipped || | = if(false, 1 / 0, 9) |
| BadSliceSkipped || | = if(false, slice("abc", 1.5), "ok") |
`.trim();

    expect(cellValue(doc, "TrueSkipsError", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "FalseSkipsError", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "GuardNumberFalse", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "GuardTextTrue", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "GuardBlankFalse", "Result")).toEqual({ kind: "string", value: "blank" });
    expect(cellValue(doc, "DivideSkipped", "Result")).toEqual({ kind: "number", value: 9 });
    expect(cellValue(doc, "BadSliceSkipped", "Result")).toEqual({ kind: "string", value: "ok" });
  });

  it("evaluates nested conditionals lazily", () => {
    const doc = `
# NestedIf
| Item || Value | Result |
| ---- || ----- | ------ |
| TextValue || abc | |
| NestedThen || | = if(true, if(false, error[bad], "inner"), error[bad]) |
| NestedElse || | = if(false, error[bad], if(isText(@[TextValue,Value]), upper(@[TextValue,Value]), error[bad])) |
| NestedGuard || | = if(isNumber(@[TextValue,Value]), if(true, number(@[TextValue,Value]), error[bad]), 7) |
`.trim();

    expect(cellValue(doc, "NestedThen", "Result")).toEqual({ kind: "string", value: "inner" });
    expect(cellValue(doc, "NestedElse", "Result")).toEqual({ kind: "string", value: "ABC" });
    expect(cellValue(doc, "NestedGuard", "Result")).toEqual({ kind: "number", value: 7 });
  });

  it("evaluates scalar and/or lazily from left to right", () => {
    const doc = `
# LazyLogical
| Item || Value | Result |
| ---- || ----- | ------ |
| TextValue || abc | |
| BlankValue || | |
| AndAllTrue || | = and(true, true, isText(@[TextValue,Value])) |
| AndStopsFalse || | = and(true, false, error[bad]) |
| AndFirstFalse || | = and(false, number("bad") > 0) |
| AndGuardConversion || | = and(isNumber(@[TextValue,Value]), number(@[TextValue,Value]) > 0) |
| OrAllFalse || | = or(false, false, isNumber(@[TextValue,Value])) |
| OrStopsTrue || | = or(false, true, error[bad]) |
| OrFirstTrue || | = or(true, number("bad") > 0) |
| OrGuardBlank || | = or(isBlank(@[BlankValue,Value]), len(@[BlankValue,Value]) == 0) |
| AliasAllStops || | = all(false, error[bad]) |
| AliasAnyStops || | = any(true, error[bad]) |
`.trim();

    expect(cellValue(doc, "AndAllTrue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "AndStopsFalse", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "AndFirstFalse", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "AndGuardConversion", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "OrAllFalse", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "OrStopsTrue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "OrFirstTrue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "OrGuardBlank", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "AliasAllStops", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "AliasAnyStops", "Result")).toEqual({ kind: "boolean", value: true });
  });

  it("preserves one-argument view reducer behavior for and/or aliases", () => {
    const doc = `
# ViewLogical
| Item || Flag | Result |
| ---- || ---- | ------ |
| A || true | |
| B || false | |
| C || true | |
| AndView || | = and(@[#2:#4,Flag]) |
| OrView || | = or(@[#2:#4,Flag]) |
| AllView || | = all(@[#2:#4,Flag]) |
| AnyView || | = any(@[#2:#4,Flag]) |
| AndScalar || | = and(@[A,Flag]) |
| OrScalar || | = or(@[B,Flag]) |
`.trim();

    expect(cellValue(doc, "AndView", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "OrView", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "AllView", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "AnyView", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "AndScalar", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "OrScalar", "Result")).toEqual({ kind: "boolean", value: false });
  });

  it("allows selected branches to feed scalar-shaped and aggregate-producing expressions", () => {
    const doc = `
# BranchValues
| Item || Value | Result |
| ---- || ----- | ------ |
| A || 1 | |
| B || 2 | |
| C || 3 | |
| AggregateThen || | = if(true, sum(@[#2:#4,Value]), 0) |
| AggregateElse || | = if(false, 0, average(@[#2:#4,Value])) |
| ScalarReferenceThen || | = if(true, @[A,Value], 0) |
| ScalarReferenceElse || | = if(false, 0, @[B,Value]) |
`.trim();

    expect(cellValue(doc, "AggregateThen", "Result")).toEqual({ kind: "number", value: 6 });
    expect(cellValue(doc, "AggregateElse", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "ScalarReferenceThen", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "ScalarReferenceElse", "Result")).toEqual({ kind: "number", value: 2 });
  });

  it("preserves final-result scalar rules for selected view branches", () => {
    const doc = `
# ViewBranches
| Item || Value | Result |
| ---- || ----- | ------ |
| A || 1 | |
| B || 2 | |
| C || 3 | |
| SelectedViewBad || | = if(true, @[#2:#4,Value], 0) |
| UnselectedViewOk || | = if(false, @[#2:#4,Value], 0) |
| SelectedScalarViewOk || | = if(true, @[A,Value], 0) |
`.trim();

    expectError(doc, "SelectedViewBad", "Result");
    expect(cellValue(doc, "UnselectedViewOk", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "SelectedScalarViewOk", "Result")).toEqual({ kind: "number", value: 1 });
  });

  it("fails early for invalid conditions and selected branch errors", () => {
    const doc = `
# IfErrors
| Item || Result |
| ---- || ------ |
| MissingArg || = if(true, 1) |
| ExtraArg || = if(true, 1, 2, 3) |
| NumberCondition || = if(1, 1, 0) |
| TextCondition || = if("true", 1, 0) |
| BlankCondition || = if(@[BlankSource,Result], 1, 0) |
| ErrorCondition || = if(error[bad], 1, 0) |
| ViewCondition || = if(@[A:B,Result], 1, 0) |
| SelectedThenError || = if(true, error[bad], 0) |
| SelectedElseError || = if(false, 0, error[bad]) |
| AndNoArgs || = and() |
| OrNoArgs || = or() |
| AndNonBoolean || = and(true, 1) |
| OrNonBoolean || = or(false, "x") |
| AndEvaluatedError || = and(true, error[bad]) |
| OrEvaluatedError || = or(false, error[bad]) |
| AndEvaluatedView || = and(true, @[A:B,Result]) |
| OrEvaluatedView || = or(false, @[A:B,Result]) |
| AndSkippedView || = and(false, @[A:B,Result]) |
| OrSkippedView || = or(true, @[A:B,Result]) |
| BlankSource || |
| A || true |
| B || false |
`.trim();

    expectError(doc, "MissingArg", "Result");
    expectError(doc, "ExtraArg", "Result");
    expectError(doc, "NumberCondition", "Result");
    expectError(doc, "TextCondition", "Result");
    expectError(doc, "BlankCondition", "Result");
    expectError(doc, "ErrorCondition", "Result");
    expectError(doc, "ViewCondition", "Result");
    expectError(doc, "SelectedThenError", "Result");
    expectError(doc, "SelectedElseError", "Result");
    expectError(doc, "AndNoArgs", "Result");
    expectError(doc, "OrNoArgs", "Result");
    expectError(doc, "AndNonBoolean", "Result");
    expectError(doc, "OrNonBoolean", "Result");
    expectError(doc, "AndEvaluatedError", "Result");
    expectError(doc, "OrEvaluatedError", "Result");
    expectError(doc, "AndEvaluatedView", "Result");
    expectError(doc, "OrEvaluatedView", "Result");
    expect(cellValue(doc, "AndSkippedView", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "OrSkippedView", "Result")).toEqual({ kind: "boolean", value: true });
  });
});
