# RFC-0028: Formula Lookup and Selection V1

- Status: Draft
- Project: Ordinate

> RFC-0052 supersedes the `view[d]` notation in these function contracts.
> Arrays are one-dimensional; views retain two explicit axes. Functions that
> consume vectors may accept either where their current runtime contract does.

## Summary

This RFC defines formula functions for locating values and expressing common selections:

```text
match(value, keys) -> number
lookup(key, keys, values) -> value
take(value, count) -> value
drop(value, count) -> value
```

`match` is the primitive search operation. `lookup`, `take`, and `drop` are convenience functions with explicit equivalences to existing primitives.

## Motivation

RFC-0020 introduced `filter`.

RFC-0026 introduced bracket indexing and slicing:

```text
x[0]
x[-1]
x[:3]
x[-3:]
x[1:]
x[:-1]
```

RFC-0027 introduced shape inspection:

```text
size(x)
shape(x)[0]
shape(x)[1]
```

Together, these make lookup and selection possible, but common formulas are still noisy:

```text
@[:,Score][match("Beta", @[:,Name])]
@[:,Name][:3]
@[:,Name][1:]
```

This RFC gives those common operations stable names while keeping their behavior tied to the existing primitive semantics.

## Goals

This RFC defines:

- exact-match position search
- zero-based `match`
- lookup-table value retrieval
- `take` as a slice convenience function
- `drop` as a slice convenience function
- equivalences to bracket indexing and slicing
- error behavior for not-found, shape mismatch, invalid count, and invalid input types

## Non-Goals

This RFC does not define:

- Excel-compatible one-based `MATCH`
- approximate match
- wildcard match
- regex match
- case-insensitive match
- multi-key lookup
- `xlookup`
- explicit `if_not_found` fallback arguments
- column-taking or column-dropping parameters for two-dimensional views
- final view display or dynamic arrays

## Naming

### `match`

`match` follows spreadsheet naming. Excel and Numbers use `MATCH` for finding a value in a range and returning its position.

Ordinate differs in one important way: `match` returns a zero-based index because RFC-0026 bracket indexing is zero-based.

### `lookup`

`lookup` names the common lookup-table operation:

```text
lookup(key, keys, values)
```

It is not a new primitive. It is equivalent to:

```text
values[match(key, keys)]
```

### `take` and `drop`

`take` and `drop` are also spreadsheet-style names. Modern Excel includes `TAKE` and `DROP`.

In Ordinate, they are explicit slice conveniences rather than separate slicing semantics.

## Functions

### `match(value, keys)`

Contract:

```text
match(value: value, keys: view[d<=2]) -> number
```

`match` searches `keys` in row-major order and returns the zero-based index of the first exact match.

Example:

```text
match("Beta", @[:,Name]) -> 1
```

`match` uses the same scalar equality semantics as the `==` operator. This keeps formula comparison behavior centralized.

If no value matches, `match` returns `error`.

### `lookup(key, keys, values)`

Contract:

```text
lookup(key: value, keys: view[d<=1], values: view[d<=1]) -> value
```

`lookup` searches `keys`, then returns the value at the matching row-major position in `values`.

It is equivalent to:

```text
values[match(key, keys)]
```

Examples:

```text
lookup("Beta", @[:,Name], @[:,Score])
@[:,Score][match("Beta", @[:,Name])]
```

`keys` and `values` must have the same row-major length. They may have different one-dimensional orientation, such as a column vector of keys and a row vector of values.

Two-dimensional lookup tables are not part of this RFC. Use `match` and explicit bracket indexing when a formula needs custom two-dimensional behavior.

### `take(value, count)`

Contract:

```text
take(x: text, count: Scalar[number]) -> text
take(x: view[d<=2], count: Scalar[number]) -> view[d<=2]
```

`count` must be an integer.

For text and one-dimensional views:

```text
take(x, n)  == x[:n]   when n >= 0
take(x, -n) == x[-n:]  when n > 0
```

For two-dimensional views, `take` selects rows and preserves all columns:

```text
take(x, n)  == x[:n, :]   when n >= 0
take(x, -n) == x[-n:, :]  when n > 0
```

### `drop(value, count)`

Contract:

```text
drop(x: text, count: Scalar[number]) -> text
drop(x: view[d<=2], count: Scalar[number]) -> view[d<=2]
```

`count` must be an integer.

For text and one-dimensional views:

```text
drop(x, n)  == x[n:]   when n >= 0
drop(x, -n) == x[:-n]  when n > 0
```

For two-dimensional views, `drop` removes rows and preserves all columns:

```text
drop(x, n)  == x[n:, :]   when n >= 0
drop(x, -n) == x[:-n, :]  when n > 0
```

## Error Behavior

`match` returns `error` when no match exists.

`lookup` returns `error` when:

- no matching key exists
- `keys` and `values` have different row-major lengths
- `keys` or `values` is two-dimensional

`take` and `drop` return `error` when:

- `count` is not a scalar integer number
- `value` is neither text nor a view
- an input expression evaluates to error

`take` and `drop` use RFC-0026 slice bounds. Counts larger than the available axis are clamped.

## Future Work

Future RFCs may add `xlookup`, approximate match, case-insensitive match, wildcard match, regex match, multi-key lookup, or explicit `if_not_found` fallback arguments.
