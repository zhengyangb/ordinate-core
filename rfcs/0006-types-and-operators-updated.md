# RFC-0006: Types and Operators

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the initial runtime type model and operator semantics for Ordinate.

It focuses on scalar values and scalar operators. It defines the core value categories, the basic behavior of arithmetic and comparison operators, the role of blank and error, the current direction for implicit coercion, and the use of lowercase `not(...)` as the logical negation function.

## Goals

This RFC defines:

- the initial runtime value categories
- basic operator behavior for scalar values
- the role of blank in unary and binary operators
- the role of boolean values in arithmetic
- the role of error propagation
- the current policy for implicit coercion
- which comparisons are allowed in the first version
- the use of `not(...)` for logical negation

## Non-Goals

This RFC does not define:

- range or collection values
- aggregate operators over collections
- date or datetime semantics
- formatting metadata such as currency or percentage
- schema enforcement
- advanced function library behavior
- localization rules for text comparison
- explicit conversion functions

## Runtime Value Categories

The current working runtime value categories are:

- `number`
- `string`
- `boolean`
- `blank`
- `error`

This RFC does not include `date` as a first-class runtime type.

This RFC treats formatting-oriented spreadsheet concepts such as currency, percentage, and accounting display as deferred concerns. They are not core runtime types in this RFC.

## Blank

`blank` is not treated as an ordinary scalar value like number or string.

Instead, it is a special empty-cell state that may participate in some operations through operator-specific coercion.

The current direction is:

- unary operators should prefer to preserve `blank`
- binary operators may coerce `blank` differently depending on operator context
- `blank` is not globally equivalent to `0` or `""`

## Error

`error` is a first-class evaluated value.

It propagates through operators unless a future RFC defines operator- or function-specific handling.

## Coercion Policy

Ordinate does not define a universal implicit conversion rule.

Instead, coercion is operator-specific.

Current working direction:

- in numeric arithmetic, `blank` may coerce to `0`
- in string concatenation, `blank` may coerce to `""`
- in equality, `blank` is only equal to `blank`
- in ordering comparisons, `blank` is invalid
- in numeric arithmetic, `boolean` may coerce to `1` or `0`
- `error` propagates through all operators

## Unary Operators

### Unary Minus

Current working behavior:

- `-number -> number`
- `-blank -> blank`
- `-string -> error`
- `-boolean -> error`
- `-error -> error`

Examples:

- `-3 -> -3`
- `-blank -> blank`

## Logical Negation Function

Current working behavior:

- `not(boolean) -> boolean`
- `not(blank) -> error`
- `not(number) -> error`
- `not(string) -> error`
- `not(error) -> error`

Examples:

- `not(true) -> false`
- `not(false) -> true`

Future RFCs may introduce shorter syntax as sugar for logical negation.

## Binary Arithmetic Operators

This RFC discusses the following arithmetic operators:

- `+`
- `-`
- `*`
- `/`

### Addition

Current working behavior:

- `number + number -> number`
- `string + string -> string` as concatenation
- `blank + number -> number` with `blank -> 0`
- `number + blank -> number` with `blank -> 0`
- `blank + string -> string` with `blank -> ""`
- `string + blank -> string` with `blank -> ""`
- `blank + blank -> blank`
- `boolean + number -> number` with `boolean -> 1/0`
- `number + boolean -> number` with `boolean -> 1/0`
- `boolean + boolean -> number` with `boolean -> 1/0`
- `error + anything -> error`
- all other combinations -> `error`

### Subtraction

Current working behavior:

- `number - number -> number`
- `blank - number -> number` with `blank -> 0`
- `number - blank -> number` with `blank -> 0`
- `blank - blank -> blank`
- `boolean - number -> number` with `boolean -> 1/0`
- `number - boolean -> number` with `boolean -> 1/0`
- `boolean - boolean -> number` with `boolean -> 1/0`
- `error - anything -> error`
- all other combinations -> `error`

### Multiplication

Current working behavior:

- `number * number -> number`
- `blank * number -> number` with `blank -> 0`
- `number * blank -> number` with `blank -> 0`
- `blank * blank -> blank`
- `boolean * number -> number` with `boolean -> 1/0`
- `number * boolean -> number` with `boolean -> 1/0`
- `boolean * boolean -> number` with `boolean -> 1/0`
- `error * anything -> error`
- all other combinations -> `error`

### Division

Current working behavior:

- `number / number -> number`, unless divisor is zero
- `blank / number -> number` with `blank -> 0`
- `number / blank -> error`
- `blank / blank -> error`
- `boolean / number -> number` with `boolean -> 1/0`, unless divisor is zero
- `number / boolean -> number` with `boolean -> 1/0`, unless divisor becomes zero
- `boolean / boolean -> number` with `boolean -> 1/0`, unless divisor becomes zero
- `error / anything -> error`
- all other combinations -> `error`

## Equality and Inequality

This RFC allows equality and inequality comparisons for selected scalar types.

Current working behavior:

- `number == number -> boolean`
- `number != number -> boolean`
- `string == string -> boolean`
- `string != string -> boolean`
- `boolean == boolean -> boolean`
- `boolean != boolean -> boolean`
- `blank == blank -> true`
- `blank != blank -> false`
- `blank == other -> false`
- `blank != other -> true`
- `error == anything -> error`
- `error != anything -> error`

This RFC does not define broad implicit cross-type comparison.

For example:

- `number == string -> error`
- `string == boolean -> error`

## Ordering Comparisons

This RFC discusses:

- `<`
- `<=`
- `>`
- `>=`

Current working behavior:

- `number` with `number` is allowed
- `string` ordering is not allowed in this RFC
- `blank` in ordering comparisons is invalid
- `error` in ordering comparisons propagates
- mixed-type ordering is invalid

Examples:

- `3 < 5 -> true`
- `"a" < "b" -> error`
- `blank < 1 -> error`

## String Operations

This RFC adopts the following working direction:

- `string + string` is allowed and means concatenation
- `string == string` and `string != string` are allowed
- string ordering is deferred and currently invalid
- `string + number` is invalid
- `number + string` is invalid

## Boolean Arithmetic

This RFC allows booleans to participate in numeric arithmetic through operator-specific coercion to `1` or `0`.

Examples:

- `true + 1 -> 2`
- `false + 1 -> 1`
- `true * 5 -> 5`
- `false * 5 -> 0`
- `true + true -> 2`

This RFC still treats `boolean` as a distinct runtime type, not as a subtype of `number`.

## Examples

### Valid Cases

- `3 + 2 -> 5`
- `"foo" + "bar" -> "foobar"`
- `blank + 3 -> 3`
- `3 + blank -> 3`
- `"foo" + blank -> "foo"`
- `blank + "bar" -> "bar"`
- `blank + blank -> blank`
- `blank - blank -> blank`
- `blank * blank -> blank`
- `blank == blank -> true`
- `3 < 5 -> true`
- `true + 1 -> 2`
- `true * 5 -> 5`
- `not(true) -> false`

### Invalid or Error-Producing Cases

- `"3" + 2 -> error`
- `2 + "3" -> error`
- `"a" < "b" -> error`
- `blank < 1 -> error`
- `2 / blank -> error`
- `not(1) -> error`
- `not("yes") -> error`

## Deferred Topics

- `date`, `datetime`, and duration values
- formatting and metadata such as currency, percentage, accounting, and precision
- collection-valued operators
- aggregate semantics over ranges or collections
- locale-aware string comparison
- explicit conversion functions
- richer structured error values
- shorter syntax sugar for logical negation

## Open Questions

- whether booleans should remain included in arithmetic permanently
- whether future versions should allow string ordering under explicit rules
- whether `blank` should be treated differently in arithmetic versus aggregation

## Current Working Assumptions

- Ordinate uses operator-specific coercion rather than universal coercion
- `blank` is preserved by unary minus
- `string + string` means concatenation
- string ordering is not allowed in this RFC
- `error` propagates through all operators
- `boolean` may coerce to `1` or `0` in numeric arithmetic
- `not(...)` is the logical negation form in this RFC
- currency and percentage are deferred as formatting or metadata concerns, not core runtime types
