# RFC-0020: Formula Views, Broadcasting, and Filtering

- Status: Draft
- Project: Ordinate

> RFC-0053 supersedes this RFC's exact-shape comparison rule. `filter` still
> requires matching kinds and shapes.

> RFC-0052 supersedes this RFC's `view[d]` runtime notation and filtered-view
> result shape. `filter` now produces a one-dimensional array; views have two
> explicit axes. Scalar and exact-shape element-wise rules remain in force.

## Summary

This RFC extends Ordinate formula evaluation with view-valued intermediate expressions, scalar broadcasting for comparisons, element-wise comparison over views, boolean masks, and a `filter(...)` function.

The immediate goal is to support Ordinate-native conditional aggregation:

```text
= sum(filter(@[:,Revenue], @[:,Region] == "West"))
```

This replaces spreadsheet-style criteria strings such as `SUMIF(range, ">100", sum_range)` with ordinary formula expressions.

## Motivation

Spreadsheet `SUMIF`-style criteria strings are compact, but they hide a small predicate language inside string values.

Examples:

```text
">100"
"<>0"
"West"
"apple*"
```

Those strings require special parsing, escaping, wildcard rules, comparison rules, type coercion rules, and date/text behavior that are separate from the normal formula language.

Ordinate should instead make predicates ordinary typed formula expressions.

Examples:

```text
@[:,Revenue] > 100
@[:,Region] == "West"
filter(@[:,Revenue], @[:,Region] == "West")
sum(filter(@[:,Revenue], @[:,Region] == "West"))
```

This keeps conditional aggregation composable and avoids a hidden compatibility language.

## Goals

This RFC defines:

- view-valued intermediate formula expressions
- scalar broadcasting for comparison operators
- element-wise comparison between views
- exact shape matching for view-to-view comparison
- boolean mask semantics
- `filter(values, mask)`
- aggregate consumption of filtered views
- error behavior for unsupported or incompatible view operations

## Non-Goals

This RFC does not define:

- lambda expressions
- Excel-style criteria strings
- `sumif`, `sumifs`, `countif`, or `countifs`
- arithmetic broadcasting
- NumPy-style dimensional broadcasting
- dynamic arrays or spreadsheet-style spill output
- formula cells whose final displayed value is a non-scalar view
- `map`, `where`, `sort`, `groupBy`, or a query language
- shape transforms such as transpose, reshape, row expansion, or column expansion

## Prior RFC Context

This RFC builds on:

- RFC-0005, which defines formula cells and formula evaluation
- RFC-0006, which defines scalar operators
- RFC-0007, which defines views, ranges, view dimensionality, and row-major flattening
- RFC-0008, which defines function contracts
- RFC-0019, which defines the Standard Function Library V1 and aggregate functions over views

## Terminology

### View

A view is a shaped collection of evaluated runtime values.

Views have dimensionality:

```text
view[d=0]  scalar-shaped view
view[d=1]  vector-shaped view
view[d=2]  matrix-shaped view
```

Ordinate uses `view[d]` as the public formula model for shaped values.

References such as `@[:,Revenue]`, computed comparisons such as `@[:,Region] == "West"`, and filtered results such as `filter(...)` are all views in this model.

### Implementation Note

This RFC does not expose whether a view is backed by document cells or by computed intermediate values. That distinction is an implementation detail.

### Shape

The shape of a view is its dimensionality and extent.

Examples:

```text
view[d=0]        one scalar position
view[d=1, n=3]   three ordered positions
view[d=2, rows=3, cols=2]
```

Exact shape equality is required for view-to-view operations in this RFC.

### Mask

A mask is a `view` whose elements are all boolean values.

`true` keeps the corresponding value.

`false` removes the corresponding value.

## Runtime Value Model

Formula expression evaluation may produce view-valued intermediate results.

Examples:

```text
@[:,Revenue]                  -> view[d=1]
@[:,Region] == "West"         -> view[d=1]
filter(@[:,Revenue], mask)    -> view[d=1]
```

However, this RFC does not allow formula cells to display or serialize non-scalar view results as final cell values.

A formula cell final result must still be scalar in V1.

If a formula expression evaluates to `view[d=1]` or `view[d=2]` as the final cell result, evaluation produces `error`.

Aggregate functions may consume views as inputs and return scalar values.

Example:

```text
= sum(filter(@[:,Revenue], @[:,Region] == "West"))
```

## Broadcast Comparison

This RFC extends comparison operators to support views.

Supported operators:

```text
== != < <= > >=
```

Supported forms:

```text
view op scalar -> view[boolean]
scalar op view -> view[boolean]
view op view   -> view[boolean], if shapes match exactly
```

Examples:

```text
@[:,Region] == "West"
@[:,Revenue] > 100
100 < @[:,Revenue]
@[:,Actual] >= @[:,Budget]
```

The output view has the same shape as the input view for scalar broadcasting, or the shared shape for view-to-view comparison.

## Shape Rules

View-to-view comparison requires exact shape equality.

Allowed:

```text
view[d=1, n=3] op view[d=1, n=3]
view[d=2, rows=3, cols=2] op view[d=2, rows=3, cols=2]
```

Rejected:

```text
view[d=1, n=3] op view[d=1, n=4]
view[d=1, n=3] op view[d=2, rows=3, cols=1]
view[d=2, rows=3, cols=1] op view[d=2, rows=1, cols=3]
```

This RFC does not support NumPy-style dimensional broadcasting.

For example, this RFC does not expand:

```text
view[d=2, rows=3, cols=1] op view[d=2, rows=1, cols=4]
```

into:

```text
view[d=2, rows=3, cols=4]
```

If that behavior is needed later, it should be introduced by explicit functions or a separate RFC.

## Comparison Semantics

Element-wise comparison uses the scalar comparison rules from RFC-0006 for each corresponding element.

If a scalar comparison would produce `error`, the broadcast comparison produces `error`.

This RFC does not define partially valid boolean views with embedded errors.

The operation either produces a boolean view or produces `error`.

Examples:

```text
@[:,Revenue] > 100
```

produces a boolean view if every element can be compared with `100`.

```text
@[:,Revenue] > "100"
```

produces `error` if the scalar comparison rules reject number/string ordering.

## Filter Function

This RFC defines `filter`.

Contract:

```text
filter(values: view[d<=2], mask: view[d<=2]) -> view[d=1]
```

Semantics:

- `values` and `mask` must have exactly the same shape
- `mask` must contain only boolean values
- values are visited in row-major order
- when the corresponding mask element is `true`, the value is kept
- when the corresponding mask element is `false`, the value is removed
- the result is a `view[d=1]`
- result order is row-major order from the input

Example:

```text
values = [100, 200, 300]
mask   = [true, false, true]

filter(values, mask) = [100, 300]
```

For two-dimensional inputs:

```text
values = [[1, 2], [3, 4]]
mask   = [[true, false], [false, true]]

filter(values, mask) = [1, 4]
```

The filtered result is one-dimensional because filtering can remove arbitrary positions and therefore does not generally preserve rectangular shape.

## Aggregate Consumption

Aggregate functions that accept `view[d<=2]` may consume filtered views.

Examples:

```text
= sum(filter(@[:,Revenue], @[:,Region] == "West"))
= count(filter(@[:,Revenue], @[:,Region] == "West"))
= average(filter(@[:,Revenue], @[:,Revenue] > 100))
= counta(filter(@[:,Customer], @[:,Revenue] > 100))
```

The aggregate function receives a `view[d=1]` from `filter(...)`.

No special `sumif` behavior is required.

## Examples

### Conditional Sum

```text
# Sales
| Item || Region | Revenue |
| ---- || ------ | ------- |
| A    || West   | 100     |
| B    || East   | 200     |
| C    || West   | 300     |
| Total West || | = sum(filter(@[#2:#4,Revenue], @[#2:#4,Region] == "West")) |
```

Result:

```text
400
```

### Numeric Threshold

```text
= average(filter(@[:,Revenue], @[:,Revenue] > 100))
```

### View-to-View Comparison

```text
= sum(filter(@[:,Actual], @[:,Actual] >= @[:,Budget]))
```

This includes only `Actual` values whose corresponding `Actual` value is greater than or equal to the corresponding `Budget` value.

## Error Policy

The following cases produce `error`:

- final formula result is `view[d=1]` or `view[d=2]`
- view-to-view comparison has incompatible shapes
- `filter(values, mask)` receives incompatible shapes
- `filter` mask contains a non-boolean value
- a broadcast comparison element fails scalar comparison rules
- an unsupported operator is applied to a view
- a view is passed to a function that requires a scalar and cannot coerce `view[d=0]`

Errors in input values propagate.

## Interaction With Scalar Context

Existing scalar context rules remain in force.

A `view[d=0]` may satisfy a scalar contract when the existing function contract rules allow scalar coercion.

This RFC does not allow `view[d=1]` or `view[d=2]` to be implicitly coerced to scalar.

## Interaction With RFC-0019

RFC-0019 aggregate functions continue to accept `view[d<=2]`.

After this RFC, that includes:

- reference expressions such as `@[:,Revenue]`
- broadcast comparison results when a boolean view is expected
- filtered views returned by `filter(...)`

The function registry may expose `filter` as a standard function once this RFC is implemented.

## Deferred Topics

- arithmetic broadcasting, such as `@[:,Revenue] * 1.1`
- view-to-view arithmetic, such as `@[:,Price] * @[:,Qty]`
- NumPy-style broadcasting
- explicit broadcast functions
- shape-preserving masks
- dynamic arrays and spill output
- lambda predicates
- `where(...)`
- `map(...)`
- `sort(...)`
- `groupBy(...)`
- Excel-style `sumif` and `countif` compatibility aliases
- criteria string parsing
- query language syntax
- shape transforms such as `transpose` and `reshape`

## Current Working Assumptions

- `view[d]` remains the public model for shaped formula values
- view storage or backing is not exposed by the formula language
- comparison broadcasting is the first supported view-valued operator behavior
- arithmetic broadcasting is useful but deferred
- `filter(...)` returns `view[d=1]`
- formula cells still produce scalar final values in V1
- conditional aggregation should compose from `filter(...)` and ordinary aggregate functions
