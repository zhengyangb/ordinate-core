# RFC-0024: Text Function Library V1

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines Ordinate's first text function set.

It adds:

```text
len(x)
lower(x)
upper(x)
trim(x)
contains(text, search)
startsWith(text, prefix)
endsWith(text, suffix)
replace(text, search, replacement)
slice(text, start)
slice(text, start, end)
join(separator, x)
```

The goal is a small, composable text library that works with scalar values and view-valued intermediate expressions.

## Motivation

Imported tables often need text cleanup and matching before aggregation.

Examples:

```text
filter(@[:,Name], contains(lower(@[:,Name]), "smith"))
sum(startsWith(@[:,Code], "A-"))
"SKU-" + text(@[:,Id])
join(", ", filter(@[:,Tag], not(isBlank(@[:,Tag]))))
```

Ordinate already supports string concatenation with `+`. This RFC does not add `concat(...)`.

## Goals

This RFC defines:

- scalar text functions
- element-wise text functions over views
- scalar broadcasting and exact-shape view matching for multi-argument text functions
- `len(...)` as text character count, not view cardinality
- `slice(...)` indexing rules
- `replace(...)` literal replace-all semantics
- `join(...)` as a text reducer over views
- error behavior for invalid inputs

## Non-Goals

This RFC does not define:

- method syntax such as `x.lower()`
- bracket slice syntax such as `x[0:3]`
- regular expressions
- locale-aware case mapping
- case-insensitive matching options
- fuzzy matching
- wildcard criteria strings
- `concat(...)`
- view shape functions such as `rows(...)`, `cols(...)`, or `size(...)`

## Text Input Policy

Text functions require text values unless explicitly stated otherwise.

Accepted:

```text
string -> string input
```

Rejected:

```text
number
boolean
blank
null
date
time
datetime
duration
error
```

Errors propagate.

Users who want explicit conversion must call `text(...)` from RFC-0023:

```text
lower(text(@[:,Code]))
join(", ", text(@[:,Id]))
```

## Element-wise View Semantics

Most text functions are element-wise.

For one-argument functions:

```text
lower(text) -> string
lower(view[d<=2]) -> view[d<=2]
```

The output view has the same shape as the input view.

For multi-argument text functions, scalar text arguments broadcast over view arguments:

```text
contains(view, scalar) -> view
contains(scalar, view) -> view
contains(view, view) -> view, if shapes match exactly
```

If multiple view arguments are present, they must have exactly the same shape.

This RFC does not support NumPy-style dimensional broadcasting.

## Character Model

Text length and slicing operate on Unicode code points.

This avoids JavaScript UTF-16 code-unit behavior for surrogate pairs. It does not attempt full grapheme-cluster segmentation.

## Functions

### `len`

Contract:

```text
len(x: string) -> number
len(x: view[d<=2]) -> view[d<=2]
```

`len(...)` returns the number of characters in text.

For views, `len(view)` applies element-wise to text values and returns a same-shape numeric view.

`len(...)` is a text function, not a view-shape function. It does not return the number of cells in a view.

Use aggregate functions such as `counta(...)`, or future shape functions such as `rows(...)` and `cols(...)`, for view cardinality or shape.

### `lower`, `upper`, and `trim`

Contracts:

```text
lower(x: string) -> string
upper(x: string) -> string
trim(x: string) -> string
```

For views, each function applies element-wise and preserves shape.

`lower(...)` and `upper(...)` use locale-independent Unicode case mapping.

`trim(...)` removes leading and trailing whitespace.

### `contains`, `startsWith`, and `endsWith`

Contracts:

```text
contains(text: string, search: string) -> boolean
startsWith(text: string, prefix: string) -> boolean
endsWith(text: string, suffix: string) -> boolean
```

For views, these functions apply element-wise with scalar broadcasting and exact-shape view matching.

Matching is case-sensitive.

Empty search text is valid:

```text
contains("abc", "") -> true
startsWith("abc", "") -> true
endsWith("abc", "") -> true
```

Case-insensitive matching should be expressed by composing with `lower(...)` or `upper(...)`.

### `replace`

Contract:

```text
replace(text: string, search: string, replacement: string) -> string
```

For views, `replace(...)` applies element-wise with scalar broadcasting and exact-shape view matching.

`replace(...)` performs literal replace-all. It does not use regular expressions.

`search` must not be empty. Empty search text produces `error`.

### `slice`

Contracts:

```text
slice(text: string, start: number) -> string
slice(text: string, start: number, end: number) -> string
```

For views, `slice(...)` applies to each text element. `start` and `end` must be scalar numbers.

Indexing is zero-based. The `end` index is exclusive.

Negative indexes count from the end:

```text
slice("abcdef", 1, 4)  -> "bcd"
slice("abcdef", -3)    -> "def"
slice("abcdef", 0, -1) -> "abcde"
```

Indexes are clamped to the text bounds.

If the normalized start is greater than the normalized end, the result is empty text.

`start` and `end` must be integers.

### `join`

Contract:

```text
join(separator: string, x: view[d<=2]) -> string
```

`join(...)` flattens `x` in row-major order and joins text values with `separator`.

`join(...)` requires the joined values to be text. It does not implicitly convert numbers, booleans, blanks, nulls, or temporal values.

Use `text(...)` for explicit conversion:

```text
join(", ", text(@[:,Id]))
```

## Examples

Filter by normalized text:

```text
filter(@[:,Name], contains(lower(@[:,Name]), "smith"))
```

Count codes with a prefix:

```text
sum(startsWith(@[:,Code], "A-"))
```

Text length as an element-wise view:

```text
average(len(@[:,Name]))
```

Text length is not view cardinality:

```text
len(@[:,Name])    # view of character counts
counta(@[:,Name]) # count of non-blank cells
```

Join tags:

```text
join(", ", @[:,Tag])
```

## Error Policy

The following cases produce `error`:

- text function receives a non-text value
- a view input contains an error
- multi-argument text function receives view arguments with incompatible shapes
- `replace(...)` receives empty search text
- `slice(...)` receives a non-integer start or end
- `slice(...)` receives a view-valued start or end
- `join(...)` receives a scalar second argument
- `join(...)` receives non-text included values

## Future Work

- method syntax such as `x.lower()`
- bracket slice syntax such as `x[0:3]`
- case-insensitive match options
- regular expression functions
- locale-aware case mapping and collation
- text split functions that require shaped output
- view shape functions such as `rows(...)`, `cols(...)`, and `size(...)`
