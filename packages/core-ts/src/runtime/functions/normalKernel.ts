/** Standard normal kernel via regularized incomplete gamma at a = 1/2.
 * The lower-gamma positive series is stable near the center; the upper-gamma
 * continued fraction directly evaluates small tails. These are complementary
 * algorithm domains, not fallback approximations. See DLMF 8.7/8.9.
 * Quantiles solve log(survival(z)) on the positive half-axis, avoiding 1-CDF
 * cancellation and underflow even for representable tiny probabilities. */
const LOG_SQRT_PI = Math.log(Math.PI) / 2;
const LOG_TWO = Math.log(2);
const EPS = 4 * Number.EPSILON;
const TINY = 1e-300; // Modified Lentz's denominator scale, not probability clipping.

export const standardNormalDensity = (z: number): number => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);

function logUpperTail(z: number): number | null {
  const t = z * z / 2;
  if (t === 0) return -LOG_TWO;
  if (!Number.isFinite(t)) return -Infinity;
  const logScale = Math.log(t) / 2 - t - LOG_SQRT_PI;
  if (t < 1.5) {
    let part = 2, total = part;
    for (let n = 1; n <= 256; n++) {
      part *= t / (n + 0.5);
      total += part;
      if (part <= total * EPS) return Math.log1p(-total * Math.exp(logScale)) - LOG_TWO;
    }
    return null;
  }
  let b = t + 0.5, c = 1 / TINY, d = 1 / b, fraction = d;
  for (let n = 1; n <= 1024; n++) {
    const a = -n * (n - 0.5);
    b += 2;
    d = a * d + b;
    c = b + a / c;
    if (Math.abs(d) < TINY) d = TINY;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) <= EPS) return logScale + Math.log(fraction) - LOG_TWO;
  }
  return null;
}

export function standardNormalCdf(z: number): number | null {
  const logTail = logUpperTail(Math.abs(z));
  if (logTail === null) return null;
  return z <= 0 ? Math.exp(logTail) : -Math.expm1(logTail);
}

export function standardNormalInverse(p: number): number | null {
  if (p === 0.5) return 0;
  const logP = Math.log(p < 0.5 ? p : 1 - p);
  // 40 exceeds the quantile of the smallest positive IEEE-754 double.
  let low = 0, high = 40;
  for (let i = 0; i < 128; i++) {
    const middle = (low + high) / 2;
    if (middle === low || middle === high) return (p < 0.5 ? -1 : 1) * middle;
    const logTail = logUpperTail(middle);
    if (logTail === null) return null;
    if (logTail > logP) low = middle;
    else high = middle;
  }
  return null;
}
