# RFC-0053: Anchored Broadcasting for Element-wise Operators

- Status: Implemented (V1)
- Project: Ordinate
- Supersedes: exact-shape binary-operator rules in RFC-0020, RFC-0021, RFC-0032, and RFC-0052

## Summary

An Ordinate `Array` is one-dimensional. A `View` is a rectangular two-dimensional
array value; every row in a two-dimensional literal has the same number of
columns. A View can also come from a reference selection or a computation.
This RFC changes how binary element-wise operators combine scalar, Array, and
View values. It does not change their types or the shape of a reference.

The rule follows NumPy's right-aligned axes, with one deliberate restriction:
**at least one operand must already have the result shape after leading axes
are padded with ones.** Thus one operand may expand, but two operands cannot
expand into a larger outer-product grid. This is called *anchored broadcasting*.

## Scope

The rule applies to `+`, `-`, `*`, `/`, `**`, `==`, `!=`, `<`, `<=`, `>`, and `>=`.
Each output element uses the existing scalar operator semantics, including
string concatenation through `+`, type errors, and error propagation.

It does not relax the exact matching required by paired-data functions such as
`filter(values, mask)` or financial value/date pairs. Functions with multiple
collection arguments retain their own contracts until separately specified.
Unary element-wise functions continue to preserve their input shape.

## Shape Rule

1. A scalar has shape `()`, an Array has shape `(N,)`, and a View has shape
   `(M, N)`. The output rank is the greater input rank.
2. Pad the shorter shape with leading ones. For example, `(N,)` aligns as
   `(1, N)` against a View, never as `(N, 1)`.
3. On each axis, lengths must be equal or one length must be `1`. The result
   length is the equal length, or the non-`1` length. This also defines empty
   axes: `0` with `1` yields `0`; `0` with a length greater than `1` fails.
4. After padding, at least one operand's full shape must equal the result
   shape. Otherwise the operation fails with the existing incompatible-shape
   arithmetic or comparison error. This prevents both operands from expanding.
5. The output is an Array if its rank is one, and a View if its rank is two.
   Its values are evaluated in row-major order. An input axis of length `1`
   repeatedly supplies its sole value on that axis.

The result never has more elements than the already full-sized operand. The
rule therefore cannot create a large outer-product result from two small
inputs. It is independent of whether a View came from literal syntax or a
reference.

| Left | Right | Result | Reason |
| --- | --- | --- | --- |
| scalar | `(3,)` | `(3,)` Array | scalar expansion |
| `(1,)` Array | `(3,)` Array | `(3,)` Array | singleton expansion |
| `(3,)` Array | `(1, 3)` View | `(1, 3)` View | rightmost axes align |
| `(3,)` Array | `(2, 3)` View | `(2, 3)` View | repeat Array across rows |
| `(2,)` Array | `(2, 3)` View | error | trailing lengths `2` and `3` differ |
| `(2, 1)` View | `(2, 3)` View | `(2, 3)` View | repeat one value per row |
| `(1, 3)` View | `(2, 3)` View | `(2, 3)` View | repeat one row |
| `(1, 1)` View | `(2, 3)` View | `(2, 3)` View | one operand supplies one value |
| `(2, 1)` View | `(3,)` Array | error | would expand both operands to `(2, 3)` |
| `(1, 3)` View | `(2, 1)` View | error | would expand both operands to `(2, 3)` |

In particular, a length-`M` Array does **not** acquire a column orientation
just because the other operand has `M` rows. For per-row offsets in an `M×N`
View, use an explicit `M×1` View such as `[[a], [b]]`.

## Errors and Compatibility

Shape compatibility is checked before applying the scalar operator to any
elements. Compatible operands use the existing left-to-right, row-major error
propagation. A collection result still cannot spill into cells or be a final
cell value unless an existing scalar-coercion rule applies; use indexing or an
aggregate such as `sum(...)` to obtain a scalar.

Previously invalid expressions such as `[1, 2, 3] + [[10, 20, 30]]` now
evaluate to a View. This is an intentional language change. Existing exact
shape operations remain valid; no previously valid expression changes its
result shape. Paired-data functions still reject mismatched kinds and shapes.

Excel translation is a separate compatibility boundary. If the Excel exporter
cannot preserve a broadcast formula's semantics, strict export rejects that
formula. With the explicit keep-results export option, it writes the calculated
scalar result as a static value and warns that the Excel cell will not
recalculate. It must not emit a plausible but semantically different formula.

## Conformance

Tests must cover both operand orders, every listed operator family, rank and
shape preservation, reference-derived Views, singleton and empty axes,
rejection of both-operand expansion, propagation of scalar errors, final-cell
scalar rules, and unchanged paired-data function contracts.
