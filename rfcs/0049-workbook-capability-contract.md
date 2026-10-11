# RFC-0049: Workbook Capability Contract

- Status: Implemented (V1)
- Project: Ordinate
- Depends on: RFC-0048

## Summary

Define host-independent inspection, validation, evaluation, and structured
editing of a supplied `.ord` source snapshot. These capabilities project the
existing TypeScript core into serializable requests and results. They perform
no file I/O and do not commit changes to an application document.

The V1 capability implementation is in `packages/core-ts/src/workbook_capabilities.ts`;
strict schemas and operation discovery share `capability_schema.ts`.
[RFC-0050](0050-command-line-interface.md) defines the first file-backed adapter.

## Scope and Ownership

Core remains authoritative for parsing, calculation, reference resolution,
rebasing, metadata, and serialization. Existing public core APIs remain usable
directly by stateful applications. This contract does not replace them.

The capability implementation belongs to the public `packages/core-ts` library.
Transport decoding and result encoding use one shared schema definition for
these capabilities. CLI and later protocol adapters must not independently
maintain copies of the operation union or validators.

Filesystem access, application revisions, history, permissions, and process
lifecycle remain adapter/host concerns. No engine or frontend types appear here.

## Source Snapshots and Revisions

Every call accepts a JavaScript string containing the complete source. Reject
unpaired UTF-16 surrogates as `invalid_request`; do not silently replace them
when encoding. Adapters decoding bytes must reject malformed UTF-8.

`SourceRevision` is `sha256:` followed by 64 lowercase hexadecimal characters,
computed over the UTF-8 encoding of the exact supplied string. Whitespace,
line endings, front matter, and caches participate. No normalization precedes
hashing. The shared library owns this calculation.

A revision identifies source content, not file identity, a user, or a session.
Two different files can have the same revision. Stateful hosts must additionally
bind a proposal to its resource and session revision; a content digest alone
does not detect an edit-and-undo sequence or authorize a commit.

Structured edit requests include a required `baseRevision`. Reject a mismatch
before target resolution. Other read-only calls return their source revision
so a subsequent edit can refer to the exact source examined.

## Entry Points

Public signatures:

```ts
workbookSourceRevision(source: string): Promise<SourceRevision>
inspectWorkbook(source: string, query?: CellQuery): Promise<CapabilityResult<Inspection>>
validateWorkbook(source: string): Promise<CapabilityResult<ValidationReport>>
evaluateWorkbook(source: string, options?: EvaluationOptions): Promise<CapabilityResult<EvaluationReport>>
editWorkbook(source: string, request: EditRequest): Promise<CapabilityResult<EditReport>>
```

Promise return types allow portable hashing and execution without imposing a
particular runtime. They do not imply worker execution or a background service.
The input string is immutable. An implementation may share parsed state within
a call, but may not expose a mutable document or retain caller-visible sessions.

## Result and Diagnostic Contract

```ts
type CapabilityResult<T> =
  | { status: "completed"; sourceRevision: SourceRevision;
      diagnostics: CapabilityDiagnostic[]; data: T }
  | { status: "rejected"; sourceRevision: SourceRevision | null;
      diagnostics: CapabilityDiagnostic[];
      failure: { stage: "request" | "validation" | "resolve" | "edit" | "serialize";
                 code: string; message: string; operationIndex?: number } };

type CapabilityDiagnostic = {
  phase: "validation" | "evaluation";
  code: string;
  message: string;
  location?:
    | { kind: "sheet"; sheet: string }
    | { kind: "cell"; sheet: string; rowIndex: number; colIndex: number }
    | { kind: "note"; sheet: string; position: "beforeTable" | "afterTable"; line: number };
  details?: JsonObject;
};
```

`completed` means the requested analysis ran, not that the workbook is valid.
Validation reports contain `valid`; evaluation reports contain `errorCount`.
In V1 every diagnostic denotes an error. A rejected operation has no candidate
source, partial edit result, or success-shaped substitute.

Request failures use `invalid_request`, `stale_source`, or `limit_exceeded`.
Invalid source uses `invalid_source`. Preserve core edit failure categories,
including `invalid_target`, `ambiguous_target`, `out_of_bounds`,
`invalid_operation`, and `rebase_conflict`. `operationIndex` is zero-based.
Serialization failures use `serialization_error`. Messages are for humans;
consumers branch on codes and structured fields.

`JsonObject` means recursively JSON-compatible data with string keys and no
undefined values. Note `line` numbers are one-based within the identified note.
Failure precedence is request decoding and source limits, revision comparison
for edits, source validation, then selection resolution or ordered application.
Rejected requests have a null `sourceRevision` only if a valid source revision
could not be established. Diagnostics preserve deterministic core traversal order.

Reuse core diagnostic codes and context. When the validator has no code, use
`validation_error` with its original message. Runtime diagnostics derive from
the existing error projection. Do not parse human messages to reconstruct data.

Locations use semantic coordinates only when core can establish them. Otherwise
retain a known sheet location and original diagnostic context in `details`.
Validator table-row numbers can include separator rows and are not semantic
cell indexes. Never relabel them by simply subtracting one. Improving core
location metadata is preferable to duplicating the parser in this boundary.

Unexpected programming faults reject the Promise; they must not be converted
into ordinary document errors. Adapters report an internal failure separately.

## Coordinates and Selection

All `*Index` fields are zero-based. Semantic rows include headers and body rows;
semantic columns include header/label columns. Markdown divider rows and the
metadata control frame do not occupy semantic coordinates. Source line numbers
and user-visible spreadsheet addresses are separate concepts.

```ts
type IndexWindow = { start: number; end: number }; // half-open [start, end)
type CellQuery = {
  sheet: string;
  rows?: IndexWindow;
  columns?: IndexWindow;
  includeNotes?: boolean; // inspection only
};
```

Sheet names resolve exactly through core. An omitted query requests a workbook
overview, with no cell matrix. A query requests one sheet. Omitted row/column
windows select the first up to 50 rows / 20 columns. Explicit windows must be
nonempty, within bounds, and contain safe integer indexes; they are never
silently clamped. An empty axis can have an empty default window.

Results include the actual windows, total dimensions, and `hasMoreRows` /
`hasMoreColumns`. These fields make default paging visible. Query omission does
not mean an unbounded cell dump. A maximum of 10,000 selected cells applies per
call; exceeding it rejects rather than truncating a requested window.

## Inspection

Inspect first validates the source. Invalid source is rejected with its
validation diagnostics; `validateWorkbook` remains available to diagnose it.
V1 inspection is a view of valid workbook structure, not a tolerant source editor.

`Inspection` contains `sheets`, an ordered list of:

- `name`, `rowCount`, `columnCount`, `headerRowCount`, `headerColumnCount`;
- `maxHierarchyDepth`, derived from core row structure.

When a query is provided, `selection` also contains:

- `sheet`, actual `rows` / `columns` windows, and paging flags;
- row descriptors: `rowIndex`, `area` (`header` or `body`), `depth`, and
  `path` (the core-derived array of label components, empty for header rows);
- column descriptors: `colIndex` and core `label`;
- a row-major `cells` matrix, with `input` and `localDisplay` for each cell;
- `notes: { beforeTable: string; afterTable: string }` only when `includeNotes` is true.

`input` follows RFC-0017: `= expression` for formulas, without cached values or
display suffixes. `localDisplay` projects core's valid format/style representation
through the portable display payload defined below, or null. Row and column
defaults use the same projection and are returned as `rowDefaults` and
`columnDefaults`, aligned with the selected descriptors. Inherited defaults are
not copied into each cell. Notes use the canonical restricted Markdown serializer.

V1 does not expose stored cache values, display text, AST nodes, or internal
row/column IDs. Recomputed values are obtained through evaluation. Labels are
informational and may be ambiguous; returning a label does not guarantee that
it uniquely selects an axis item.

## Validation

`ValidationReport` contains `valid: boolean` and the existing core
`ValidationSummary` under `summary`. This is a diagnostic summary, whose current
table row counts can differ from semantic inspection counts. They must not be
used as edit indexes. The distinction is explicit until core standardizes them.

Invalid syntax, malformed notes, and invalid display metadata produce a
completed report with `valid: false` and diagnostics. A document parse failure
that the validator recognizes also produces such a report. Validation performs
no evaluation, checks no stored cache against a recomputation, and writes nothing.

## Evaluation and Value Encoding

```ts
type EvaluationOptions = {
  query?: Omit<CellQuery, "includeNotes">;
  materialize?: boolean; // default false
};
```

Validate source and resolve the requested selection before calculation. Invalid
source or selection rejects. Evaluate the entire workbook, including cross-sheet
dependencies, independently of stored formula caches. A query limits returned
values, not the scope of calculation or error reporting.

`EvaluationReport` contains:

- `summary: { sheetCount: number; evaluatedCellCount: number; errorCount: number }`;
- `selection`, when requested, with actual windows, paging flags, and a row-major
  `values` matrix;
- `candidate: CandidateSource | null`, populated only when `materialize` is true
  and the entire workbook has no evaluation errors.

`evaluatedCellCount` counts semantic body cells, including label columns;
structural header cells are not counted. Selected header cells are projected as
their core literal values. Every evaluated error-valued cell, including an
explicit error literal, contributes to `errorCount` and a located diagnostic.
Errors outside a selected window still appear in diagnostics and prevent
materialization. A completed calculation with errors is inspectable, with no
candidate source to write.

Use a JSON-safe value projection of `RuntimeValue`:

| Kind | Encoding |
| --- | --- |
| `blank`, `null` | `{ kind, value: null }`, preserving the distinction |
| `number` | `{ kind: "number", value: string }` using core's lossless number-literal encoder |
| `string`, `boolean` | `{ kind, value }` with the corresponding JSON primitive |
| `date`, `time`, `datetime` | Core canonical `value` string and `isOffsetQualified` |
| `duration` | Core canonical `value` string |
| `error` | `{ kind: "error", errorKind, diagnostic }`, with the core diagnostic code/context |

Numbers are strings in this projection to preserve negative zero and avoid
transport-dependent numeric rounding. This does not introduce arbitrary-precision
arithmetic: evaluation still uses core's numeric semantics. No locale formatting,
NaN, infinity, undefined, Map, or class instance appears in results. Diagnostic
context must be projected into JSON data without silent loss.

```ts
type CandidateSource = {
  source: string;
  revision: SourceRevision;
};
```

Materialization calls the existing canonical serializer after evaluation. It
may normalize whitespace, quoting, and formula source according to RFC-0011.
It is not a minimal textual patch. It preserves opaque front matter and notes
according to their existing contracts.

## Portable Structured Edits

```ts
type RowSelector =
  | { kind: "index"; index: number }
  | { kind: "path"; path: string[] };
type ColumnSelector =
  | { kind: "index"; index: number }
  | { kind: "label"; label: string };
type CellTarget = {
  sheet: string; row: RowSelector; column: ColumnSelector;
};
type RegionTarget = {
  sheet: string; rows: IndexWindow; columns: IndexWindow;
};
type EditRequest = {
  baseRevision: SourceRevision;
  operations: WorkbookOperation[];
};
```

Paths are arrays so a dot inside a component is not mistaken for hierarchy.
Path components and labels must be nonempty, with no leading/trailing whitespace;
the decoder rejects malformed names instead of dropping empty components.
Indexes target the current staged document; names resolve using core label maps.
Missing and ambiguous names fail. No guessed match or case-folding is added.

The V1 operation set is deliberately bounded:

| `op` | Other required fields | Existing semantics |
| --- | --- | --- |
| `set_cell_input` | `target: CellTarget`, `input: string` | RFC-0017 |
| `clear_cell` | `target: CellTarget` | RFC-0017 |
| `set_region` | `target: RegionTarget`, `values: string[][]` | RFC-0018 |
| `clear_region` | `target: RegionTarget` | RFC-0018 |
| `fill_region` | `source: RegionTarget`, `target: RegionTarget`, `mode: "auto" \| "copy" \| "series"` | RFC-0038 |
| `set_cell_local_format` | `target: CellTarget`, `format: PortableFormatSpec` | RFC-0017 |
| `clear_cell_local_format` | `target: CellTarget` | RFC-0017 |
| `set_cell_local_style` | `target: CellTarget`, `style: StylePatch` | RFC-0017 |
| `clear_cell_local_style` | `target: CellTarget` | RFC-0017 |
| `set_row_default_format` | `sheet`, `row: RowSelector`, `format: PortableFormatSpec` | Core row defaults |
| `clear_row_default_format` | `sheet`, `row: RowSelector` | Core row defaults |
| `set_row_default_style` | `sheet`, `row: RowSelector`, `style: StylePatch` | Core row defaults |
| `clear_row_default_style` | `sheet`, `row: RowSelector` | Core row defaults |
| `set_column_default_format` | `sheet`, `column: ColumnSelector`, `format: PortableFormatSpec` | RFC-0018 |
| `clear_column_default_format` | `sheet`, `column: ColumnSelector` | RFC-0018 |
| `set_column_default_style` | `sheet`, `column: ColumnSelector`, `style: StylePatch` | RFC-0018 |
| `clear_column_default_style` | `sheet`, `column: ColumnSelector` | RFC-0018 |
| `set_sheet_note` | `sheet`, `position: "beforeTable" \| "afterTable"`, `markdown` | RFC-0043 |
| `insert_row` | `sheet`, `area: "header" \| "body"`, `rowGapIndex`, `depth` | RFC-0017/0018 |
| `delete_row` | `sheet`, `row: RowSelector`, `mode: "node" \| "subtree"` | RFC-0017/0018 |
| `insert_column` | `sheet`, `colIndex` | RFC-0017 |
| `delete_column` | `sheet`, `column: ColumnSelector` | RFC-0017 |
| `move_rows` | `sheet`, `rows: RowSelector[]`, `targetGapIndex` | RFC-0034 |
| `move_columns` | `sheet`, `columns: ColumnSelector[]`, `targetGapIndex` | RFC-0034 |
| `duplicate_rows` | `sheet`, `rows: RowSelector[]`, `targetGapIndex` | RFC-0034 |
| `duplicate_columns` | `sheet`, `columns: ColumnSelector[]`, `targetGapIndex` | RFC-0034 |
| `insert_sheet` | `name`, `sheetIndex` | RFC-0035 |
| `delete_sheet` | `sheet` | RFC-0035/0036 |
| `move_sheet` | `sheet`, `targetGapIndex` | RFC-0035 |
| `rename_sheet` | `sheet`, `newName` | RFC-0035/0036 |

All indexes/gaps/counts are safe integers. Insertion gaps are interpreted before
insertion; move destination gaps are interpreted after removing the selected
source, as RFC-0034 specifies. Source selectors resolve before that removal.
Multiple selectors resolving to the same item are invalid. Contiguity, subtree
coverage, region restrictions, and reference changes remain core decisions.

### Regions and Display Payloads

Region windows are required, zero-based, nonempty, half-open, and within the
current staged sheet. They use the same coordinates as inspection; there is no
default window, endpoint reversal, implicit table growth, or clipping for edits.
The implementation resolves each rectangle once immediately before applying
that operation, then converts it to core handles internally.

`set_region` requires a rectangular matrix whose dimensions exactly match the
target. Every entry is a semantic input string, including an explicit empty
string for a blank input. Sparse/ragged matrices, nulls, and coercion are invalid.
The operation sets supplied formulas literally; it does not infer a series or
shift references. As with `set_cell_input`, existing local display metadata is
preserved. `clear_region` follows repeated `clear_cell` semantics, including
clearing local display metadata. Header/label cells follow RFC-0018 restrictions.
To blank inputs while retaining local display metadata, use empty strings with
`set_region`.

Display operations use these portable payloads:

```ts
type PortableFormatSpec =
  | NumericFormatSpec
  | { kind: "temporal"; pattern: string };
// NumericFormatSpec and StylePatch retain their existing core fields/semantics.
```

Temporal tokens are derived parser state. Callers supply the pattern; core's
format parser validates it and derives tokens. Inspection likewise omits tokens.
Numeric formats reuse core compatibility rules after strict shape decoding.
The shared projection/decoder owns this conversion; adapters do not implement
format grammars. A set-format operation replaces the whole format; clearing uses
the corresponding clear operation, so null is not a second spelling for clearing.

Style patches preserve omitted axes and clear axes explicitly set to null.
Only existing core align/weight/color values are accepted. An empty patch is
invalid. Clear-style removes the style without clearing the format. Cell-local
display edits apply only to data cells; row/column defaults preserve existing
core area restrictions and inheritance. Formatting does not convert a value's
type or introduce currency conversion, locale preferences, or arbitrary CSS.

### Label Edits and Hierarchy

RFC-0018 already defines label rename through `set_cell_input` on the underlying
header/label cell. Reuse that operation; do not add a second rename protocol or
route these calls through the older string-path rename convenience methods.
Core rebuilds labels/paths and renders existing bound references against the
same row/column identities, including cross-sheet references. A duplicate label
can require positional serialization to preserve a previously bound target;
this does not make a new ambiguous name selector acceptable. Never guess a
target or repair formulas with string replacement. Label lookup fails on
ambiguity, while preservation of an already bound target follows core semantics.

Body hierarchy is represented in label input by leading `*` markers. Editing
those markers rebuilds paths and can change the parentage of subsequent rows.
It is not a subtree-preserving indent/outdent command. For example, promoting
`* A` and changing its child `** Child` to `* Child` can also place a following
`* B` under A. A caller must specify the complete intended structure, including
any needed moves/label changes, and the final document must validate. Existing
`insert_row` enforces depth/gap rules; `move_rows` preserves complete-subtree
constraints. A dedicated reparent/indent/outdent operation needs its own core
semantics before inclusion here.

### Fill and Duplication

`fill_region` uses native RFC-0038 semantics, with an explicit mode. Source and
target must be adjacent rectangles in the same sheet with matching lanes and
within the native data area. `copy` repeats inputs and adjusts ordinary positional
references while preserving fixed, named, and current/offset selectors. `auto`
infers supported consistent series and otherwise repeats; `series` rejects seeds
without a supported consistent series. No second inference/copy algorithm exists
in the capability boundary. Agents may still generate exact matrices with
`set_region` or edit text directly instead of using fill.

Duplication preserves native RFC-0034 identity, hierarchy, metadata, and formula
copy semantics. Sources are contiguous; body-row sources cover complete subtrees.
Destination gaps are measured before insertion (unlike move's post-removal gaps).
New copies receive fresh internal identities, never public handles. Duplicate
names may subsequently require positional selectors until renamed in the batch.

Header conversion remains outside this portable profile. New operations extend
the shared contract/schema; adapters cannot invent private spellings.

### Ordered Resolution and Atomicity

1. Decode the entire request strictly, rejecting unknown fields and operations.
2. Verify `baseRevision` against the supplied source.
3. Validate the base source; invalid base documents are rejected in V1.
4. Apply each operation on private staged state in order. Resolve its portable
   selectors immediately before application, convert them to core targets, and
   perform core binding/rebasing before the next operation.
5. Serialize private staged state using core's cache invalidation rules and
   validate its canonical source with the existing source validator. Reject an
   invalid final result without exposing a candidate. Intermediate drafts need
   not pass full document validation, but each operation satisfies core invariants.
6. Return the validated candidate and its revision. Do not implicitly evaluate.

Resolving every selector against the initial source is incorrect: a preceding
insert, move, or rename may change what a later selector means. Reuse or extract
core target-resolution and staged-application helpers; do not recreate rebasing
in the capability layer. Private intermediate state is never published.

The base-validity requirement is a V1 automation precondition, not a change to
core's invalid-input preservation contract. Repairing a malformed source remains
possible through direct text editing followed by validation.

`EditReport` contains `operationCount`, `evaluation: "not_run"`, and
`candidate: CandidateSource`. An empty operation array is invalid. No
caller-owned state changes. The candidate is structurally and syntactically
validated, but does not claim to have correct calculated results.

Affected formula caches are invalidated by core and cannot be serialized as
current results. Unaffected stored caches may survive serialization; this is
preservation, not independent verification. Call `evaluateWorkbook` on the
candidate source to verify calculations or regenerate all caches.

Editing and evaluation have separate success conditions. An unrelated existing
division-by-zero error must not prevent a valid structural edit or incremental
repair. Evaluation reports that error when explicitly requested. Invalid target,
structural invariant, and syntax failures still reject the edit early.

There is no promise of preserving in-memory identities or undo mementos across
this source-in/source-out API. Stateful applications can continue to use
`applyBatchWithUndo` directly, or accept a source proposal through a separately
defined host history boundary. Reparsing a candidate is not core edit inversion.

## Limits and Strict Decoding

V1 defaults are fixed and shared: 16 MiB of UTF-8 source, 10,000 selected cells,
1,000 operations per edit request, and 10,000 directly targeted cells per edit
request. The last budget sums region areas and single-cell input/display edits
across the batch, including repeated visits; it is not 10,000 per operation.
Fill counts destination cells; duplication counts all copied cells (including
copied headers/labels). Each fill source is additionally limited to 10,000 cells.
Row/column default edits count toward the operation limit rather than expanding
to every inheriting cell. Structural reference updates are not direct cell edits.
Check dimensions and cumulative work before expanding a region into core targets
or applying its operation. A limit failure rejects the entire staged batch.
Candidate source must also fit the 16 MiB UTF-8 source limit before being returned.
Exceeding a limit is an explicit rejection.
Adapters may impose smaller transport limits and must report those separately.
Core's existing bounded numerical algorithms retain their own failure behavior.

No string-to-number or truthiness coercion is allowed for request fields.
Unknown keys, invalid discriminators, and non-finite/unsafe indexes reject before
work begins. These requirements apply equally to typed in-process callers and
decoded JSON. TypeScript types alone do not validate external requests.

## Implementation and Conformance

Implement shared request schemas and public types from one source. Reuse
`validateDocument`, `DocumentState`, core edit execution, row structure helpers,
cell input projection, diagnostic projection, and canonical serialization.
Extract shared helpers from core when necessary; do not make adapters reach
into private maps or replicate semantic logic.

### Implementation Sequence

1. Define shared runtime schemas, portable types, revision hashing, and result
   projections in `packages/core-ts`. Keep the operation schema authoritative
   for TypeScript types, decoding, and later CLI help. Project diagnostics and
   display metadata explicitly; do not return internal IDs through context fields.
2. Implement validation and bounded inspection, then full evaluation and optional
   materialization using existing core parsing/evaluation/serialization. Establish
   coordinate and cache behavior before adding writes in any adapter.
3. Extract a shared staged edit runner from the existing batch machinery: clone
   once, resolve a portable operation against current staged state, apply the core
   operation, and bind before resolving the next. Native batches and portable
   batches use the same execution path. Do not pre-resolve all IDs from the base
   snapshot or repeatedly call the clone-per-batch API for each operation.
4. Add portable target conversion, region budgets, display decoding, final
   validation, and serialization to that runner. Preserve the original portable
   operation index in failures. Reuse native edit semantics and cache invalidation.
5. Complete conformance tests, then build the file-backed CLI in RFC-0050.

`applyCoreEditToStaged` is shared by native batches and the portable runner.
Expected note/edit domain failures have explicit categories; unexpected faults
propagate out of the portable capability. Existing native batch return behavior
is not used as the portable error projection. Format requests are decoded and
validated before invoking setters that assume typed callers.

This is bounded adapter/extraction work around existing core capabilities,
not merely exporting the native `CoreEdit` union. No CLI, UI, or filesystem
dependency belongs in the shared runner.

### Conformance

Required tests cover:

- inspection coordinates with multiple headers, dividers, metadata control frames,
  hierarchy, and absent headers; paging and exact range bounds;
- quoted labels, dots in path components, missing/ambiguous targets, and no ID leakage;
- revision changes for whitespace, line endings, caches, and content changes;
- malformed requests and source, correct diagnostic coordinates, and immutable inputs;
- poisoned formula caches, cross-sheet dependencies, cycles, error literals,
  errors outside the selected window, and typed temporal/negative-zero values;
- ordered insert-then-set and rename-then-edit batches, moves and rebasing,
  whole-batch failure, invalid final input, and editing documents with runtime errors;
- exact region dimensions, out-of-bounds and cumulative-cell limits, literal
  formula writing, metadata preservation versus clearing, and immutable failures;
- numeric/temporal format decoding, style patches and clearing, row/column
  inheritance, and rejection of forged temporal tokens or unsupported styles;
- parent/child label and column renames, cross-sheet bound references, duplicate
  names, and explicit hierarchy-marker edits that affect following rows;
- invalidation of affected caches and explicit evaluation of edited candidates;
- semantic preservation of unrelated cells, metadata, notes, and front matter;
- equality with direct core evaluation/edit results and canonical serialization;
- no runtime/transport-specific objects or invalid JSON values in results.

Acceptance requires these contracts to be implemented and verified. Provider
selection, UI design, and agent task success rates are separate integration work.
