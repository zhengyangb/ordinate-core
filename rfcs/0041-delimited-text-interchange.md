# RFC-0041: CSV and TSV Data Interchange

- Status: Draft (TypeScript implementation)
- Extends: RFC-0011, RFC-0039
- Scope: core library only; no UI, filesystem access, Excel, ODS, or cloud APIs

## Purpose and boundaries

Import and export rectangular data without changing Ordinate's parser, formula
language, evaluator, or document representation. CSV and TSV share one codec;
only the delimiter differs. These are data interchange operations, not native
Save As operations or lossless `.ord` serialization.

Export evaluates formulas using the existing evaluator. It never writes formula
source as executable spreadsheet syntax. Import never executes formulas or
interprets Ordinate table syntax embedded in fields.

## Public API

```ts
importDelimitedDocument(text, {
  format: "csv",                 // required: "csv" | "tsv"
  sheetName: "Imported",          // required, nonempty, already trimmed, one line
  valueMode: "text",              // default; optional "infer"
  limits: { maxCells: 100_000 },   // optional individual overrides
});

exportDelimitedSheet(document, {
  format: "tsv",
  sheetName: "Revenue",           // required, exact unique name; no active-sheet state
  formulaLikeText: "reject",      // default; optional explicit "preserve"
  lineEnding: "\r\n",             // default; optional "\n"
  bom: false,                    // default; optional UTF-8 BOM marker
  limits: { maxCells: 100_000 },
});
```

Both functions return a discriminated result:

- `{ ok: true, value, diagnostics }`
- `{ ok: false, diagnostics }`, with no partial document or output text

Import's value is a new `DocumentState` with exactly one sheet. Export's value
contains `text`, `format`, `sheetName`, `rowCount`, and `columnCount`.

Diagnostics contain stable `code`, `severity`, and `message`, optional sheet
name, zero-based logical `rowIndex` / `colIndex`, and `count` for aggregated
warnings. Syntax errors also include a zero-based UTF-16 `offset` into the
original input. Aggregated warnings identify the first occurrence, not every
affected cell. Callers must inspect diagnostics before saving or presenting a
result; success with warnings is not a claim of lossless conversion.

Malformed data, invalid options, missing/ambiguous sheets, limits, and
unrepresentable evaluated values fail early. Programmer/invariant failures are
not caught and disguised as successful conversion or empty data.

## Delimited text dialect

CSV follows RFC 4180's field quoting, with Unicode content and acceptance of
CRLF, LF, or CR record endings. TSV uses the same quoting rules with TAB as the
delimiter. This is an explicitly quoted TSV dialect, not the more restrictive
IANA TSV profile; readers that merely split every physical line on TAB cannot
consume embedded tabs/newlines. There is no delimiter, encoding, or header
auto-detection and no `sep=,` directive interpretation.

- Input/output is a JavaScript string; byte decoding/encoding belongs to callers.
- One file-leading U+FEFF is consumed as a BOM. Embedded U+FEFF is data.
- Double quotes delimit an entire field; doubled quotes encode one quote.
- A quote inside an unquoted field, an unterminated quoted field, or any text
  (including whitespace) between a closing quote and delimiter/end is an error.
- Quoted fields preserve embedded CRLF, LF, CR, tabs, spaces and Unicode exactly.
  Backslashes have no CSV/TSV escape meaning.
- All records must have the same number of fields. Ragged records are errors,
  not silently padded or truncated.
- Blank records are one empty field; they are not skipped. A final record
  terminator does not invent an additional record. Empty input/BOM alone is
  zero records. `""` is one record with one empty field.
- Output uses doubled-quote escaping, quotes fields containing a delimiter,
  quote, CR or LF, and quotes empty fields. A first field starting with U+FEFF
  is quoted so it cannot be confused with a file BOM. Nonempty output always
  ends with the requested record terminator.

## Import semantics

Every record is an ordinary body row. No header rows, header columns, hierarchy,
display metadata or formulas are inferred. The first record is retained as data.
Empty input creates an empty sheet (the same core state as a newly created sheet).

`text` preserves every decoded field as a string, including empty strings,
leading/trailing spaces, `00123`, `true`, dates, `null`, `=SUM(A1:A2)`, cached
formula-looking text, pipes, backslashes, `@meta`, `---`, and `* Label`.
Values are encoded as explicit Ordinate string literals and then table-escaped,
using existing core encoding functions. CSV quoting is not Ordinate quoting.

`infer` is an explicit, conservative convenience mode:

- Exact lowercase `true` / `false` become booleans.
- Decimal numbers with an optional leading minus, no redundant leading zeros,
  optional decimal fraction, and optional decimal exponent become finite JS
  numbers. The mantissa's integer part is required. Whitespace is not trimmed.
- Non-finite numbers, unsafe integers, and nonzero values that underflow to zero
  remain text with a `numeric_text_preserved` warning. Other fractions use JS
  Number precision; selecting inference permits numerical normalization.
- Other fields remain strings. In particular, dates, durations, `null`, errors,
  leading-plus expressions, and formulas are not guessed.
- A `types_inferred` warning summarizes conversions. Quoting is only transport
  escaping and does not opt individual fields out of inference.

Numerical input is rendered as a non-exponential Ordinate number literal before
using the existing parser; the formula grammar is unchanged. Native document
and formula serialization share this encoding, preserving finite JS number
precision and negative zero across save/reopen instead of rounding to 15 digits
or emitting unparseable exponent notation. Import creates a
new document only; it does not merge into an existing document or touch history.

## Export semantics

The caller selects exactly one sheet by name. All its logical rows and columns
are exported, including header rows, label columns, hierarchy parents and
children. Folded/hidden UI state is irrelevant. Serialization-only separator
rows and metadata control frames are not data and are excluded.

Structural header/label cells use their semantic label text, not formula
evaluation. The first label column removes hierarchy markers. Other cells use
fresh evaluated values, including cross-sheet dependencies, not stale caches or
rounded display strings. Source document state, caches, dirty flags and formula
reference bindings remain unchanged: export evaluates an isolated clone, using
the same cloning implementation as atomic core edits.

| Value kind | Field |
| --- | --- |
| string | Exact text |
| number | JS round-trippable number text; preserve `-0`; reject non-finite values |
| boolean | `true` / `false` |
| date / time / datetime / duration | Existing canonical runtime value string |
| blank | Empty field |
| null | Empty field, with `null_as_empty` warning |
| error | Export readable text (e.g. `Type Error`, `Divide by Zero`) with an `errors_as_text` warning; preserve the surrounding data |

Error text uses stable English labels: `Generic Error`, `Parse Error`, `Type Error`,
`Divide by Zero`, `Unresolved Reference`, `Ambiguous Reference`, and `Cycle`.
Custom external error kinds retain their spelling as `error[custom_kind]`.
This is an explicit lossy text conversion, not a cached result or a blank-cell
fallback. Reimport treats these fields as text; it does not reconstruct errors.
Repeated error conversions report their count and first affected cell.

CSV/TSV do not retain type tags. Blank, null and empty string fields cannot be
reliably distinguished by a receiving application. A `types_not_preserved`
warning identifies non-string values. Formulas, display metadata, hierarchy,
front matter and non-table sheet content produce explicit omission warnings
when present. Additional table blocks in the selected sheet are rejected rather
than silently ignored. Unselected sheets are intentionally outside the export
scope, not silently merged into one file.

## Spreadsheet formula injection

CSV/TSV themselves have no formula type, but receiving spreadsheet applications
may execute formula-looking text. Quoting alone does not prevent this.

The default `formulaLikeText: "reject"` rejects text fields whose first
non-whitespace character is `=`, `+`, `-`, or `@`, their full-width equivalents,
or whose leading whitespace includes TAB/CR/LF. This applies to structural
labels and formula results that are strings, not genuine negative numeric
values. The policy is conservative, not a guarantee about every downstream app.

Explicit `preserve` emits the original text unchanged and reports
`formula_like_text`. No apostrophes are silently added and no content is
silently rewritten. Import always treats these fields as non-executable text.

## Resource limits

`DEFAULT_DELIMITED_LIMITS` exposes `maxTextLength: 16_777_216`,
`maxRows: 100_000`, `maxColumns: 10_000`, `maxCells: 1_000_000`, and
`maxFieldLength: 1_048_576`. Text/field lengths are UTF-16 code units. Callers may override limits
with positive safe integers, never Infinity. Input size is checked before
parsing; row/column/cell/field budgets are enforced during parsing. Export
checks the selected sheet's dimensions before materialization, limits the total
document cells before cloning/evaluation, and bounds output while encoding.
There is no truncation, silent recovery, partial success, or filesystem I/O.

## Test contract

Both delimiters run the same quoting, malformed-input, limits, Unicode, blank
record and injection matrix. Core integration tests cover explicit strings,
opt-in inference, structural sentinels, escaping through native serialization,
headers/hierarchy, cross-sheet evaluation, stale caches, numerical precision,
temporal/error values, warnings and original-document immutability on success
and failure. Deterministic generated fields exercise encode/decode properties;
independently specified golden input/output cases prevent self-confirming tests.

No `.ord -> CSV/TSV -> .ord` semantic round-trip is promised. Testing decoded
field preservation is useful and does not imply preservation of formulas,
types, hierarchy or display metadata. A later Excel RFC must define its own
formula translation contract without changing this one or the evaluator.

## References

- [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180)
- [IANA TSV profile](https://www.iana.org/assignments/media-types/text/tab-separated-values)
- [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)
