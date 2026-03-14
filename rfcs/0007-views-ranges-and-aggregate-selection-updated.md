# RFC-0007: Views, Ranges, and Aggregate Selection

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the conceptual model for multi-cell selection in Ordinate.

It introduces `view` as the unified concept for reference-derived table selection objects. A view preserves cell identity, including position and value, and may have different dimensionalities. This RFC also defines the initial direction for ranges, aggregate selection, and the distinction between views and literal list-like values.

## Goals

This RFC defines:

- `view` as the unified concept for table-derived reference objects
- dimensional constraints over `view` (e.g., `view[d=0]`, `view[d=1]`, `view[d=2]`, `view[d<=2]`)
- the distinction between `view` and literal container values
- the role of ranges as a way to construct views
- the rule that aggregate functions consume views rather than selections directly
- the current direction for `:`, `_`, and index-based selection
- a minimal aggregate example through `sum`

## Non-Goals

This RFC does not define:

- the full function library
- full aggregate function behavior beyond the minimal `sum` example
- sparse or irregular multi-point union selection
- general list literals as a first-class runtime type
- negative indexing
- exclusive-endpoint range syntax
- structural-row filtering rules
- date-aware or metadata-aware aggregate behavior

## Core Idea

All table-derived reference objects are uniformly called **views**.

A view is not merely a collection of values. A view preserves:

- cell identity
- position in the original table
- shape
- value access through the referenced cells

This allows Ordinate to model table-derived selections in a way that is closer to a structured view than to a plain list.

## Dimensionality

Dimensionality is a constraint on `view`, not a separate container family.

The following constraint forms are used in the conceptual model:

### `view[d=0]`

`view[d=0]` means a single-cell view.

Examples:

- `@[_,_]`
- `@[Revenue,"2025"]`

### `view[d=1]`

`view[d=1]` means a one-dimensional view.

This may be:

- a single row slice
- a single column slice

Examples:

- `@[Revenue,:]`
- `@[:,"2025"]`
- `@[#1:#5,_]`
- `@[_,#1:#3]`

### `view[d=2]`

`view[d=2]` means a two-dimensional rectangular view.

Examples:

- `@[#1:#3,#1:#2]`
- `@["Revenue":"Cost of Sales","2024":"2025"]`

### `view[d<=2]`

`view[d<=2]` means any currently supported view dimensionality.

This is not a separate runtime container type; it is a constraint over `view`.

## Shape

A view preserves shape.

Examples:

- a single cell is a `1×1` shape and satisfies `view[d=0]`
- a row slice is `1×N` and satisfies `view[d=1]`
- a column slice is `N×1` and satisfies `view[d=1]`
- a rectangular block is `M×N` and satisfies `view[d=2]`

This RFC treats shape as an intrinsic property of a view.

## Views versus Literal Containers

A view is table-derived.

A literal container, by contrast, is explicitly constructed by the user and does not inherently preserve source-table geometry.

Examples of things that are **not** views in this RFC:

- a hypothetical future list literal such as `[1, 2, 3]`
- a hypothetical future list of references such as `[@[_,_], @[_+1,_], @[_,_+1], @[_+1,_+1]]`

Such forms may exist in future RFCs, but they are not views. A nested list of cells does not imply a rectangular table-derived slice.

## Views Are Not First-Class Values

Views are not first-class runtime values in this RFC.

Current working direction:

- a view may appear as an argument to an aggregate function
- using a view in a scalar context is an error

## Aggregate Selection Principle

Selection and aggregation are separate concerns.

- a selector or range constructs a view
- an aggregate function consumes a view

Examples of the intended conceptual separation:

- `sum(@[:,"2025"])`
- `avg(@[Revenue,:])`

The aggregate is a function. It is not a kind of selector.

## Aggregate Function Input

This RFC adopts the direction that aggregate functions may accept views.

A `view[d=0]` may be implicitly lifted to a one-element aggregate input at aggregate-function boundaries.

This lifting is not a general coercion rule for the language. It is only a rule for aggregate function boundaries.

## Selector Syntax Direction

This RFC adopts the following directional syntax ideas for future multi-cell selection.

### Current Position

`_` denotes the current position along an axis.

Examples:

- `@[_, "2025"]`
- `@[Revenue,_]`
- `@[_,_]`

Relative offsets from the current position may be expressed with `_+n` or `_-n`.

Examples:

- `@[_-1,_]`
- `@[_,_+1]`

### All Positions

`:` denotes all positions along an axis.

Examples:

- `@[:,"2025"]`
- `@[Revenue,:]`
- `@[:,:]`

Current working direction for `:`:

- `:` covers only the data region on that axis
- `:` excludes header rows, label rows/columns, and other structural or non-data rows

### Absolute Position

This RFC continues to allow `#` as the current candidate marker for absolute one-based positional selection.

Examples:

- `@[#1,_]`
- `@[_,#2]`
- `@[#1:#5,_]`

Current working direction:

- `#1` means the first position on an axis
- indexing is one-based
- negative indexing is not included in this RFC
- absolute positions include header rows and other non-data rows (A1-style absolute coordinates)
- the header separator line is not a row; absolute row positions skip it

## Range Syntax

This RFC adopts `:` as the current range syntax.

Current working direction:

- ranges are closed intervals
- `A:B` includes both endpoints
- only one interval style is included in this RFC
- open-ended ranges are allowed; `A:` means from `A` to the end of the axis, and `:B` means from the start to `B`
- open-ended ranges use axis start/end in rendered coordinates (header rows included, separator excluded)

Examples:

- `@[#1:#5,_]`
- `@["Revenue":"Cost of Sales","2025"]`
- `@[#1:#3,#1:#2]`
- `@[#2:,#2]`
- `@[:#3,#2]`

This RFC does not include exclusive-endpoint syntax.

## Range Resolution and Errors

Current working direction:

- range endpoints must resolve to valid positions
- if a range resolves to a start position after its end position, that is a selection error
- out-of-bounds endpoints are a selection error
- a range may still produce an empty view if the data region on an axis is empty

Future consideration:

- a reversed range could be interpreted as an empty view, but this RFC treats it as an error for clarity

## Label Interpretation

Labels are not modeled as strings in selector syntax.

Quoted labels are a selector-level escaping mechanism, not string literals.

Current working direction:

- numeric-looking labels must be quoted
- labels are required to be unique on an axis; duplicates are a selection error

## Dimensional Requirements in Functions

This RFC adopts the idea that function signatures may constrain the dimensionality of accepted views.

Examples of future function-signature directions:

- a scalar function may require `view[d=0]`
- a row/column aggregate may require `view[d=1]`
- a matrix-style function may require `view[d=2]`
- a general aggregate such as `sum` may accept `view[d<=2]`

This RFC does not define the full function-signature system.

Future RFCs may use dimensional view constraints such as `view[d=0]`, `view[d=1]`, and `view[d=2]` to express function requirements.

## Minimal Aggregate Example: `sum`

This RFC defines `sum` as a minimal aggregate example.

### Input

`sum` accepts any `view`.

This includes:

- `view[d=0]`
- `view[d=1]`
- `view[d=2]`

A `view[d=0]` may be implicitly lifted to a one-element aggregate input.

### Semantics

The result of `sum(view)` is defined in three steps:

1. flatten the input view into an ordered one-dimensional sequence of cells
2. read the value of each cell
3. reduce the resulting sequence using the `+` operator, starting from a numeric zero identity

This means that `sum` does not define independent rules for:

- `blank`
- `boolean`
- `error`

Those behaviors are inherited from the definition of `+` in RFC-0006.

### Flattening Order

Views are flattened in **row-major order**.

That is:

- rows are processed from top to bottom
- within each row, columns are processed from left to right

### Empty View

Current working direction:

- `sum(empty_view) = 0`

The zero identity ensures that empty inputs produce `0`, and that string values in a view cause an error rather than concatenation (because `0 + "string"` is an error under RFC-0006).

## Examples

### `view[d=0]` Examples

- `@[_,_]`
- `@[Revenue,"2025"]`

### `view[d=1]` Examples

- `@[:,"2025"]`
- `@[Revenue,:]`
- `@[#1:#5,_]`

### `view[d=2]` Examples

- `@[#1:#3,#1:#2]`
- `@["Revenue":"Cost of Sales","2024":"2025"]`

### Contextual View Examples

- `@[_-1,_]`
- `@[_,_+1]`
- `@[_-2:_,"2025"]`

### `sum` Examples

- `sum(@[_,_])`
- `sum(@[:,"2025"])`
- `sum(@["Revenue",:])`
- `sum(@[#1:#5,_])`

## Deferred Topics

- sparse or irregular selector unions
- explicit list literals
- lists of references
- negative indexing
- exclusive-endpoint range syntax
- shape-conversion rules between different view dimensions
- general multi-sheet view construction
- full function contracts over `view[d=0]`, `view[d=1]`, and `view[d=2]`
- aggregates other than `sum`

## Open Questions

- whether `#` should remain the final absolute-index syntax
- whether aggregate functions should accept all view dimensions or only selected ones
- whether `view[d=0]` should always be implicitly liftable at aggregate boundaries
- how future sparse multi-point selection should be represented
- whether future list literals should coexist with views as a separate container family

## Current Working Assumptions

- all table-derived reference objects are uniformly called views
- views preserve position and value, not just values
- dimensional constraints such as `view[d=0]`, `view[d=1]`, `view[d=2]`, and `view[d<=2]` apply to `view`
- views are table-derived and distinct from hypothetical future list literals
- views are not first-class runtime values and may only appear as aggregate inputs
- `:` is the current range syntax
- ranges are currently treated as closed intervals
- open-ended ranges are allowed and clamp to the start/end of the axis
- `_` denotes current position
- `#` is the current candidate for one-based absolute positional selection
- aggregate functions consume views rather than selections directly
- `sum` is defined by flattening a view and reducing with `+` from a numeric zero identity
- `:` covers only the data region and excludes header/structural/non-data rows
- absolute `#` positions are A1-style coordinates that include header and non-data rows
- the header separator line is not a row for absolute row positions
- numeric-looking labels must be quoted
- labels are unique on an axis; duplicates are a selection error
- range endpoints must resolve to valid positions; reversed or out-of-bounds ranges are selection errors
