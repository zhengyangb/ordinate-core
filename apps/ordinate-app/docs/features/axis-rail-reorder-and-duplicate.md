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

## Appendix: Axis Append Chrome Model

Quick row and column add controls are part of the axis chrome, not part of the sheet data model and not fake grid cells.

The app should follow this layer model:

- The real table owns only real header rows, real body rows, and real columns.
- The row and column rails are separate chrome tracks projected from the real table geometry.
- The append row and append column slots live at the end of those chrome tracks.
- Append slots may look visually independent from the rounded rail pill, but their hover/reveal behavior belongs to the same rail chrome layer.
- The append column slot must not reserve a permanent right-side table-stage gutter.
- The append row slot must not create a fake body row or change body-row selection geometry.
- Header overlays, body cells, selection overlays, and formula-reference overlays must never render fake append cells.
- The append column slot appears only when the final real data column edge is in view.
- The append row slot appears at the end of the real body row rail, after the final real row.

The following static HTML fixture is the reference visual model. It is not a DOM contract for the React implementation; it is a compact rendering of the intended layering and geometry.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Append Axis Chrome Demo</title>
  <style>
    :root {
      --bg: #f4f5f2;
      --surface: #ffffff;
      --sheet: #fbfcfa;
      --ink: #18221a;
      --muted: #667168;
      --grid: #cdd3ce;
      --header: #dddfdc;
      --header-col: #f1f3f0;
      --rail: rgba(255, 255, 255, 0.86);
      --green: #169247;
      --green-soft: rgba(22, 146, 71, 0.13);
      --rail-w: 46px;
      --rail-h: 38px;
      --label-col-w: 210px;
      --col-w: 142px;
      --row-h: 42px;
      --data-cols: 7;
      --rows: 18;
      --real-w: calc(var(--label-col-w) + var(--data-cols) * var(--col-w));
      --real-h: calc(var(--rows) * var(--row-h));
      --append-slot: 34px;
      --append-gap: 9px;
      --canvas-w: calc(var(--real-w) + var(--append-gap) + var(--append-slot));
      --canvas-h: calc(var(--real-h) + var(--append-gap) + var(--append-slot));
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .sheet {
      width: min(1120px, calc(100vw - 48px));
      height: 660px;
      padding: 30px;
      border: 1px solid rgba(24, 34, 26, 0.14);
      border-radius: 24px;
      background: var(--surface);
      box-shadow: 0 22px 72px rgba(24, 34, 26, 0.14);
      overflow: hidden;
    }

    .stage {
      position: relative;
      display: grid;
      grid-template-columns: var(--rail-w) minmax(0, 1fr);
      grid-template-rows: var(--rail-h) minmax(0, 1fr);
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--sheet);
    }

    .col-rail,
    .row-rail {
      position: relative;
      overflow: hidden;
      background: transparent;
    }

    .col-rail { grid-column: 2; grid-row: 1; }
    .row-rail { grid-column: 1; grid-row: 2; }

    .viewport {
      grid-column: 2;
      grid-row: 2;
      position: relative;
      overflow: auto;
      background: #fff;
    }

    .axis-chrome {
      opacity: 0.22;
      filter: saturate(0.88);
      transition: opacity 180ms ease-out, filter 180ms ease-out;
    }

    .sheet:hover .axis-chrome,
    .stage:focus-within .axis-chrome {
      opacity: 1;
      filter: none;
    }

    .col-track,
    .row-track,
    .canvas {
      position: relative;
    }

    .col-track {
      width: var(--canvas-w);
      height: 100%;
      transform: translateX(calc(-1 * var(--scroll-x, 0px)));
    }

    .row-track {
      width: 100%;
      height: var(--canvas-h);
      transform: translateY(calc(-1 * var(--scroll-y, 0px)));
    }

    .col-pill,
    .row-pill {
      position: absolute;
      overflow: hidden;
      border: 1px solid rgba(24, 34, 26, 0.12);
      background: var(--rail);
      border-radius: 999px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 8px 18px rgba(24, 34, 26, 0.08);
      backdrop-filter: blur(12px);
    }

    .col-pill {
      left: 0;
      top: 5px;
      width: var(--real-w);
      height: 28px;
    }

    .row-pill {
      top: 0;
      left: 7px;
      width: 32px;
      height: var(--real-h);
    }

    .append-col-slot,
    .append-row-slot {
      position: absolute;
      display: grid;
      place-items: center;
      width: var(--append-slot);
      height: var(--append-slot);
    }

    .append-col-slot {
      left: calc(var(--real-w) + var(--append-gap));
      top: 2px;
    }

    .append-row-slot {
      left: 6px;
      top: calc(var(--real-h) + var(--append-gap));
    }

    .axis-add {
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(24, 34, 26, 0.18);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.96);
      color: var(--muted);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 8px 22px rgba(24, 34, 26, 0.12);
      font-size: 19px;
      line-height: 1;
      cursor: pointer;
    }

    .canvas {
      width: var(--canvas-w);
      height: var(--canvas-h);
    }

    .real-table {
      position: absolute;
      inset: 0 auto auto 0;
      width: var(--real-w);
      height: var(--real-h);
      display: grid;
      grid-template-columns: var(--label-col-w) repeat(var(--data-cols), var(--col-w));
      grid-template-rows: repeat(var(--rows), var(--row-h));
      border-right: 1px solid var(--grid);
      border-bottom: 1px solid var(--grid);
      background: #fff;
    }

    .cell {
      display: flex;
      align-items: center;
      min-width: 0;
      padding: 0 14px;
      border-top: 1px solid var(--grid);
      border-left: 1px solid var(--grid);
      background: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 14px;
    }

    .cell.header-row {
      position: sticky;
      top: 0;
      z-index: 5;
      justify-content: center;
      background: var(--header);
      color: #4d564f;
      font-weight: 650;
    }

    .cell.header-col {
      position: sticky;
      left: 0;
      z-index: 4;
      background: var(--header-col);
      font-weight: 650;
    }
  </style>
</head>
<body>
  <section class="sheet">
    <div class="stage">
      <div class="col-rail axis-chrome">
        <div class="col-track">
          <div class="col-pill"></div>
          <div class="append-col-slot"><button class="axis-add" type="button">+</button></div>
        </div>
      </div>
      <div class="row-rail axis-chrome">
        <div class="row-track">
          <div class="row-pill"></div>
          <div class="append-row-slot"><button class="axis-add" type="button">+</button></div>
        </div>
      </div>
      <div class="viewport">
        <div class="canvas">
          <div class="real-table">
            <!-- Real header/body cells only. No fake append row or append column cells. -->
          </div>
        </div>
      </div>
    </div>
  </section>
</body>
</html>
```

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
