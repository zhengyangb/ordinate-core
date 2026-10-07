# RFC-0018: Core Edit V2 Contract

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the V2 core-edit contract.

V2 extends V1 from data-cell editing into structure-aware editing:

- header and label cell editing
- header-row insertion/deletion
- column display default editing
- region set/clear
- row-area conversion
- structural impact preview

## V2 Operation Set

| Area | Operation | Status |
|---|---|---|
| Header rows | `insert_row(area="header")` | implemented |
| Header rows | `delete_row` for header rows | implemented |
| Header/label cells | `set_cell_input` on header/label cells | implemented |
| Header/label cells | `clear_cell` on header/label cells | implemented |
| Column defaults | `set_column_default_format` / `clear_column_default_format` | implemented |
| Column defaults | `set_column_default_style` / `clear_column_default_style` | implemented |
| Region | `set_region` | implemented |
| Region | `clear_region` | implemented |
| Row conversion | `convert_rows_to_header` | implemented |
| Row conversion | `convert_rows_to_body` | implemented |
| Structural preview | `preview_delete_row` / `preview_delete_column` | implemented |

## Header and Label Cell Editing

`set_cell_input` and `clear_cell` apply to all semantic cells:

- header rows
- row-label/header-column cells
- data cells

Header/label cell edits are label-affecting edits. After a successful edit, core must:

- rebuild sheet metadata
- refresh formula input text from the current formula AST/bindings
- mark dependent evaluation state dirty

Label rename is not a separate V2 operation. Label rename happens by editing the underlying header/label cell with `set_cell_input`.

Cell-local display metadata editing remains data-cell only in this RFC.

## Formula Reference Display After Label Edits

Formula references are bound to row/column identity where possible.

When a label changes:

- core must not do raw formula text search/replace
- existing bound references keep pointing at the same row/column identity
- formula input/read surfaces are derived from the current AST/bindings
- serialization uses the same derived rendering path

This means a formula may appear to change text after a label edit because the referenced row/column now has a different display label.

## Header Row Operations

`insert_row(area="header")` inserts a new semantic header row.

Rules:

- `rowGapIndex` is a sheet-wide semantic row gap index
- valid header insertion gaps are inside the header region, including the header/body boundary gap
- header insertion does not participate in body hierarchy depth
- until the insert-row type is split by `area`, callers must pass `depth: 0`

`delete_row` may delete header rows by `rowId`.

Rules:

- header-row deletion removes exactly that header row
- `mode: "node"` is valid
- `mode: "subtree"` is invalid for header rows
- deleting the final header row removes the serialized divider on round-trip

## Column Display Defaults

V2 defines structured edit operations for column display defaults:

- `set_column_default_format`
- `clear_column_default_format`
- `set_column_default_style`
- `clear_column_default_style`

These operations must use structured `FormatSpec` / `StylePatch` payloads, not raw display metadata strings.

Targeting:

- existing column edits target `sheet + colId`
- column insertion continues to use a positional gap index

Column default style uses patch semantics:

- omitted style axes are preserved
- `null` clears an axis
- clearing the whole style removes only style, preserving any default format

Column default format uses whole-value replacement semantics.

## Region Operations

V2 defines a first-class structured region target.

```ts
type CoreCellHandle = {
  sheet: string;
  rowId: number;
  colId: number;
};

type CoreRegionTarget = {
  sheet: string;
  start: { rowId: number; colId: number };
  end: { rowId: number; colId: number };
};
```

Region operations:

- `set_region`
- `clear_region`

V2 region operations do not define move/copy semantics.

Region `set_region` uses semantic input strings, not serialized cached formula bodies or display metadata segments.

Region `clear_region` has the same semantics as repeated `clear_cell` over the region.

Region target endpoints may be passed in either order; core normalizes them into a rectangle.

## Row Conversion

V2 supports batch row-area conversion:

- `convert_rows_to_header`
- `convert_rows_to_body`

Rules:

- selected rows must be contiguous semantic rows
- conversion must update header/body boundary deterministically
- conversion must fail early if it would create invalid hierarchy depth
- `convert_rows_to_header` converts a contiguous prefix of body rows
- `convert_rows_to_body` converts a contiguous suffix of header rows
- converted body rows receive explicit hierarchy depth
- column-area conversion remains deferred

Column-area conversion remains deferred until column-area semantics are specified.

## Structural Impact Preview

V2 exposes read-side preview helpers for destructive structural edits:

- `preview_delete_row`
- `preview_delete_column`

Preview helpers are for UI/CLI/agent confirmation flows. Actual edit operations do not take a `force` flag.

Preview output includes:

- deleted row/column count
- affected formula cell count
- affected formula cell handles

Preview is read-side impact analysis. It does not mutate document state.

## Deferred

The following remain outside Core Edit V2:

- promote/demote convenience commands
- move/copy region semantics
- column-area conversion

The following remain V3 host-integration work:

- explicit transaction handles
- mandatory `expectedVersion`
- operation log standardization
- checkpoint/replay strategy
- collaborative conflict handling

## Initial Test Matrix

| Case | Expected result |
|---|---|
| edit data cell input | succeeds, preserves V1 behavior |
| edit header cell input | succeeds, rebuilds column labels |
| edit row-label cell input | succeeds, rebuilds row paths |
| clear data cell | succeeds, clears body/display as in V1 |
| clear header/label cell | succeeds as a semantic empty cell edit |
| edit header/label with display metadata segment | fails |
| edit header/label with cached formula body | fails |
| set cell-local style/format on header/label cell | fails |
| insert header row at boundary gap | succeeds |
| delete header row by `rowId` | succeeds |
| delete header row with `mode: "subtree"` | fails |
| set column default format by `colId` | succeeds |
| set column default style by `colId` | succeeds with patch semantics |
| clear column default format/style | succeeds independently |
| set column default with unknown `colId` | fails |
| set column default with invalid structured payload | fails |
| set rectangular region with matching value matrix | succeeds |
| set region with reversed endpoints | succeeds after normalization |
| set region with wrong matrix dimensions | fails |
| set region value containing display metadata | fails |
| clear region spanning header/label/data cells | succeeds |
| convert first body rows to header | succeeds |
| convert last header rows to body | succeeds |
| convert non-contiguous rows | fails |
| convert body rows not starting at first body row | fails |
| convert header rows not ending at last header row | fails |
| preview row delete with dependent formula | returns affected formula cells |
| preview column delete with dependent formula | returns affected formula cells |

## Header column boundary editing

`set_header_columns { sheet, count }` updates the leading `||` boundary as one
undoable edit. Count is an integer from zero to column count minus one; at least
one data column remains. Rows, columns, stable IDs and reference coordinates do
not move. Every logical row receives the same boundary, including header rows.

Newly promoted cells become label surfaces. Ordinary quoted text is unquoted
only when reparsing preserves its literal value and does not introduce hierarchy
or display syntax. Cell-local presentation on promoted cells is removed because
native header cells do not support it; it must not turn into whole-row formatting.
Undo restores it. Existing row-header conversion uses the same literal cleanup.

Promotion of a column containing formulas or invalid input fails atomically.
RFC 0045 moves canonical row defaults to the `@display` control column, so
removing the final label column preserves row formatting.
