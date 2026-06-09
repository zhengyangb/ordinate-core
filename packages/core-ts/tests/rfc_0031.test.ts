import { describe, expect, it } from "vitest";

import {
  evaluateDocument,
  getStandardFunctionMetadata,
  isError,
  listStandardFunctionMetadata,
  type RuntimeValue,
} from "../src";
import {
  cumipmtValue,
  cumprincValue,
  dbValue,
  ddbValue,
  effectValue,
  fvValue,
  ipmtValue,
  irrView,
  ispmtValue,
  mirrView,
  nominalValue,
  nperValue,
  npvView,
  pmtValue,
  ppmtValue,
  pvValue,
  rateValue,
  slnValue,
  sydValue,
  xirrView,
  xnpvView,
} from "../src/runtime/functions/financial";
import { makeRuntimeView } from "../src/runtime/view";
import type { RuntimeView } from "../src/runtime/types";

// RFC-0031 edge inventory covered in this file:
// - TVM inverse relationships, zero-rate branches, payment timing, and invalid periods/types.
// - IRR root solver cases: valid single root, missing positive/negative cash flows,
//   sign-diverse cash flows with no real root, and multiple valid roots.
// - Cash-flow view policy: row/column vectors, matrix rejection, blanks, booleans,
//   strings, propagated errors, and paired value/date blanks.
// - Dated cash flows: first-date anchoring, unordered dates, 365-day year,
//   leap-year 366-day spans, shape mismatch, invalid dates, no root, and multiple roots.
// - Deterministic supporting functions: rate conversion and depreciation validation.
// - Spreadsheet formula integration because formula vector literals are future work.

function n(value: number): RuntimeValue {
  return { kind: "number", value };
}

function b(value: boolean): RuntimeValue {
  return { kind: "boolean", value };
}

function s(value: string): RuntimeValue {
  return { kind: "string", value };
}

function blank(): RuntimeValue {
  return { kind: "blank", value: null };
}

function date(value: string): RuntimeValue {
  return { kind: "date", value, isOffsetQualified: false };
}

function vector(values: RuntimeValue[]): RuntimeView {
  return makeRuntimeView(1, values.length, 1, values);
}

function rowVector(values: RuntimeValue[]): RuntimeView {
  return makeRuntimeView(1, 1, values.length, values);
}

function matrix(values: RuntimeValue[]): RuntimeView {
  return makeRuntimeView(2, 2, 2, values);
}

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

function expectNumber(value: RuntimeValue, expected: number, digits = 10): void {
  expect(value.kind).toBe("number");
  if (value.kind !== "number") throw new Error(`expected number, got ${value.kind}`);
  expect(value.value).toBeCloseTo(expected, digits);
}

function numberOf(value: RuntimeValue): number {
  if (value.kind !== "number") throw new Error(`expected number, got ${value.kind}`);
  return value.value;
}

function expectErrorReason(value: RuntimeValue, reason: string): void {
  expect(isError(value)).toBe(true);
  if (!isError(value)) throw new Error(`expected error, got ${value.kind}`);
  expect(value.context.reason).toBe(reason);
}

function expectCellNumber(doc: string, rowPath: string, colLabel: string, expected: number, digits = 10): void {
  expectNumber(cellValue(doc, rowPath, colLabel), expected, digits);
}

function expectCellErrorReason(doc: string, rowPath: string, colLabel: string, reason: string): void {
  expectErrorReason(cellValue(doc, rowPath, colLabel), reason);
}

describe("RFC-0031 financial function library v1", () => {
  it("exposes deterministic financial functions from the registry", () => {
    const names = listStandardFunctionMetadata().map((definition) => definition.name);

    expect(names).toEqual(expect.arrayContaining([
      "fv",
      "pv",
      "pmt",
      "nper",
      "rate",
      "ipmt",
      "ppmt",
      "cumipmt",
      "cumprinc",
      "ispmt",
      "npv",
      "irr",
      "mirr",
      "xnpv",
      "xirr",
      "effect",
      "nominal",
      "sln",
      "syd",
      "db",
      "ddb",
    ]));

    expect(getStandardFunctionMetadata("XIRR")?.category).toBe("financial");
    expect(getStandardFunctionMetadata("irr")?.summary).toContain("internal rate of return");
    expect(getStandardFunctionMetadata("rate")?.summary).toContain("deterministic");
  });

  it("evaluates TVM functions and payment allocation identities", () => {
    // Edge-case category: scalar TVM correctness.
    // This covers inverse relationships, zero-rate branches, beginning/end payment type,
    // period validation, and invalid type handling without needing spreadsheet ranges.
    const rate = n(0.05);
    const nper = n(10);
    const pv = n(-1000);

    const pmt = pmtValue(rate, nper, pv, null, null, "pmt");
    expectNumber(pmt, 129.50457496545661);
    expectNumber(pvValue(rate, nper, pmt, null, null, "pv"), -1000);
    expectNumber(fvValue(rate, nper, pmt, pv, null, "fv"), 0);
    expectNumber(nperValue(rate, pmt, pv, null, null, "nper"), 10);
    expectNumber(rateValue(nper, pmt, pv, null, null, "rate"), 0.05);

    expectNumber(pmtValue(n(0), n(5), n(-100), n(0), null, "pmt"), 20);
    expectNumber(fvValue(n(0), n(5), n(20), n(-100), null, "fv"), 0);
    expectNumber(pvValue(n(0), n(5), n(20), n(0), null, "pv"), -100);

    const beginningPmt = pmtValue(rate, nper, pv, null, n(1), "pmt");
    expectNumber(beginningPmt, numberOf(pmt) / 1.05);
    expectNumber(ipmtValue(rate, n(1), nper, n(1000), null, n(1), "ipmt"), 0);

    const period3Pmt = pmtValue(rate, nper, n(1000), null, null, "pmt");
    const period3Interest = ipmtValue(rate, n(3), nper, n(1000), null, null, "ipmt");
    const period3Principal = ppmtValue(rate, n(3), nper, n(1000), null, null, "ppmt");
    expectNumber(n(numberOf(period3Interest) + numberOf(period3Principal)), numberOf(period3Pmt));

    const cumulativeInterest = cumipmtValue(rate, nper, n(1000), n(1), n(3), null, "cumipmt");
    const cumulativePrincipal = cumprincValue(rate, nper, n(1000), n(1), n(3), null, "cumprinc");
    const firstThreeInterest = [1, 2, 3]
      .map((period) => numberOf(ipmtValue(rate, n(period), nper, n(1000), null, null, "ipmt")))
      .reduce((sum, value) => sum + value, 0);
    const firstThreePrincipal = [1, 2, 3]
      .map((period) => numberOf(ppmtValue(rate, n(period), nper, n(1000), null, null, "ppmt")))
      .reduce((sum, value) => sum + value, 0);
    expectNumber(cumulativeInterest, firstThreeInterest);
    expectNumber(cumulativePrincipal, firstThreePrincipal);
    expectNumber(ispmtValue(rate, n(1), nper, n(1000), "ispmt"), -45);

    expectErrorReason(pmtValue(rate, n(0), pv, null, null, "pmt"), "zero_period_count");
    expectErrorReason(pmtValue(rate, nper, pv, null, n(2), "pmt"), "invalid_payment_type");
    expectErrorReason(ipmtValue(rate, n(11), nper, n(1000), null, null, "ipmt"), "period_out_of_range");
    expectErrorReason(cumipmtValue(rate, nper, n(1000), n(3), n(2), null, "cumipmt"), "period_out_of_range");
  });

  it("fails early for invalid rate and MIRR scalar cases", () => {
    // Edge-case category: root-solved scalar functions.
    // RATE and MIRR must return structured errors for impossible or invalid input,
    // not NaN, Infinity, or host-dependent root-solver behavior.
    expectErrorReason(rateValue(n(0), n(100), n(-1000), null, null, "rate"), "non_positive_period_count");
    expectErrorReason(rateValue(n(10), n(0), n(100), n(100), null, "rate"), "root_not_found");
    expectErrorReason(rateValue(n(10), n(0), n(0), n(0), null, "rate"), "multiple_roots");
    expectErrorReason(mirrView(vector([n(10), n(20)]), n(0.08), n(0.12), "mirr"), "missing_cashflow_sign");
    expectErrorReason(mirrView(vector([n(-100), n(20)]), n(-1), n(0.12), "mirr"), "rate_out_of_range");
  });

  it("evaluates periodic cash-flow functions over runtime views", () => {
    // Edge-case category: periodic IRR root solving.
    // This covers the key IRR boundaries: one positive and one negative cash flow,
    // no sign diversity, no real root despite sign diversity, and multiple valid roots.
    const cashflows = vector([n(-100), n(30), n(40), n(50)]);
    const expectedNpv = 30 / 1.1 + 40 / 1.1 ** 2 + 50 / 1.1 ** 3;
    const expectedIrr = 0.08896339469335035;
    const expectedMirr = ((30 * 1.12 ** 2 + 40 * 1.12 + 50) / 100) ** (1 / 3) - 1;

    expectNumber(npvView(n(0.1), vector([n(30), n(40), n(50)]), "npv"), expectedNpv);
    expectNumber(irrView(cashflows, "irr"), expectedIrr);
    expectNumber(mirrView(cashflows, n(0.08), n(0.12), "mirr"), expectedMirr);

    expectErrorReason(irrView(vector([n(10), n(20)]), "irr"), "missing_cashflow_sign");
    expectErrorReason(irrView(vector([n(-100), n(50), n(-100)]), "irr"), "root_not_found");
    expectErrorReason(irrView(vector([n(-100), n(230), n(-132)]), "irr"), "multiple_roots");
    expectErrorReason(irrView(matrix([n(-100), n(30), n(40), n(50)]), "irr"), "vector_required");
  });

  it("uses row-major order for one-dimensional cash-flow views", () => {
    // Edge-case category: row-vector cash flows.
    // Cash-flow functions accept view[d=1], whether the vector is a column or a row.
    const expectedIrr = 0.08896339469335035;

    expectNumber(irrView(rowVector([n(-100), n(30), n(40), n(50)]), "irr"), expectedIrr);
    expectNumber(npvView(n(0.1), rowVector([n(30), n(40), n(50)]), "npv"), 30 / 1.1 + 40 / 1.1 ** 2 + 50 / 1.1 ** 3);
  });

  it("applies cash-flow view input policy consistently", () => {
    // Edge-case category: view coercion and failure policy.
    // Blanks are ignored, booleans are numeric-compatible, errors propagate, strings fail,
    // and paired XNPV inputs must remove blanks only as complete value/date pairs.
    expectNumber(npvView(n(0), vector([blank(), n(10), b(true), b(false)]), "npv"), 11);
    expectErrorReason(npvView(n(0), vector([n(10), s("cash")]), "npv"), "non_numeric_cashflow");

    const propagated = { kind: "error", errorKind: "generic", internalKind: "fixture_error", context: {} } satisfies RuntimeValue;
    expect(irrView(vector([n(-1), propagated, n(2)]), "irr")).toBe(propagated);

    expectNumber(
      xnpvView(n(0), vector([blank(), n(-100), n(110)]), vector([blank(), date("2026-01-01"), date("2027-01-01")]), "xnpv"),
      10,
    );
    expectErrorReason(
      xnpvView(n(0), vector([blank(), n(110)]), vector([date("2026-01-01"), date("2027-01-01")]), "xnpv"),
      "incomplete_cashflow_date_pair",
    );
    expectErrorReason(
      xnpvView(n(0), vector([n(-100), n(110)]), vector([date("2026-01-01"), s("2027-01-01")]), "xnpv"),
      "date_required",
    );
    expectErrorReason(
      xnpvView(n(0), vector([n(-100), n(110)]), rowVector([date("2026-01-01"), date("2027-01-01")]), "xnpv"),
      "shape_mismatch",
    );
    expectErrorReason(
      xnpvView(n(0), vector([n(-100), n(110)]), vector([date("2026-01-01"), date("2027-02-29")]), "xnpv"),
      "invalid_date_value",
    );
  });

  it("evaluates dated cash-flow functions using first-date anchor and a 365-day year", () => {
    // Edge-case category: dated cash flows.
    // XNPV anchors on the first supplied date, not the earliest date. XIRR uses 365-day
    // exponents, so a leap-year 366-day span is close to but not exactly a 10% annual IRR.
    expectNumber(
      xnpvView(
        n(0.1),
        vector([n(100), n(-90)]),
        vector([date("2026-02-01"), date("2026-01-01")]),
        "xnpv",
      ),
      100 - 90 * 1.1 ** (31 / 365),
    );

    expectNumber(
      xnpvView(
        n(0.1),
        vector([n(-100), n(110)]),
        vector([date("2026-01-01"), date("2027-01-01")]),
        "xnpv",
      ),
      0,
    );
    expectNumber(
      xirrView(
        vector([n(-100), n(110)]),
        vector([date("2026-01-01"), date("2027-01-01")]),
        "xirr",
      ),
      0.1,
    );

    const leapSpanRate = 1.1 ** (365 / 366) - 1;
    expectNumber(
      xirrView(
        vector([n(-100), n(110)]),
        vector([date("2024-01-01"), date("2025-01-01")]),
        "xirr",
      ),
      leapSpanRate,
    );
    expectNumber(
      xnpvView(
        n(0.1),
        vector([n(-100), n(110)]),
        vector([date("2024-01-01"), date("2025-01-01")]),
        "xnpv",
      ),
      -100 + 110 / 1.1 ** (366 / 365),
    );
  });

  it("detects no-root and multiple-root XIRR cases", () => {
    // Edge-case category: dated root solving.
    // Same-date opposing cash flows can be sign-diverse but still rate-independent;
    // multi-turn dated cash flows can have more than one mathematically valid XIRR.
    expectErrorReason(
      xirrView(
        vector([n(-100), n(110)]),
        vector([date("2026-01-01"), date("2026-01-01")]),
        "xirr",
      ),
      "root_not_found",
    );
    expectErrorReason(
      xirrView(
        vector([n(-100), n(230), n(-132)]),
        vector([date("2026-01-01"), date("2027-01-01"), date("2028-01-01")]),
        "xirr",
      ),
      "multiple_roots",
    );
    expectErrorReason(
      xirrView(
        vector([n(100), n(110)]),
        vector([date("2026-01-01"), date("2027-01-01")]),
        "xirr",
      ),
      "missing_cashflow_sign",
    );
  });

  it("evaluates rate conversion and depreciation functions", () => {
    // Edge-case category: deterministic non-cash-flow financial math.
    // This covers period integer validation, depreciation-to-salvage limits,
    // Excel-compatible DB month adjustment, and effect/nominal round-trip behavior.
    const effective = effectValue(n(0.12), n(12), "effect");
    expectNumber(effective, (1 + 0.12 / 12) ** 12 - 1);
    expectNumber(nominalValue(effective, n(12), "nominal"), 0.12);
    expectErrorReason(effectValue(n(0.12), n(1.5), "effect"), "positive_integer_required");
    expectErrorReason(nominalValue(n(-1), n(12), "nominal"), "rate_out_of_range");

    expectNumber(slnValue(n(1000), n(100), n(5), "sln"), 180);
    const sydTotal = [1, 2, 3, 4, 5]
      .map((period) => numberOf(sydValue(n(1000), n(100), n(5), n(period), "syd")))
      .reduce((sum, value) => sum + value, 0);
    expect(sydTotal).toBeCloseTo(900);

    const ddbTotal = [1, 2, 3, 4, 5]
      .map((period) => numberOf(ddbValue(n(1000), n(100), n(5), n(period), null, "ddb")))
      .reduce((sum, value) => sum + value, 0);
    expect(ddbTotal).toBeCloseTo(900);

    const dbRate = Math.round((1 - (100 / 1000) ** (1 / 5)) * 1000) / 1000;
    expectNumber(dbValue(n(1000), n(100), n(5), n(1), n(7), "db"), 1000 * dbRate * 7 / 12);
    expectErrorReason(dbValue(n(1000), n(100), n(5), n(1), n(13), "db"), "month_out_of_range");
    expectErrorReason(slnValue(n(1000), n(1001), n(5), "sln"), "salvage_exceeds_cost");
  });

  it("evaluates financial formulas inside spreadsheets", () => {
    // Edge-case category: formula integration.
    // Formula vector literals are future work in RFC-0031, so spreadsheet formulas
    // consume table ranges here. This verifies parser -> registry -> evaluator -> view paths.
    const doc = `
# Financial
| Item || Cashflow | Date | Result |
| ---- || -------- | ---- | ------ |
| A || -100 | 2026-01-01 | |
| B || 30 | 2026-06-01 | |
| C || 40 | 2027-01-01 | |
| D || 50 | 2027-06-01 | |
| PMT || | | = pmt(0.05, 10, -1000) |
| PV || | | = pv(0.05, 10, @[PMT,Result]) |
| FV || | | = fv(0.05, 10, @[PMT,Result], -1000) |
| Rate || | | = rate(10, @[PMT,Result], -1000) |
| NPV || | | = npv(0.1, @[#3:#5,Cashflow]) |
| IRR || | | = irr(@[#2:#5,Cashflow]) |
| MIRR || | | = mirr(@[#2:#5,Cashflow], 0.08, 0.12) |
| XNPV || | | = xnpv(0.1, @[#2:#5,Cashflow], @[#2:#5,Date]) |
| XIRR || | | = xirr(@[#2:#5,Cashflow], @[#2:#5,Date]) |
| EFFECT || | | = effect(0.12, 12) |
| NOMINAL || | | = nominal(@[EFFECT,Result], 12) |
| SLN || | | = sln(1000, 100, 5) |
| SYD || | | = syd(1000, 100, 5, 1) |
| DB || | | = db(1000, 100, 5, 1, 7) |
| DDB || | | = ddb(1000, 100, 5, 5) |
| IRRMultipleRoots || | | = irr(@[MR1:MR3,Cashflow]) |
| BadVector || | | = irr(@[#2:#5,Cashflow:Date]) |
| MR1 || -100 | | |
| MR2 || 230 | | |
| MR3 || -132 | | |
`.trim();

    expectCellNumber(doc, "PMT", "Result", 129.50457496545661);
    expectCellNumber(doc, "PV", "Result", -1000);
    expectCellNumber(doc, "FV", "Result", 0);
    expectCellNumber(doc, "Rate", "Result", 0.05);
    expectCellNumber(doc, "NPV", "Result", 30 / 1.1 + 40 / 1.1 ** 2 + 50 / 1.1 ** 3);
    expectCellNumber(doc, "IRR", "Result", 0.08896339469335035);
    expectCellNumber(doc, "MIRR", "Result", ((30 * 1.12 ** 2 + 40 * 1.12 + 50) / 100) ** (1 / 3) - 1);
    expectCellNumber(
      doc,
      "XNPV",
      "Result",
      -100 + 30 / 1.1 ** (151 / 365) + 40 / 1.1 + 50 / 1.1 ** (516 / 365),
    );
    expect(cellValue(doc, "XIRR", "Result").kind).toBe("number");
    expectCellNumber(doc, "EFFECT", "Result", (1 + 0.12 / 12) ** 12 - 1);
    expectCellNumber(doc, "NOMINAL", "Result", 0.12);
    expectCellNumber(doc, "SLN", "Result", 180);
    expectCellNumber(doc, "SYD", "Result", 300);
    expectCellNumber(doc, "DB", "Result", 1000 * (Math.round((1 - (100 / 1000) ** (1 / 5)) * 1000) / 1000) * 7 / 12);
    expectCellNumber(doc, "DDB", "Result", 29.6);
    expectCellErrorReason(doc, "IRRMultipleRoots", "Result", "multiple_roots");
    expectCellErrorReason(doc, "BadVector", "Result", "vector_required");
  });

  it("evaluates financial formula names case-insensitively", () => {
    // Edge-case category: registry integration aliases.
    // The registry is case-insensitive, so Excel/Numbers-style uppercase spelling
    // reaches the same canonical financial definitions.
    const doc = `
# FinancialCase
| Item || Cashflow | Result |
| ---- || -------- | ------ |
| A || -100 | |
| B || 30 | |
| C || 40 | |
| D || 50 | |
| UpperIRR || | = IRR(@[#2:#5,Cashflow]) |
| UpperPMT || | = PMT(0.05, 10, -1000) |
`.trim();

    expectCellNumber(doc, "UpperIRR", "Result", 0.08896339469335035);
    expectCellNumber(doc, "UpperPMT", "Result", 129.50457496545661);
  });
});
