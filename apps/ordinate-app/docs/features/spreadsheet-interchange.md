# Spreadsheet import and export

Status: implemented. This is the frontend feature specification; conversion
semantics belong to [RFC-0041](../../../../rfcs/0041-delimited-text-interchange.md)
and [RFC-0042](../../../../rfcs/0042-excel-formula-interchange.md).

## Entry points

- The toolbar contains **Export a copy**, not an Import button, on both hosts.
  It opens the shared menu surface with Excel, CSV, TSV and Ordinate copy.
  Format choice never appears again inside a dialog.
- Desktop File menu contains **Import…** and **Export…**. Commands target the
  focused document. Import creates an untitled document in the current native
  tab group; sheet tabs are not document tabs.
- Browser **Open file** offers Open Ordinate document or Import spreadsheet.
  The former keeps the existing ORD file-session workflow; the latter shares
  the desktop conversion review and never grants write access to its source.

## Formats and defaults

| Format | Import | Export |
| --- | --- | --- |
| CSV / TSV | UTF-8, no guessed headers, text by default; explicit number/boolean inference | Explicit sheet, evaluated full-precision values, BOM, quoted multiline fields |
| XLSX | Supported formulas executable; unsupported formulas may remain text after explicit loss confirmation; no cached-value substitution | All sheets, readable native Excel formulas; recalculation requested, no Ordinate formula caches |
| ORD copy | Use Open for native documents | Exact persistence snapshot, including front matter; invalid Source drafts allowed |

No XLS, ODS, Google-specific format, or values-only XLSX mode. XLSX import and
export are independent profiles; successful import does not promise re-export.
The UI must not have its own list of supported formula functions. Core diagnostics
are authoritative as the conversion profile evolves.

Imported formulas default to readable A1 references, retaining `$` row/column
copy locks. Sheet-qualified A1 uses `@["Inputs"::$A$1]`; the Formula Bar resolves
and highlights the target sheet through the same core reference inspection API.
Arithmetic, aggregates and conditionals use ordinary native operations, without
generated Excel-coercion guards. Review explains that calculation results may differ.

XLSX import/export retains supported text styles: bold/normal, left/center/right
alignment and the native red/green/blue palette. Core approximates nearby RGB or
theme colors and reports approximations or omitted formatting in the existing
review list. Imported styles are ordinary ORD metadata, so document recovery and
both hosts use the same rendering path. No new style toggle is required. XLSX
export uses core's neutral presentation policy: theme-following body typography,
content-based bounded column widths, wrapped long text and fitted row heights.
Known header rows/label columns receive subtle neutral fills and bold weight;
header rows are centered when their alignment is automatic. Headers can optionally
be frozen. Freezing defaults off. User styles override defaults; export does not create Excel Tables,
filters, row banding or decorative borders. CSV/TSV remain style-free.
Repeated adjacent header labels become horizontal Excel merged cells using the
same core grouping policy as the screen and print views, without crossing the
header-column/data-column boundary. Body cells are not merged. Hierarchical row
labels use two leading spaces per resolved level instead of hierarchy markers;
all descendants export, but Excel expand/collapse structure is not retained.

Supported fixed-point precision, grouping, percentages and negative parentheses
are preserved. Date-formatted serials become native date/datetime values: the
Formula Bar shows DATE and the ISO date input, with no imported date display format.
Excel calendar epochs stay inside the converter. Native date literals export with
Excel's required date formatting; the native document itself remains unformatted.
Existing numeric imports are not rewritten automatically; reimport the source XLSX.
Currency/zero decorations and exact date layouts can be
approximated; the review lists those losses. The shared grid uses compact widths
for predominantly numeric reports, protects numeric/date display lengths, and
narrows internal empty spacer columns without removing coordinates. Error capsules
show only their icon when the full label cannot fit; hover and keyboard focus keep
the complete error details available.

CSV/TSV include hidden/collapsed rows, hierarchy labels and headers. They omit
structural metadata, formatting, sheet prose and other sheets; core notes describe
the losses. Text that another spreadsheet might execute is rejected by default.
The user can explicitly allow formula-like text, with an execution-risk warning;
the importer never executes CSV/TSV text as formulas.
Calculation errors are exported as readable text (for example `Type Error`),
with a warning and location; they do not block CSV/TSV export.

## Export flow

Choose a format from the toolbar menu (or native File > Export). ORD copies
convert immediately. Excel prepares a workbook for confirmation; CSV/TSV show a compact sheet picker and
an **Export** action; no explanatory sentence repeating what CSV means. The picker
floats above the content without resizing or scrolling the dialog, stays within
the viewport, and remains owned by the modal for focus and keyboard navigation.
The immutable snapshot is captured after committing pending cell edits.
CSV/TSV automatically prepare the selected sheet on opening and whenever a setting
changes. Notes are shown in the same dialog, with settings still editable. Export
only saves the prepared bytes: one confirmation, never a first Export to analyze
and a second Export to save. Preparation and blocking conversion errors disable
Export; warnings do not. Changing settings invalidates old bytes immediately and
late results from superseded preparations are discarded.

Excel uses core's explicit `cellErrors: "blank"` policy and initially enables
`unsupportedFormulas: "value"`. **Keep unsupported formula results** is a shared
whole-row selection button, independent of freezing. A valid freshly evaluated
formula that cannot be translated becomes a static value with its own loss
warning; imported caches are never used. Deselecting it leaves unsupported cells
blank. Erroneous cells are blank, supported formulas stay editable, and each
omission is reported.
Workbook-wide failures still stop the operation. When conversion produces warnings,
show a simple list with locations and occurrence counts **before** saving/downloading.
The user chooses **Cancel** or **Export**; only Export passes the exact prepared
bytes to the transport. Compatibility notes use a warning label; omitted cells
use a stronger loss label. Color is supplemental, not the only distinction.
Excel always uses one confirmation page, even with no headers or warnings. It shows
the filename and all-sheet count in the title row, with lighter metadata and no
repeated export-copy caption. Conversion notes have their own bounded, keyboard-accessible
scroll area; scrolling them does not move the settings, title or actions.
CSV/TSV use the same compact summary and shared whole-row choice component for
Allow formula-like text; no native checkbox or redundant format explanation.
The notes region stays mounted at a fixed height even if subsequent settings
produce fewer or no warnings. All formats retain the last review during preparation;
only Export is disabled, without a Checking/Preparing message.
When any sheet has either header axis, show one
whole-row pressable Freeze headers choice, off by default, alongside any conversion
notes. The choice is neither selected nor automatically focused on opening.
Changing it invalidates prepared bytes; stale work cannot re-enable Export.
During regeneration the previous review and its scroll position remain visible.
Preparation is communicated only by disabling Export until the current bytes are
ready, without flashing status text or adding an artificial minimum wait.
Saving status occupies the existing action row, not an extra body row; the title,
settings, warning region and buttons do not move on a freeze toggle.
No-warning ORD copies proceed directly. Successful dispatch closes the dialog;
there is no extra success confirmation. Cancellation never changes the current
document. The original file/session remains unchanged.

## Import review before committing

1. Commit pending cell edits and capture one immutable document snapshot.
2. Choose a source file and prepare its preview immediately, with no additional
   file confirmation or Continue step. Perform conversion without mutating the
   editor, history, backing file, autosave baseline or original imported file.
3. Show either a successful review or errors. Consolidate formatting, formula-result
   and metadata warnings into flat categories, retaining each distinct explanation,
   total notice count, sheet count and the first affected sheet/cell. Fatal errors
   and cell omissions remain separate. Never add expandable detail panels.
   An import error never produces a partial document.
4. Only after confirmation, adopt the import.
   Change file opens the picker without discarding the current preview on picker
   cancellation. Selecting a replacement resets the prepared result and settings.
   Cancel preserves the active document and cancels pending preview work.

Excel preview selects safe before/after-table note candidates by default, for every
sheet. Initial conversion, preview and controls share these choices. Click a
compact option to deselect/reselect it; selected options use the existing green
active palette and a checkmark, without a sliding switch. Literal
empty/whitespace-only cells do not break a continuous note region; zero values
and formulas (even with an empty result) still belong to the table. Candidate
planning checks same-sheet, cross-sheet and resolved named formula references.
A referenced region stays unselected and previewable, but its option is disabled with a source
cell address and an explanation to keep those rows in the table. Planning and
extraction share this dependency check, including ranges crossing note rows.
Each available labeled strip is clickable and keyboard-operable; each shows original
row numbers and a one-line plain-text summary. The strips sit side by side on
wide screens and stack on narrow screens. Preview is independent of extraction:
it temporarily shows the full safely rendered note in the same fixed table
preview area, without adding vertical space or another wizard step. Back to table
or Escape closes the reader and returns focus to its Preview button. Switching
sheets closes the reader; each sheet retains its own extraction/header choices.

Import compaction extracts shared column defaults, then shared row defaults
(RFC 0045), retaining cell exceptions. Cell > row > column precedence resolves
each style property independently. Row defaults use the left control column
of the serialization-only `@display` frame, including on unheaded sheets.
Numeric row formats are not promoted across unheaded text labels: that would
change their format validity. Setting appropriate header columns can therefore
allow further numeric-format compaction. Metadata counts shrink, but source
byte size may not shrink proportionally because tables are whitespace-aligned.
Row and column Rails show a short green underline for explicit axis metadata;
inherited defaults do not mark other axes. Right-click a body row to edit its
format/style without needing a header column. Existing documents are not
automatically compacted; source serialization uses the canonical control frame.

Confirmed bands are removed from the
table and become Sheet Notes; headers describe the remaining table. References
are rebased structurally; a formula referring into a removed band blocks that
choice with a message to keep those rows. No extra modal is introduced.
Import runs in a dedicated worker. The session retains decoded workbook data
when header/note choices change and terminates on Back or close.

Browser import explicitly says that it replaces the current document and undo
history. It requires a distinct **Replace & import** confirmation after review.
If the current document changed during review, fail and request a fresh review.
Do not replace a session with an active save/open, pending recovery or external
edit conflict. Imported content is an untitled local draft, not the imported file's
backing store. Desktop imports instead receive a fresh document/session identity.

New imports use the source filename without its CSV/TSV/XLSX extension as their
draft name, with no "import" suffix. This name follows the local draft and desktop
session through recovery/reload, appears in the title, and supplies the first
Save/Save As suggestion (`Quarterly.xlsx` → `Quarterly` → `Quarterly.ord`). It is
metadata only: no backing-file capability is granted for the source spreadsheet.
After saving, the actual destination filename becomes the document name.

## File drop

Drop one `.ord`, `.csv`, `.tsv` or `.xlsx` file anywhere in the document window.
ORD uses the normal document-open flow: desktop opens the original file in a new
native tab (or focuses an already-open document); the browser checks unsaved
changes before replacing the current document. A browser-dropped File is a
read-only upload snapshot, not write permission to the original; use Save As to
establish a writable backing file.

CSV/TSV/XLSX opens the existing import dialog with the file already selected.
Conversion options, review, confirmation and cancellation are unchanged. Dropping
does not immediately import or overwrite anything. File drags never navigate the
page, even while a modal or file operation prevents accepting a drop. Plain-text
and internal grid drags are unaffected. Multiple files, unsupported extensions,
oversized inputs and read failures are rejected explicitly.

While a file is over the window, a non-interactive cue lightly blurs only the
working area (table or source), with green Open / blue Import guidance. Protected
browser drags may hide filenames until release: a recognized import MIME shows
Import, otherwise both supported routes are shown without guessing an extension.
Available filenames use the same validator as the eventual drop. Invalid inputs
show the reason and a non-accepting cursor; modals and busy operations suppress
the invitation. Nested drag events do not flicker or repeatedly render the cue.
Leaving, dropping, cancelling or losing window focus clears it without changing
editor focus. Motion is disabled under the reduced-motion preference.

## Export copy is not Save As

**Save As** changes the file being edited and its subsequent autosave destination.
**Export a copy** creates another file without changing either. This distinction
is expressed by the **Export a copy** label, without a repeated autosave explanation. ORD copies get a
` copy.ord` filename. Desktop export refuses any currently open document path,
including aliases resolved through symlinks. Other existing destinations require
the native save panel's overwrite consent and are replaced atomically.

Browser exports initiate downloads, not persistence receipts; the browser owns
final download success and destination. Cancelling a save panel after warning
review retains the review for retry, including warning-free Excel confirmations.
Cancelling a direct ORD export closes the flow. CSV/TSV settings remain available for retry.

## Architecture and failure boundaries

- `src/interchange/conversion.ts`: core-to-UI adaptation only; no second parser or
  formula representation. It serializes successful imports through core.
- `src/interchange/contracts.ts`: shared format names, payload types and limits.
- Browser transport: file input / Blob download, separate from native ORD handles.
- Desktop transport: isolated per-window IPC; filesystem paths and dialogs remain
  in the main process. Read only bounded regular files; reject payloads before
  showing save dialogs; canonicalize and recheck destination ownership before
  atomic replacement. Failed writes remove only their own temporary file.
- File session: one explicit `importUntitled` transition detaches backing state;
  normal draft persistence, undo reset, error notices and recovery continue to work.

Input limit: 16 MiB before reading and converting. Export transport limit: 64 MiB.
Core archive expansion/cell/formula limits still apply independently. Unsupported
encoding, corrupt archives, conversion failure and filesystem errors stay visible.
There is no silent fallback or cached-value substitution. Preview may prepare an
explicit lossy candidate; only confirmation adopts that complete candidate.
Excel's runtime codec loads on demand, not on the editor's initial path.

## Compatibility import consent

Core prepares unsupported formulas as exact source text, detaches recognized
external data links without fetching them, and omits value-free trailing layout.
The review lists these changes before adoption. Repeated formula failures with
the same explanation consolidate into flat entries with counts and a first cell
location; distinct reasons remain separate. No expandable details widget.

When these losses are present, the final action becomes **Acknowledge and continue**.
That explicit click both accepts the listed conversion changes and imports the
current prepared result; there is no separate consent checkbox. While options
are being recomputed, or if they fail, the final action is disabled. Superseded
results cannot enable adoption, and Cancel/new-file selection discard the
candidate. Ordinary presentation notes retain the regular import action. Both
hosts share this policy; only their document-adoption operation differs.

Macros, embedded objects, controls and external linked content are removed from
the import candidate, with warnings requiring the same explicit confirmation.
They are not retained as executable payloads in ORD; the original file is unchanged.
Unknown non-hyperlink external relationships are also detached, never fetched.
Malformed archives, no remaining local sheets and genuine resource-budget
violations still stop conversion. Show the actual limit
and observed span when the cell-position budget is exceeded. Do not raise the
browser's memory budget automatically or trim real far-right data to fit it.

## Interaction and verification

Reuse the application's modal, theme and typography system. Support keyboard
focus, Escape/Cancel, scrolling long diagnostic lists, wrapped filenames, small
screens and dark mode. Busy state prevents duplicate conversion or save actions.

Automated coverage includes CSV/TSV quoting and text/inference, selected-sheet
scope, executable XLSX formulas, directional failure, diagnostic grouping,
invalid bytes/types/sizes, download semantics, native binary I/O, cancellation,
destination protection, and imported-draft isolation. Native smoke checks use
the production renderer, real preload and test-owned windows/files/profile.
Real Microsoft Excel compatibility remains a separate core interoperability gate.

## Import preview and header setup

After choosing or dropping a file, the confirmation page immediately prepares
a preview, a Sheet selector, and Header rows / Header columns inputs. Each sheet
retains its own settings. The preview shows up to 12 rows and 8 columns, highlights
the chosen header regions, and reports the full dimensions. The grid scrolls
inside the modal; the sheet menu uses the shared portal menu and does not change
modal height. CSV/TSV value interpretation remains editable on this page;
changing it reparses the file while preserving the chosen header counts.
Controls reflow on narrow screens. Header counts use the same
integer stepper as Sheet Setup: a centered editable value with persistent minus
and plus buttons, enlarged in the wizard. Buttons commit immediately; direct
typing (including native Up/Down stepping) commits on Enter or blur, so multi-digit
entry does not reconfigure mid-draft. Escape restores the current value without
closing the wizard. Out-of-range or fractional drafts report an inline error and
leave the previous count intact. Boundary buttons and busy controls are disabled.

Excel's whole-sheet Table headers are adopted by core when their structure maps
directly to native headers. Other Excel sheets and CSV/TSV default to zero.
Visual clues do not automatically establish headers. There is no post-import
coach mark or transient header-guidance state in file sessions or desktop IPC.

Changing counts reimports the original file; only the latest conversion may
update the preview. Invalid boundaries display an inline error and disable
adoption. Formula cells cannot become headers. Cancellation or Back discards
pending results. Desktop opens the configured document in a new tab; browser
adoption retains the existing replacement warning and document-change guard.

Core compacts repeated body formatting into column defaults after header
configuration, preserving exceptions and omitting General number formats.
Explicit precision is retained, not inferred from whether a current value is
an integer or fraction. The preview and final document share this same pipeline.

Sheet Setup has matching editable Header rows / Header columns steppers, bounded
to retain a body row and a data column. Changes use core edits and normal undo.
Invalid counts and unsupported semantic conversions show an inline error.

The Column Rail context menu also offers **Use Column as Header** for the first
data column. Shift-select a consecutive leading group of data columns and
right-click within it to **Use Columns as Headers**. This extends any existing
header prefix without moving cells. Interior selections do not offer conversion;
selecting every data column disables it, retaining at least one data column.
Right-click the last header column to **Move Header Column to Data**. Both actions
share Sheet Setup's structural edit and undo history; formulas cannot be converted
into labels. Pinned headers do not gain unsupported insertion/deletion actions.
