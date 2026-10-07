# RFC 0046: Deterministic mathematics — logarithms, trigonometry and numeric reductions

Status: Accepted

## Amendment 2026-10-06: source rounding normalization

Excel FLOOR/CEILING are now translated in the adapter; their spelling/history
does not create a native legacy function. RFC-0019 owns floor(x)/ceil(x), which
round to integers. floorMultiple/ceilMultiple round to a specified multiple
(for example floor(12.7)=12, floorMultiple(12.7,5)=10). Their optional mode
controls negative-number direction independently of the multiple's sign.

Source significance 1 simplifies to floor/ceil. Positive significance uses
default multiple rounding. Negative significance becomes its absolute magnitude
with mode 1; both legacy functions reject positive numbers with negative
significance. FLOOR with zero significance is an error, whereas CEILING returns
zero. Source literals simplify these choices without examining current cell
values or caches. Dynamic references preserve source sign/mode selection with
native if expressions, so input edits remain meaningful. These are operation
branches and invalid-domain results, not ISNUMBER/IFERROR/coercion defenses.
Native errors propagate; we do not emulate Excel's complete error-code taxonomy.
No ternary syntax is invented: the existing native conditional is if.

The import profile and its normalizer own this rule once. Export continues
to use current FLOOR.MATH/CEILING.MATH for multiple operations and the existing
INT/CEILING(x,1) for integer operations. Tests cover poison caches, source
reopening, edits, export/reimport, sign combinations, zero significance,
invalid inputs/arity and independent-engine calculation. Calc's different
error labels for invalid legacy domains are recorded, not copied into native
semantics.

## Amendment 2026-10-05: deterministic scalar mathematics

This is an extension of RFC-0019, not a second definition of the standard
library. RFC-0019 remains the owner of existing arithmetic, aggregates and
rounding contracts. This amendment broadens the original four-function scope:

- Trigonometry: sin/cos/tan, asin/acos/atan/atan2, cot/acot/sec/csc.
- Hyperbolic functions: sinh/cosh/tanh, asinh/acosh/atanh, coth/acoth/sech/csch.
- Units: radians/degrees and sqrtPi.
- Counting: factorial/doubleFactorial, combinations/combinationsWithRepetition,
  permutations/permutationsWithRepetition.
- Arithmetic: quotient, even/odd, roundMultiple, floorMultiple/ceilMultiple.
- Numeric-view reductions: multinomial, seriesSum, sumSquaredDifference,
  sumSquareDifference, sumSquareSum and determinant.
- Distribution mathematics: gamma/logGamma, erf/erfc, normalDensity and
  normalCenteredCdf (Excel PHI/GAUSS).

Native atan2 follows the conventional atan2(y,x) order; the Excel adapter
reorders ATAN2(x,y) declaratively. Counting arguments must be nonnegative safe
integers; Excel's truncation of fractional counts is not inherited. Error
domains are validated in the evaluator, not in generated import expressions.
Nonfinite results fail early. Multiple rounding names describe their native
operation, with current FLOOR.MATH/CEILING.MATH export. FLOOR.PRECISE,
CEILING.PRECISE and ISO.CEILING import into the same operations without a mode
argument. Their two-argument limits are declared in the catalog, not guessed.
Legacy FLOOR/CEILING sign behavior is normalized in the adapter as specified
above, not implicitly renamed to current MATH behavior. MDETERM is implemented because its result is scalar; grouping it with
matrix-spill exclusions would be incorrect.

### Implemented Excel inventory

The following additions have native evaluation, import, export and assistant
metadata. This is an executable scope, not a roadmap:

| Group | Excel spellings |
| --- | --- |
| Logarithms/exponential | EXP, LN, LOG, LOG10 |
| Trigonometry | SIN, COS, TAN, ASIN, ACOS, ATAN, ATAN2, COT, ACOT, SEC, CSC |
| Hyperbolic | SINH, COSH, TANH, ASINH, ACOSH, ATANH, COTH, ACOTH, SECH, CSCH |
| Units | RADIANS, DEGREES, SQRTPI |
| Counting | FACT, FACTDOUBLE, COMBIN, COMBINA, PERMUT, PERMUTATIONA, MULTINOMIAL |
| Quotient/parity/multiples | QUOTIENT, EVEN, ODD, MROUND, FLOOR.MATH, CEILING.MATH; precise/ISO aliases above; FLOOR/CEILING source normalization |
| Scalar numeric reductions | SERIESSUM, SUMXMY2, SUMX2MY2, SUMX2PY2, MDETERM |
| Distribution mathematics | GAMMA, GAMMALN.PRECISE/GAMMALN, PHI, GAUSS, ERF.PRECISE, ERFC.PRECISE/ERFC |
| Statistical math aliases | FISHER → atanh, FISHERINV → tanh |
| Existing integer aggregates now mapped | GCD, LCM |

Existing ABS, SIGN, SQRT, PI, POWER, MOD, INT, ROUND/ROUNDUP/ROUNDDOWN/TRUNC,
SUM, PRODUCT, SUMSQ and vector SUMPRODUCT remain owned by RFC-0019. This
amendment does not silently expand their argument/coercion contracts.
TRUNC already supports optional integer digits in both directions; it is not
a missing feature. General matrix SUMPRODUCT is not claimed merely because
an adapter spelling is registered. Legacy FLOOR/CEILING use adapter-owned
sign-mode normalization rather than a rename.

Counting products avoid subtracting large factorial logarithms when the answer
is small (for example COMBIN(10^15,1)). Numeric-view inputs are strict numbers,
with equal shapes for paired reductions and a nonempty square for determinant.
Determinant uses partial-pivot elimination and returns zero for singular input.
It does not introduce inverse matrices or multi-cell formula results.

Excluded by feature category, not deferred scalar implementations: random
functions require a volatility contract; MINVERSE/MMULT/MUNIT need matrix-view
operations and, for top-level multi-cell results, a cell-spill contract. They
are not fundamentally untranslatable. BASE/DECIMAL/ROMAN/ARABIC are text
conversions; criteria
aggregates and SUBTOTAL/AGGREGATE require criterion/visibility adapter contracts
(native filter/reduce alone is not the Excel criterion parser). The
Excel compatibility manifest must distinguish these from missing scalar math.
GCD/LCM already exist and receive explicit bidirectional integer-view mappings.

## Scope

Add native `exp(x)`, `ln(x)`, `log(x, base = 10)` and `log10(x)` as strict
numeric scalar functions. `exp` is the natural exponential; `power` and `**`
already cover arbitrary powers. `ln` is natural logarithm, not an Excel-only
alias. Exclude implicit text/blank conversion and complex numbers.

## Contract and implementation

Use JavaScript's standard double-precision Math primitives. Require x > 0 for
logarithms and base > 0, base != 1 for log. Base below one is valid. Underflow
to zero is a valid exponential result; overflow/nonfinite results are errors.
Propagate argument errors and reject wrong types/arity at the owning evaluator.
Never generate IF/ISNUMBER/ISERROR guards around imported calls.

The runtime function catalog owns metadata, signatures, examples and evaluation.
Formula assistance consumes that catalog, not a hand-maintained second list.
The shared Excel signature manifest owns both import and export mappings:

| Native | Excel |
| --- | --- |
| exp(x) | EXP(x) |
| ln(x) | LN(x) |
| log(x[, base]) | LOG(x[, base]) |
| log10(x) | LOG10(x) |

Optional LOG base is 10 in both directions. An explicitly missing Excel base
uses the same declared default, not the generic missing-argument zero.
This is a declared normalization, not a claim of identical behavior for every
Excel empty-argument spelling. LibreOffice rejects `LOG(x,)` with `#VALUE!`;
the independent-engine test records that difference separately from `LOG(x)`.

## Verification

Test identities, base below one, omitted/missing base, invalid domains/types,
argument-error propagation, overflow and underflow. Test XLSX import with
deliberately wrong caches, source reopening, input edits, and export/reimport.
Check canonical formulas directly as well as independent numerical references.
Add executable reference-engine cases; passing native tests alone does not
prove target-engine compatibility.

## Sources

- [Microsoft math and trigonometry inventory](https://support.microsoft.com/en-us/excel/math-and-trigonometry-functions-reference)
- [Microsoft ATAN2 argument order](https://support.microsoft.com/en-us/excel/functions/atan2-function)
- [Microsoft FLOOR](https://support.microsoft.com/en-us/excel/functions/floor-function)
- [Microsoft CEILING](https://support.microsoft.com/en-us/excel/functions/ceiling-function)
- [Microsoft EXP](https://support.microsoft.com/en-us/excel/functions/exp-function)
- [Microsoft LN](https://support.microsoft.com/en-us/excel/functions/ln-function)
- [Microsoft LOG](https://support.microsoft.com/en-us/excel/functions/log-function)
- [Microsoft LOG10](https://support.microsoft.com/en-us/excel/functions/log10-function)
