# RFC-0043: Sheet Notes

- Status: Implemented (core and shared web/desktop UI)
- Scope: restricted Markdown above and below the single primary table

## Contract

Each sheet may contain a `beforeTable` and an `afterTable` note. Notes are document
content, never cells, formulas, headers, front matter or calculation dependencies.
Changing notes must not move coordinates, change cell identities, dirty formulas,
or invalidate calculation caches, including undo and redo.

The canonical representation is a typed note block in the sheet's existing ordered
source-block sequence. Do not maintain a second mutable Markdown string or a
parallel notes field. Public readers return detached note values. Serialization
derives restricted Markdown from these blocks. Invalid source remains an unparsed
block with a diagnostic and can be explicitly replaced through the note edit API.

## Syntax

Support paragraphs, `**strong**`, `*emphasis*`, their nesting, and single-level
bullet lists (`-`, `+`, `*`) and ordered lists (`1.`, `1)`). A paragraph's soft source
line breaks normalize to spaces; blank lines separate paragraphs. List items occupy
one nonempty source line, with one to four spaces or tabs after their marker.
Ordered markers have one to nine digits and retain the initial start (including
zero). Subsequent source numbers do not control numbering. Canonical serialization
repeats the start number; rendering increments it. Marker/delimiter changes start
a separate list. Blank lines end the restricted single-line list.
No headings, HTML, images, links, code, blockquotes, nested lists, tables or hard line breaks
inside a note. Strict source parsing diagnoses unescaped constructs outside this
subset. The note editor instead commits unsupported syntax as escaped ordinary
text, never HTML. Backslash escapes punctuation.
Underscores in words are literal; underscore emphasis is not an alternate syntax.
Emphasis must be balanced, nonempty and not padded by whitespace.

Standalone `---`, `----`, `-----`, `***`, `___` and spaced variants such as
`- - -` are the same thematic separator, represented by `{kind: "rule"}`.
There is no separate column-break syntax or AST kind. Rules allow up to three
leading spaces and trailing spaces/tabs, including at note edges or consecutively.
Canonical rules serialize as `---`. Escape `\---` for literal dashes.

Layout is a renderer decision: internal separators divide content into sections.
Above the existing 420px narrow-note breakpoint and with space for at least two
readable 12rem columns and a 24px gutter, sections
render as columns; otherwise they stack in source order with visible horizontal
rules. Leading/trailing and extra consecutive rules remain visible, never creating
empty columns. Saved notes, import previews and printing use the same renderer;
resizing never changes the note AST or saved Markdown. Front matter is recognized
only at the start of the document; `| --- |` still belongs to table syntax.

`# Name` still starts a sheet, and pipe-delimited rows still delimit the table.
Escape literal reserved characters (`\# Name`, `\| text \|`). The standalone
note editor escapes structural syntax instead of creating extra sheets/tables.
Formula-looking text is inert, including `=SUM(A1:A3)` and external URLs.
Notes require a sheet with exactly one nonempty table; note-only documents and
notes between multiple tables are outside this version.

The marker definitions follow [CommonMark](https://spec.commonmark.org/0.31.2/),
but this remains an explicit subset, not a general Markdown/HTML engine.

Example:

```markdown
# Results

**Units: EUR million.** Unreviewed *quarterly* figures.

| Item || Q1 | Q2 |
| ---- || --- | --- |
| Sales || 12 | 14 |

- Figures are rounded.
- Prior periods were restated.
```

Empty input clears a note. Canonical formatting inserts blank lines around note
blocks, preserves paragraph/list order, and is idempotent. Unsupported source is
preserved with diagnostics through save/reload; there is no raw-HTML rendering API.

## Core API and lifecycle

Expose note types, parsing and Markdown serialization, `SheetState.getSheetNote`,
`SheetState.setSheetNote`, and atomic `set_sheet_note` edits with `sheet`,
`position`, and `markdown`. Bad positions, types or note syntax fail before mutation.
The empty string clears the selected side. Reads of invalid note source fail with
the syntax diagnostic instead of presenting a fabricated empty note.

The editor uses `parseSheetNote(markdown, {unsupportedSyntax: "literal"})` followed
by the canonical serializer before `set_sheet_note`. This is an explicit authoring
policy, not a fallback after a failed mutation. Unsupported inline syntax becomes
inert text in that paragraph/list item; supported blocks elsewhere remain structured.
Unsupported block prefixes become ordinary paragraphs, with indentation and hard-break
whitespace normalized to prose. Their punctuation is escaped on serialization.
Type errors, control characters, conflicts, missing sheets and failed core edits still
fail early and retain the editor draft. File commands and click-away share this one
commit boundary. Source parsing, validation and core edits remain strict.

The note authoring UI uses Enter for paragraph separation (two source newlines).
Within a flat list it continues the same marker; on an empty item it removes that
marker and exits. Shift+Enter inserts a single soft source newline. Cmd/Ctrl+Enter
confirms editing. `matchNoteListItem` is the shared parser/editor grammar; it also
recognizes an unfinished empty item for editing, which strict source parsing still
rejects. Separator precedence and supported marker spacing are not reimplemented
by the UI. Ordered continuation repeats the marker like canonical serialization;
display numbering follows Markdown. This changes authoring assistance, not saved
syntax or soft-wrap semantics. Text insertion uses native editing history.

Notes participate in document cloning, sheet moves/renames/deletes, edit history,
validation and document IR. Notes edits preserve cell state; atomic batches retain
their existing explicit `recalculate` option. Formula parsing/evaluation stays
unchanged. No new Markdown dependencies or evaluator functions are needed.

## Interchange

ORD preserves notes and their supported formatting. CSV/TSV and Excel currently
omit notes with a warning. Do not insert rows, move formula coordinates, or turn
Excel merged cells into notes automatically.

Excel import proposes contiguous leading/trailing text-only bands (one text cell
in the first column or the anchor of a horizontal merge). Numeric/formula rows,
interior rows and all-text single-column sheets are not inferred as notes. The
wizard shows source row ranges and text, unchecked by default. Confirmed rows
become escaped note paragraphs, retaining bold emphasis. Header choices apply to
the remaining table. Reference AST coordinates, including fixed/cross-sheet and
resolved named references, are rebased before native translation. A reference
into removed rows blocks that choice during candidate planning; the wizard
disables extraction, names a referencing cell and retains the note preview.
Planning and extraction use the same dependency inspection. Literal empty or
whitespace-only strings count as blank layout rows, but formulas with empty
results and numeric zero do not. This keeps contiguous footer prose together.
Unsupported formulas remain inert original text, not adjusted executable source.

## Manual edge-row conversion

`convert_rows_to_note` moves a nonempty consecutive prefix or suffix of whole
table rows into the matching note. The selection uses stable `rowIds`, not visible
row offsets. This is a structural edit (unlike `set_sheet_note`), recorded as one
undoable transaction. At least one body row must remain. Interior/discontinuous
rows, formulas, numeric/temporal values, invalid cells/display metadata and
incomplete hierarchy prefixes cannot be converted. Blank layout rows are allowed
when the selection also contains text.

`previewRowsToNote` is the single source of truth for eligibility, Markdown and
reference protection. Literal cell text becomes escaped paragraphs in row/column
reading order; effective bold is retained. Existing intro content precedes an
extracted prefix; an extracted suffix precedes existing footer content. Notes do
not preserve table columns, colors or alignment. A surviving formula referencing
any extracted row blocks conversion, including A1/fixed/relative/label/range and
cross-sheet references. Unresolved references into the target sheet must be fixed
before conversion. Surviving row/cell identities, reference targets, header counts
and display defaults use the existing structural-edit machinery.

The shared UI offers **Convert to note before/after table** in row and whole-row
selection context menus, or **Add to note ...** when that side already has content.
Ineligible edge selections keep the item disabled with a visible explanation;
interior selections have no conversion item. Conversion does not open the note
editor or leave a stale table selection. Undo restores both rows and prior note.

## Verification

Cover parse/format/save/reload stability; escaped syntax, Unicode, CRLF, malformed
and unsupported input; each position and clearing; multiple sheets; atomic failure;
undo/redo including conflicts and mixed batches; cloning; row/column edits;
unchanged formulas, IDs, dependencies, cached values and dirty flags; and explicit
note-omission diagnostics in XLSX/CSV/TSV. All fixtures are synthetic.
