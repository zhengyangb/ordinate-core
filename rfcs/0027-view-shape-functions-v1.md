# RFC-0027: View Shape Functions V1

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines scalar shape inspection functions for views and one shape-vector function:

```text
shape(view) -> view[d=1]
size(view) -> number
rowCount(view) -> number
columnCount(view) -> number
```

It also defines concise aliases:

```text
rows(view) alias of rowCount(view)
columns(view) alias of columnCount(view)
cols(view) alias of columnCount(view)
```

## Motivation

RFC-0026 introduced indexing and slicing. Users now need a way to inspect a view before indexing into it:

```text
if(size(filter(@[:,Name], @[:,Score] > 90)) > 0, filter(@[:,Name], @[:,Score] > 90)[0], "")
```

Aggregate functions such as `count`, `counta`, or `sum` inspect contents. Shape functions inspect only the grid shape. This keeps guards independent from blanks, booleans, text, and errors inside the view.

## Goals

This RFC defines:

- `shape(view)`
- `size(view)`
- `rowCount(view)`
- `columnCount(view)`
- aliases for row and column counts
- shape behavior for scalar-shaped, one-dimensional, two-dimensional, and empty views
- interaction with RFC-0026 bracket indexing

## Non-Goals

This RFC does not define:

- final view display or dynamic arrays
- tensor shapes beyond the existing two-axis grid model
- reshaping or transposition
- first-axis `len(view)` semantics
- spill behavior for `shape(view)` as a final cell result

## Grid Shape Model

Ordinate views already carry a two-axis grid shape:

```text
rowCount
columnCount
```

This RFC exposes that shape directly. The shape is a grid shape, not a tensor rank shape.

Examples:

```text
@[This,Revenue]      -> [1, 1]
@[:,Revenue]         -> [rowCount, 1]
@[This,Revenue:Cost] -> [1, columnCount]
@[:,Revenue:Cost]    -> [rowCount, columnCount]
```

Empty views keep their axis sizes:

```text
filter(@[:,Name], @[:,Score] > 999) -> [1, 0]
@[:,A][2:1]                         -> [0, 1]
@[:,A:C][0:0, :]                    -> [0, 3]
@[:,A:C][:, 1:1]                    -> [rowCount, 0]
```

## Functions

### `shape(view)`

Contract:

```text
shape(x: view[d<=2]) -> view[d=1]
```

`shape(x)` returns a two-item row vector:

```text
[rowCount(x), columnCount(x)]
```

The returned vector can be indexed with RFC-0026 bracket syntax:

```text
shape(x)[0] # row count
shape(x)[1] # column count
```

Because final view display is not part of this RFC, a formula whose final result is `shape(x)` remains invalid under the existing final-value rules.

### `size(view)`

Contract:

```text
size(x: view[d<=2]) -> number
```

`size(x)` returns the total number of positions in the view:

```text
rowCount(x) * columnCount(x)
```

`size` does not inspect values and does not skip blanks or errors.

### `rowCount(view)`

Contract:

```text
rowCount(x: view[d<=2]) -> number
```

`rowCount(x)` returns the view row count.

Alias:

```text
rows(x)
```

### `columnCount(view)`

Contract:

```text
columnCount(x: view[d<=2]) -> number
```

`columnCount(x)` returns the view column count.

Aliases:

```text
columns(x)
cols(x)
```

## Naming Policy

`shape` follows Python and NumPy-style naming: it returns the axis shape.

`size` follows Python and NumPy-style naming: it returns the total number of positions, not the shape vector.

`rowCount` and `columnCount` are the canonical scalar names because they are explicit. `rows`, `columns`, and `cols` exist as aliases for spreadsheet-style formulas and concise authoring.

## Error Behavior

Each function requires a view argument. Passing a scalar value is invalid:

```text
size(1)       -> error
shape("text") -> error
```

Shape functions propagate errors produced while evaluating the argument expression.

Shape functions do not inspect view contents, so errors inside a view do not affect the result.

## Future Work

Future RFCs may define lookup functions, reshaping, transposition, or final view display. Those features can build on the shape functions defined here.
