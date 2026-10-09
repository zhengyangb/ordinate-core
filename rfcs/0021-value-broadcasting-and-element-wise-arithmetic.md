# RFC-0021: Value Broadcasting and Element-wise Arithmetic

- Status: Draft
- Project: Ordinate

> RFC-0053 supersedes this RFC's exact-shape binary-operator rule with
> anchored broadcasting across scalar, Array, and View values.

## Summary

This RFC extends Ordinate view-valued formula expressions with element-wise arithmetic broadcasting.

RFC-0020 defines view-valued intermediate expressions, scalar broadcasting for comparisons, exact-shape view-to-view comparison, and `filter(...)`.

This RFC applies the same view model to arithmetic operators:

```text
view + scalar -> view
scalar + view -> view
view + view   -> view, if shapes match exactly
```

Supported operators:

```text
+ - * / **
```

## Motivation

Many useful formulas operate over whole rows, columns, or rectangular regions before reducing the result with an aggregate.

Examples:

```text
= sum(@[:,Price] * @[:,Qty])
= average((@[:,Revenue] - @[:,Cost]) / @[:,Revenue])
= sum((@[:,Actual] - @[:,Budget]) ** 2)
```

Without element-wise arithmetic, these patterns require specialized functions such as `sumproduct(...)` or helper columns.

Element-wise arithmetic gives the formula language a smaller and more composable core.

## Goals

This RFC defines:

- arithmetic broadcasting between views and scalars
- element-wise arithmetic between exact-shape views
- result shape rules
- aggregate consumption of arithmetic views
- error behavior for invalid element operations and incompatible shapes
- preservation of the scalar final-result rule from RFC-0020

## Non-Goals

This RFC does not define:

- NumPy-style dimensional broadcasting
- matrix multiplication
- dot product as an operator
- dynamic arrays or spreadsheet-style spill output
- formula cells whose final displayed value is a non-scalar view
- shape transforms such as transpose or reshape
- lambda expressions
- partially valid views with embedded arithmetic errors

## Prior RFC Context

This RFC builds on:

- RFC-0006, which defines scalar arithmetic operators and operator-specific coercion
- RFC-0019, which defines `power(...)`, `**`, aggregate functions, and `sumproduct` as a `dotProduct` alias
- RFC-0020, which defines view-valued intermediate expressions, exact-shape view operations, and `filter(...)`

## Arithmetic Broadcasting

This RFC extends arithmetic operators to support views.

Supported operators:

```text
+ - * / **
```

Supported forms:

```text
view op scalar -> view
scalar op view -> view
view op view   -> view, if shapes match exactly
```

The output view has the same shape as the input view for scalar broadcasting, or the shared shape for view-to-view arithmetic.

Examples:

```text
@[:,Revenue] * 1.1
100 + @[:,Delta]
@[:,Price] * @[:,Qty]
(@[:,Actual] - @[:,Budget]) ** 2
```

## Shape Rules

View-to-view arithmetic requires exact shape equality.

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

If larger broadcasting semantics are needed later, they should be introduced by explicit functions or a separate RFC.

## Element Semantics

Element-wise arithmetic uses the existing scalar arithmetic rules for each corresponding element.

For `+`, `-`, `*`, and `/`, each element operation uses RFC-0006 scalar arithmetic.

For `**`, each element operation uses the `power(...)` / `**` semantics from RFC-0019.

If any element operation produces `error`, the whole arithmetic expression produces `error`.

This RFC does not define partially valid views with embedded errors.

## Aggregate Consumption

Aggregate functions that accept `view[d<=2]` may consume arithmetic views.

Examples:

```text
= sum(@[:,Price] * @[:,Qty])
= average(@[:,Revenue] * 1.1)
= sum((@[:,Actual] - @[:,Budget]) ** 2)
```

The aggregate function receives a view-valued intermediate result and reduces it to a scalar.

## Final Result Rule

Formula cells still produce scalar final values in V1.

If a formula expression evaluates to `view[d=1]` or `view[d=2]` as the final cell result, evaluation produces `error`.

Examples:

```text
= @[:,Revenue] * 1.1
```

produces `error` as a final cell result.

```text
= sum(@[:,Revenue] * 1.1)
```

is valid because `sum(...)` consumes the view and returns a scalar.

## Examples

### Sum Product Without Special Syntax

```text
# Sales
| Item || Price | Qty | Revenue |
| ---- || ----- | --- | ------- |
| A    || 2     | 4   |         |
| B    || 3     | 5   |         |
| Total ||      |     | = sum(@[#2:#3,Price] * @[#2:#3,Qty]) |
```

Result:

```text
23
```

### Percent Margin

```text
= average((@[:,Revenue] - @[:,Cost]) / @[:,Revenue])
```

### Squared Error

```text
= sum((@[:,Actual] - @[:,Budget]) ** 2)
```

### Arithmetic With Filter

```text
= sum(filter(@[:,Price] * @[:,Qty], @[:,Region] == "West"))
```

## Error Policy

The following cases produce `error`:

- final formula result is `view[d=1]` or `view[d=2]`
- view-to-view arithmetic has incompatible shapes
- an element operation fails scalar arithmetic rules
- an element operation divides by zero
- an element `**` operation produces an invalid numeric result
- an unsupported operator is applied to a view

Errors in input values propagate.

## Interaction With Existing Functions

This RFC makes some specialized functions less necessary but does not remove them.

For example:

```text
sumproduct(@[:,Price], @[:,Qty])
```

is equivalent to:

```text
sum(@[:,Price] * @[:,Qty])
```

for exact-shape numeric views.

`sumproduct` remains available as a compatibility alias for `dotProduct`.

## Deferred Topics

- NumPy-style broadcasting
- matrix multiplication
- shape-preserving arithmetic outputs as final cell values
- dynamic arrays and spill output
- explicit broadcast functions
- shape transforms such as `transpose` and `reshape`
- linear algebra functions

## Current Working Assumptions

- `view[d]` remains the public model for shaped formula values
- view storage or backing is not exposed by the formula language
- arithmetic broadcasting follows RFC-0020 exact shape rules
- element operations reuse existing scalar operator semantics
- formula cells still produce scalar final values in V1
