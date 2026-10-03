# Desktop document workspace

Each Electron window owns one file session, undo history, file capabilities and
watch subscription. macOS can group those windows into native document tabs;
the application's sheet tabs still navigate within a single document.

Document construction and loading stay hidden, including `ready-to-show`.
The workspace owns presentation: it joins the destination tab group before
showing the loaded window once. If that group closes during loading, the new
window is cancelled instead of appearing unexpectedly as a standalone window.

## Commands

- New (Cmd+N) and the native toolbar's New document button create a blank
  document in the current macOS tab group. New Window (Cmd+Shift+N) opens a
  separate window; New Tab remains available explicitly. None replaces existing
  work. These are document tabs, separate from the sheets inside each document.
- Open accepts multiple files. Opening the same canonical path focuses its
  existing document. File-menu commands target the focused window.
- Duplicate first commits pending cell/source edits and flushes that session,
  then creates an untitled copy with an independent draft and undo history.
- Save As changes the current document's backing file. An already-open file
  belonging to another window is rejected as a destination.
- Rename and Move To use the existing NSDocument panels on macOS and the shared
  conflict-checked writer. Windows/Linux retain New/Open/Save As/Duplicate.
- Revert To on macOS presents saved versions by timestamp. Version contents
  stay in the main process. Restoration uses the shared compare-and-write path,
  replaces the editor and its undo history, and refreshes its recovery draft.
  Concurrent external edits fail the version check rather than being overwritten.

## Recovery and close

Workspace records contain an opaque session ID and a saved file location or
initial untitled content. Each untitled draft uses its own session ID; named
drafts continue to use the canonical file's recovery key. Duplicate contents are
recorded before its renderer loads. The workspace file is replaced atomically.
The first workspace boot migrates the prior single-document bookmark and keeps
its existing untitled draft identity; subsequent launches read only the workspace.

Quit flushes every document before closing any window, writes the workspace and
flushes Chromium storage. A failed save leaves all documents open. Next launch
reopens the saved workspace; document windows may be merged again with the native
Window menu. Individual untitled-window close offers Save, Cancel or Don't Save.
Closed documents are removed from the workspace; quitting keeps their records.

macOS checkpoints the existing file before its first changed save and at most
once per five minutes of subsequent autosaves. Restoring a version forces a
checkpoint of current content. NSFileVersion owns the version storage; this is
a timestamp menu, not AppKit's full-screen Time Machine version browser. Volumes
that cannot store macOS versions report the native error instead of silently
claiming version history exists. Web has no native document or version logic.

## Export direction (not implemented)

CSV/TSV can export one sheet's evaluated values and quote multiline text using
standard CSV escaping. They cannot preserve multiple sheets, hierarchy, styles
or formulas; a workbook export could contain one file per sheet.

XLSX has two useful scopes: a values-only workbook can preserve sheets and basic
formatting without translating any formulas; a formula-preserving workbook needs
an explicit mapping from Ordinate references/functions/types to Excel semantics.
Unsupported formulas should be reported, not silently rewritten. ODS is another
open spreadsheet format, but has the same semantic translation question.

The .ord document remains the lossless editable source. Export is deliberately
outside this implementation.
