# Sheet search

Find searches the current sheet's **displayed values**, including formatted numbers,
localized error labels, boolean capsules, collapsed body rows, and visually merged
headers. It is literal text search with optional case sensitivity, not formula-source
search, regex, replace, or workbook-wide search. Source mode retains its own text-editing
behavior; the sheet-search control is disabled there.

The compact translucent panel floats at the upper right below the sheet tabs, with no
reserved row, separator, or layout shift. Navigation scrolls body matches into view;
if the current result overlaps the panel (including frozen headers), the panel moves
below that cell. Placement is checked on result/navigation changes and resize, not on
every scroll frame. Ordinary matches have a yellow text highlight;
the current match also has an amber underline. These are independent of the green
selection ring. Counts refer to matching cells; repeated occurrences in a cell are all
highlighted, and a merged header counts once.

## Interaction

- Toolbar magnifier or Cmd/Ctrl+F opens and focuses the query.
- Enter / Shift+Enter in the input visits the next / previous result, wrapping around.
  F3 / Shift+F3 and Cmd/Ctrl+G / Shift+Cmd/Ctrl+G work while search is open.
- Escape closes search and removes highlights. An active editor or menu keeps its
  own Escape behavior first. Closing from the panel restores the previous focus
  when that element still exists.
- Navigation scrolls and expands collapsed ancestors without changing the selected
  cell or cancelling an edit. Typing a query or refreshing results does not steal
  focus or automatically scroll the document.
- Changing sheets preserves the query and searches the new sheet. No-result states
  disable navigation. Closing search retains the query for reopening.

## Updates and ownership

The search index is derived from the grid projection; it does not keep a second
document or write to the editor store. Row and column identities reconcile the active
match through structural edits. Deleted matches cannot leave a stale navigation
target. An external document replacement rebuilds results from the new projection.

Cell edits update matches **when committed**, including formula recalculation, undo,
and redo. An uncommitted input remains a draft, not a replacement for the displayed
cell. Desktop file synchronization retains its existing rules: defer refresh during
pending edits and protect real simultaneous-write conflicts. Search never bypasses
those safeguards. The browser has no new filesystem watcher.

The model and navigation controller live in `src/search`. React context updates visible
cell highlights without rebuilding AG Grid's column definitions or modifying frozen
header geometry. No polling or per-scroll search work is introduced.

## Verification

Automated tests cover literal/Unicode matching, case sensitivity, repeated occurrences,
merged headers, identity reconciliation, wrapping, editing/undo/redo, row/column
insertion/deletion, displayed numeric/boolean/error values, external replacement,
and actual desktop file-watch events after repeated atomic replacements.

Browser checks cover Cmd/Ctrl+F, Enter/Shift+Enter, Escape, keyboard activation of the
case toggle, editing while searching, retention of uncommitted input, green selection
coexistence, collapsed result navigation, merged headers, cross-sheet updates,
horizontal result navigation, and light/dark appearance.
