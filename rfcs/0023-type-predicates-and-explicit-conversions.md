# RFC-0023: Type Predicates and Explicit Conversions

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines type predicate and explicit conversion functions for Ordinate formulas.

It adds:

```text
isNumber(x)
isText(x)
isBoolean(x)
isBlank(x)
isNull(x)
isError(x)

number(x)
text(x)
boolean(x)

all(x)  # alias of and(x)
any(x)  # alias of or(x)
not(x)  # scalar or element-wise view negation
```

The RFC reuses the view-valued expression and broadcasting model from RFC-0020 and RFC-0021.

## Motivation

RFC-0022 allows booleans to participate in numeric-compatible statistical functions. That is useful for concise formulas such as:

```text
average(@[:,Passed])
```

Users also need explicit ways to validate or convert imported and mixed data:

```text
all(isNumber(@[:,Score]))
average(filter(@[:,Score], isNumber(@[:,Score])))
average(number(@[:,ImportedAmount]))
"SKU-" + text(@[:,Code])
```

This RFC provides those primitives without introducing new syntax.

## Goals

This RFC defines:

- element-wise type predicates
- element-wise explicit conversions
- `all(...)` and `any(...)` aliases for boolean reducers
- element-wise `not(view[boolean])`
- error behavior for invalid conversions

## Non-Goals

This RFC does not define:

- `x is number` syntax
- `typeOf(...)`
- named parameters
- broad or locale-dependent text parsing
- fallback conversion behavior
- partially valid views with embedded conversion errors

## Type Predicates

Predicates return booleans.

For scalar inputs:

```text
isNumber(1)      -> true
isText("x")      -> true
isBoolean(true)  -> true
isBlank(blank)   -> true
isNull(null)     -> true
isError(error[x]) -> true
```

For view inputs:

```text
predicate(view[d<=2]) -> view[d<=2]
```

The output view has the same shape as the input view and contains boolean values.

Examples:

```text
isNumber(@[:,Score])
isBlank(@[:,Optional])
isError(@[:,Result])
```

Predicates inspect error values instead of propagating them. For example:

```text
isError(error[bad]) -> true
isNumber(error[bad]) -> false
```

## Explicit Conversions

Conversions return converted scalar values or converted views.

For scalar inputs:

```text
number(x)  -> number
text(x)    -> string
boolean(x) -> boolean
```

For view inputs:

```text
conversion(view[d<=2]) -> view[d<=2]
```

The output view has the same shape as the input view.

Conversion errors fail the whole expression. This RFC does not define partially valid converted views.

### `number(x)`

Accepted:

```text
number(number)       -> same number
number(boolean)      -> 1 for true, 0 for false
number(numeric text) -> parsed number
```

Rejected:

```text
number(blank)
number(null)
number(non-numeric text)
number(date/time/datetime/duration)
number(error)
```

Errors propagate.

Numeric text is parsed with a strict decimal grammar. Locale-specific number formats are not supported.

### `text(x)`

Accepted:

```text
text(string)   -> same string
text(number)   -> canonical number string
text(boolean)  -> "true" or "false"
text(blank)    -> ""
text(null)     -> "null"
text(date/time/datetime/duration) -> canonical stored string
```

Errors propagate.

### `boolean(x)`

Accepted:

```text
boolean(boolean) -> same boolean
boolean(number)  -> false for 0, true for non-zero
boolean("true")  -> true
boolean("false") -> false
```

Rejected:

```text
boolean(blank)
boolean(null)
boolean(other text)
boolean(date/time/datetime/duration)
boolean(error)
```

String parsing is strict and only accepts `"true"` and `"false"`.

## Boolean Reducer Aliases

RFC-0019 defines:

```text
and(view[boolean]) -> boolean
or(view[boolean])  -> boolean
```

This RFC adds aliases:

```text
all(x) -> and(x)
any(x) -> or(x)
```

These are aliases, not separate evaluators.

## Element-wise `not`

`not(...)` supports both scalar and view inputs:

```text
not(boolean) -> boolean
not(view[boolean]) -> view[boolean]
```

The view output has the same shape as the input view.

This makes predicate composition concise:

```text
filter(@[:,Score], not(isBlank(@[:,Score])))
```

## Examples

Validate a numeric column:

```text
all(isNumber(@[:,Score]))
```

Average only numeric values in a mixed column:

```text
average(filter(@[:,Score], isNumber(@[:,Score])))
```

Count blank cells:

```text
sum(isBlank(@[:,Optional]))
```

Convert imported numeric text:

```text
average(number(@[:,ImportedAmount]))
```

Convert IDs to text before concatenation:

```text
"SKU-" + text(@[:,Code])
```

## Error Policy

The following cases produce `error`:

- conversion receives an unsupported value kind
- `number(...)` receives non-numeric text
- `boolean(...)` receives text other than `"true"` or `"false"`
- conversion input contains an error
- `not(...)`, `and(...)`, `or(...)`, `all(...)`, or `any(...)` receives non-boolean included values

Predicates do not propagate input errors. They inspect them.

## Future Work

- `x is number` syntax sugar
- `typeOf(...)`
- strict assertion functions such as `requireNumber(...)`
- locale-aware numeric text parsing
- explicit missing-value functions such as `fillBlank(x, replacement)`
