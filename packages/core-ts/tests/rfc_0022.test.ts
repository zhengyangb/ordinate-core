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

function expectNumberClose(doc: string, rowPath: string, colLabel: string, expected: number): void {
  const value = cellValue(doc, rowPath, colLabel);
  expect(value.kind).toBe("number");
  if (value.kind !== "number") {
    throw new Error(`expected number at ${rowPath}, ${colLabel}`);
  }
  expect(value.value).toBeCloseTo(expected);
}

function expectError(doc: string, rowPath: string, colLabel: string): void {
  expect(cellValue(doc, rowPath, colLabel).kind).toBe("error");
}

describe("RFC-0022 statistical function library v1", () => {
  it("exposes statistical functions from the registry", () => {
    const names = listStandardFunctionMetadata().map((definition) => definition.name);

    expect(names).toEqual(expect.arrayContaining([
      "countblank",
      "median",
      "percentile",
      "quartile",
      "variance",
      "variancep",
      "stdev",
      "stdevp",
      "avedev",
      "devsq",
      "geomean",
      "harmean",
      "large",
      "small",
      "rank",
      "mode",
      "correl",
      "covariance",
      "covariancep",
      "slope",
      "intercept",
      "forecast",
      "standardize",
    ]));

    const variance = getStandardFunctionMetadata("VAR");
    expect(variance?.name).toBe("variance");
    expect(variance?.category).toBe("statistical");
    expect(getStandardFunctionMetadata("STDDEV")?.name).toBe("stdev");
    expect(getStandardFunctionMetadata("CORRELATION")?.name).toBe("correl");
  });

  it("evaluates descriptive and order statistics over numeric views", () => {
    const doc = `
# Scores
| Item || V | Result |
| ---- || --- | ------ |
| A    || 2 | |
| B    || 4 | |
| C    || 6 | |
| D    || 8 | |
| Median || | = median(@[#2:#5,V]) |
| Percentile || | = percentile(@[#2:#5,V], 0.25) |
| Quartile || | = quartile(@[#2:#5,V], 3) |
| Var || | = variance(@[#2:#5,V]) |
| VarP || | = varp(@[#2:#5,V]) |
| Stdev || | = stdev(@[#2:#5,V]) |
| StdevP || | = stddevp(@[#2:#5,V]) |
| AveDev || | = avedev(@[#2:#5,V]) |
| DevSq || | = devsq(@[#2:#5,V]) |
| GeoMean || | = geomean(@[#2:#5,V]) |
| HarMean || | = harmean(@[#2:#5,V]) |
| Large || | = large(@[#2:#5,V], 2) |
| Small || | = small(@[#2:#5,V], 2) |
| RankDesc || | = rank(6, @[#2:#5,V]) |
| RankAsc || | = rank(6, @[#2:#5,V], 1) |
| Standardize || | = standardize(10, 4, 2) |
`.trim();

    expect(cellValue(doc, "Median", "Result")).toEqual({ kind: "number", value: 5 });
    expect(cellValue(doc, "Percentile", "Result")).toEqual({ kind: "number", value: 3.5 });
    expect(cellValue(doc, "Quartile", "Result")).toEqual({ kind: "number", value: 6.5 });
    expectNumberClose(doc, "Var", "Result", 20 / 3);
    expect(cellValue(doc, "VarP", "Result")).toEqual({ kind: "number", value: 5 });
    expectNumberClose(doc, "Stdev", "Result", Math.sqrt(20 / 3));
    expectNumberClose(doc, "StdevP", "Result", Math.sqrt(5));
    expect(cellValue(doc, "AveDev", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "DevSq", "Result")).toEqual({ kind: "number", value: 20 });
    expectNumberClose(doc, "GeoMean", "Result", 384 ** 0.25);
    expectNumberClose(doc, "HarMean", "Result", 3.84);
    expect(cellValue(doc, "Large", "Result")).toEqual({ kind: "number", value: 6 });
    expect(cellValue(doc, "Small", "Result")).toEqual({ kind: "number", value: 4 });
    expect(cellValue(doc, "RankDesc", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "RankAsc", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "Standardize", "Result")).toEqual({ kind: "number", value: 3 });
  });

  it("uses boolean numeric compatibility without Excel A-variant functions", () => {
    const doc = `
# Flags
| Item || Flag | Result |
| ---- || ---- | ------ |
| A    || true | |
| B    || false | |
| C    || true | |
| D    ||      | |
| Sum || | = sum(@[#2:#5,Flag]) |
| Average || | = average(@[#2:#5,Flag]) |
| Count || | = count(@[#2:#5,Flag]) |
| Min || | = min(@[#2:#5,Flag]) |
| Max || | = max(@[#2:#5,Flag]) |
| SumSq || | = sumsq(@[#2:#5,Flag]) |
| CountBlank || | = countblank(@[#2:#5,Flag]) |
`.trim();

    expect(cellValue(doc, "Sum", "Result")).toEqual({ kind: "number", value: 2 });
    expectNumberClose(doc, "Average", "Result", 2 / 3);
    expect(cellValue(doc, "Count", "Result")).toEqual({ kind: "number", value: 3 });
    expect(cellValue(doc, "Min", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "Max", "Result")).toEqual({ kind: "number", value: 1 });
    expect(cellValue(doc, "SumSq", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "CountBlank", "Result")).toEqual({ kind: "number", value: 1 });
  });

  it("evaluates mode and paired regression statistics", () => {
    const doc = `
# Regression
| Item || X | Y | Result |
| ---- || --- | --- | ------ |
| A    || 1 | 2 | |
| B    || 2 | 4 | |
| C    || 3 | 6 | |
| D    || 4 | 8 | |
| Mode || 4 | 4 | = mode(@[#2:#6,X]) |
| Correl || | | = correl(@[#2:#5,X], @[#2:#5,Y]) |
| Covariance || | | = covariance(@[#2:#5,X], @[#2:#5,Y]) |
| CovarianceP || | | = covariancep(@[#2:#5,X], @[#2:#5,Y]) |
| Slope || | | = slope(@[#2:#5,Y], @[#2:#5,X]) |
| Intercept || | | = intercept(@[#2:#5,Y], @[#2:#5,X]) |
| Forecast || | | = forecast(5, @[#2:#5,Y], @[#2:#5,X]) |
`.trim();

    expect(cellValue(doc, "Mode", "Result")).toEqual({ kind: "number", value: 4 });
    expectNumberClose(doc, "Correl", "Result", 1);
    expectNumberClose(doc, "Covariance", "Result", 10 / 3);
    expect(cellValue(doc, "CovarianceP", "Result")).toEqual({ kind: "number", value: 2.5 });
    expect(cellValue(doc, "Slope", "Result")).toEqual({ kind: "number", value: 2 });
    expect(cellValue(doc, "Intercept", "Result")).toEqual({ kind: "number", value: 0 });
    expect(cellValue(doc, "Forecast", "Result")).toEqual({ kind: "number", value: 10 });
  });

  it("fails early for invalid statistical inputs", () => {
    const doc = `
# Errors
| Item || A | B | Result |
| ---- || --- | --- | ------ |
| R1   || 1 | 2 | |
| R2   || text | 4 | |
| R3   || 3 | 6 | |
| Text || | | = median(@[#2:#4,A]) |
| Percentile || | | = percentile(@[#2:#4,B], 1.5) |
| Large || | | = large(@[#2:#4,B], 4) |
| GeoMean || | | = geomean(@[#2:#4,A] - 1) |
| Shape || | | = correl(@[R1,A:B], @[:,B]) |
| ZeroVariance || | | = slope(@[#2:#4,B], @[#2:#4,B] * 0) |
`.trim();

    expectError(doc, "Text", "Result");
    expectError(doc, "Percentile", "Result");
    expectError(doc, "Large", "Result");
    expectError(doc, "GeoMean", "Result");
    expectError(doc, "Shape", "Result");
    expectError(doc, "ZeroVariance", "Result");
  });
});
