# RFC-0022: Statistical Function Library V1

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines Ordinate's first statistical function set over scalar and view-valued formula expressions.

It builds on:

- RFC-0019 standard function registry and scalar numeric functions
- RFC-0020 view-valued intermediate expressions and filtering
- RFC-0021 value broadcasting and element-wise arithmetic

This RFC does not copy Excel's historical statistical function surface. It defines a smaller Python-like policy:

- numbers are used as-is
- booleans are numeric-compatible: `true -> 1`, `false -> 0`
- blanks are ignored by statistical reducers
- strings, nulls, dates, times, datetimes, and durations fail early
- errors propagate

## Motivation

Common table workflows need descriptive statistics, ranks, percentiles, and simple linear relationships.

Examples:

```text
average(@[:,Passed])
median(@[:,Score])
percentile(@[:,Score], 0.9)
stdev(@[:,Score])
correl(@[:,Spend], @[:,Revenue])
slope(@[:,Revenue], @[:,Spend])
forecast(100, @[:,Revenue], @[:,Spend])
```

Boolean numeric compatibility makes flag columns useful without Excel-style duplicate functions:

```text
sum(@[:,Passed])      # true count
average(@[:,Passed])  # true ratio
```

## Goals

This RFC defines:

- statistical input compatibility
- descriptive statistical reducers
- order statistics
- sample and population variance/stdev
- paired statistics and linear regression
- error behavior for invalid values, incompatible shapes, and insufficient input

## Non-Goals

This RFC does not define:

- probability distribution functions
- statistical test functions
- Excel `A` variants such as `AVERAGEA`, `MAXA`, `STDEVA`, or `VARA`
- text-to-number coercion
- strict type assertion functions such as `requireNumber(...)`
- array or spill outputs
- named parameters

## Numeric-Compatible Values

Statistical functions use numeric-compatible values.

Accepted:

```text
number   -> number
boolean  -> 1 for true, 0 for false
blank    -> ignored
```

Rejected:

```text
string
null
date
time
datetime
duration
```

Errors propagate.

This policy is intentionally different from Excel's historical `A` variants. Boolean coercion is part of the primary statistical semantics. Text coercion is not.

If imported text must be interpreted as numbers, that requires a future explicit conversion function:

```text
average(number(@[:,ImportedAmount]))
```

## View Reduction

Statistical reducers accept `view[d<=2]`.

The reducer consumes the view's row-major values and returns a scalar.

View dimension does not affect reducer output:

```text
median(view[d=1]) -> number
median(view[d=2]) -> number
```

View shape still matters for paired functions such as `correl(...)`, `covariance(...)`, `slope(...)`, and `forecast(...)`.

## Functions

### Descriptive Statistics

```text
countblank(x)
median(x)
variance(x)
variancep(x)
stdev(x)
stdevp(x)
avedev(x)
devsq(x)
geomean(x)
harmean(x)
mode(x)
```

Aliases:

```text
var        -> variance
varp       -> variancep
stddev     -> stdev
stddevp    -> stdevp
```

`variance(...)` and `stdev(...)` are sample functions.

`variancep(...)` and `stdevp(...)` are population functions.

`mode(...)` returns the most frequent numeric-compatible value. Ties are resolved by returning the smallest tied value.

`geomean(...)` and `harmean(...)` require all included values to be positive.

### Order Statistics

```text
percentile(x, p)
quartile(x, q)
large(x, k)
small(x, k)
rank(value, x)
rank(value, x, ascending)
```

`percentile(...)` uses inclusive linear interpolation with `p` in `[0, 1]`.

`quartile(...)` accepts integer `q` values from `0` through `4` and maps them to percentiles.

`large(...)` and `small(...)` use one-based `k`.

`rank(...)` uses descending order by default. If `ascending` is non-zero, it uses ascending order.

### Paired Statistics and Regression

```text
correl(x, y)
covariance(x, y)
covariancep(x, y)
slope(y, x)
intercept(y, x)
forecast(x, knownY, knownX)
standardize(x, mean, stdev)
```

`correl(...)` returns the Pearson correlation coefficient.

`covariance(...)` is sample covariance.

`covariancep(...)` is population covariance.

`slope(...)`, `intercept(...)`, and `forecast(...)` use simple linear regression.

Paired functions require exact view shape equality. Rows with a blank in either paired input are skipped. Non-blank invalid values fail early.

## Examples

Boolean true ratio:

```text
average(@[:,Passed])
```

Percentile of filtered values:

```text
percentile(filter(@[:,Score], @[:,Region] == "West"), 0.9)
```

Residual variance:

```text
variance(@[:,Actual] - @[:,Budget])
```

Correlation:

```text
correl(@[:,Spend], @[:,Revenue])
```

Forecast:

```text
forecast(100, @[:,Revenue], @[:,Spend])
```

## Error Policy

The following cases produce `error`:

- all included values are blank
- sample variance/stdev/covariance has fewer than two included values
- percentile `p` is outside `[0, 1]`
- quartile `q` is not an integer in `[0, 4]`
- `k` is not a positive integer or exceeds the number of included values
- paired views have incompatible shapes
- paired functions have insufficient included pairs
- correlation or regression receives zero-variance input
- geometric or harmonic mean receives a non-positive included value
- text, null, date, time, datetime, or duration appears in included input

## Future Work

- `number(...)`, `text(...)`, and strict type validators such as `isNumber(...)` or `requireNumber(...)`
- probability distributions such as normal, binomial, Poisson, beta, gamma, chi-square, t, and Weibull
- statistical tests such as t-test and z-test
- histogram or frequency functions that require shaped output
- named-parameter function options
