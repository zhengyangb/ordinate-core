# RFC 0047: Probability distribution functions

Status: Accepted

## Amendment 2026-10-05: complete distribution-family implementation

This extends RFC-0022, whose scope explicitly excluded distributions. The
previous first-stage roadmap is replaced by the implemented scope: normal,
lognormal, beta, gamma, exponential, Weibull, Student t, chi-square, F, binomial,
Poisson, negative binomial and hypergeometric. It includes Excel right-tail,
two-tail, inverse-tail, binomial-range and current/legacy function spellings.
PDF/CDF/inverse are separate native operations; integer distributions use Pmf.
Implement only meaningful inverse operations exposed in Excel, not invented
POISSON.INV or EXPON.INV aliases.

Use shared log-gamma, regularized gamma/beta, monotone inversion and discrete
quantile kernels. Tail operations evaluate the small tail directly; generated
`1-CDF` expressions are not a numerical implementation. Bounded numerical
work fails with a convergence error when it cannot finish; it never substitutes
a cache, a different algorithm, or clipped inputs. Finite inverse endpoints
may be represented; infinite endpoints fail. Native discrete counts are safe
integers, not implicitly truncated Excel values.

One declarative source-profile manifest owns argument order, optional bounds,
cumulative flag position, fixed flags, legacy tail meaning and aliases. Import
uses a single conditional only for a dynamic PDF/CDF choice. Export inserts
flags/reorders arguments from the same profile, with no defensive wrappers.
Function-catalog exhaustion tests require both directional decisions, and
every distribution import profile gets a poison-cache/round-trip test.

### Implemented Excel coverage

All distribution families listed in Microsoft's statistical inventory have
native operations and bidirectional adapter mappings. This means distribution
functions, not every statistical worksheet function or every Excel coercion.
Names below omit the required XLSX future-function prefix for readability.

| Family | Current Excel functions | Legacy inputs |
| --- | --- | --- |
| Normal | NORM.DIST, NORM.INV, NORM.S.DIST, NORM.S.INV | NORMDIST, NORMINV, NORMSDIST, NORMSINV |
| Lognormal | LOGNORM.DIST, LOGNORM.INV | LOGNORMDIST, LOGINV |
| Beta | BETA.DIST, BETA.INV (optional lower/upper bounds) | BETADIST, BETAINV |
| Gamma | GAMMA.DIST, GAMMA.INV | GAMMADIST, GAMMAINV |
| Exponential | EXPON.DIST | EXPONDIST |
| Weibull | WEIBULL.DIST | WEIBULL |
| Chi-square | CHISQ.DIST, CHISQ.DIST.RT, CHISQ.INV, CHISQ.INV.RT | CHIDIST, CHIINV |
| Student t | T.DIST, T.DIST.RT, T.DIST.2T, T.INV, T.INV.2T | TDIST (one/two-tail selector), TINV |
| F | F.DIST, F.DIST.RT, F.INV, F.INV.RT | FDIST, FINV |
| Binomial | BINOM.DIST, BINOM.INV, BINOM.DIST.RANGE | BINOMDIST, CRITBINOM |
| Poisson | POISSON.DIST | POISSON |
| Negative binomial | NEGBINOM.DIST | NEGBINOMDIST |
| Hypergeometric | HYPGEOM.DIST | HYPGEOMDIST |

Legacy BETADIST is cumulative-only; NEGBINOMDIST/HYPGEOMDIST are mass-only.
FDIST/FINV and CHIDIST/CHIINV mean right tails, and TINV means two tails.
BINOM.INV's Excel argument order differs from native probability-first Inv.
Each difference is declared once in the family manifest. Density at an infinite
boundary is an error because the scalar runtime does not represent infinity.
The explicit studentTTail(x,df,tails) selector exports TDIST directly; separate
Sf/TwoTail operations export current T.DIST.RT/T.DIST.2T. No generated tail
validation branch is needed because the native selector owns its 1/2 domain.
The native Poisson mean-zero degenerate limit is valid. Counts/degrees of
freedom reject fractional values rather than inheriting Excel's truncation.
Hypergeometric cumulative summation has a 10,000-term work limit; exceeding it
reports convergence failure, never a guessed probability or cached result.

The independent Calc oracle cannot calculate BINOM.DIST.RANGE. Its observed
`#NAME?` is recorded separately while native and adapter tests use analytic
binomial coefficients. This limitation is not a failed Excel mapping or an
assertion that Excel supports no such function.

Random sampling, confidence intervals, hypothesis tests and general probability
tables (PROB) are distinct statistical features, not distribution functions.
They must be classified explicitly, not mislabeled as unavailable distributions.

## Model and first implementation

Distribution functions are deterministic scalar operations, not array spills
or random sampling. Use one numerical kernel per family. Separate density
(`Pdf`), cumulative probability (`Cdf`) and inverse cumulative probability
(`Inv`) instead of a native boolean switch whose meaning users must memorize.

The first implemented families are normal and lognormal, which cover the
option-valuation files motivating this work:

| Function | Arguments |
| --- | --- |
| normalPdf, normalCdf | x, mean = 0, sd = 1 |
| normalInv | probability, mean = 0, sd = 1 |
| lognormalPdf, lognormalCdf | x, logMean, logSd |
| lognormalInv | probability, logMean, logSd |

All arguments are finite numeric scalars. sd/logSd must be positive. Inverse
probabilities must satisfy 0 < p < 1 (infinite endpoints are not runtime
numbers). Lognormal x must be positive, matching Excel's input domain.
Domain/type/nonfinite-result errors belong to the evaluator and are visible.
No input clipping, substitute caches or generated defensive formulas.

Standard normal and general normal share a kernel through standardization;
lognormal shares it through logarithm/exponential transformation. Compute small
tails directly, not by subtracting nearly equal probabilities. Use bounded,
convergence-tested numerical methods; convergence failures are errors, not
fallback approximations. Independent reference tests cover the center, tails,
quantile round trips and nondefault location/scale.

## Excel interchange is part of the feature

Each native function must have both an inbound decision and outbound mapping
before the family is complete. Extend the shared function-signature manifest
with argument normalization: fixed export arguments and inbound variants.
Do not put a second collection of distribution names in the parser/UI.

| Excel operation | Native operation |
| --- | --- |
| NORM.DIST/NORMDIST, cumulative TRUE/FALSE | normalCdf/normalPdf |
| NORM.S.DIST, cumulative TRUE/FALSE | normalCdf/normalPdf with default mean/sd |
| NORMSDIST | normalCdf with default mean/sd (legacy is always cumulative) |
| NORM.INV/NORMINV | normalInv |
| NORM.S.INV/NORMSINV | normalInv with default mean/sd |
| LOGNORM.DIST, cumulative TRUE/FALSE | lognormalCdf/lognormalPdf |
| LOGNORMDIST | lognormalCdf (legacy is always cumulative) |
| LOGNORM.INV/LOGINV | lognormalInv |

Literal cumulative flags choose the named operation directly. A dynamic flag
may become a single native conditional selecting Cdf/Pdf: this expresses the
source choice, not error defense. Standard aliases normalize arguments rather
than creating duplicate native functions. Export canonical current Excel names
and required future-function prefixes with the appropriate cumulative flag.

## Completion contract

Each family above requires numerical and bidirectional interchange tests.
Normal-only implementation does not complete the amendment. There is no
remaining distribution-family roadmap hidden behind Accepted status.

## Sample and cached-value audit

Run real XLSX files through the actual Ordinate adapter and runtime. Keep
downloaded sources and reports in durable storage outside the repository.
Inventory every unsupported function: distinguish missing mapping, missing
native capability, unsupported argument mode, legacy container, external
workbook references, and inherently non-scalar/dynamic features.

Compare untouched source caches with freshly evaluated values at unchanged
coordinates, recording missing caches, numeric tolerance, source errors,
formulas preserved as text and native errors separately. A cache can be stale;
a mismatch is evidence for investigation, not permission to change semantics.
Do not use cached values to make an import appear calculable, and do not add
coercion/blank/error guards to fix this audit's differences.

## Sources

- [Microsoft statistical inventory](https://support.microsoft.com/en-us/excel/statistical-functions-reference)
- [Microsoft legacy compatibility functions](https://support.microsoft.com/en-gb/excel/compatibility-functions-reference)
- [Microsoft BINOM.DIST.RANGE](https://support.microsoft.com/en-us/excel/binom-dist-range-function)
- [LibreOffice source function registrations](https://report.dev.libreoffice.org/sources/formulabase.cxx_1179.html)
- [NIST DLMF incomplete gamma continued fractions](https://dlmf.nist.gov/8.9)
- [Microsoft NORM.S.DIST](https://support.microsoft.com/en-us/excel/functions/norm-s-dist-function)
- [Microsoft NORM.INV](https://support.microsoft.com/en-us/excel/functions/norm-inv-function)
- [Microsoft LOGNORM.DIST](https://support.microsoft.com/en-us/excel/functions/lognorm-dist-function)
- [NYU Damodaran spreadsheets](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/spreadsh.htm)
