# RFC-0026: Indexing and Slicing V1

- Status: Draft
- Project: Ordinate

> RFC-0052 supersedes the `view[d]` dimensionality and slice-result rules
> here. One-dimensional arrays remain arrays after slicing; views retain row
> and column axes even when a slice has only one row or column.

## Summary

This RFC defines view indexing, view slicing, and bracket syntax for indexing and slicing.

It adds:

```text
index(view, n)
index(view, row, col)

value[n]
value[start:end]
value[row, col]
value[rowSelector, colSelector]
```

Bracket syntax is postfix syntax over an expression. It can index or slice views and text.

## Motivation

Ordinate already supports view-valued intermediate expressions through references, filters, broadcasts, arithmetic views, and text/type transformations.

Users need a direct way to extract values or smaller views:

```text
index(filter(@[:,Name], @[:,Score] > 90), 0)
filter(@[:,Name], @[:,Score] > 90)[0]
@[:,Revenue:Cost][0, 1]
@[:,Name][-1]
@[This,Code][0:3]
```

This keeps lookup-style formulas composable without introducing Excel-style criteria strings or dynamic-array final outputs.

## Goals

This RFC defines:

- `index(view, n)`
- `index(view, row, col)`
- postfix bracket syntax
- one-dimensional view indexing and slicing
- two-dimensional view indexing and slicing
- text indexing and slicing through bracket syntax
- zero-based indexing
- negative indexing from the end
- end-exclusive slices
- shape rules for returned views
- parser error behavior for malformed bracket syntax

## Non-Goals

This RFC does not define:

- Excel-compatible one-based indexing
- chained row/column extraction semantics
- step slices such as `0:10:2`
- boolean masks inside brackets
- lists of indexes inside brackets
- reference-returning indexes or slices
- dynamic arrays or final view display
- `match`, `xlookup`, or full lookup functions
- `transpose(...)`

## Indexing Policy

Ordinate indexing is zero-based.

Examples:

```text
x[0]   # first item
x[1]   # second item
x[-1]  # last item
```

This is intentionally different from Excel and Numbers `INDEX`, which are one-based.

## Scalar Indexes

Scalar indexes must be integers.

Negative indexes count from the end:

```text
x[-1] # last item
x[-2] # second from last
```

Scalar indexes outside the available axis produce `error`.

## Slices

Slice syntax is:

```text
start:end
start:
:end
:
```

Slice bounds are zero-based. The end bound is exclusive.

Negative bounds count from the end.

Slice bounds are clamped to the axis bounds.

If a normalized start is greater than a normalized end, the slice is empty.

This RFC does not define step slices.

## View Indexing Function

### `index(view, n)`

Contract:

```text
index(x: view[d<=1], n: Scalar[number]) -> value
```

For `view[d=1]`, `n` indexes the view in row-major order.

For `view[d=0]`, only `n = 0` or `n = -1` is valid.

`index(view[d=2], n)` is invalid. Two-dimensional views require two-axis indexing.

### `index(view, row, col)`

Contract:

```text
index(x: view[d<=2], row: Scalar[number], col: Scalar[number]) -> value
```

`row` indexes the row axis.

`col` indexes the column axis.

Both indexes are zero-based and may be negative.

## Bracket Syntax

Bracket syntax is postfix syntax:

```text
expression[selector]
expression[rowSelector, colSelector]
```

It binds tighter than unary, power, arithmetic, comparison, and equality operators.

Examples:

```text
@[:,Name][0]
filter(@[:,Name], @[:,Score] > 90)[0]
@[:,Revenue:Cost][0, 1]
(@[:,Revenue] + 1)[-1]
```

### One-Axis Brackets

One-axis brackets are valid for text, `view[d=0]`, and `view[d=1]`.

```text
x[n]         -> scalar index
x[start:end] -> slice
```

For views, one-axis indexing uses row-major order.

For text:

```text
text[n]         -> one-character string
text[start:end] -> sliced string
```

Text indexes and slices operate on Unicode code points, matching RFC-0024 `len(...)` and `slice(...)`.

One-axis brackets are invalid for `view[d=2]`.

### Two-Axis Brackets

Two-axis brackets are valid for views.

```text
view[row, col]             -> value
view[row, colStart:colEnd] -> view[d=1]
view[rowStart:rowEnd, col] -> view[d=1]
view[rowStart:rowEnd, colStart:colEnd] -> view[d<=2]
```

The comma form is used instead of chained brackets:

```text
view[row, col]
```

This RFC does not define:

```text
view[row][col]
```

If an axis is a scalar index, that axis is removed from the result shape.

If an axis is a slice, that axis is preserved.

Examples:

```text
view[0, 1]     -> scalar
view[0, :]     -> row slice, view[d=1]
view[:, 1]     -> column slice, view[d=1]
view[0:2, 1:3] -> rectangular view
view[:, :]     -> same-shape view
```

Two-axis brackets are invalid for text.

## Final Result Rule

Indexing may return scalar values or views.

Existing final result rules still apply:

- scalar result -> valid final cell result
- `view[d=0]` -> scalarized by existing scalar context behavior
- `view[d=1]` or `view[d=2]` -> final cell result is `error`

View-returning indexes and slices are valid as intermediate expressions consumed by aggregate or other functions:

```text
sum(@[:,Revenue][0:3])
sum(@[:,Revenue:Cost][:, 0])
index(@[:,Revenue:Cost][0:2, 0:1], 0, 0)
```

## Parser Rules

`@[row,col]` remains reference syntax because it starts with `@`.

`error[kind]` remains error literal syntax.

Other postfix square brackets are parsed as indexing syntax.

The following produce parse errors:

```text
x[]
x[1, 2, 3]
x[1:2:3]
x[1,]
x[,1]
x[1 2]
x[1
x[1]]
```

## Error Policy

The following cases produce `error`:

- scalar index is not an integer
- scalar index is out of bounds
- slice bound is not an integer
- one-axis indexing is applied to `view[d=2]`
- two-axis indexing is applied to text
- `index(...)` receives a non-view first argument
- `index(view[d=2], n)` receives only one index
- selected view element is an error
- malformed bracket syntax parses as an error

## Future Work

- chained row/column extraction
- step slices
- boolean masks inside brackets
- lists of indexes
- `match(...)` and lookup functions
- `transpose(...)`
