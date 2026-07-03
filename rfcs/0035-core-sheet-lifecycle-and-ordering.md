# RFC-0035: Core Sheet Lifecycle and Ordering

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines core edit operations for sheet-level document structure:

- inserting sheets
- deleting sheets
- moving sheets
- renaming sheets

These operations modify the document's sheet list. They are document-level structural edits, not cell edits and not sheet-internal edits.

## Goals

- Add first-class core edits for sheet lifecycle and ordering.
- Preserve deterministic sheet order in serialization.
- Keep sheet names unique within a document.
- Define undo and redo behavior for document-level edits.
- Keep V1 independent of cross-sheet reference semantics, because the current formula model has no cross-sheet references.

## Non-Goals

- Sheet duplication.
- Cross-sheet formula reference parsing or rebasing.
- Frontend tab UI, context menus, keyboard shortcuts, or drag behavior.
- Templates or user-selected initial sheet contents.
- Collaborative conflict handling.

## Operation Set

This RFC adds three new core edit operations and standardizes the existing rename operation:

```ts
type CoreInsertSheetEdit = {
  op: "insert_sheet";
  name: string;
  sheetIndex: number;
};

type CoreDeleteSheetEdit = {
  op: "delete_sheet";
  sheet: string;
};

type CoreMoveSheetEdit = {
  op: "move_sheet";
  sheet: string;
  targetGapIndex: number;
};

type CoreRenameSheetEdit = {
  op: "rename_sheet";
  sheet: string;
  newName: string;
};
```

## Sheet Names

Sheet names are document-local labels.

For insert and rename:

- leading and trailing whitespace is trimmed
- the trimmed name must not be empty
- the trimmed name must be unique within the document

Renaming a sheet to its existing name is a no-op.

## Insert Sheet

`insert_sheet` inserts a new sheet at `sheetIndex`.

`sheetIndex` is a document sheet insertion index:

- `0` means before the first sheet
- `sheetCount` means after the last sheet

The new sheet uses a minimal 1x1 blank table:

```ord
# Name
|  |
```

V1 does not support templates or custom initial contents.

## Delete Sheet

`delete_sheet` removes one existing sheet by name.

V1 requirements:

- the target sheet must resolve uniquely
- deleting the final remaining sheet is invalid
- no cross-sheet formula rebasing is performed

## Move Sheet

`move_sheet` reorders one existing sheet.

The source sheet is removed first. `targetGapIndex` is interpreted in the remaining sheet list, matching axis move target-gap semantics from RFC-0034.

Moving a sheet into the same effective location is a no-op and must not create a history entry.

## Serialization

Serialization emits sheets in the current `DocumentState.sheets` order.

After insert, delete, move, or rename, serializing and reparsing must preserve:

- sheet order
- sheet names
- sheet contents
- evaluation results under the current formula model

## Undo and Redo

Sheet lifecycle and ordering edits require document-level history entries.

Existing sheet-internal edits may continue to use sheet-level history snapshots. Operations that insert, delete, move, or rename sheets must capture enough document state to undo and redo the document sheet list safely.

Rename is document-scoped because stale undo can otherwise reintroduce an old name after another sheet has been inserted with that name. Document-level history must fail early when the current document snapshot no longer matches the expected before/after state.

Undo and redo must preserve sheet contents, sheet order, sheet names, and session-local row/column IDs within each restored sheet.

## Failure Semantics

Minimum failure cases:

- unknown sheet: `invalid_target`
- ambiguous sheet name: `ambiguous_target`
- empty inserted or renamed sheet name: `invalid_operation`
- duplicate inserted or renamed sheet name: `invalid_operation`
- non-integer `sheetIndex` or `targetGapIndex`: `invalid_target`
- out-of-bounds `sheetIndex` or `targetGapIndex`: `out_of_bounds`
- deleting the final remaining sheet: `invalid_operation`

Failure is atomic at the batch boundary.

## Testing Requirements

Core tests must cover:

- inserting sheets at beginning, middle, and end
- inserted sheet default shape and serialization
- invalid insert names and indices
- deleting sheets while preserving remaining order
- rejecting unknown sheet deletion and final-sheet deletion
- moving sheets forward and backward with post-removal target gaps
- no-op sheet moves producing no history entry
- rename trim, no-op, and duplicate-name behavior
- batch atomicity when a sheet edit fails after earlier edits
- mixed document-level and sheet-level history entries in one undoable batch
- stale document-level mementos failing without mutating the document
- deleted sheet undo restoring sheet contents, source blocks, metadata, and row/column IDs
- ambiguous sheet names failing for delete, move, and rename
- serialization round-trip after sheet lifecycle edits
- undo and redo for insert, delete, move, and rename sheet edits

## Future Work

- sheet duplication
- cross-sheet references
- sheet rename rebasing for cross-sheet references
- host/UI tab behavior
