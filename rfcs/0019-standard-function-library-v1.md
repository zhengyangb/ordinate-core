# RFC-0019: Standard Function Library V1

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the first standard built-in function library for Ordinate formulas.

Earlier RFCs define formula cells, scalar operators, view selection, and function contracts. This RFC promotes a small, practical subset of functions from illustrative examples into standardized core behavior and adds a small expression syntax extension for exponentiation.

The goal is not Excel or Numbers compatibility. The goal is a clear, deterministic, maintainable function set that supports ordinary spreadsheet-style calculations while preserving Ordinate's type and view model.

## Goals

This RFC defines:

- canonical built-in function names for V1
- function name normalization
- scalar numeric functions
- numeric aggregate functions over views
- boolean aggregate functions over views
- vector numeric functions
- exponentiation syntax using `**`
- blank, error, string, and boolean behavior for the V1 functions
- explicit deferrals for future expression syntax and compatibility work

## Non-Goals

This RFC does not define:

- a complete spreadsheet function library
- Excel or Numbers compatibility
- broad implicit coercion beyond rules explicitly defined here or inherited from earlier RFCs
- Python truthiness
- Python-style boolean infix syntax (`a and b`, `a or b`, `not a`)
- lazy conditional evaluation
- `if(...)`
- volatile functions such as `now()` or `today()`
- lookup/reference-returning functions
- dynamic-array or view-returning functions
- financial, engineering, or statistical advanced libraries
- namespace-qualified functions
- external plugin functions

## Prior RFC Context

This RFC builds on:

- RFC-0005, which defines formula cells and the single-value formula result model
- RFC-0006, which defines scalar operators and operator-specific coercion
- RFC-0007, which defines views, ranges, view dimensionality, and `sum` as a minimal aggregate example
- RFC-0008, which defines function contracts and illustrative functions
- RFC-0013, which allows spreadsheet-style references in formula-expression context

## Function Naming

Built-in function names are case-insensitive at parse/evaluation time.

Canonical function names are lowercase.

Examples:

- `sum(...)`
- `SUM(...)`
- `Sum(...)`

all refer to the canonical function `sum`.

Generated formula rendering should prefer canonical lowercase names when it creates new function calls. Source-preserving render paths may preserve user-authored spelling when no semantic rewrite is required.

## Compatibility Policy

Ordinate may borrow familiar function names from spreadsheet applications when the semantics are clear and useful.

However, this RFC does not promise Excel or Numbers compatibility.

In particular:

- function behavior is defined by Ordinate RFCs, not by another spreadsheet application's historical behavior
- compatibility aliases are not introduced unless explicitly listed
- broad spreadsheet-style implicit coercion is not introduced
- date serial numbers, financial calendar conventions, and volatile recalculation behavior are deferred

## Coercion Policy

Ordinate uses operator-specific coercion, not universal coercion.

Functions must choose one of these policies:

1. explicitly require a runtime type or contract type
2. inherit a specific operator's behavior
3. define function-local handling for `blank`, `boolean`, `string`, and `error`

Functions must not silently apply a broad global conversion rule.

## View Flattening

Aggregate functions that accept `view[d<=2]` flatten views in row-major order unless otherwise specified.

Row-major order means:

1. rows are processed from top to bottom
2. within each row, columns are processed from left to right

This matches RFC-0007.

## Standard Functions

### Existing Implemented Functions

The following functions already exist in the current TypeScript core implementation and are standardized by this RFC:

- `sum`
- `abs`
- `not`
- `dotProduct`

### V1 Function Set

The V1 standard function set is:

- `sum`
- `product`
- `average`
- `min`
- `max`
- `count`
- `counta`
- `and`
- `or`
- `abs`
- `round`
- `floor`
- `ceil`
- `mod`
- `power`
- `sqrt`
- `pi`
- `gcd`
- `lcm`
- `not`
- `dotProduct`

Implementations may stage delivery, but conformance to this RFC requires the full V1 function set.

## Numeric Aggregate Functions

Numeric aggregate functions accept one argument:

```text
functionName(x: view[d<=2]) -> number
```

A `view[d=0]` is accepted as a one-cell aggregate input.

Scalar non-view arguments do not satisfy numeric aggregate contracts in V1.

### `sum`

Contract:

```text
sum(x: view[d<=2]) -> number
```

Semantics:

- flatten `x` in row-major order
- start from numeric zero
- reduce using the `+` operator from RFC-0006

Because `sum` reduces with `+`, it inherits `+` behavior for `blank` and `boolean`.

Consequences:

- `blank` contributes `0` when combined with the numeric accumulator
- `boolean` contributes `1` for `true` and `0` for `false`
- `string` produces `error`
- `error` propagates
- `sum(empty_view) = 0`

### `product`

Contract:

```text
product(x: view[d<=2]) -> number
```

Semantics:

- flatten `x` in row-major order
- start from numeric one
- reduce using the `*` operator from RFC-0006

Consequences:

- `blank` contributes `0` when combined with the numeric accumulator
- `boolean` contributes `1` for `true` and `0` for `false`
- `string` produces `error`
- `error` propagates
- `product(empty_view) = 1`

### `average`

Contract:

```text
average(x: view[d<=2]) -> number
```

Semantics:

- flatten `x` in row-major order
- accept numeric values
- accept `blank` as absent from the denominator
- reject `string`
- reject `boolean`
- propagate `error`

The result is:

```text
sum_of_numeric_values / numeric_value_count
```

If there are no numeric values, the result is `error`.

### `min`

Contract:

```text
min(x: view[d<=2]) -> number
```

Semantics:

- flatten `x` in row-major order
- accept numeric values
- ignore `blank`
- reject `string`
- reject `boolean`
- propagate `error`

If there are no numeric values, the result is `error`.

### `max`

Contract:

```text
max(x: view[d<=2]) -> number
```

Semantics:

- flatten `x` in row-major order
- accept numeric values
- ignore `blank`
- reject `string`
- reject `boolean`
- propagate `error`

If there are no numeric values, the result is `error`.

### `count`

Contract:

```text
count(x: view[d<=2]) -> number
```

Semantics:

- flatten `x` in row-major order
- count cells whose evaluated value is `number`
- do not count `blank`
- do not count `string`
- do not count `boolean`
- propagate `error`

`count(empty_view) = 0`.

### `counta`

Contract:

```text
counta(x: view[d<=2]) -> number
```

Semantics:

- flatten `x` in row-major order
- count cells whose evaluated value is not `blank`
- count `number`
- count `string`
- count `boolean`
- propagate `error`

`counta(empty_view) = 0`.

## Boolean Aggregate Functions

Boolean aggregate functions accept one argument:

```text
functionName(x: view[d<=2]) -> boolean
```

They are eager aggregate functions. They do not short-circuit.

They require boolean elements.

### `and`

Contract:

```text
and(x: view[d<=2]) -> boolean
```

Semantics:

- flatten `x` in row-major order
- require every non-error element to be `boolean`
- propagate `error`
- reject `blank`
- reject `number`
- reject `string`
- return `true` only when every element is `true`
- `and(empty_view) = true`

### `or`

Contract:

```text
or(x: view[d<=2]) -> boolean
```

Semantics:

- flatten `x` in row-major order
- require every non-error element to be `boolean`
- propagate `error`
- reject `blank`
- reject `number`
- reject `string`
- return `true` when at least one element is `true`
- `or(empty_view) = false`

## Scalar Numeric Functions

Scalar numeric functions accept scalar numeric arguments.

A `view[d=0]` may satisfy a scalar numeric contract if its single cell evaluates to `number`.

### `abs`

Contract:

```text
abs(x: Scalar[number]) -> number
```

Returns the absolute value of `x`.

### `round`

Contract:

```text
round(x: Scalar[number], digits: Scalar[number]) -> number
```

Returns `x` rounded to `digits` decimal places.

`digits` must be an integer.

Negative `digits` are allowed and round to positions left of the decimal point.

Examples:

- `round(12.345, 2) -> 12.35`
- `round(1234, -2) -> 1200`

### `floor`

Contract:

```text
floor(x: Scalar[number]) -> number
```

Returns the greatest integer less than or equal to `x`.

### `ceil`

Contract:

```text
ceil(x: Scalar[number]) -> number
```

Returns the least integer greater than or equal to `x`.

### `mod`

Contract:

```text
mod(x: Scalar[number], divisor: Scalar[number]) -> number
```

Returns the remainder after dividing `x` by `divisor`.

If `divisor` is zero, the result is `error`.

### `power`

Contract:

```text
power(base: Scalar[number], exponent: Scalar[number]) -> number
```

Returns `base` raised to `exponent`.

Invalid numeric results, such as unsupported real-number exponentiation, produce `error`.

### `sqrt`

Contract:

```text
sqrt(x: Scalar[number]) -> number
```

Returns the square root of `x`.

If `x` is negative, the result is `error`.

### `pi`

Contract:

```text
pi() -> number
```

Returns the mathematical constant π as an implementation-defined floating-point approximation.

## Integer Numeric Functions

Integer numeric functions accept integer numeric values.

They do not inherit the arithmetic operator coercion rules from RFC-0006.

They reject:

- non-integer numbers
- `blank`
- `boolean`
- `string`
- `error`

### `gcd`

Contract:

```text
gcd(x: view[d<=2]) -> number
```

Semantics:

- flatten `x` in row-major order
- require every element to be an integer number
- use absolute values
- `gcd(empty_view) = 0`
- `gcd(0, 0, ...) = 0`

### `lcm`

Contract:

```text
lcm(x: view[d<=2]) -> number
```

Semantics:

- flatten `x` in row-major order
- require every element to be an integer number
- use absolute values
- `lcm(empty_view) = 1`
- if any element is `0`, the result is `0`

## Logical Scalar Function

### `not`

Contract:

```text
not(x: Scalar[boolean]) -> boolean
```

Returns logical negation.

`not` rejects `blank`, `number`, and `string`.

## Vector Numeric Function

### `dotProduct`

Contract:

```text
dotProduct(x: view[d=1], y: view[d=1]) -> number
```

Semantics:

- both arguments must be one-dimensional views
- both vectors must have the same length
- every element must be `number`
- multiply pairwise and sum the products
- propagate `error`

`blank`, `boolean`, and `string` elements are invalid.

## Exponentiation Operator

This RFC adds exponentiation syntax:

```text
left ** right
```

`left ** right` is equivalent to:

```text
power(left, right)
```

### Precedence

`**` has higher precedence than `*`, `/`, `+`, and `-`.

Examples:

```text
2 + 3 ** 2 = 11
(2 + 3) ** 2 = 25
```

### Associativity

`**` is right-associative.

Example:

```text
2 ** 3 ** 2 = 2 ** (3 ** 2)
```

### Unary Minus

`**` binds more tightly than unary minus.

Examples:

```text
-2 ** 2 = -(2 ** 2)
(-2) ** 2 = 4
```

## Error Policy

Unless a function explicitly defines special handling:

- `error` arguments propagate
- invalid arity produces `error`
- invalid argument type produces `error`
- invalid view dimensionality produces `error`
- invalid numeric domain produces `error`

Structured error kind modeling follows RFC-0015.

## Examples

```text
= sum(@[:,2025])
= average(@["Revenue",:])
= min(@[#2:#10,#2])
= max(@[#2:#10,#2])
= count(@[:,2025])
= counta(@[:,2025])
= product(@["Factors",:])
= abs(-3)
= round(12.345, 2)
= floor(12.9)
= ceil(12.1)
= mod(10, 3)
= power(2, 8)
= 2 ** 8
= sqrt(81)
= pi()
= gcd(@["Values",:])
= lcm(@["Values",:])
= not(true)
= and(@["Flags",:])
= or(@["Flags",:])
= dotProduct(@["Price",:], @["Qty",:])
```

## Deferred Topics

- Python-style boolean expression syntax (`a and b`, `a or b`, `not a`)
- short-circuit boolean operators
- `if(...)` and lazy conditional branch evaluation
- variadic scalar calls such as `sum(a, b, c)`
- list literals
- `median`
- `percentile`
- `sumIf`, `countIf`, and criteria syntax
- text functions such as `lower`, `upper`, `trim`, and `len`
- explicit conversion functions such as `toNumber`
- type predicates such as `isBlank` and `isError`
- temporal functions
- lookup functions
- view-returning functions
- volatile functions
- Excel or Numbers compatibility profiles

## Current Working Assumptions

- function names are case-insensitive
- canonical function names are lowercase
- functions are part of the core formula language, not app/editor behavior
- aggregate functions consume views
- scalar functions may accept `view[d=0]` where RFC-0008 permits scalar contracts
- `sum` and `product` inherit operator-specific arithmetic behavior
- other aggregate functions define their own element policies explicitly
- boolean `and` and `or` are eager aggregate functions in this RFC
- Python-style boolean operators are deferred to a future expression syntax RFC
- formulas still produce a single runtime value
