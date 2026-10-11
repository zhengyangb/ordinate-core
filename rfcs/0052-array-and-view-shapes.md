# RFC-0052: Arrays and Views as Distinct Runtime Shapes

- Status: Implemented (V1)
- Project: Ordinate
- Supersedes: the runtime dimensionality and array equivalence rules in RFC-0007, RFC-0020, RFC-0026, RFC-0027, RFC-0028, RFC-0031, and RFC-0032

> RFC-0053 supersedes this RFC's exact-shape rule for binary element-wise
> operators. The exact-shape contract for paired-data functions remains.

## Summary

Ordinate has scalar values, one-dimensional arrays, and two-dimensional views.
**View is Ordinate's name for a two-dimensional array value**, whether it comes
from a nested array literal, a reference selection, or a computed expression.
In runtime type names, `Array` means specifically a one-dimensional array;
`View` means a two-dimensional array. An array's single axis is not implicitly
a row or a column. A view always has explicit row and column axes. The runtime
does not store a separate `dimension` field: kind and shape are the single
source of truth.

This changes the earlier convention that inferred dimensionality from a view's
shape and represented every array literal as a view. It does not introduce
spilling or general NumPy broadcasting.

## Values and Syntax

| Expression | Runtime kind | Shape |
| --- | --- | --- |
| `1` | scalar | no axes |
| `[1, 2, 3]` | array | length 3 |
| `[]` | array | length 0 |
| `[[1, 2, 3]]` | view | 1 row × 3 columns |
| `[[1], [2], [3]]` | view | 3 rows × 1 column |
| `[[1, 2], [3, 4]]` | view | 2 rows × 2 columns |
| `@[Row, Column]` | view | 1 row × 1 column |

Nested array-literal syntax constructs a two-dimensional view. It does not
construct an array containing arrays. Rows must have equal lengths; nesting
deeper than two levels is invalid. `[[]]` is a 1 × 0 view and `[[], []]` is a
2 × 0 view.

At the *evaluated-value* level, a two-dimensional array literal and a reference
selection have the same view shape and value operations. This does not erase
their distinction in syntax or dependency tracking: references still identify
source cells for recalculation, copying, and structural editing. Materializing
a reference for formula evaluation yields a grid of values; the runtime view
does not need to carry source-cell identity. An array literal has no source-cell
identity of its own.

## Shape and Scalar Rules

`shape(array)` returns a one-dimensional array with one number, `[length]`.
`shape(view)` returns a one-dimensional array with two numbers, `[rows, columns]`.
`size(array)` is its length; `size(view)` is rows × columns.
`rowCount` and `columnCount` require a view, because an array has no row or
column axis. They reject arrays rather than guessing an orientation.

The syntax preserves rank even for singleton and empty values. `[1]` remains
an array; `[[1]]` remains a 1 × 1 view. A final formula result must still be
scalar. A 1 × 1 view may use the existing single-cell scalar coercion, while
`[1]` cannot. Indexing extracts a scalar explicitly: `[1][0]` is `1`.

One-axis indexing and slicing work on arrays and on row/column views. Array
slices remain arrays; view slices retain two explicit axes. Two-axis indexing
requires a view. There is no implicit conversion between `[a, b]`,
`[[a, b]]`, and `[[a], [b]]`.

## Functions and Operators

Aggregates consume a collection of scalar values in row-major order. In
particular, all of these are valid:

```text
sum([1, 2, 3])       -> 6
sum([[1, 2, 3]])     -> 6
sum([[1, 2], [3, 4]]) -> 10
sum(@[:, Revenue])   -> sum of selected cells
```

This is one aggregate contract accepting either an array or a view, not an
implicit cast of every array to a view. `sum(1)` remains invalid. Empty-array
aggregate identities and error/blank handling retain their existing rules.

`filter(values, mask)` requires matching kinds and shapes and returns a
one-dimensional array of retained values. It does not retain a row/column
orientation. Element-wise scalar operations preserve the collection kind and
shape. RFC-0053 defines broadcasting for binary element-wise operators;
paired-data functions such as `filter` keep their exact-match contracts.

Functions that only reduce a sequence may accept both kinds. Functions that
need a grid (such as row/column counts and matrix-only operations) require a
view. Vector functions may accept an array or a one-row/one-column view where
their existing contracts permit it. Function metadata and help must name these
accepted kinds explicitly rather than use `view[d]` notation.

## Interchange and Compatibility

The `.ord` source syntax is unchanged. Existing formulas using a singleton
one-dimensional array as a final cell value now fail instead of silently
coercing it to a scalar; use `[x][0]` or `[[x]]` when that is intended.
Formulas depending on the old `shape(filter(...)) == [1, n]` convention must
use the new one-axis shape `[n]`. Imported Excel formulas retain Excel's
row/column orientation rules in the interchange translator; native arrays do
not acquire a hidden orientation to satisfy them.

## Conformance

Tests must distinguish `[x]` from `[[x]]`, array and view shapes, empty
shapes, array/view aggregate inputs, indexing and slicing rank preservation,
filter output, final-cell coercion, and Excel's oriented `ROWS`/`COLUMNS`
translation. All runtime constructors must validate their own shape and fail
early on mismatches.
