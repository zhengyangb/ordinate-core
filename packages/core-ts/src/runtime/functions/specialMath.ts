/** Shared special-function kernels (DLMF 5, 8 and 15). Algorithm-domain
 * selection is not fallback. Nonconvergence is observable, never clipped. */
export class NumericalConvergenceError extends Error {}
const EPS = 8 * Number.EPSILON;
const TINY = 1e-300; // Modified Lentz denominator scale, not a probability floor.
const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.507343278686905, -0.13857109526572012,
  9.984369578019572e-6, 1.5056327351493116e-7];

export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let sum = 0.99999999999980993;
  for (let i = 0; i < coefficients.length; i++) sum += coefficients[i] / (z + i + 1);
  const t = z + 7.5;
  return 0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}
export function gamma(x: number): number {
  if (x < 0) return Math.PI / (Math.sin(Math.PI * x) * Math.exp(logGamma(1 - x)));
  return Math.exp(logGamma(x));
}
export const logBeta = (a: number, b: number): number => logGamma(a) + logGamma(b) - logGamma(a + b);

export function gammaProbability(a: number, x: number, upper = false): number {
  if (x === 0) return upper ? 1 : 0;
  if (x === Infinity) return upper ? 0 : 1;
  const scale = a * Math.log(x) - x - logGamma(a);
  if (x < a + 1) {
    let part = 1 / a, sum = part;
    for (let n = 1; n <= 10000; n++) {
      part *= x / (a + n); sum += part;
      if (Math.abs(part) <= Math.abs(sum) * EPS) {
        const logP = scale + Math.log(sum);
        return upper ? -Math.expm1(logP) : Math.exp(logP);
      }
    }
  } else {
    let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
    for (let n = 1; n <= 10000; n++) {
      const an = -n * (n - a); b += 2;
      d = an * d + b; c = b + an / c;
      if (Math.abs(d) < TINY) d = TINY;
      if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d; const delta = d * c; h *= delta;
      if (Math.abs(delta - 1) <= EPS) {
        const logQ = scale + Math.log(h);
        return upper ? Math.exp(logQ) : -Math.expm1(logQ);
      }
    }
  }
  throw new NumericalConvergenceError("regularized_gamma");
}

function betaFraction(a: number, b: number, x: number): number {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d; let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    for (const [step, aa] of [m * (b - m) * x / ((qam + m2) * (a + m2)),
      -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))].entries()) {
      d = 1 + aa * d; c = 1 + aa / c;
      if (Math.abs(d) < TINY) d = TINY;
      if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d; const delta = d * c; h *= delta;
      if (step === 1 && Math.abs(delta - 1) <= EPS) return h;
    }
  }
  throw new NumericalConvergenceError("regularized_beta");
}
export function betaProbability(x: number, a: number, b: number, upper = false): number {
  if (x === 0) return upper ? 1 : 0;
  if (x === 1) return upper ? 0 : 1;
  const reflected = x >= (a + 1) / (a + b + 2);
  const y = reflected ? 1 - x : x, aa = reflected ? b : a, bb = reflected ? a : b;
  const logTail = aa * Math.log(y) + bb * Math.log1p(-y) - logBeta(aa, bb)
    + Math.log(betaFraction(aa, bb, y) / aa);
  return upper === reflected ? Math.exp(logTail) : -Math.expm1(logTail);
}

/** Invert an increasing CDF or decreasing survival function. Bounds and target
 * are supplied by the distribution, so tails never subtract from one. */
export function continuousQuantile(p: number, probability: (x: number) => number,
  lower: number, upper: number, decreasing = false): number {
  let low = lower, high = upper;
  for (let i = 0; i < 1100; i++) {
    const middle = low + (high - low) / 2;
    if (middle === low || middle === high) return middle;
    const value = probability(middle);
    if (!Number.isFinite(value)) throw new NumericalConvergenceError("quantile_probability");
    if (value === p) return middle;
    if (decreasing ? value > p : value < p) low = middle; else high = middle;
  }
  throw new NumericalConvergenceError("continuous_quantile");
}
export function positiveQuantile(p: number, probability: (x: number) => number, decreasing = false): number {
  let high = 1;
  for (let i = 0; i < 1024; i++) {
    const value = probability(high);
    if (decreasing ? value <= p : value >= p) return continuousQuantile(p, probability, 0, high, decreasing);
    high *= 2;
    if (!Number.isFinite(high)) break;
  }
  throw new NumericalConvergenceError("quantile_bracket");
}
export function discreteQuantile(p: number, n: number, cdf: (k: number) => number): number {
  let low = 0, high = n;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (cdf(middle) >= p) high = middle; else low = middle + 1;
  }
  return low;
}
export function logChoose(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}
export function combinations(n: number, k: number): number {
  let result = 1;
  const terms = Math.min(k, n - k);
  for (let i = 1; i <= terms; i++) {
    result *= (n - terms + i) / i;
    if (!Number.isFinite(result)) return result;
  }
  return Math.round(result);
}
export function permutations(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i++) {
    result *= n - i;
    if (!Number.isFinite(result)) return result;
  }
  return result;
}
export function factorial(n: number, step = 1): number {
  // Overflow is an error, not a reason to spend unbounded time in a product.
  if (n > (step === 1 ? 170 : 300)) return Infinity;
  let result = 1;
  for (let k = n; k > 1; k -= step) result *= k;
  return result;
}
