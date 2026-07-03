# Axis Rail Reorder and Duplicate

## Status

Draft implementation spec.

## Summary

Ordinate should let users duplicate and reorder rows and columns from the visible row and column rails.

This is an app/editor feature spec. Core RFC-0034 defines the semantic edit operations and rebasing rules. This spec defines how the Ordinate app exposes those operations through rail menus, axis selection, drag gestures, drop indicators, and undoable app commands.

## Goals

- Expose column and row duplication in the existing rail context menus.
- Support direct drag reorder from the row and column rails.
- Show a precise insertion line while dragging.
- Send semantic axis edit commands to core rather than rewriting cells in the app.
- Preserve formula bindings, display metadata, undo/redo, and selection consistency through core edit application.
- Make hierarchy constraints visible before drop when possible.
- Build a path from single-axis drag in V1 to multi-axis segment drag in V2.

## Non-goals

- Using AG Grid's built-in column move model as the source of truth.
- Dragging arbitrary rectangular cell ranges.
- Non-contiguous row or column reordering.
- Cross-sheet row or column moves or duplicates.
- Moving or duplicating header or label columns in V1.
- Three-way merge or collaboration semantics.
- Persisting row or column IDs into `.ord`.

## Relationship To Core

The app must use the RFC-0034 core edit operations:

```ts
{ op: "move_columns", sheet, colIds, targetGapIndex }
{ op: "move_rows", sheet, rowIds, targetGapIndex }
{ op: "duplicate_columns", sheet, colIds, targetGapIndex }
{ op: "duplicate_rows", sheet, rowIds, targetGapIndex }
```

The app must not implement move or duplicate as cell-by-cell copy, delete, insert, or formula text rewriting. Core is the source of truth for row and column identity, formula rebasing, metadata movement, and undo mementos.

## Core Constraints Reflected In UI

Column constraints:

- Data columns may be moved or duplicated.
- Header or label columns may not be moved or duplicated in V1.
- Column sources must resolve to a contiguous segment.
- Column targets must stay inside the data-column region.

Row constraints:

- Header rows may be moved or duplicated only within the header row region.
- Body rows may be moved or duplicated only within the body row region.
- Header rows and body rows may not be moved or duplicated across the divider.
- Body row hierarchy must remain valid.
- If a body row has descendants, a move or duplicate must include the complete subtree unless the selected segment already represents a valid complete hierarchy segment.

These constraints should be reflected in drag affordances and invalid drop indicators before the user releases the pointer.

## Axis Selection Model

Ordinary cell range selection is not the same as axis selection.

The app should introduce explicit axis selection state before V2 multi-axis drag:

```ts
type AxisSelection =
  | { axis: "column"; sheet: string; colIds: number[] }
  | { axis: "row"; sheet: string; rowIds: number[] }
  | null;
```

Rules:

- Axis selection must be contiguous.
- Axis selection must not be inferred from arbitrary rectangular cell ranges.
- Clicking a rail item selects one row or one column.
- Shift-clicking a rail item may extend to a contiguous axis segment in V2.
- Dragging from an unselected rail item selects a contiguous axis segment in V2.
- Dragging a selected rail item moves the selected axis segment.

V1 may defer persistent multi-axis selection, but should avoid decisions that make V2 difficult.

## Target Gap Semantics

The UI operates over visible current-axis gaps. Core move operations use target gaps after source removal.

The app needs a single helper for this conversion:

```ts
function mapMoveDropGapToCoreTargetGap(
  sourceStartIndex: number,
  sourceCount: number,
  currentDropGapIndex: number,
): number
```

Expected behavior:

- A drop before the source segment maps to the same gap.
- A drop immediately before or immediately after the source segment is a no-op.
- A drop after the source segment subtracts `sourceCount`.
- A drop strictly inside the source segment is invalid for duplicate, and no-op or invalid for move depending on the exact boundary.

This helper should be covered by unit tests because off-by-one errors here are easy and user-visible.

## V1 Scope

V1 should deliver useful drag reorder without requiring the full multi-select model.

### V1 Duplicate

Rail menu actions:

- `Duplicate Column`
- `Duplicate Row`
- `Duplicate Row and Children` when the row has descendants

Default placement:

- Column duplicate inserts immediately to the right of the source column.
- Header row duplicate inserts immediately below the source header row.
- Body row duplicate inserts immediately after the source row or source subtree.

Duplicate operations always create new row or column identities and always enter app history.

### V1 Drag Move

Column drag:

- Starts from a data column rail item.
- Moves one data column.
- Header or label columns do not start a drag.
- Shows a vertical drop line spanning the table body/header area.
- Uses horizontal auto-scroll near the grid edges.
- Drops only into the data-column region.

Row drag:

- Starts from a row rail item.
- Header row drag moves one header row within the header region.
- Body row drag moves one body row.
- If the body row has descendants, the default source is the complete subtree.
- Shows a horizontal drop line spanning the grid width.
- Drops only within the same row region.
- Invalid hierarchy targets show a blocked drop state.

V1 does not support dragging multiple selected rows or columns. It should still structure the code around a source segment so V2 can extend it without rewriting the drag engine.

### V1 Interaction Details

- Drag should start only after a small pointer movement threshold, so ordinary rail click still selects.
- Right-click still opens the rail menu and must not start drag.
- Escape cancels an active drag.
- Pointer capture should keep the drag stable while the pointer leaves the rail.
- The formula bar and floating menus should close or become inert during an active axis drag.
- On successful drop, selection should follow the moved source segment's new position.
- A no-op drop should not create a history entry.
- Undo and redo must restore canonical document text and selection should remain valid.

## V2 Scope

V2 adds explicit multi-row and multi-column axis selection.

### V2 Axis Multi-select

Interactions:

- Shift-click column rails to select a contiguous column segment.
- Shift-click row rails to select a contiguous row segment.
- Drag from an unselected rail item to select a contiguous row or column segment.
- Drag within a selected axis segment to move the entire selected segment.
- The selected segment should have a distinct axis-selection visual state from ordinary cell range selection.

Validation:

- Multi-column selection must be contiguous and entirely in data columns.
- Multi-row selection must be contiguous and entirely within header rows or body rows.
- Body row selection must cover complete hierarchy subtrees where required.
- Invalid partial hierarchy selections should not be draggable.

### V2 Multi-axis Drag

- Dragging any rail item inside the selected axis segment moves the whole segment.
- The ghost or label should communicate the segment size, such as `3 columns` or `5 rows`.
- Drop indicator remains a single insertion line at the target gap.
- Drop validation reuses the same segment validator as V1.

## Deferred

- Non-contiguous axis selection.
- Dragging a visible floating copy of the full row or column.
- Dragging columns by header matrix cells instead of rails.
- Dragging rows by tree labels instead of rails.
- Keyboard-only reorder commands.
- Cross-sheet move or duplicate.
- Full clipboard-style copy and paste for axis segments.

## Implementation Notes

Prefer a small shared axis drag model instead of separate ad hoc row and column drag implementations:

```ts
type AxisDragState =
  | {
      axis: "column";
      sourceColIds: number[];
      sourceStartIndex: number;
      sourceCount: number;
      currentDropGapIndex: number | null;
      valid: boolean;
    }
  | {
      axis: "row";
      sourceRowIds: number[];
      sourceStartIndex: number;
      sourceCount: number;
      currentDropGapIndex: number | null;
      valid: boolean;
    };
```

Recommended helpers:

- `resolveColumnDragSource(selection, draggedColIndex)`
- `resolveRowDragSource(selection, draggedRowNumber)`
- `resolveColumnDropGap(clientX, columnMetrics)`
- `resolveRowDropGap(clientY, headerIndexMetrics, rowIndexMetrics)`
- `mapMoveDropGapToCoreTargetGap(sourceStartIndex, sourceCount, currentDropGapIndex)`
- `validateColumnAxisDrop(source, targetGap)`
- `validateRowAxisDrop(source, targetGap, rowStructure)`

These helpers should live outside React components and have focused unit tests.

## Acceptance Criteria

V1:

- Duplicating a data column from the rail menu inserts a copied column to the right.
- Duplicating a row from the rail menu inserts a copied row or subtree below.
- Dragging a data column rail item shows a vertical insertion line and reorders the column on drop.
- Dragging a header row rail item shows a horizontal insertion line and reorders within the header region.
- Dragging a body row with descendants moves the complete subtree by default.
- Invalid column and row drop targets are visibly blocked and do not mutate the document.
- Formulas, display metadata, and local cell formatting follow core semantics after move or duplicate.
- Undo and redo work for column duplicate, row duplicate, column move, and row move.
- No-op drops do not create history entries.

V2:

- Shift-click rails selects contiguous axis segments.
- Multi-column drag moves the selected contiguous data-column segment.
- Multi-row drag moves the selected contiguous valid row segment.
- Partial body subtree selections are not draggable.
- Axis selection visuals are distinct from ordinary cell range selection.
