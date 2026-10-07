import { betaProbability, continuousQuantile, discreteQuantile, gammaProbability,
  logBeta, logChoose, logGamma, positiveQuantile, NumericalConvergenceError } from "./specialMath";
import { numericDomainError, scalarNumericFunction, type NumericParameter } from "./scalarNumeric";
import type { RuntimeValue } from "../types";

type Operation = "Pdf" | "Pmf" | "Cdf" | "Sf" | "Inv" | "Isf" | "TwoTail" | "TwoTailInv";
export interface DistributionFamily {
  name: string; parameters: NumericParameter[];
  operations: Partial<Record<Operation, (values: readonly number[]) => number>>;
  valid: (values: readonly number[], inverse: boolean, operation: Operation) => boolean;
}
const p = (name: string, value?: number): NumericParameter => ({ name, summary: `Distribution ${name}.`,
  ...(value === undefined ? {} : { default: value }) });
const count = (x: number) => Number.isSafeInteger(x) && x >= 0;
const probability = (x: number) => x >= 0 && x <= 1;
const interior = (x: number) => x > 0 && x < 1;
const lowerInverse = (x: number) => x >= 0 && x < 1;
const upperInverse = (x: number) => x > 0 && x <= 1;
const gammaInv = (p: number, shape: number, scale: number, upper = false): number => {
  if (upper ? p === 1 : p === 0) return 0;
  const survival = upper || p > 0.5, target = upper ? p : survival ? 1 - p : p;
  return scale * positiveQuantile(target, x => gammaProbability(shape, x, survival), survival);
};
const betaInv = (p: number, a: number, b: number): number => p === 0 ? 0 : p === 1 ? 1
  : p > 0.5 ? 1 - continuousQuantile(1 - p, x => betaProbability(x, b, a), 0, 1)
  : continuousQuantile(p, x => betaProbability(x, a, b), 0, 1);
const tTail = (x: number, df: number) => betaProbability(df / (df + x * x), df / 2, 0.5) / 2;
const tSf = (x: number, df: number) => x >= 0 ? tTail(x, df) : 1 - tTail(x, df);
const tInv = (p: number, df: number) => p === 0.5 ? 0 : (p < 0.5 ? -1 : 1)
  * positiveQuantile(p < 0.5 ? p : 1 - p, x => tTail(x, df), true);
const fProbability = (x: number, d1: number, d2: number, upper = false) => {
  const ratio = d1 / d2 * x;
  // Standardize from the nearer endpoint: rounding a tiny lower-tail argument
  // to 1 in its complementary coordinate would erase the probability.
  return ratio <= 1 ? betaProbability(ratio / (1 + ratio), d1 / 2, d2 / 2, upper)
    : betaProbability(1 / (1 + ratio), d2 / 2, d1 / 2, !upper);
};
const fInv = (p: number, d1: number, d2: number, upper = false) => {
  if (upper ? p === 1 : p === 0) return 0;
  const survival = upper || p > 0.5, target = upper ? p : survival ? 1 - p : p;
  return positiveQuantile(target, x => fProbability(x, d1, d2, survival), survival);
};
const binomialCdf = (k: number, n: number, p: number) => k < 0 ? 0 : k >= n || p === 0 ? 1
  : p === 1 ? 0 : betaProbability(p, k + 1, n - k, true);
const binomialSf = (k: number, n: number, p: number) => k < 0 ? 1 : k >= n || p === 0 ? 0
  : p === 1 ? 1 : betaProbability(p, k + 1, n - k);
const binomialPmf = (k: number, n: number, p: number) => p === 0 ? k === 0 ? 1 : 0
  : p === 1 ? k === n ? 1 : 0 : Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));

export const distributionFamilies: readonly DistributionFamily[] = [
  { name: "beta", parameters: [p("alpha"), p("beta"), p("lower", 0), p("upper", 1)],
    valid: ([x, a, b, low, high], inverse) => a > 0 && b > 0 && high > low
      && (inverse ? probability(x) : x >= low && x <= high),
    operations: {
      Pdf: ([x, a, b, low, high]) => {
        const z = (x - low) / (high - low);
        return Math.exp((a === 1 ? 0 : (a - 1) * Math.log(z))
          + (b === 1 ? 0 : (b - 1) * Math.log1p(-z)) - logBeta(a, b)) / (high - low);
      },
      Cdf: ([x, a, b, low, high]) => betaProbability((x - low) / (high - low), a, b),
      Inv: ([x, a, b, low, high]) => low + (high - low) * betaInv(x, a, b),
    } },
  { name: "gamma", parameters: [p("shape"), p("scale")],
    valid: ([x, a, b], inverse) => a > 0 && b > 0 && (inverse ? lowerInverse(x) : x >= 0),
    operations: {
      Pdf: ([x, a, b]) => x === 0 ? a === 1 ? 1 / b : a > 1 ? 0 : Infinity
        : Math.exp((a - 1) * Math.log(x / b) - x / b - logGamma(a)) / b,
      Cdf: ([x, a, b]) => gammaProbability(a, x / b), Inv: ([x, a, b]) => gammaInv(x, a, b),
    } },
  { name: "exponential", parameters: [p("rate")],
    valid: ([x, rate]) => x >= 0 && rate > 0,
    operations: { Pdf: ([x, rate]) => rate * Math.exp(-rate * x), Cdf: ([x, rate]) => -Math.expm1(-rate * x) } },
  { name: "weibull", parameters: [p("shape"), p("scale")],
    valid: ([x, a, b]) => x >= 0 && a > 0 && b > 0,
    operations: {
      Pdf: ([x, a, b]) => x === 0 ? a === 1 ? 1 / b : a > 1 ? 0 : Infinity
        : Math.exp(Math.log(a / b) + (a - 1) * Math.log(x / b) - (x / b) ** a),
      Cdf: ([x, a, b]) => -Math.expm1(-((x / b) ** a)),
    } },
  { name: "chiSquare", parameters: [p("df")],
    valid: ([x, df], inverse, op) => count(df) && df > 0 && (inverse ? op === "Isf" ? upperInverse(x) : lowerInverse(x) : x >= 0),
    operations: {
      Pdf: ([x, df]) => x === 0 ? df === 2 ? 0.5 : df > 2 ? 0 : Infinity
        : Math.exp((df / 2 - 1) * Math.log(x / 2) - x / 2 - logGamma(df / 2)) / 2,
      Cdf: ([x, df]) => gammaProbability(df / 2, x / 2), Sf: ([x, df]) => gammaProbability(df / 2, x / 2, true),
      Inv: ([x, df]) => gammaInv(x, df / 2, 2), Isf: ([x, df]) => gammaInv(x, df / 2, 2, true),
    } },
  { name: "studentT", parameters: [p("df")],
    valid: ([x, df], inverse, op) => count(df) && df > 0
      && (inverse ? op === "TwoTailInv" ? upperInverse(x) : interior(x) : op !== "TwoTail" || x >= 0),
    operations: {
      Pdf: ([x, df]) => Math.exp(logGamma((df + 1) / 2) - logGamma(df / 2)
        - Math.log(df * Math.PI) / 2 - (df + 1) / 2 * Math.log1p(x * x / df)),
      Cdf: ([x, df]) => x < 0 ? tTail(x, df) : 1 - tTail(x, df), Sf: ([x, df]) => tSf(x, df),
      Inv: ([x, df]) => tInv(x, df),
      TwoTail: ([x, df]) => 2 * tTail(x, df),
      TwoTailInv: ([x, df]) => x === 1 ? 0 : positiveQuantile(x / 2, z => tTail(z, df), true),
    } },
  { name: "f", parameters: [p("df1"), p("df2")],
    valid: ([x, d1, d2], inverse, op) => count(d1) && count(d2) && d1 > 0 && d2 > 0
      && (inverse ? op === "Isf" ? upperInverse(x) : lowerInverse(x) : x >= 0),
    operations: {
      Pdf: ([x, d1, d2]) => x === 0 ? d1 === 2 ? 1 : d1 > 2 ? 0 : Infinity
        : Math.exp(d1 / 2 * Math.log(d1 / d2) + (d1 / 2 - 1) * Math.log(x)
          - logBeta(d1 / 2, d2 / 2) - (d1 + d2) / 2 * Math.log1p(d1 / d2 * x)),
      Cdf: ([x, d1, d2]) => fProbability(x, d1, d2), Sf: ([x, d1, d2]) => fProbability(x, d1, d2, true),
      Inv: ([x, d1, d2]) => fInv(x, d1, d2), Isf: ([x, d1, d2]) => fInv(x, d1, d2, true),
    } },
  { name: "binomial", parameters: [p("trials"), p("probability")],
    valid: ([x, n, p], inverse) => count(n) && probability(p) && (inverse ? probability(x) : count(x) && x <= n),
    operations: { Pmf: ([k, n, p]) => binomialPmf(k, n, p), Cdf: ([k, n, p]) => binomialCdf(k, n, p),
      Inv: ([p, n, chance]) => discreteQuantile(p, n, k => binomialCdf(k, n, chance)) } },
  { name: "poisson", parameters: [p("mean")],
    valid: ([x, mean]) => count(x) && mean >= 0,
    operations: { Pmf: ([k, mean]) => mean === 0 ? k === 0 ? 1 : 0 : Math.exp(k * Math.log(mean) - mean - logGamma(k + 1)),
      Cdf: ([k, mean]) => gammaProbability(k + 1, mean, true) } },
  { name: "negativeBinomial", parameters: [p("successes"), p("probability")],
    valid: ([x, successes, p]) => count(x) && count(successes) && successes > 0 && p > 0 && p <= 1,
    operations: {
      Pmf: ([k, r, p]) => p === 1 ? k === 0 ? 1 : 0 : Math.exp(logChoose(k + r - 1, k) + r * Math.log(p) + k * Math.log1p(-p)),
      Cdf: ([k, r, p]) => betaProbability(p, r, k + 1),
    } },
  { name: "hypergeometric", parameters: [p("draws"), p("successes"), p("population")],
    valid: ([k, n, m, total]) => [k, n, m, total].every(count) && total > 0 && n <= total && m <= total
      && k >= Math.max(0, n - (total - m)) && k <= Math.min(n, m),
    operations: {
      Pmf: ([k, n, m, total]) => Math.exp(logChoose(m, k) + logChoose(total - m, n - k) - logChoose(total, n)),
      Cdf: ([k, n, m, total]) => {
        const lower = Math.max(0, n - (total - m));
        if (k === Math.min(n, m)) return 1;
        if (k - lower + 1 > 10000) throw new NumericalConvergenceError("hypergeometric_sum");
        let sum = 0;
        for (let i = lower; i <= k; i++) sum += Math.exp(logChoose(m, i) + logChoose(total - m, n - i) - logChoose(total, n));
        return sum;
      },
    } },
];

export const additionalDistributionDefinitions = distributionFamilies.flatMap(family =>
  Object.entries(family.operations).map(([operation, calculate]) => scalarNumericFunction({
    name: `${family.name}${operation}`, category: "statistical", summary: `${operation} of the ${family.name} distribution.`,
    parameters: [p(operation.endsWith("Inv") || operation === "Isf" ? "probability" : "x"), ...family.parameters],
    examples: [], calculate: (args, fn): number | RuntimeValue => family.valid(args,
      operation.endsWith("Inv") || operation === "Isf", operation as Operation)
      ? calculate!(args) : numericDomainError(fn, "invalid_distribution_domain"),
  }))).concat([
    scalarNumericFunction({ name: "binomialRange", category: "statistical", summary: "Inclusive binomial probability between two counts.",
      parameters: [p("trials"), p("probability"), p("lower"), { name: "upper", summary: "Inclusive upper count; defaults to lower.", defaultFrom: 2 }],
      examples: [], calculate: ([n, chance, low, high], fn) => {
        if (!count(n) || !probability(chance) || !count(low) || !count(high) || low > high || high > n)
          return numericDomainError(fn, "invalid_distribution_domain");
        return binomialCdf(low - 1, n, chance) > 0.5
          ? binomialSf(low - 1, n, chance) - binomialSf(high, n, chance)
          : binomialCdf(high, n, chance) - binomialCdf(low - 1, n, chance);
      } }),
  ]);
export const studentTTailDefinition = scalarNumericFunction({ name: "studentTTail", category: "statistical",
  summary: "One- or two-tailed probability at a nonnegative Student t statistic.",
  parameters: [p("x"), p("df"), p("tails")], examples: [],
  calculate: ([x, df, tails], fn) => x >= 0 && count(df) && df > 0 && (tails === 1 || tails === 2)
    ? tails * tTail(x, df) : numericDomainError(fn, "invalid_tail_parameters") });
