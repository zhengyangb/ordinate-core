import { isError, makeInternalError } from "../errors";
import type { RuntimeValue, RuntimeView } from "../types";
import { runtimeViewShapesMatch } from "../view";
import { viewValues } from "./aggregates";

const ROOT_MIN_RATE = -0.999999999;
const ROOT_MAX_RATE = 1_000_000;
const ROOT_TOLERANCE = 1e-10;
const ROOT_MAX_ITERATIONS = 200;
const ROOT_SCAN_STEPS = 400;
const MS_PER_DAY = 86_400_000;

type Result<T> = { ok: true; value: T } | { ok: false; error: RuntimeValue };
type PaymentType = 0 | 1;
type PeriodPaymentArgs = { rate: number; per: number; nper: number; pv: number; fv: number; type: PaymentType };
type PairedCashflowDates = { values: number[]; days: number[] };

type RootSolveResult =
  | { ok: true; value: number }
  | { ok: false; reason: string; rootsFound?: number };

export function fvValue(rate: RuntimeValue, nper: RuntimeValue, pmt: RuntimeValue, pv: RuntimeValue | null, type: RuntimeValue | null, functionName: string): RuntimeValue {
  const args = financialArgs(functionName, { rate, nper, pmt, pv: pv ?? numberValue(0), type: type ?? numberValue(0) });
  if (!args.ok) return args.error;
  const payment = paymentType(args.value.type, functionName);
  if (!payment.ok) return payment.error;
  return finiteResult(fvNumber(args.value.rate, args.value.nper, args.value.pmt, args.value.pv, payment.value), functionName);
}

export function pvValue(rate: RuntimeValue, nper: RuntimeValue, pmt: RuntimeValue, fv: RuntimeValue | null, type: RuntimeValue | null, functionName: string): RuntimeValue {
  const args = financialArgs(functionName, { rate, nper, pmt, fv: fv ?? numberValue(0), type: type ?? numberValue(0) });
  if (!args.ok) return args.error;
  const payment = paymentType(args.value.type, functionName);
  if (!payment.ok) return payment.error;
  return finiteResult(pvNumber(args.value.rate, args.value.nper, args.value.pmt, args.value.fv, payment.value), functionName);
}

export function pmtValue(rate: RuntimeValue, nper: RuntimeValue, pv: RuntimeValue, fv: RuntimeValue | null, type: RuntimeValue | null, functionName: string): RuntimeValue {
  const args = financialArgs(functionName, { rate, nper, pv, fv: fv ?? numberValue(0), type: type ?? numberValue(0) });
  if (!args.ok) return args.error;
  if (args.value.nper === 0) return invalid(functionName, "zero_period_count");
  const payment = paymentType(args.value.type, functionName);
  if (!payment.ok) return payment.error;
  return finiteResult(pmtNumber(args.value.rate, args.value.nper, args.value.pv, args.value.fv, payment.value), functionName);
}

export function nperValue(rate: RuntimeValue, pmt: RuntimeValue, pv: RuntimeValue, fv: RuntimeValue | null, type: RuntimeValue | null, functionName: string): RuntimeValue {
  const args = financialArgs(functionName, { rate, pmt, pv, fv: fv ?? numberValue(0), type: type ?? numberValue(0) });
  if (!args.ok) return args.error;
  const payment = paymentType(args.value.type, functionName);
  if (!payment.ok) return payment.error;
  if (args.value.rate === 0) {
    if (args.value.pmt === 0) return invalid(functionName, "zero_payment");
    return finiteResult(-(args.value.pv + args.value.fv) / args.value.pmt, functionName);
  }
  if (args.value.rate <= -1) return invalid(functionName, "rate_out_of_range");
  const q = args.value.pmt * (1 + args.value.rate * payment.value) / args.value.rate;
  const term = (q - args.value.fv) / (args.value.pv + q);
  if (term <= 0) return invalid(functionName, "no_real_solution");
  return finiteResult(Math.log(term) / Math.log(1 + args.value.rate), functionName);
}

export function rateValue(nper: RuntimeValue, pmt: RuntimeValue, pv: RuntimeValue, fv: RuntimeValue | null, type: RuntimeValue | null, functionName: string): RuntimeValue {
  const args = financialArgs(functionName, { nper, pmt, pv, fv: fv ?? numberValue(0), type: type ?? numberValue(0) });
  if (!args.ok) return args.error;
  if (args.value.nper <= 0) return invalid(functionName, "non_positive_period_count");
  const payment = paymentType(args.value.type, functionName);
  if (!payment.ok) return payment.error;
  const solved = solveFinancialRoot((rate) => tvmEquation(rate, args.value.nper, args.value.pmt, args.value.pv, args.value.fv, payment.value));
  if (!solved.ok) return invalid(functionName, solved.reason, solved.rootsFound === undefined ? {} : { rootsFound: solved.rootsFound });
  return finiteResult(solved.value, functionName);
}

export function ipmtValue(rate: RuntimeValue, per: RuntimeValue, nper: RuntimeValue, pv: RuntimeValue, fv: RuntimeValue | null, type: RuntimeValue | null, functionName: string): RuntimeValue {
  const args = periodPaymentArgs(rate, per, nper, pv, fv, type, functionName);
  if (!args.ok) return args.error;
  const payment = pmtNumber(args.value.rate, args.value.nper, args.value.pv, args.value.fv, args.value.type);
  return finiteResult(ipmtNumber(args.value.rate, args.value.per, args.value.nper, args.value.pv, args.value.fv, args.value.type, payment), functionName);
}

export function ppmtValue(rate: RuntimeValue, per: RuntimeValue, nper: RuntimeValue, pv: RuntimeValue, fv: RuntimeValue | null, type: RuntimeValue | null, functionName: string): RuntimeValue {
  const args = periodPaymentArgs(rate, per, nper, pv, fv, type, functionName);
  if (!args.ok) return args.error;
  const payment = pmtNumber(args.value.rate, args.value.nper, args.value.pv, args.value.fv, args.value.type);
  return finiteResult(payment - ipmtNumber(args.value.rate, args.value.per, args.value.nper, args.value.pv, args.value.fv, args.value.type, payment), functionName);
}

export function cumipmtValue(rate: RuntimeValue, nper: RuntimeValue, pv: RuntimeValue, startPeriod: RuntimeValue, endPeriod: RuntimeValue, type: RuntimeValue | null, functionName: string): RuntimeValue {
  return cumulativePaymentValue("interest", rate, nper, pv, startPeriod, endPeriod, type, functionName);
}

export function cumprincValue(rate: RuntimeValue, nper: RuntimeValue, pv: RuntimeValue, startPeriod: RuntimeValue, endPeriod: RuntimeValue, type: RuntimeValue | null, functionName: string): RuntimeValue {
  return cumulativePaymentValue("principal", rate, nper, pv, startPeriod, endPeriod, type, functionName);
}

export function ispmtValue(rate: RuntimeValue, per: RuntimeValue, nper: RuntimeValue, pv: RuntimeValue, functionName: string): RuntimeValue {
  const args = financialArgs(functionName, { rate, per, nper, pv });
  if (!args.ok) return args.error;
  const period = positiveInteger(args.value.per, functionName, "per");
  if (!period.ok) return period.error;
  if (args.value.nper <= 0) return invalid(functionName, "non_positive_period_count");
  if (period.value > args.value.nper) return invalid(functionName, "period_out_of_range");
  return finiteResult(args.value.pv * args.value.rate * (period.value / args.value.nper - 1), functionName);
}

export function npvView(rate: RuntimeValue, view: RuntimeView, functionName: string): RuntimeValue {
  const rateNumber = financialNumber(rate, functionName, "rate");
  if (!rateNumber.ok) return rateNumber.error;
  if (rateNumber.value <= -1) return invalid(functionName, "rate_out_of_range");
  const values = numericViewValues(view, functionName, { requireVector: true });
  if (!values.ok) return values.error;
  return finiteResult(npvPeriodic(rateNumber.value, values.value, 1), functionName);
}

export function irrView(view: RuntimeView, functionName: string): RuntimeValue {
  const values = numericViewValues(view, functionName, { requireVector: true });
  if (!values.ok) return values.error;
  const signIssue = requirePositiveAndNegative(values.value, functionName);
  if (signIssue) return signIssue;
  const solved = solveFinancialRoot((rate) => npvPeriodic(rate, values.value, 0));
  if (!solved.ok) return invalid(functionName, solved.reason, solved.rootsFound === undefined ? {} : { rootsFound: solved.rootsFound });
  return finiteResult(solved.value, functionName);
}

export function mirrView(view: RuntimeView, financeRate: RuntimeValue, reinvestRate: RuntimeValue, functionName: string): RuntimeValue {
  const finance = financialNumber(financeRate, functionName, "financeRate");
  if (!finance.ok) return finance.error;
  const reinvest = financialNumber(reinvestRate, functionName, "reinvestRate");
  if (!reinvest.ok) return reinvest.error;
  if (finance.value <= -1 || reinvest.value <= -1) return invalid(functionName, "rate_out_of_range");
  const values = numericViewValues(view, functionName, { requireVector: true });
  if (!values.ok) return values.error;
  const signIssue = requirePositiveAndNegative(values.value, functionName);
  if (signIssue) return signIssue;
  if (values.value.length < 2) return invalid(functionName, "insufficient_cashflows");

  let positiveFutureValue = 0;
  let negativePresentValue = 0;
  const last = values.value.length - 1;
  for (let i = 0; i < values.value.length; i += 1) {
    const cashflow = values.value[i];
    if (cashflow > 0) positiveFutureValue += cashflow * (1 + reinvest.value) ** (last - i);
    if (cashflow < 0) negativePresentValue += cashflow / (1 + finance.value) ** i;
  }
  if (negativePresentValue === 0 || positiveFutureValue === 0) return invalid(functionName, "missing_cashflow_sign");
  return finiteResult((-positiveFutureValue / negativePresentValue) ** (1 / last) - 1, functionName);
}

export function xnpvView(rate: RuntimeValue, valuesView: RuntimeView, datesView: RuntimeView, functionName: string): RuntimeValue {
  const rateNumber = financialNumber(rate, functionName, "rate");
  if (!rateNumber.ok) return rateNumber.error;
  if (rateNumber.value <= -1) return invalid(functionName, "rate_out_of_range");
  const pair = pairedCashflowDates(valuesView, datesView, functionName);
  if (!pair.ok) return pair.error;
  return finiteResult(xnpvNumber(rateNumber.value, pair.value.values, pair.value.days), functionName);
}

export function xirrView(valuesView: RuntimeView, datesView: RuntimeView, functionName: string): RuntimeValue {
  const pair = pairedCashflowDates(valuesView, datesView, functionName);
  if (!pair.ok) return pair.error;
  const signIssue = requirePositiveAndNegative(pair.value.values, functionName);
  if (signIssue) return signIssue;
  const solved = solveFinancialRoot((rate) => xnpvNumber(rate, pair.value.values, pair.value.days));
  if (!solved.ok) return invalid(functionName, solved.reason, solved.rootsFound === undefined ? {} : { rootsFound: solved.rootsFound });
  return finiteResult(solved.value, functionName);
}

export function effectValue(nominalRate: RuntimeValue, npery: RuntimeValue, functionName: string): RuntimeValue {
  const args = financialArgs(functionName, { nominalRate, npery });
  if (!args.ok) return args.error;
  const periods = positiveInteger(args.value.npery, functionName, "npery");
  if (!periods.ok) return periods.error;
  return finiteResult((1 + args.value.nominalRate / periods.value) ** periods.value - 1, functionName);
}

export function nominalValue(effectRate: RuntimeValue, npery: RuntimeValue, functionName: string): RuntimeValue {
  const args = financialArgs(functionName, { effectRate, npery });
  if (!args.ok) return args.error;
  if (args.value.effectRate <= -1) return invalid(functionName, "rate_out_of_range");
  const periods = positiveInteger(args.value.npery, functionName, "npery");
  if (!periods.ok) return periods.error;
  return finiteResult(periods.value * ((1 + args.value.effectRate) ** (1 / periods.value) - 1), functionName);
}

export function slnValue(cost: RuntimeValue, salvage: RuntimeValue, life: RuntimeValue, functionName: string): RuntimeValue {
  const args = depreciationArgs(functionName, { cost, salvage, life });
  if (!args.ok) return args.error;
  return finiteResult((args.value.cost - args.value.salvage) / args.value.life, functionName);
}

export function sydValue(cost: RuntimeValue, salvage: RuntimeValue, life: RuntimeValue, period: RuntimeValue, functionName: string): RuntimeValue {
  const args = depreciationArgs(functionName, { cost, salvage, life, period });
  if (!args.ok) return args.error;
  const periodValue = positiveInteger(args.value.period, functionName, "period");
  if (!periodValue.ok) return periodValue.error;
  if (periodValue.value > args.value.life) return invalid(functionName, "period_out_of_range");
  return finiteResult((args.value.cost - args.value.salvage) * (args.value.life - periodValue.value + 1) * 2 / (args.value.life * (args.value.life + 1)), functionName);
}

export function ddbValue(cost: RuntimeValue, salvage: RuntimeValue, life: RuntimeValue, period: RuntimeValue, factor: RuntimeValue | null, functionName: string): RuntimeValue {
  const args = depreciationArgs(functionName, { cost, salvage, life, period, factor: factor ?? numberValue(2) });
  if (!args.ok) return args.error;
  const periodValue = positiveInteger(args.value.period, functionName, "period");
  if (!periodValue.ok) return periodValue.error;
  if (periodValue.value > args.value.life) return invalid(functionName, "period_out_of_range");
  if (args.value.factor <= 0) return invalid(functionName, "non_positive_factor");
  let accumulated = 0;
  let current = 0;
  for (let p = 1; p <= periodValue.value; p += 1) {
    current = Math.min((args.value.cost - accumulated) * (args.value.factor / args.value.life), args.value.cost - args.value.salvage - accumulated);
    if (current < 0) current = 0;
    accumulated += current;
  }
  return finiteResult(current, functionName);
}

export function dbValue(cost: RuntimeValue, salvage: RuntimeValue, life: RuntimeValue, period: RuntimeValue, month: RuntimeValue | null, functionName: string): RuntimeValue {
  const args = depreciationArgs(functionName, { cost, salvage, life, period, month: month ?? numberValue(12) });
  if (!args.ok) return args.error;
  const periodValue = positiveInteger(args.value.period, functionName, "period");
  if (!periodValue.ok) return periodValue.error;
  const monthValue = positiveInteger(args.value.month, functionName, "month");
  if (!monthValue.ok) return monthValue.error;
  if (monthValue.value < 1 || monthValue.value > 12) return invalid(functionName, "month_out_of_range");
  const maxPeriod = monthValue.value === 12 ? args.value.life : args.value.life + 1;
  if (periodValue.value > maxPeriod) return invalid(functionName, "period_out_of_range");
  const rate = roundToPlaces(1 - (args.value.salvage / args.value.cost) ** (1 / args.value.life), 3);
  let accumulated = 0;
  let current = 0;
  for (let p = 1; p <= periodValue.value; p += 1) {
    if (p === 1) {
      current = args.value.cost * rate * monthValue.value / 12;
    } else if (p === args.value.life + 1) {
      current = (args.value.cost - accumulated) * rate * (12 - monthValue.value) / 12;
    } else {
      current = (args.value.cost - accumulated) * rate;
    }
    current = Math.min(current, args.value.cost - args.value.salvage - accumulated);
    if (current < 0) current = 0;
    accumulated += current;
  }
  return finiteResult(current, functionName);
}

export function solveFinancialRoot(fn: (rate: number) => number): RootSolveResult {
  const brackets: Array<[number, number]> = [];
  const candidates = rootScanCandidates();
  let previousRate: number | null = null;
  let previousValue: number | null = null;
  for (const rate of candidates) {
    const value = fn(rate);
    if (!Number.isFinite(value)) {
      previousRate = null;
      previousValue = null;
      continue;
    }
    if (Math.abs(value) <= ROOT_TOLERANCE) {
      brackets.push([rate, rate]);
    } else if (previousRate !== null && previousValue !== null && previousValue * value < 0) {
      brackets.push([previousRate, rate]);
    }
    previousRate = rate;
    previousValue = value;
  }
  const distinct = distinctBrackets(brackets);
  if (distinct.length === 0) return { ok: false, reason: "root_not_found", rootsFound: 0 };
  if (distinct.length > 1) return { ok: false, reason: "multiple_roots", rootsFound: distinct.length };
  const [min, max] = distinct[0];
  if (min === max) return { ok: true, value: min };
  return bisectRoot(fn, min, max);
}

function cumulativePaymentValue(kind: "interest" | "principal", rate: RuntimeValue, nper: RuntimeValue, pv: RuntimeValue, startPeriod: RuntimeValue, endPeriod: RuntimeValue, type: RuntimeValue | null, functionName: string): RuntimeValue {
  const args = financialArgs(functionName, { rate, nper, pv, startPeriod, endPeriod, type: type ?? numberValue(0) });
  if (!args.ok) return args.error;
  if (args.value.nper <= 0) return invalid(functionName, "non_positive_period_count");
  const start = positiveInteger(args.value.startPeriod, functionName, "startPeriod");
  if (!start.ok) return start.error;
  const end = positiveInteger(args.value.endPeriod, functionName, "endPeriod");
  if (!end.ok) return end.error;
  if (start.value > end.value || end.value > args.value.nper) return invalid(functionName, "period_out_of_range");
  const paymentTypeValue = paymentType(args.value.type, functionName);
  if (!paymentTypeValue.ok) return paymentTypeValue.error;
  const payment = pmtNumber(args.value.rate, args.value.nper, args.value.pv, 0, paymentTypeValue.value);
  let total = 0;
  for (let period = start.value; period <= end.value; period += 1) {
    const interest = ipmtNumber(args.value.rate, period, args.value.nper, args.value.pv, 0, paymentTypeValue.value, payment);
    total += kind === "interest" ? interest : payment - interest;
  }
  return finiteResult(total, functionName);
}

function periodPaymentArgs(rate: RuntimeValue, per: RuntimeValue, nper: RuntimeValue, pv: RuntimeValue, fv: RuntimeValue | null, type: RuntimeValue | null, functionName: string): Result<PeriodPaymentArgs> {
  const args = financialArgs(functionName, { rate, per, nper, pv, fv: fv ?? numberValue(0), type: type ?? numberValue(0) });
  if (!args.ok) return args;
  if (args.value.nper <= 0) return err(invalid(functionName, "non_positive_period_count"));
  const period = positiveInteger(args.value.per, functionName, "per");
  if (!period.ok) return period;
  if (period.value > args.value.nper) return err(invalid(functionName, "period_out_of_range"));
  const payment = paymentType(args.value.type, functionName);
  if (!payment.ok) return payment;
  return ok({ rate: args.value.rate, per: period.value, nper: args.value.nper, pv: args.value.pv, fv: args.value.fv, type: payment.value });
}

function fvNumber(rate: number, nper: number, pmt: number, pv: number, type: PaymentType): number {
  if (rate === 0) return -(pv + pmt * nper);
  const term = (1 + rate) ** nper;
  return -(pv * term + pmt * (1 + rate * type) * (term - 1) / rate);
}

function pvNumber(rate: number, nper: number, pmt: number, fv: number, type: PaymentType): number {
  if (rate === 0) return -(fv + pmt * nper);
  const term = (1 + rate) ** nper;
  return -(fv + pmt * (1 + rate * type) * (term - 1) / rate) / term;
}

function pmtNumber(rate: number, nper: number, pv: number, fv: number, type: PaymentType): number {
  if (rate === 0) return -(fv + pv) / nper;
  const term = (1 + rate) ** nper;
  return -(fv + pv * term) * rate / ((1 + rate * type) * (term - 1));
}

function tvmEquation(rate: number, nper: number, pmt: number, pv: number, fv: number, type: PaymentType): number {
  if (rate <= -1) return Number.POSITIVE_INFINITY;
  if (Math.abs(rate) < 1e-14) return pv + pmt * nper + fv;
  const term = (1 + rate) ** nper;
  return pv * term + pmt * (1 + rate * type) * (term - 1) / rate + fv;
}

function ipmtNumber(rate: number, per: number, _nper: number, pv: number, _fv: number, type: PaymentType, payment: number): number {
  if (rate === 0) return 0;
  if (type === 1 && per === 1) return 0;
  const interestBase = type === 1
    ? fvNumber(rate, per - 2, payment, pv, type) - payment
    : fvNumber(rate, per - 1, payment, pv, type);
  return interestBase * rate;
}

function npvPeriodic(rate: number, values: readonly number[], firstPeriod: number): number {
  if (rate <= -1) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    total += values[i] / (1 + rate) ** (i + firstPeriod);
  }
  return total;
}

function xnpvNumber(rate: number, values: readonly number[], days: readonly number[]): number {
  if (rate <= -1) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    total += values[i] / (1 + rate) ** (days[i] / 365);
  }
  return total;
}

function numericViewValues(view: RuntimeView, functionName: string, options: { requireVector: boolean }): Result<number[]> {
  if (options.requireVector && view.dimension !== 1) {
    return err(invalid(functionName, "vector_required", { dimension: view.dimension }));
  }
  const values: number[] = [];
  for (const value of viewValues(view)) {
    if (isError(value)) return err(value);
    if (value.kind === "blank") continue;
    if (value.kind === "number") {
      if (!Number.isFinite(value.value)) return err(invalid(functionName, "non_finite_number"));
      values.push(value.value);
      continue;
    }
    if (value.kind === "boolean") {
      values.push(value.value ? 1 : 0);
      continue;
    }
    return err(invalid(functionName, "non_numeric_cashflow", { argumentKind: value.kind }));
  }
  if (values.length === 0) return err(invalid(functionName, "empty_numeric_input"));
  return ok(values);
}

function pairedCashflowDates(valuesView: RuntimeView, datesView: RuntimeView, functionName: string): Result<PairedCashflowDates> {
  if (valuesView.dimension !== 1 || datesView.dimension !== 1) return err(invalid(functionName, "vector_required"));
  if (!runtimeViewShapesMatch(valuesView, datesView)) return err(invalid(functionName, "shape_mismatch"));
  const values: number[] = [];
  const dates: number[] = [];
  for (let i = 0; i < valuesView.values.length; i += 1) {
    const value = valuesView.values[i];
    const date = datesView.values[i];
    if (isError(value)) return err(value);
    if (isError(date)) return err(date);
    if (value.kind === "blank" && date.kind === "blank") continue;
    if (value.kind === "blank" || date.kind === "blank") return err(invalid(functionName, "incomplete_cashflow_date_pair"));
    const cashflow = numericCashflow(value);
    if (cashflow === null || !Number.isFinite(cashflow)) return err(invalid(functionName, "non_numeric_cashflow", { argumentKind: value.kind }));
    if (date.kind !== "date") return err(invalid(functionName, "date_required", { argumentKind: date.kind }));
    const serial = dateSerialDay(date.value, functionName);
    if (!serial.ok) return serial;
    values.push(cashflow);
    dates.push(serial.value);
  }
  if (values.length === 0) return err(invalid(functionName, "empty_numeric_input"));
  const first = dates[0];
  return ok({ values, days: dates.map((date) => date - first) });
}

function financialArgs<T extends Record<string, RuntimeValue>>(functionName: string, values: T): Result<{ [K in keyof T]: number }> {
  const result: Record<string, number> = {};
  for (const [name, value] of Object.entries(values)) {
    const number = financialNumber(value, functionName, name);
    if (!number.ok) return number;
    result[name] = number.value;
  }
  return ok(result as { [K in keyof T]: number });
}

function depreciationArgs<T extends Record<string, RuntimeValue>>(functionName: string, values: T): Result<{ [K in keyof T]: number }> {
  const args = financialArgs(functionName, values);
  if (!args.ok) return args;
  if ("cost" in args.value && args.value.cost <= 0) return err(invalid(functionName, "non_positive_cost"));
  if ("salvage" in args.value && args.value.salvage < 0) return err(invalid(functionName, "negative_salvage"));
  if ("cost" in args.value && "salvage" in args.value && args.value.salvage > args.value.cost) return err(invalid(functionName, "salvage_exceeds_cost"));
  if ("life" in args.value && args.value.life <= 0) return err(invalid(functionName, "non_positive_life"));
  return args;
}

function financialNumber(value: RuntimeValue, functionName: string, argument: string): Result<number> {
  if (isError(value)) return err(value);
  if (value.kind !== "number") return err(invalid(functionName, "number_required", { argument, argumentKind: value.kind }));
  if (!Number.isFinite(value.value)) return err(invalid(functionName, "non_finite_number", { argument }));
  return ok(value.value);
}

function paymentType(value: number, functionName: string): Result<PaymentType> {
  if (value === 0 || value === 1) return ok(value);
  return err(invalid(functionName, "invalid_payment_type", { type: value }));
}

function positiveInteger(value: number, functionName: string, argument: string): Result<number> {
  if (!Number.isInteger(value) || value < 1) return err(invalid(functionName, "positive_integer_required", { argument, value }));
  return ok(value);
}

function requirePositiveAndNegative(values: readonly number[], functionName: string): RuntimeValue | null {
  const hasPositive = values.some((value) => value > 0);
  const hasNegative = values.some((value) => value < 0);
  return hasPositive && hasNegative ? null : invalid(functionName, "missing_cashflow_sign");
}

function rootScanCandidates(): number[] {
  const candidates: number[] = [];
  for (let i = 0; i <= ROOT_SCAN_STEPS; i += 1) {
    candidates.push(ROOT_MIN_RATE + (1 - ROOT_MIN_RATE) * (i / ROOT_SCAN_STEPS));
  }
  for (let i = 1; i <= ROOT_SCAN_STEPS; i += 1) {
    const t = i / ROOT_SCAN_STEPS;
    candidates.push(Math.exp((Math.log(ROOT_MAX_RATE) - Math.log(1)) * t));
  }
  return candidates;
}

function distinctBrackets(brackets: Array<[number, number]>): Array<[number, number]> {
  const distinct: Array<[number, number]> = [];
  for (const bracket of brackets) {
    const last = distinct[distinct.length - 1];
    if (!last || Math.abs(last[1] - bracket[0]) > ROOT_TOLERANCE) distinct.push(bracket);
  }
  return distinct;
}

function bisectRoot(fn: (rate: number) => number, min: number, max: number): RootSolveResult {
  let lo = min;
  let hi = max;
  let flo = fn(lo);
  let fhi = fn(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return { ok: false, reason: "invalid_root_bracket" };
  for (let iteration = 0; iteration < ROOT_MAX_ITERATIONS; iteration += 1) {
    const mid = (lo + hi) / 2;
    const fmid = fn(mid);
    if (!Number.isFinite(fmid)) return { ok: false, reason: "non_finite_root_evaluation" };
    if (Math.abs(fmid) <= ROOT_TOLERANCE || Math.abs(hi - lo) <= ROOT_TOLERANCE) return { ok: true, value: mid };
    if (flo * fmid <= 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  void fhi;
  return { ok: false, reason: "root_solver_did_not_converge" };
}

function dateSerialDay(value: string, functionName: string): Result<number> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return err(invalid(functionName, "invalid_date_value", { value }));
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return err(invalid(functionName, "invalid_date_value", { value }));
  }
  return ok(date.getTime() / MS_PER_DAY);
}

function numericCashflow(value: RuntimeValue): number | null {
  if (value.kind === "number") return value.value;
  if (value.kind === "boolean") return value.value ? 1 : 0;
  return null;
}

function finiteResult(value: number, functionName: string): RuntimeValue {
  if (!Number.isFinite(value)) return invalid(functionName, "non_finite_result");
  return { kind: "number", value: Object.is(value, -0) ? 0 : value };
}

function numberValue(value: number): RuntimeValue {
  return { kind: "number", value };
}

function invalid(functionName: string, reason: string, context: Record<string, unknown> = {}): RuntimeValue {
  return makeInternalError("invalid_function_call", { function: functionName, reason, ...context });
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err(error: RuntimeValue): Result<never> {
  return { ok: false, error };
}

function roundToPlaces(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
