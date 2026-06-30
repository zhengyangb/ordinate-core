# RFC-0034: Core Axis Structural Editing Semantics

- Status: Draft
- Project: Ordinate

## Summary

This RFC adds first-class core edit operations for structural row and column operations on existing axis items.

Axis structural edits are not ordinary cell edits. They must preserve or create row and column identity intentionally, carry display metadata with the structural item, rebuild formula binding metadata, and remain atomic at the core edit boundary.

This RFC defines:

- `move_columns` and `move_rows`: identity-preserving reorder operations
- `duplicate_columns` and `duplicate_rows`: identity-creating structural copy operations

It does not define a general clipboard, arbitrary rectangular paste, sorting, label rename, or header promotion/demotion model.

## Goals

- Support backend/core semantics needed by row and column drag-reordering and duplication UI.
- Preserve session-local `rowId` and `colId` identity when rows or columns move.
- Allocate fresh session-local identities when rows or columns are duplicated.
- Define deterministic target-gap semantics independent of UI details.
- Keep formulas bound to the same logical row or column identity when possible.
- Re-render formula source text after structural edits through the existing formula rendering path.
- Preserve cell state, row/column display defaults, and local display metadata with moved or duplicated axis items.
- Keep operations atomic and fail early for invalid or ambiguous structural edits.

## Non-Goals

- Frontend drag behavior, pointer handling, drop indicators, menus, or keyboard shortcuts.
- Cross-sheet row or column movement or duplication.
- Moving or duplicating arbitrary non-contiguous selections.
- Moving or copying only a partial cell region.
- General clipboard semantics.
- Arbitrary rectangular region paste.
- Sorting or data-table ordering semantics.
- Label rename, header promotion, or header demotion APIs.
- Spill ranges or derived table outputs.
- Collaborative merge semantics.
- Persisting row or column IDs into `.ord`.

## Core Principle

Move is an identity-preserving permutation of existing axis items.

Duplicate is an identity-creating structural copy of existing axis items.

Neither operation is equivalent to raw cell-by-cell rewrite. Cell-by-cell rewrite gives formulas, display metadata, history, and dependency tracking the wrong semantic signal.

## Operation Set

This RFC adds four core edit operations:

```ts
type CoreMoveColumnsEdit = {
  op: "move_columns";
  sheet: string;
  colIds: number[];
  targetGapIndex: number;
};

type CoreMoveRowsEdit = {
  op: "move_rows";
  sheet: string;
  rowIds: number[];
  targetGapIndex: number;
};

type CoreDuplicateColumnsEdit = {
  op: "duplicate_columns";
  sheet: string;
  colIds: number[];
  targetGapIndex: number;
};

type CoreDuplicateRowsEdit = {
  op: "duplicate_rows";
  sheet: string;
  rowIds: number[];
  targetGapIndex: number;
};
```

`colIds` and `rowIds` identify the source segment by session-local axis identity.

The provided IDs may be in any order. The resolved source segment order is always current sheet order.

## Source Segment Semantics

The source segment is resolved from the provided IDs against the current staged sheet state.

Normative requirements:

- all IDs must exist
- IDs must be unique
- resolved axis positions must be contiguous
- zero axis items is invalid

The source segment keeps its internal order.

## Target Gap Semantics

`targetGapIndex` is a sheet-wide gap index.

For moves, the source segment is removed first. `targetGapIndex` is interpreted in the remaining axis.

For duplicates, the source segment is not removed. `targetGapIndex` is interpreted in the current axis as an insertion gap.

For duplicate operations, `targetGapIndex` must not be strictly inside the source segment. Duplicating immediately before or immediately after the source is valid.

Operations that restrict movement or duplication to a row or column region still use sheet-wide gap indices. For example, if a sheet has one label column, the first valid data-column target gap is `1`, not `0`.

Example move:

```text
original axis:        [A, B, C, D, E]
source segment:      [B, C]
after removal:       [A, D, E]

targetGapIndex = 0   [B, C, A, D, E]
targetGapIndex = 1   [A, B, C, D, E]  # no-op
targetGapIndex = 2   [A, D, B, C, E]
targetGapIndex = 3   [A, D, E, B, C]
```

Example duplicate:

```text
original axis:        [A, B, C, D, E]
source segment:      [B, C]

targetGapIndex = 1   [A, B, C, B, C, D, E]  # before source
targetGapIndex = 2   invalid                 # between B and C
targetGapIndex = 3   [A, B, C, B, C, D, E]  # after source
targetGapIndex = 5   [A, B, C, D, E, B, C]
```

A move no-op must not mark cells dirty, refresh formula text, or create a history memento entry. Duplicates always create new axis items and are never no-ops.

## Column Move Semantics

`move_columns` moves logical columns within one sheet.

V1 scope:

- source columns must be data columns
- target gap must be in the data-column region after source removal
- header/label columns are not movable in V1

The following state moves with each column:

- the column ID
- all cells in that logical column, including header-row cells
- column display metadata

After a successful move:

- column label metadata is rebuilt
- formula dependency metadata is rebuilt
- formula source text is refreshed from current bindings
- affected values are dirty unless eager recalculation is requested

## Column Duplicate Semantics

`duplicate_columns` duplicates logical data columns within one sheet.

V1 scope:

- source columns must be data columns
- target gap must be in the current data-column region
- header/label columns are not duplicable in V1

The following state is copied for each duplicated column:

- all cells in that logical column, including header-row cells
- column display metadata
- cell-local display metadata

The following state is not copied:

- the original column ID
- formula caches as authoritative state

Each duplicated column receives a fresh `colId`.

## Row Move Semantics

`move_rows` moves logical rows within one sheet.

V1 scope:

- source rows must all be in the header region or all be in the body region
- target gap must be in the same row region after source removal
- moving between header and body is not allowed
- the divider is not an axis item and is never moved directly

The following state moves with each row:

- the row ID
- the logical row label and hierarchy marker
- all cells in that logical row
- row display metadata

After a successful move:

- row path metadata is rebuilt
- column label metadata is rebuilt when header rows move
- formula dependency metadata is rebuilt
- formula source text is refreshed from current bindings
- affected values are dirty unless eager recalculation is requested

## Row Duplicate Semantics

`duplicate_rows` duplicates logical rows within one sheet.

V1 scope:

- source rows must all be in the header region or all be in the body region
- target gap must be in the same current row region
- duplicating between header and body is not allowed
- the divider is not an axis item and is never duplicated directly

The following state is copied for each duplicated row:

- the logical row label and hierarchy marker
- all cells in that logical row
- row display metadata
- cell-local display metadata

The following state is not copied:

- the original row ID
- formula caches as authoritative state

Each duplicated row receives a fresh `rowId`.

## Body Row Hierarchy Rules

Body rows have hierarchy depth, so body row structural edits must preserve a valid hierarchy.

V1 uses fail-early structural rules:

- if a source body row has descendants, the source segment must include its whole subtree
- an operation must not leave a descendant behind without its ancestor
- an operation must not insert a row at an invalid depth jump
- an operation must not implicitly adopt following rows at the target gap
- moved or duplicated rows keep their existing depths

For moves, target validation applies after source removal.

For duplicates, target validation applies to the current axis because the source remains in place.

Insertion before the segment uses the first moved or duplicated row's depth:

- at the first body gap, the first inserted row must have depth `0`
- otherwise the first inserted row depth must be at most previous body row depth plus `1`

Insertion after the segment uses the last moved or duplicated row's depth:

- if the following body row at the target gap is deeper than the last inserted row, the operation is invalid because it would implicitly adopt that following row

## Formula Reference Semantics

Axis structural edits affect reference rendering and dependency metadata.

Ordinate formulas are bound to stable row and column identities where possible.

After a move:

- bound label references keep targeting the same row or column identity
- bound ordinary positional references keep targeting the same row or column identity and render to the new position
- fixed positional references remain fixed to their textual position and do not follow the moved identity
- relative references keep their numeric offset; if the formula cell moves, the origin moves with the formula cell

After a duplicate:

- formulas outside the duplicated segment are not retargeted to duplicated rows or columns
- formulas copied inside the duplicated segment are copied as structured formula bodies
- copied formulas remap bound references that point wholly inside the duplicated axis segment to the fresh duplicated IDs
- copied formulas keep references to outside rows or columns pointing to the original identities
- fixed positional references remain fixed positional references
- relative references keep their numeric offset relative to the copied formula cell

For duplicated ranges, both range endpoints are remapped only when both bound endpoints point inside the duplicated axis segment. Crossing ranges keep their original endpoints in V1.

Core must not rebase by raw formula text search and replace.

## Range Rebasing

Ordinate ranges are contiguous spans, not arbitrary sets.

For a range whose endpoints are bound to axis identities:

- endpoints keep targeting the same identities when those identities still exist
- the rendered range is the contiguous span between the endpoints' current positions
- the range may include different intervening rows or columns after a move
- if structurally rebound endpoints resolve in reverse order, rendering canonicalizes to current low-to-high axis order
- core does not synthesize union ranges in V1

For fixed positional range endpoints:

- fixed endpoints remain fixed positions
- the range refers to the contiguous span between those fixed positions after the structural edit

This canonicalization applies to structurally rebound endpoints. A user-authored reversed positional range remains invalid under ordinary formula evaluation rules.

## Duplicate Labels

Duplicate operations may create duplicate row labels or column labels.

This is valid document state. Existing label resolution rules still apply:

- unique labels may render as labels
- duplicate labels are ambiguous for fresh label-based selection
- bound formula references may render as positional fallback when the label is no longer unique

Duplicate operations must not fail solely because they produce duplicate labels.

## Failure Semantics

Axis structural edits use the existing core edit failure categories.

Minimum failure cases:

- unknown sheet: `invalid_target`
- unknown row or column ID: `invalid_target`
- duplicate source IDs: `invalid_target`
- non-contiguous source IDs: `invalid_operation`
- source and target regions differ: `invalid_operation`
- source includes a header or label column for `move_columns` or `duplicate_columns`: `invalid_operation`
- body row hierarchy rules are violated: `invalid_operation`
- duplicate target gap is strictly inside the source segment: `invalid_operation`
- `targetGapIndex` is not an integer: `invalid_target`
- `targetGapIndex` is out of bounds: `out_of_bounds`

Failure is atomic at the batch boundary. No partial structural edit may be committed.

## Relationship to Undo and Redo

RFC-0033 mementos are compatible with axis structural edits.

When these operations are added to `CoreEdit`, `applyBatchWithUndo` must capture enough typed semantic state to undo and redo:

- move operations while preserving existing IDs
- duplicate operations while preserving generated IDs on redo

A move no-op may produce an empty memento entry.

## Serialization Contract

Serialization after an axis structural edit emits the new row or column order and any duplicated rows or columns.

`.ord` does not persist row or column IDs. IDs are session-local implementation state and are reconstructed on parse, as with other core edit operations.

Round-tripping after serialization must preserve visible document semantics, formula source text, display metadata, and evaluation results under the current serialization rules.

## Implementation Notes

Implementation should use shared axis-segment helpers for arrays that must be moved or duplicated together.

For columns, the same structural operation must be applied to:

- every parsed row's `rawCells`
- every parsed row's normalized `cells`
- every row's `CellState[]`
- `colIds`
- `columnDisplayMetadata`

For rows, the same structural operation must be applied to:

- `logicalRows`
- `cells`
- `rowIds`
- `rowDisplayMetadata`

After a structural edit, implementation should call the same structural finalization path used by other structure edits:

- rebuild metadata
- refresh formula source text
- mark values dirty or recalculate according to options

Do not allocate new row or column IDs for moved axis items.

Do allocate new row or column IDs for duplicated axis items.

Do not preserve formula caches as authoritative state across structural edits. The implementation may keep them temporarily as an optimization only if the final dirty/recalculation contract remains identical to structural invalidation.

## Testing Requirements

Core tests must cover:

- moving one data column left and right
- moving multiple contiguous data columns
- column move preserving `colId`
- column move preserving column display metadata
- column move preserving local cell display metadata
- column move rejecting header or label columns
- column move rejecting unknown, duplicate, or non-contiguous `colIds`
- column move rejecting out-of-bounds target gaps after source removal
- duplicating one data column
- duplicating multiple contiguous data columns
- column duplicate allocating fresh `colId`s
- column duplicate copying column display metadata and local cell display metadata
- column duplicate rejecting header or label columns
- column duplicate rejecting unknown, duplicate, or non-contiguous `colIds`
- column duplicate rejecting out-of-bounds or source-interior target gaps
- moving one header row
- moving one body row
- moving a complete body subtree
- row move preserving `rowId`
- row move preserving row display metadata
- row move rejecting cross-region moves between header and body
- row move rejecting partial subtree moves
- row move rejecting hierarchy adoption at the target gap
- duplicating one header row
- duplicating body rows
- duplicating a complete body subtree
- row duplicate allocating fresh `rowId`s
- row duplicate copying row display metadata and local cell display metadata
- row duplicate rejecting cross-region target gaps, partial subtrees, invalid depth jumps, and source-interior target gaps
- formula references following moved row or column identities
- duplicate formulas remapping references wholly inside the duplicated axis segment
- duplicate formulas keeping references outside the duplicated axis segment
- fixed positional references staying fixed to position
- relative references remaining relative when the formula cell moves or is duplicated
- range endpoints rendering to a contiguous span after a structural edit
- bound range endpoint reversal canonicalizing to current low-to-high order
- no-op moves producing no semantic change
- forward and backward moves using target gaps after source removal
- duplicates using current-axis target gaps
- IDs supplied out of order while preserving current sheet order
- incremental evaluation after structural edits matching full serialize/reparse/evaluate results
- batch atomicity when an axis structural edit fails after earlier edits in the same batch
- undo and redo of row and column moves and duplicates
- serialization round-trip after row and column structural edits

## Deferred

- non-contiguous axis reordering
- arbitrary swap convenience operations
- cross-sheet row or column moves or duplicates
- partial region move/copy
- general clipboard integration
- move or duplicate preview helpers
- union ranges
- user-configurable range rebasing policies
- UI drag-and-drop or paste behavior
