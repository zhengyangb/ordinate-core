# Editor Session and History

## Summary

The app owns editor session semantics on top of core edit inversion. Core supplies atomic edit application and session-local mementos. The app supplies command boundaries, undo/redo stack behavior, dirty state, keyboard shortcuts, and toolbar controls.

## Command Boundaries

Document-changing table-mode edits are commands:

- formula or literal input commit
- apply input to selection
- clear selection
- cell format/style edit
- row or column default format/style edit
- row/column insert/delete
- row header/body conversion
- sheet rename

These states are not commands:

- formula draft typing before commit
- formula point-pick hover/drag state
- selection changes
- popover/menu visibility
- tooltip state

## Session State

The app keeps:

- `revision`: monotonic document-change counter for stale async guards
- `history`: linear command history
- `historyCursor`: current undo/redo position
- `savedHistoryCursor`: clean marker reserved for file-save integration

Dirty state is derived from `historyCursor !== savedHistoryCursor`.

## Source Mode

Source mode uses native textarea undo while editing source text. When source text successfully reparses back to table mode, app history is reset because core row and column IDs are session-local.

## Undo/Redo UI

The toolbar exposes document-level Undo and Redo buttons near the sheet setup control.

Keyboard shortcuts:

- `Cmd/Ctrl+Z`: undo
- `Shift+Cmd/Ctrl+Z`: redo
- `Ctrl+Y`: redo

The app must not intercept these shortcuts while the event target is a text input, textarea, or contenteditable editor.

## Acceptance Criteria

- all table-mode document edits enter history through the editor store
- no component mutates the document directly
- undo and redo restore canonical document text for all covered edit families
- redo stack clears after a new command
- no-op edits do not create history entries
- source-mode reparse clears history
- toolbar disabled states and shortcuts match history availability
