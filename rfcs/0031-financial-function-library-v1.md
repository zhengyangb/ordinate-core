# RFC-0031: Financial Function Library V1

- Status: Draft
- Project: Ordinate

## Summary

This RFC adds deterministic financial functions for time-value-of-money, cash-flow analysis, rate conversion, and depreciation.

V1 covers numeric financial math only. It does not define bond calendar conventions, market data, currency conversion, or live external data.

## Goals

This RFC defines:

- annuity functions: `fv`, `pv`, `pmt`, `nper`, `rate`
- payment allocation functions: `ipmt`, `ppmt`, `cumipmt`, `cumprinc`, `ispmt`
- cash-flow functions: `npv`, `irr`, `mirr`, `xnpv`, `xirr`
- interest conversion functions: `effect`, `nominal`
- depreciation functions: `sln`, `syd`, `db`, `ddb`
- deterministic root-solver behavior for `irr`, `xirr`, and `rate`
- view input rules for cash-flow functions
- diagnostics for invalid financial inputs

## Non-Goals

This RFC does not define:

- bond/security functions such as `accrint`, `coup*`, `yield`, `disc`, or `received`
- day-count basis conventions such as Actual/Actual, Actual/360, Actual/365, or 30/360
- coupon schedule generation
- currency formatting or conversion
- stock or market-data functions
- volatile external-data reads
- variable declining balance `vdb`
- formula vector literals such as `[-100, 30, 40, 50]`

## Function Names

Canonical function names are lowercase:

```text
npv(...)
irr(...)
xnpv(...)
```

Excel/Numbers-style uppercase names may be accepted as aliases by the existing case-insensitive function registry. Serialization does not rewrite user formula text in this RFC.

## Numeric Model

All functions use Ordinate `number` values. Rates are decimal rates:

```text
0.05 -> 5%
```

Money is represented as ordinary numbers. This RFC does not introduce a currency type.

All functions are deterministic and must return an Ordinate `error` rather than `NaN`, `Infinity`, or host-dependent behavior.

## Cash-Flow Inputs

Cash-flow inputs are `view[d=1]`.

Supported:

```text
irr(@[:,Cashflow])
npv(0.1, @[#2:#5,Cashflow])
mirr(@[:,Cashflow], 0.08, 0.12)
xnpv(0.1, @[:,Cashflow], @[:,Date])
xirr(@[:,Cashflow], @[:,Date])
```

Formula vector literals are deferred:

```text
irr([-100, 30, 40, 50])  # future work
```

View values are consumed in row-major order.

Rules:

- `blank` values are ignored
- numeric-compatible values follow the existing Ordinate numeric-compatible view policy
- errors propagate
- non-numeric incompatible values fail the call
- cash-flow functions requiring returns must see at least one positive and one negative value unless otherwise stated

## Time-Value-Of-Money Functions

### Shared Contract

These functions use per-period rates and period counts:

```text
pv(rate, nper, pmt, fv?, type?) -> number
fv(rate, nper, pmt, pv?, type?) -> number
pmt(rate, nper, pv, fv?, type?) -> number
nper(rate, pmt, pv, fv?, type?) -> number
rate(nper, pmt, pv, fv?, type?) -> number
```

`type` is optional:

```text
0 -> payments at end of period
1 -> payments at beginning of period
```

If omitted:

```text
fv defaults pv = 0, type = 0
pv defaults fv = 0, type = 0
pmt defaults fv = 0, type = 0
nper defaults fv = 0, type = 0
rate defaults fv = 0, type = 0
```

`type` values other than `0` or `1` are invalid.

Zero-rate cases use the linear formulas instead of division by zero.

## Payment Allocation

```text
ipmt(rate, per, nper, pv, fv?, type?) -> number
ppmt(rate, per, nper, pv, fv?, type?) -> number
cumipmt(rate, nper, pv, startPeriod, endPeriod, type?) -> number
cumprinc(rate, nper, pv, startPeriod, endPeriod, type?) -> number
ispmt(rate, per, nper, pv) -> number
```

Rules:

- `per`, `startPeriod`, and `endPeriod` are one-based periods
- period numbers must be integers
- `1 <= per <= nper`
- `1 <= startPeriod <= endPeriod <= nper`
- `ppmt = pmt - ipmt`
- cumulative functions sum the period functions inclusively

## Cash-Flow Functions

### `npv`

```text
npv(rate, values: view[d=1]) -> number
```

The first value is discounted by one period:

```text
npv(r, [c1, c2, c3]) = c1/(1+r)^1 + c2/(1+r)^2 + c3/(1+r)^3
```

Users who need Excel-style `initial + NPV(rate, future_flows)` should write:

```text
initial + npv(rate, future_flows)
```

### `irr`

```text
irr(values: view[d=1]) -> number
```

`irr` solves:

```text
sum(c_i / (1 + r)^i) = 0
```

The first cash flow is at period `0`.

### `mirr`

```text
mirr(values: view[d=1], financeRate, reinvestRate) -> number
```

Negative cash flows are discounted using `financeRate`. Positive cash flows are compounded using `reinvestRate`.

### `xnpv`

```text
xnpv(rate, values: view[d=1], dates: view[d=1]) -> number
```

Dates must be `date` values. Values and dates must have the same shape after ignored blanks are removed pairwise.

XNPV uses a 365-day year:

```text
sum(value_i / (1 + rate)^((date_i - first_date) / 365))
```

Dates may be unordered. The first date in the supplied view is the anchor date.

### `xirr`

```text
xirr(values: view[d=1], dates: view[d=1]) -> number
```

`xirr` solves `xnpv(rate, values, dates) = 0`.

## Root Solver

`irr`, `xirr`, and `rate` use a shared deterministic root solver.

The solver:

- scans a fixed finite set of candidate intervals
- finds sign-changing brackets
- solves bracketed roots by bisection
- returns `error` if no bracket is found
- returns `error` if multiple brackets are found
- returns `error` if convergence fails within the fixed iteration limit

Constants:

```text
minRate = -0.999999999
maxRate = 1_000_000
tolerance = 1e-10
maxIterations = 200
scanSteps = 400
```

The multiple-root rule is intentional. IRR can be ambiguous when cash-flow signs change more than once.

## Interest Conversion

```text
effect(nominalRate, npery) -> number
nominal(effectRate, npery) -> number
```

`npery` is the number of compounding periods per year and must be a positive integer.

## Depreciation

```text
sln(cost, salvage, life) -> number
syd(cost, salvage, life, period) -> number
db(cost, salvage, life, period, month?) -> number
ddb(cost, salvage, life, period, factor?) -> number
```

Rules:

- `cost`, `salvage`, and `life` must be valid positive numeric inputs according to each function
- `period` must be a positive integer
- `month` defaults to `12` and must be an integer from `1` to `12`
- `factor` defaults to `2`
- depreciation functions never depreciate below salvage

`db` follows the Excel-compatible fixed declining balance convention:

```text
rate = round(1 - (salvage / cost)^(1 / life), 3)
```

The first and final period are adjusted by `month`.

## Future Work

Future RFCs may define:

- formula vector literals such as `[-100, 30, 40, 50]`
- bond/security functions with explicit day-count and coupon schedule semantics
- `vdb`
- currency display presets
- currency conversion through explicit user-provided rate tables
- stock or market data through non-core app connectors
