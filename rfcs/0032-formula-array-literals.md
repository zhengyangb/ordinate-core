# RFC-0032: Formula Array Literals

- Status: Draft
- Project: Ordinate

## Summary

Current amendment (RFC-0042): array elements now accept A1 references through
the shared structural tokenizer. `[A1, $B$2]` is valid. Non-scalar range elements
still fail at evaluation under the ordinary array shape rules. The V1 exclusions
below are historical and are superseded by this amendment.

This RFC adds array literals to the formula language.

Array literals create temporary runtime views that can be passed to existing view-consuming functions, indexed, sliced, and used in existing element-wise operations. This RFC does not define spreadsheet-style spill behavior or any other mechanism that writes array results into multiple cells.

## Goals

This RFC defines:

- one-dimensional array literals
- two-dimensional array literals
- empty array literal shape
- nested array shape validation
- expression evaluation order for array elements
- interaction with existing view indexing, slicing, broadcasting, aggregation, and formula final-result rules
- explicit non-support for spreadsheet-style references inside array literals in V1

## Non-Goals

This RFC does not define:

- spill ranges
- derived tables
- display of non-scalar array results as final cell values
- array literals containing range/view values as elements
- spreadsheet-style references such as `A1` or `A1:B3` inside array literals
- named variables or lexical bindings
- array comprehensions
- step slicing
- reshape, transpose, sort, unique, or other view-transform functions

## Motivation

Many formula functions naturally consume a small ad hoc vector:

```text
sum([1, 2, 3])
irr([-100, 30, 40, 50])
dotProduct([1, 2, 3], [4, 5, 6])
```

Before this RFC, users must place those values in sheet cells and pass a reference view. That is correct for worksheet data, but too heavy for constants, examples, tests, and small parameter lists.

Array literals also make the existing view runtime model easier to use. They are temporary `RuntimeView` values, not sheet ranges.

## Syntax

### One-Dimensional Arrays

```text
[expr1, expr2, expr3]
```

Examples:

```text
[1, 2, 3]
["a", "b", "c"]
[true, false, null]
[date(2026, 1, 1), date(2026, 1, 2)]
[-100, 30, 40, 50]
[]
```

One-dimensional arrays produce a row-oriented view:

```text
[1, 2, 3] -> view[d=1, rows=1, cols=3]
[1]       -> view[d=0, rows=1, cols=1]
[]        -> view[d=1, rows=1, cols=0]
```

The empty array is supported in V1. It is an empty row vector.

### Two-Dimensional Arrays

Two-dimensional arrays are arrays whose elements are themselves array literals:

```text
[[1, 2], [3, 4]]
```

The result keeps the literal's row and column shape:

```text
[[1, 2], [3, 4]] -> view[d=2, rows=2, cols=2]
[[1, 2]]         -> view[d=1, rows=1, cols=2]
[[1], [2]]       -> view[d=1, rows=2, cols=1]
[[1]]            -> view[d=0, rows=1, cols=1]
```

Rows must have the same column count.

Valid:

```text
[[1, 2], [3, 4]]
[[], []]
```

Invalid:

```text
[[1, 2], [3]]
[[1], []]
```

`[[]]` is valid and has shape:

```text
[[]] -> view[d=1, rows=1, cols=0]
```

`[[], []]` is valid and has shape:

```text
[[], []] -> view[d=2, rows=2, cols=0]
```

## Element Rules

Array elements are formula expressions.

Supported:

```text
[1 + 2, 3 * 4]
[lower("A"), upper("b")]
[@[Revenue, 2026], @[Revenue, 2027]]
[[1, 2], [3, 4]]
```

Array elements must evaluate to scalar runtime values or scalar-shaped views. Scalar-shaped views use the existing scalar-view coercion rule.

Invalid:

```text
[@[:, Revenue]]
[filter(@[:, Name], @[:, Active])]
```

If an element evaluates to a non-scalar view, array evaluation returns an error.

Nested array literals in two-dimensional syntax are structural rows, not view-valued elements:

```text
[[1, 2], [3, 4]]
```

This constructs a two-row view. It does not construct a one-dimensional array whose elements are two nested views.

Errors inside arrays are preserved as ordinary runtime values. They may later propagate or be inspected depending on the consuming operation:

```text
isError([error[bad]][0]) -> true
sum([1, error[bad]])     -> error[bad]
```

## Spreadsheet References Inside Array Literals

Spreadsheet-style references are not supported inside array literals in V1.

Invalid:

```text
[A1, B1]
[A1:B3]
```

Use explicit Ordinate references instead:

```text
[@[Row1, Value], @[Row2, Value]]
```

This keeps array literal parsing unambiguous. Spreadsheet-style references remain supported outside array literals and in ordinary function arguments:

```text
sum(A1:A3)
A1 + B1
```

Future RFCs may revisit spreadsheet-style references inside array literals after the formula parser has a clearer distinction between array contexts and indexing contexts.

## Runtime Shape Rules

The runtime value of an array literal is a `RuntimeView`.

Shape rules:

- `[a, b, c]` is `view[d=1, rows=1, cols=3]`
- `[a]` is `view[d=0, rows=1, cols=1]`
- `[]` is `view[d=1, rows=1, cols=0]`
- `[[a, b], [c, d]]` is `view[d=2, rows=2, cols=2]`
- `[[a, b]]` is `view[d=1, rows=1, cols=2]`
- `[[a], [b]]` is `view[d=1, rows=2, cols=1]`
- `[[a]]` is `view[d=0, rows=1, cols=1]`
- `[[]]` is `view[d=1, rows=1, cols=0]`
- `[[], []]` is `view[d=2, rows=2, cols=0]`
- ragged nested arrays fail early
- arrays deeper than two dimensions fail early

The `dimension` field follows the existing runtime shape convention:

```text
dimensionForShape(1, 1) -> 0
dimensionForShape(1, n) -> 1 when n != 1
dimensionForShape(n, 1) -> 1 when n != 1
dimensionForShape(n, m) -> 2 when n != 1 and m != 1
```

Invalid:

```text
[[[1]]]
[[1, 2], [3]]
```

## Evaluation Order

Array elements are evaluated left to right in row-major order.

For a matrix:

```text
[[a, b], [c, d]]
```

Evaluation order is:

```text
a, b, c, d
```

If evaluating an element returns an error, array evaluation returns that error unless the error is written as an explicit error literal.

Example:

```text
[1, 1 / 0, 3] -> error
[1, error[bad], 3] -> view containing error[bad]
```

## Operations

Array literals are ordinary temporary views and use existing view semantics.

### Aggregates

```text
sum([1, 2, 3])       -> 6
product([2, 3, 4])   -> 24
count([1, true, "x"]) -> 2
counta([1, true, "x"]) -> 3
sum([])              -> 0
product([])          -> 1
count([])            -> 0
average([])          -> error
```

### Financial Functions

```text
irr([-100, 30, 40, 50])
mirr([-100, 30, 40, 50], 0.08, 0.12)
xirr([-100, 110], [date(2026, 1, 1), date(2027, 1, 1)])
```

### Indexing And Slicing

Array literals support the existing zero-based bracket indexing and slicing rules:

```text
[10, 20, 30][0]  -> 10
[10, 20, 30][-1] -> 30
[10, 20, 30][1:] -> view[d=1, rows=1, cols=2]
[[1, 2], [3, 4]][1, 0] -> 3
```

Out-of-bounds indexes fail using the existing indexing error behavior:

```text
[][0] -> error
```

### Element-Wise Operators

Array literals participate in existing view arithmetic and comparison semantics:

```text
[1, 2, 3] + 1      -> view containing [2, 3, 4]
[1, 2, 3] * [4, 5, 6] -> view containing [4, 10, 18]
[1, 2, 3] > 1      -> view containing [false, true, true]
```

Shape mismatches fail using the existing view operator error behavior.

## Final Cell Result

This RFC does not introduce spill behavior.

If a formula's final result is a non-scalar view, evaluation still fails with the existing invalid-view behavior:

```text
= [1, 2, 3] -> error
```

Use an aggregate, index, slice consumer, or scalar extraction when a cell needs a scalar:

```text
= sum([1, 2, 3]) -> 6
= [1, 2, 3][0]  -> 1
```

A scalar-shaped array may coerce through the existing scalar-view rule:

```text
= [1] -> 1
```

## Serialization

Formula rendering and round-trip serialization must preserve array literal syntax.

Examples:

```text
= sum([1, 2, 3])
= [[1, 2], [3, 4]][0, 1]
```

Serialization may normalize whitespace, but it must not rewrite array literals into sheet references or function calls.

## Diagnostics

Implementations should fail early with structured errors for:

- empty array syntax that is malformed rather than intentionally empty
- missing closing bracket
- trailing comma
- missing element between commas
- ragged nested array rows
- arrays deeper than two dimensions
- non-scalar element results
- spreadsheet-style references inside array literals

Examples:

```text
[1, 2
[1,]
[1,,2]
[[1, 2], [3]]
[[[1]]]
[A1, B1]
```

## Parser Notes

The parser must distinguish array literals from postfix indexing:

```text
[1, 2, 3]  # array literal primary expression
x[1]       # indexing postfix expression
```

`@[...]` remains a single Ordinate reference token and is not an array literal.

Spreadsheet-style references are intentionally disabled inside array literal parsing in V1.

## Future Work

Future RFCs may define:

- spreadsheet-style references inside array literals
- array literals containing view values with explicit flattening
- spill ranges
- derived tables
- view display previews
- `transpose`
- `sort`
- `unique`
- array comprehensions
- named formula bindings
