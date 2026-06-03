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

describe("RFC-0023 type predicates and explicit conversions", () => {
  it("exposes type functions and boolean reducer aliases from the registry", () => {
    const names = listStandardFunctionMetadata().map((definition) => definition.name);

    expect(names).toEqual(expect.arrayContaining([
      "isNumber",
      "isText",
      "isBoolean",
      "isBlank",
      "isNull",
      "isError",
      "number",
      "text",
      "boolean",
    ]));

    expect(getStandardFunctionMetadata("isnumber")?.category).toBe("type");
    expect(getStandardFunctionMetadata("NUMBER")?.category).toBe("type");
    expect(getStandardFunctionMetadata("isString")?.name).toBe("isText");
    expect(getStandardFunctionMetadata("all")?.name).toBe("and");
    expect(getStandardFunctionMetadata("any")?.name).toBe("or");
  });

  it("evaluates scalar type predicates, including error inspection", () => {
    const doc = `
# ScalarPredicates
| Item || V | Result |
| ---- || --- | ------ |
| NumberValue || 12 | = isNumber(@[NumberValue,V]) |
| TextValue || abc | = isText(@[TextValue,V]) |
| BooleanValue || true | = isBoolean(@[BooleanValue,V]) |
| BlankValue || | = isBlank(@[BlankValue,V]) |
| NullValue || null | = isNull(@[NullValue,V]) |
| ErrorValue || = error[bad] | = isError(@[ErrorValue,V]) |
| NumberRejectsText || abc | = isNumber(@[NumberRejectsText,V]) |
| TextRejectsNumber || 7 | = isText(@[TextRejectsNumber,V]) |
| BooleanRejectsBlank || | = isBoolean(@[BooleanRejectsBlank,V]) |
| ErrorRejectsNumber || 7 | = isError(@[ErrorRejectsNumber,V]) |
| NumberRejectsError || = error[bad] | = isNumber(@[NumberRejectsError,V]) |
| LiteralError || | = isError(error[bad]) |
`.trim();

    expect(cellValue(doc, "NumberValue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "TextValue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "BooleanValue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "BlankValue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "NullValue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "ErrorValue", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "NumberRejectsText", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "TextRejectsNumber", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "BooleanRejectsBlank", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "ErrorRejectsNumber", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "NumberRejectsError", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "LiteralError", "Result")).toEqual({ kind: "boolean", value: true });
  });

  it("broadcasts predicates over views and composes with all, any, not, filter, and aggregate functions", () => {
    const doc = `
# Mixed
| Item || Value | Result |
| ---- || ----- | ------ |
| A    || 10 | |
| B    || text | |
| C    ||    | |
| D    || 30 | |
| E    || = error[bad] | |
| AllNumbers || | = all(isNumber(@[#2:#6,Value])) |
| AnyText || | = any(isText(@[#2:#6,Value])) |
| AnyError || | = any(isError(@[#2:#6,Value])) |
| BlankCount || | = sum(isBlank(@[#2:#6,Value])) |
| NonBlankCount || | = sum(not(isBlank(@[#2:#6,Value]))) |
| NumericAverage || | = average(filter(@[#2:#5,Value], isNumber(@[#2:#5,Value]))) |
| ErrorFreeCount || | = sum(not(isError(@[#2:#6,Value]))) |
| AliasAll || | = all(not(isNull(@[#2:#6,Value]))) |
| AliasAny || | = any(isBlank(@[#2:#6,Value])) |
`.trim();

    expect(cellValue(doc, "AllNumbers", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "AnyText", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "AnyError", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "BlankCount", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "NonBlankCount", "Result")).toEqual({ kind: "number", value: 4 });
    expect(cellValue(doc, "NumericAverage", "Result")).toEqual({ kind: "number", value: 20 });
    expect(cellValue(doc, "ErrorFreeCount", "Result")).toEqual({ kind: "number", value: 4 });
    expect(cellValue(doc, "AliasAll", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "AliasAny", "Result")).toEqual({ kind: "boolean", value: true });
  });

  it("converts scalar values explicitly", () => {
    const doc = `
# ScalarConversions
| Item || Result |
| ---- || ------ |
| NumberFromString || = number("12.5") |
| NumberFromPlusString || = number("+3") |
| NumberFromBooleanTrue || = number(true) |
| NumberFromBooleanFalse || = number(false) |
| TextFromNumber || = text(12.5) |
| TextFromBoolean || = text(true) |
| TextFromBlank || = text(@[BlankSource,Result]) |
| TextFromNull || = text(null) |
| BooleanFromZero || = boolean(0) |
| BooleanFromNumber || = boolean(2) |
| BooleanFromTrueText || = boolean("true") |
| BooleanFromFalseText || = boolean("false") |
| BlankSource || |
`.trim();

    expect(cellValue(doc, "NumberFromString", "Result")).toEqual({ kind: "number", value: 12.5 });
    expect(cellValue(doc, "NumberFromPlusString", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "NumberFromBooleanTrue", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "NumberFromBooleanFalse", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "TextFromNumber", "Result")).toEqual({ kind: "string", value: "12.5" });
    expect(cellValue(doc, "TextFromBoolean", "Result")).toEqual({ kind: "string", value: "true" });
    expect(cellValue(doc, "TextFromBlank", "Result")).toEqual({ kind: "string", value: "" });
    expect(cellValue(doc, "TextFromNull", "Result")).toEqual({ kind: "string", value: "null" });
    expect(cellValue(doc, "BooleanFromZero", "Result")).toEqual({ kind: "boolean", value: false });
    expect(cellValue(doc, "BooleanFromNumber", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "BooleanFromTrueText", "Result")).toEqual({ kind: "boolean", value: true });
    expect(cellValue(doc, "BooleanFromFalseText", "Result")).toEqual({ kind: "boolean", value: false });
  });

  it("broadcasts conversions over views and preserves final scalar result rules", () => {
    const doc = `
# ViewConversions
| Item || Amount | Code | Flag | Result |
| ---- || ------ | ---- | ---- | ------ |
| A    || 10 | 101 | true | |
| B    || 20 | 202 | false | |
| SumTextNumbers || | | | = sum(number(@[#2:#3,Amount])) |
| AverageTextBooleans || | | | = average(number(@[#2:#3,Flag])) |
| TextCodes || | | | = counta("SKU-" + text(@[#2:#3,Code])) |
| BooleanTextAny || | | | = any(boolean(@[#2:#3,Flag])) |
| FinalViewError || | | | = number(@[#2:#3,Amount]) |
`.trim();

    expect(cellValue(doc, "SumTextNumbers", "Result")).toEqual({ kind: "number", value: 30 });
    expect(cellValue(doc, "AverageTextBooleans", "Result")).toEqual({ kind: "number", value: 0.5 });
    expect(cellValue(doc, "TextCodes", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "BooleanTextAny", "Result")).toEqual({ kind: "boolean", value: true });
    expectError(doc, "FinalViewError", "Result");
  });

  it("fails early for invalid conversions and invalid boolean reducers", () => {
    const doc = `
# Errors
| Item || V | Result |
| ---- || --- | ------ |
| Blank || | |
| Text || abc | |
| Maybe || maybe | |
| ErrorSource || = error[bad] | |
| NumberBlank || | = number(@[Blank,V]) |
| NumberText || | = number(@[Text,V]) |
| NumberError || | = number(@[ErrorSource,V]) |
| BooleanBlank || | = boolean(@[Blank,V]) |
| BooleanText || | = boolean(@[Maybe,V]) |
| BooleanError || | = boolean(@[ErrorSource,V]) |
| NotNumber || | = not(1) |
| AllMixed || | = all(@[Blank:Text,V]) |
| AnyMixed || | = any(@[Blank:Text,V]) |
| ViewNumberBad || | = sum(number(@[Blank:Text,V])) |
`.trim();

    expectError(doc, "NumberBlank", "Result");
    expectError(doc, "NumberText", "Result");
    expectError(doc, "NumberError", "Result");
    expectError(doc, "BooleanBlank", "Result");
    expectError(doc, "BooleanText", "Result");
    expectError(doc, "BooleanError", "Result");
    expectError(doc, "NotNumber", "Result");
    expectError(doc, "AllMixed", "Result");
    expectError(doc, "AnyMixed", "Result");
    expectError(doc, "ViewNumberBad", "Result");
  });
});
