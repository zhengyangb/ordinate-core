# ordinate-core

Core library for Ordinate documents.

Primary implementation: TypeScript (`packages/core-ts`).
Python (`src/ordinate_core`) is a frozen reference and is not actively maintained.

## Example workbooks

The shared [examples directory](examples/README.md) contains a guided workbook and eight editable native
`.ord` workbooks: company reporting, DCF valuation, project investment, household
budgeting, mortgage amortization, subscription metrics, inventory planning and
time-based invoicing. All figures and companies are fictional. These are
user-facing models, separate from RFC compliance fixtures; core tests read the
same files rather than duplicate their source.

[Ordinate Online](apps/ordinate-app/README.md#ordinate-online) is a static-hosted
variant of the shared editor, with an example gallery and separate browser drafts.

## Specification Boundaries

Ordinate RFCs in `rfcs/` define the core document format, semantic model, parser and serializer behavior, evaluation semantics, and public core library edit contracts.

Application-specific editor behavior is specified separately under `apps/ordinate-app/docs/features/`. This includes UI workflows, editor sessions, command boundaries, undo/redo UX, file open/save behavior, host integration, and future desktop packaging.

Do not fold app feature behavior into core RFCs unless it changes the `.ord` format or the public core library contract.

Current capabilities:

- formatted scalar text with `format(value, spec?)` and `f"Total: {B2:,.2f}"`
  syntax sugar, including reference editing and bounded numeric Excel `TEXT`
  import/export ([RFC-0044](rfcs/0044-formatted-text-and-f-strings.md))
- core Sheet Notes before/after the table: paragraphs, bold, italic and flat bullet
  lists, with atomic edits and undo/redo (RFC-0043; no UI yet)
- import/export CSV and quoted TSV in the TypeScript core (RFC-0041;
  single-sheet data interchange, evaluated-value export, structured diagnostics)
- accept and preserve opaque YAML front matter before the first sheet (RFC-0040;
  no fields or YAML semantics are defined yet)
- parse sheets and pipe tables from text
- validate RFC-0002 structural rules
- validate RFC-0003 section hierarchy rules
- parse/evaluate RFC-0004 scalar references (`@[row_selector, col_selector]`)
- parse/evaluate RFC-0005 minimal formulas (`+-*/`, `==`, parentheses, references)
- parse literal/formula cells with optional cached form (`cached = expression`)
- return validation summary stats (sheet count, row/column counts, header row/column counts)
- format document text to a normalized readable layout
- formatter auto-expands separator row dashes based on column widths
- apply file-level escaping inside cells:
  - `\|` for literal pipe
  - `\\` for literal backslash
- expose an internal object model via `parse_document_model` / `parse_file_model`
- expose runtime APIs via `parse_cell`, `evaluate_document`, `evaluate_file`
- expose cell-level eval API via `evaluate_cell` (no full table required)
- expose RFC5 pipeline API via `evaluate_and_format_document` / `evaluate_and_format_file`

Planned:
- formula parsing and calculation engine

Tests:
- generic unit tests: `tests/test_*.py`
- RFC-organized compliance tests: `tests/rfc_0002/test_rfc_0002_requirements.py`
- RFC-organized compliance tests: `tests/rfc_0003/test_rfc_0003_sections.py`
- fixture documents: `tests/fixtures/rfc_0002/*.ord`
- formatter expectation snapshots are compared via fixture-to-fixture assertions
- runtime parser/evaluator tests: `tests/test_runtime_model.py`
- RFC4 reference spec tests: `tests/rfc_0004/test_reference_cases.py`
- RFC4 single-file readable cases: `tests/fixtures/rfc_0004/reference_cases.cases`
- RFC5 formula-eval spec tests: `tests/rfc_0005/test_formula_eval_cases.py`
- RFC5 single-file readable cases: `tests/fixtures/rfc_0005/formula_eval_cases.cases`
- RFC5 ORD input->output cache snapshot test: `tests/rfc_0005/test_evaluate_and_format_ord_file.py`
- RFC5 ORD fixtures: `tests/fixtures/rfc_0005/profit_statement_input.ord` and `tests/fixtures/rfc_0005/profit_statement_expected.ord`
- RFC6 types/operators spec tests: `tests/rfc_0006/test_types_and_operators.py`
- RFC6 single-file readable cases: `tests/fixtures/rfc_0006/types_and_operators.cases`

Spec format note:
- `*.cases` here is a project-local readable DSL (`=== case`, `[doc]...[/doc]`, `expect_*`), not an external standard format.

## CSV / TSV interchange (TypeScript)

The public core entrypoint exposes `importDelimitedDocument` and
`exportDelimitedSheet`. CSV and TSV use the same strict quoted-field dialect,
with comma and TAB delimiters respectively. This does not add application UI,
file access, or Excel formula conversion. See [RFC-0041](rfcs/0041-delimited-text-interchange.md)
for the complete contract, limits and diagnostics.

```ts
import { importDelimitedDocument, exportDelimitedSheet } from "./packages/core-ts/src/index";

const imported = importDelimitedDocument('Name,Amount\r\nCash,120\r\n', {
  format: "csv",
  sheetName: "Imported",
  valueMode: "infer", // optional; the default "text" preserves all fields as strings
});
if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
// Surface warnings before accepting the conversion. No header row is guessed.

const exported = exportDelimitedSheet(imported.value, {
  format: "tsv",
  sheetName: "Imported",
});
if (!exported.ok) throw new Error(JSON.stringify(exported.diagnostics));
// The host decides whether to save exported.value.text after inspecting warnings.
```

- Imports create a new document and never execute formula-looking fields.
- Exports include all logical rows of the explicitly selected sheet, evaluate
  formulas on an isolated clone, and leave the original document unchanged.
- Warnings identify omitted formulas/styles/hierarchy/metadata and type loss.
  Errors have no partial output. Text which a spreadsheet might execute is
  rejected by default; `formulaLikeText: "preserve"` explicitly preserves it
  unchanged with a warning. CSV quoting alone does not prevent formula injection.
- No lossless `.ord` round-trip is promised. Basic numeric/boolean inference
  is opt-in; dates, formula expressions and leading-zero identifiers stay text.
- CSV/TSV adds no runtime dependencies. Coverage tooling is development-only.

Run all core tests with `npm --prefix packages/core-ts test`, build with
`npm --prefix packages/core-ts run build`, and run the interchange tests with
coverage thresholds using `npm --prefix packages/core-ts run test:interchange`.

## Excel interchange (TypeScript core profile)

`importExcelWorkbook(bytes, options?)` and `exportExcelWorkbook(document, options?)`
are async core APIs returning `{ ok, value?, diagnostics }`. Export writes actual
readable formula cells without native result caches, requesting Excel
recalculation rather than a values-only sheet. Import
translates formula source and ignores cached results. Both operate on all sheets;
an error returns no partial document or file. Hosts must surface diagnostics.

The rules cover arithmetic, text concatenation, references and copy locks,
conditionals, selected aggregates (including multiple-argument MIN/MAX import),
scalar literal text matching/replacement/slicing, numeric and statistical functions,
and all 21 native financial functions. TEXTJOIN, exact MATCH/XLOOKUP, two-vector
SUMPRODUCT, one-dimensional intermediate FILTER and supported TAKE/DROP forms
have explicit rules. INDEX, ROWS/COLUMNS and static reference slices translate
index conventions without changing selected coordinates. Formula spill results,
two-dimensional FILTER, multi-range view composition and explicit solver guesses
remain unsupported; see RFC-0042 for the exact directional profile.
Export prioritizes recognizable operations and exact reference membership over
native evaluator emulation: `A1+B1` stays `A1+B1`, explicit concatenation becomes
`&`, and `number(A1)` becomes `VALUE(A1)`. Excel coercion, comparison, rounding
and error rules can produce different results; this is disclosed, not hidden
behind generated type guards. Target-engine tests include intentional differences.
Date-formatted input becomes native date/datetime values;
DATE/YEAR/MONTH/DAY imports preserve the workbook's 1900/1904 calendar through
ordinary native expressions. XNPV/XIRR consume typed date ranges directly; their
explicit serial-date arrays are decoded at import. Original text stays text.

**Import and export support are independent; lossless or bidirectional round-trip
compatibility is not promised.** For example, a calendar formula may import into
ordinary native temporal expressions whose operations have no export rule.
That is a located conversion error, not a restriction on native formulas.
General temporal formula export, additional financial families and broader
view composition remain separate features. Unimplemented formulas fail explicitly and never turn
into cached values. The API stops at the first blocking error with no partial
output; earlier warnings are retained. The explicit `cellErrors: "blank"` host
policy leaves erroneous/unsupported cells blank with located warnings. The user
confirms those warnings before saving/downloading the prepared file.
See the [directional compatibility guide](rfcs/0042-excel-formula-interchange.md#import-remains-directional)
for the supported groups, argument restrictions and known verification limits.

The binary adapter lazily loads ExcelJS, fflate and saxes. Tests inspect emitted
workbooks with ExcelJS and raw XML, and use the separate desktop-engine gate for
recalculation. Neither replaces verification in Microsoft Excel itself.
Run the Excel suite and coverage report with
`npm --prefix packages/core-ts run test:excel`. This enforces 95% line/statement/
function coverage and 90% branch coverage of the measured compatibility boundary;
coverage is not a percentage of supported Excel features. The shared web/desktop
UI is specified separately in [Spreadsheet interchange](apps/ordinate-app/docs/features/spreadsheet-interchange.md).

For independent desktop-engine recalculation, install/configure LibreOffice so
`soffice` is on PATH, then run
`npm --prefix packages/core-ts run test:excel:recalc`. This separate integration
gate fails if the engine is missing; it never silently skips. It uses disposable
files and an isolated profile, poisons formula caches, and checks recomputed
values after selected input edits. Calc/Excel differences are recorded separately
as oracle calibration checks, not counted as proof of formula compatibility.
