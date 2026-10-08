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

Close and Quit share the same flush and save-confirmation policy. Quit confirms
documents sequentially before closing any window, writes the workspace and
flushes Chromium storage. Cancel or a failed save leaves all documents open. Next launch
reopens the saved workspace; document windows may be merged again with the native
Window menu. Closing an untouched new document is silent, even when its initial
content includes a default table. The shared file session compares current content
with the canonical initial-content baseline; selection and view changes do not
count as edits, and Undo back to that baseline makes the document clean again.
Imported, duplicated and recovered changed content remains protected. An edited
untitled-window close offers Save, Cancel or Don't Save. The main process uses the
fresh save requirement returned by the renderer's completed flush, not the native
edited indicator (which tracks recovery durability). Explicitly saved files remain
on disk when their windows close.
Closed documents are removed from the workspace. Confirmed quit keeps saved file
records; untouched new documents and documents explicitly discarded with Don't
Save are not reopened. Recovery drafts still protect against crashes, not as a
silent substitute for a quit confirmation. Repeated quit attempts share one
pending operation, and close/new-window actions cannot interfere with it.

macOS checkpoints the existing file before its first changed save and at most
once per five minutes of subsequent autosaves. Restoring a version forces a
checkpoint of current content. NSFileVersion owns the version storage; this is
a timestamp menu, not AppKit's full-screen Time Machine version browser. Volumes
that cannot store macOS versions report the native error instead of silently
claiming version history exists. Web has no native document or version logic.

## Import and export

File → Import opens a converted CSV, TSV or XLSX document in a new native tab.
File → Export and the toolbar's Export button share the conversion-review flow.
Export never changes the active document or its autosave destination. See the
[spreadsheet interchange specification](spreadsheet-interchange.md) for format
scope, warning/error behavior and the distinction between export-copy and Save As.

## Printing (macOS)

File → Print… / Cmd+P opens a compact shared options dialog. Its segmented choice
reuses the Settings control for Current sheet (default) or All sheets. Full-row
choices reuse the export selection component for notes above and below the table,
independently included by default. Note choices are absent when no sheet has that
note position; when only other sheets have notes, they remain disabled in Current
sheet instead of changing dialog geometry on scope switches. The summary is a
fixed-height, truncatable line. Cancel/Escape starts no system print job.

Printing includes the full table, expanded hierarchy, computed values and effective
number/style formatting. Table headers remain included and repeat on long pages;
note settings never remove headers. All sheets retain workbook order and each
starts on a fresh page, with no blank lead or trailing page. No toolbar, Rails or
selection rings are printed. There is no toolbar entry.
Chromium paginates an in-memory PDF; PDFKit presents the
Mac window-modal print panel with page preview explicitly enabled. The panel
owns printer, paper, orientation, page range and scaling. Changing paper fits
the already-paginated PDF rather than reflowing the table. Wide tables wrap to
the PDF page width. Long tables paginate and repeat their header rows.

The command commits pending cell/note edits, then builds a detached snapshot
using the existing presentation and row projection. One captured source backs
both the options and the printed content; a whole-workbook print shares one
evaluation across every sheet and presentation. Source mode parses the
current source instead of printing stale table state; invalid structure/notes
fail explicitly. Blocking issues in an unselected sheet do not reject Current
sheet, but All sheets fails explicitly rather than silently omitting them. Cell formula errors remain visible. A print-only React root
renders the complete table rather than the virtualized screen DOM. The scoped
native IPC passes the PDF buffer directly to PDFKit (no temporary file), retaining
the PDF document/operation and print root until
completion/cancellation, then cleans it up even on failure. Repeated commands
and commands behind a modal do not start another job. Printing itself does not
save, mutate or export the document.

`npm run desktop:test-print` exercises this path in a test-owned Mac window,
substituting only the PDFKit completion callback. Real Chromium PDFs verify
pagination/formatting. A separate native smoke opens and cancels the actual
system preview twice, verifies its preview option and two-page PDF, and rejects
malformed PDFs without submitting physical print jobs. Test-only panel controls
are excluded from the production addon. Unit tests cover complete data, current
source, invalid input, escaping, format cascade and print lifecycle/failures.

## Printing (browser)

Both the editor web build and Ordinate Online expose Ordinate → File → Print…
and Cmd/Ctrl+P. The same options and snapshot/layout above render all rows and the
chosen notes/sheets; only the host dialog differs. Browser printing passes HTML/CSS directly
to `window.print()`, with no backend, uploaded content or pre-generated PDF.
The browser owns pagination, print settings and its available PDF destinations.

The print root remains mounted until `afterprint`, not merely until `print()`
returns, since browser previews can be asynchronous. Cancellation is a normal
completion. Errors remove the root and release the command for retry. Keyboard
printing commits active edits and is blocked behind application dialogs, just
like the native command. There is no guessed timeout or fallback print/export.

After building, `npx electron desktop/interchange-smoke.mjs --browser-print-only`
tests isolated ordinary/Online pages with a stubbed dialog and real Chromium PDF
pagination: full 260-row data, notes, active sheet, source edits, keyboard commit,
both themes, cancellation, duplicate requests and invalid-source/modal guards.
Both native and browser suites also verify the options dialog, keyboard controls,
scope/toggle geometry, narrow layouts, independent note omission, all-sheet order,
cross-sheet formulas, three-page PDF breaks and invalid-sheet rejection/retry.
