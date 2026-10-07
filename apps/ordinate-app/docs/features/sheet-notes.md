# Sheet Notes

Status: implemented in the shared web/desktop renderer. Document semantics and
restricted Markdown belong to [RFC-0043](../../../../rfcs/0043-sheet-notes.md).

## Interaction

- Hover the table's upper/lower boundary to reveal a fine gold rule with a
  single-sided entrance with white **+ Add note before/after table** text on solid
  gold. The selected lab preset is 186 × 23px, curve tension 86, with 280ms expansion.
  Before grows upward from its fixed bottom edge; after grows downward from its
  fixed top edge. Both stay attached to the table boundary throughout the reveal.
  A 350ms hover dwell precedes the reveal; leaving cancels that delay. Keyboard focus
  reveals it immediately, and touch discovery stays unchanged. Sheet Setup
  also offers **Note before table** and **Note after table**.
- The entrance tracks the pointer horizontally along the boundary, clamped to
  keep the full label inside the table. Tracking does not restart hover dwell or
  animate table layout. Keyboard focus centers it; touch retains the centered
  entrance. Resizing recalculates the available travel.
- The upper note includes the live sheet title, read-only. It is presentation,
  not duplicated note content; sheet renaming remains in the tab strip.
- On initial render and sheet switches, the upper note shares the grid's layout
  readiness gate. Reveal it only once real viewport width, pinning, font metrics
  and row heights are ready. Do not guess a temporary width or show text squeezed
  into the previous sheet's/intermediate width; keep normal layout measurement
  active while hidden. There is no separate note loading timer or ready state.
- Sheet/source-to-table switches retain a disposable, inert copy of the last
  completed workspace while the new grid measures its layout. Table and notes
  reveal together on the existing grid readiness signal. After 250ms, an unfinished
  switch releases the copy and shows a quiet loading cue instead. This is not a
  minimum delay: ready views reveal immediately. Rapid switches keep only the
  last completed copy and wait for the current live grid, never an obsolete one.
  The copy has no React tree, grid instance, event listeners, focus targets or IDs;
  its nested scroll offsets are retained. Source and error views reveal immediately.
- Notes render paragraphs, bold, italic, flat bullet and ordered lists, and
  horizontal separators such as `---`, `-----`, `***` or `___`, all with the same
  meaning. At sufficient width their sections render side by side; narrow screens
  stack them in source order with visible rules. Saved notes, previews and printing
  share this layout, without changing saved Markdown.
  Double-click, Enter or F2 starts editing. Single-click does not; there is no
  Edit button and no Formula Bar for notes.
- The full note paper is one interaction target: title, body, padding and blank
  space all accept double-click. The title remains read-only. Keyboard navigation
  outlines this entire group, not just the body. Confirming/clearing a note returns
  to an unhighlighted, non-tab-stop slot; it never focuses or reveals Add note.
  Click-away keeps focus with the clicked destination.
- Enter inserts a paragraph break (two source newlines), or continues a flat list
  using its current marker. Ordered markers repeat as in canonical Markdown; the
  initial number determines displayed numbering. Enter on an empty list item
  removes its marker and exits the list. Shift+Enter inserts one native source
  newline (Markdown soft wrapping), without saving. Ctrl+Enter, Cmd+Enter and
  Escape save and exit. Cursor splits and selected-text replacement retain all
  unselected source. Automatic Enter edits stay in native textarea undo history.
  Composition keystrokes never commit. Clicking away commits before navigation.
- A top-right **Done** capsule reuses the shared modal primary action style with
  the sheet-surface palette. It remains a light action on light paper even when
  the surrounding application chrome is dark.
  The floating editor stays above the table but below app chrome and command
  overlays. Its top is bounded by the workspace, so outside scrolling cannot
  carry the heading and Done into the toolbar or Sheet tabs.
  Clicking elsewhere and the save shortcuts remain available. There is no Delete
  button: clear the text and exit to delete. Clearing does not interrupt editing; replacement text
  can be typed before exiting. Edit/delete are ordinary
  document history operations. Undo reverses them. Unchanged drafts add no history.
- Unsupported Markdown is saved as escaped ordinary text, not rejected or executed.
  Supported blocks elsewhere retain their formatting. Nested/code indentation and
  hard-break whitespace normalize to prose. Invalid data and edit conflicts still
  retain the draft with an error. Raw invalid notes loaded from source remain visible
  and can be repaired by saving in this editor; HTML is never executed.

## Convert table rows to notes

Select consecutive whole rows at the beginning or end of the table (Shift-click
the Row Rail, or select a full-width cell range), then right-click. The row and
selection menus offer **Convert to note before/after table**, or **Add to note ...**
when that note exists. Interior selections and selections of every table row do
not offer this action. The conversion item uses the shared note icon and menu
icon/text alignment.

Only literal text and blank layout cells can be moved. Bold and literal punctuation
are retained; separate cells read left to right within each row. Formula/data rows,
blank-only selections, incomplete row groups, references into extracted rows and
selections leaving no body row disable the action with an explanation. Existing
intro text stays before extracted prefix text; extracted suffix text stays before
existing footer text, preserving reading order. One undo restores both the original
rows and note. Surviving formula targets, row identities and remaining headers are
preserved. Conversion closes the menu and clears stale cell selection.

## Layout and scrolling

Notes follow the visible table footprint, with the same white/light paper surface
without an outer frame, no yellow tint, no card radius and no gap at the table
boundary. The upper title is read-only.

Adding a note immediately reserves one body line, plus the sheet title for an
upper note. This transient placeholder uses the saved note's spacing and type;
it does not create document content or an undo entry. Empty exit or deletion
reclaims that space. Existing notes keep their saved layout footprint when editing.
A fixed, portalled white editor expands above that placeholder. Further draft
growth never shifts/resizes the grid; committing adopts the rendered content's
height. The square-cornered editor starts at one
text line, grows with explicit newlines or wrapping, and shrinks when text is
removed. The input grows to 45vh, then scrolls. The paper editor has no border or
border ripple, only a soft 12px-offset shadow; text is 14px and the shared inset is
10px. Done occupies the top-right header without covering the title or text.
Its initial size/position is constrained to the viewport.
On creation the editor unfolds vertically from a thin slit at its top edge; reopening an
existing note uses a smaller entrance. Neither animation changes table layout.
Reduced-motion preferences disable entrance and editor animations.

The Column Rail is above the intro and remains sticky at the workspace top.
Scrolling first moves the intro away, then the existing native grid scrolls.
The Row Rail starts at the grid, never at the note. Frozen headers, selection,
fill and formula references retain the grid's existing coordinates.

The footer is outside the row model too. Its position uses the existing header
and body track heights and live native scroll offset. Its measured height reserves
scroll space, so long notes can be reached without manufacturing blank rows.
Opening a footer editor from Sheet Setup reveals it in the native viewport.
The column rail and grid share live scroll offsets on the workspace, not separate
React-delayed horizontal positions.

## Persistence and compatibility

The core source blocks are the only saved note representation. UI drafts are
transient and commit through `set_sheet_note` and existing undo history. Save,
export and native close prepare pending edits first. Pending drafts defer external
file refresh and trigger the browser's unsaved-edit protection on unload.

ORD preserves notes. Excel, CSV and TSV continue the core policy: omit notes with
conversion warnings, without shifting data or formulas to imitate them.

## Verification

- `src/notes/noteModel.test.ts`: restricted-source projection, shortcuts/IME,
  scroll routing, history, source persistence and unchanged cell coordinates.
- `desktop/interchange-smoke.mjs --notes-only`: test-owned web and native hosts,
  editing, validation, history, light/dark/narrow layouts, docking and footer reach.
- Existing app/core suites and desktop workspace smoke cover the surrounding
  Formula Bar, tooltips, rails, file actions and native tabs.

## Excel import confirmation

Offer candidates only from continuous leading/trailing text bands outside the
data rectangle. Full-width merges and single populated text cells are evidence,
not proof: sparse group labels and totals remain ordinary data by default.
Show exact source row ranges and text in the import preview, unchecked initially.
Never change numeric/formula rows or move interior rows heuristically.

Confirmed extraction rebases reference ASTs, not formula strings, before native
translation. Both same-sheet and cross-sheet fixed references retain their
targets. References into removed note rows block that choice and ask the user to
keep those rows in the table. Header counts describe the remaining table.
The preview is processed in a worker which reuses decoded Excel input when
settings change; closing the dialog terminates its session.

Columns have a minimum readable width and wrap in source order as space runs
out. Long words wrap within each column; saved Notes have no outer or divider
borders that content could visually spill across.
