# RFC-0025: Conditional Lazy Evaluation V1

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines Ordinate's first lazy logical forms:

```text
if(condition, thenValue, elseValue)
and(a, b, ...)
or(a, b, ...)
```

`if(...)` looks like a function call, but it is a lazy conditional special form. It evaluates the condition first, then evaluates only the selected branch.

Scalar multi-argument `and(...)` and `or(...)` are lazy logical special forms. They evaluate arguments from left to right and stop as soon as the result is determined.

## Motivation

Ordinary functions evaluate their arguments before the function receives them. That does not work for guarded conversions or guarded error-producing expressions.

Example:

```text
if(isNumber(x), number(x), 0)
```

If all arguments were evaluated eagerly, `number(x)` would still run when `x` is not numeric and the formula would fail. The correct conditional behavior is to evaluate `number(x)` only when `isNumber(x)` is true.

## Goals

This RFC defines:

- `if(condition, thenValue, elseValue)`
- lazy branch evaluation
- lazy scalar `and(...)` and `or(...)`
- scalar boolean condition requirements
- branch result behavior for scalar and view-valued branch expressions
- preservation of existing `and(view)` / `or(view)` reducer behavior
- error behavior for invalid conditions, selected branches, and evaluated logical operands

## Non-Goals

This RFC does not define:

- ternary operator syntax
- vectorized conditional selection over views
- Python truthiness
- `ifError(...)`
- `coalesce(...)`
- `case(...)` or `switch(...)`

## Conditional Form

Contract:

```text
if(condition: Scalar[boolean], thenValue: expression, elseValue: expression) -> value
```

Evaluation order:

1. evaluate `condition`
2. if `condition` is `true`, evaluate `thenValue` and return its result
3. if `condition` is `false`, evaluate `elseValue` and return its result

The unselected branch is not evaluated.

## Condition Semantics

The condition must evaluate to a scalar boolean.

Accepted:

```text
true
false
isNumber(x)
contains(text, search)
```

Rejected:

```text
number
string
blank
null
error
view[d=1]
view[d=2]
```

A scalar-shaped `view[d=0]` may satisfy the scalar condition rule through the existing scalar context behavior.

This RFC does not define Python truthiness or numeric truthiness for `if(...)`.

## Branch Semantics

Only the selected branch is evaluated.

Branch expressions may evaluate to any runtime value or view-valued intermediate expression.

The existing final-result rule still applies when an `if(...)` expression is used as the formula cell result:

- scalar branch result -> returned as the cell value
- `view[d=0]` branch result -> scalarized by existing scalar context behavior
- `view[d=1]` or `view[d=2]` branch result -> `error`

This means `if(...)` does not introduce dynamic arrays or final view display.

## Lazy Scalar Logical Forms

This RFC extends `and(...)` and `or(...)` with scalar multi-argument lazy behavior.

Contracts:

```text
and(a: Scalar[boolean], b: Scalar[boolean], ...) -> boolean
or(a: Scalar[boolean], b: Scalar[boolean], ...) -> boolean
```

Evaluation order is left to right.

For `and(...)`:

- evaluate each operand in order
- if an evaluated operand is `false`, return `false`
- do not evaluate later operands after the first `false`
- if all evaluated operands are `true`, return `true`

For `or(...)`:

- evaluate each operand in order
- if an evaluated operand is `true`, return `true`
- do not evaluate later operands after the first `true`
- if all evaluated operands are `false`, return `false`

Only evaluated operands can produce errors. Unevaluated operands do not affect the result.

Each evaluated scalar operand must be boolean. This RFC does not define Python truthiness or numeric truthiness for `and(...)` or `or(...)`.

Existing one-argument view reducer behavior remains valid:

```text
and(view[boolean]) -> boolean
or(view[boolean]) -> boolean
```

`all(...)` remains an alias for `and(...)`.

`any(...)` remains an alias for `or(...)`.

## Examples

Guard explicit conversion:

```text
if(isNumber(@[This,Score]), number(@[This,Score]), 0)
```

Avoid evaluating an invalid conversion:

```text
if(isText(@[This,Amount]), number(@[This,Amount]), 0)
```

Guard text slicing:

```text
if(contains(@[This,Code], "-"), slice(@[This,Code], 0, 3), @[This,Code])
```

Select aggregate branch:

```text
if(any(isError(@[:,Value])), 0, sum(@[:,Value]))
```

Lazy scalar conjunction:

```text
and(isNumber(x), number(x) > 0)
```

If `isNumber(x)` is false, `number(x) > 0` is not evaluated.

Lazy scalar disjunction:

```text
or(isBlank(x), len(x) == 0)
```

If `isBlank(x)` is true, `len(x) == 0` is not evaluated.

## Error Policy

The following cases produce `error`:

- `if(...)` receives the wrong number of arguments
- `and(...)` or `or(...)` receives no arguments
- `condition` evaluates to `error`
- `condition` is not a scalar boolean
- an evaluated `and(...)` or `or(...)` operand evaluates to `error`
- an evaluated `and(...)` or `or(...)` scalar operand is not boolean
- an evaluated multi-argument `and(...)` or `or(...)` operand is a non-scalar view
- the selected branch evaluates to `error`
- the selected branch evaluates to a non-scalar final view when used as the final cell result

The unselected branch does not affect the result, even if it would produce `error`.

Unevaluated lazy logical operands do not affect the result, even if they would produce `error`.

## Future Work

- ternary operator syntax
