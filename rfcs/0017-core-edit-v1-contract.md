# RFC-0017: Core Edit V1 Contract

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the first stable core-edit contract for Ordinate core.

V1 prioritizes deterministic semantics, atomic application, and clear failure behavior.

## Goals

This RFC defines:

- V1 edit operation set
- target resolution contract
- atomic batch application semantics
- failure behavior and error surface
- rebasing semantics for row/column structural edits
- canonical cell read/write model
- test and conformance requirements

## Non-Goals

This RFC does not define:

- header promotion/demotion APIs
- label rename APIs
- region move/copy APIs
- explicit transaction-handle lifecycle API
- collaborative or distributed conflict merge semantics

## V1 Operation Set

V1 includes the following logical operations:

- `setCellInput`
- `clearCell`
- `setCellLocalFormat`
- `clearCellLocalFormat`
- `setCellLocalStyle`
- `clearCellLocalStyle`
- `renameSheet`
- `insertRow`
- `deleteRow`
- `insertColumn`
- `deleteColumn`

## Canonical Cell Model

V1 defines a canonical cell state split into three parts:

- `body`: structured formula/literal input state as defined in RFC-0016
- `cache`: cached runtime value plus dirty-state
- `localDisplay`: cell-local display metadata (`format` and `style`)

Normative requirements:

- read APIs and write APIs must use this conceptual split
- serialization layout does not redefine this model
- `body`/`cache`/`localDisplay` must not be conflated into one opaque cell-text field
- cached formula `body` text must not be exposed directly as `input`
- valid `body` is serialized from structured fields; invalid `body` preserves `unparsedBodyRaw`
- valid `localDisplay` is serialized from structured `format`/`style`; invalid `localDisplay` preserves its raw display block

## Public Read Contract (V1)

V1 read surfaces are split by concern.

### 1. Input Surface

Input is the read/edit-facing text defined in RFC-0016.

For formulas, input is always `= expr`, even if the serialized body is `cached value = expr`.

For literals, input is the literal body.

Current contract terms:

- `parseState`: `parse_ok` or `parse_failed`
- when `parse_ok`:
  - `inputText`: editable input (formula/literal content, excluding the `display` segment and excluding cached value)
  - `parsedInput`: parsed representation of `inputText`
- when `parse_failed`:
  - `unparsedBodyRaw`: exact body source text fragment preserved for lossless round-trip

Normative requirements:

- on edit, parser attempts parse immediately
- parse success stores `parse_ok` state and clears `unparsedBodyRaw`
- parse failure stores `parse_failed` state and preserves exact `unparsedBodyRaw`
- serializer must emit `unparsedBodyRaw` verbatim when `parse_failed`
- `setCellInput` accepts semantic cell text; callers do not need to provide table-wire escaping (`\|`, `\\`)
- table-wire escaping is handled by serialization/parsing layer (RFC-0002 / RFC-0011)
- empty `input` represents a semantic empty cell; serializer must encode it unambiguously for `.ord` text without requiring edit state to store a placeholder space
- RFC-0039 permits real line breaks in implicit text data cells; formula, explicit quoted, and structural header/label input remain single-line (fail-early)
- `setCellInput` must reject input containing a trailing `display` segment; callers must use display metadata edit operations instead
- `setCellInput` must reject cached-formula body text such as `cached value = expr`; callers must pass formula input as `= expr`

### 2. Cache Surface

Cache is the stored evaluated value attached to cell state.

Current contract term:

- `cachedValue`
- `dirty`

Notes:

- cache may be stale while cell is dirty
- cache is stateful and tied to recalculation lifecycle

### 3. Evaluated Surface

Evaluated value is authoritative value after evaluation.

Current contract term:

- `evaluatedValue` (evaluation-result snapshot field, not a mutable per-cell state field)

Notes:

- evaluated value is not the same concept as cache
- evaluated value should be treated as authoritative output for computation consumers
- if evaluation has not been run for current dirty state, `evaluatedValue` is unavailable
- when evaluation runs, resulting `evaluatedValue` is written back into `cachedValue` and `dirty` becomes `false`
- core cell state must not introduce a second mutable field like `cacheEvaluatedValue`

### 4. Display Surface

Display is presentation-only output.

Current contract terms:

- `localDisplay` (`format` and `style` set on this cell)
- `inheritedDisplay` (from defaults/cascade)
- `effectiveDisplay` (resolved display metadata)
- `displayText` (rendered text)

Notes:

- `displayText` belongs to presentation, not to input
- `displayText` is derived from value + effective display metadata

### 5. Row Structure Surface

V1 row-structure-aware hosts need a minimal readable row surface.

This surface is for UI/CLI/agent consumers. It does not require a specific accessor style. Implementations may expose these fields directly on a row view model or via a read helper, as long as the semantics are stable.

Minimum row fields:

- `rowId`: system-assigned row ID for the current in-memory document
- `depth`: row hierarchy depth
- `hasChildren`: whether the row currently has nested descendant rows
- `subtreeRowCount`: total number of rows in the row subtree, including the row itself

Normative requirements:

- this surface must be derived from the authoritative flat row list plus row depth semantics
- these fields must not become a second source of truth separate from authoritative row order/depth
- hosts must not need to recompute `hasChildren` or subtree shape independently from raw row paths
- `rowId` is stable across in-memory edits but is not persisted to `.ord`

Deferred:

- `parentRowId`
- richer tree-navigation helpers

## Unparsed Source Preservation

V1 requires preserving unparsed source to prevent data loss.

Normative requirements:

- `setCellInput` attempts parse on every write
- parse-success path does not rely on persistent raw-source storage
- parse-failure path preserves exact `unparsedBodyRaw`
- invalid input must still round-trip through parse/serialize without information loss
- cache and local display may change independently of input state
- invalid body and invalid display metadata are preserved independently; editing display metadata must not rewrite an invalid body

## Application Model

V1 uses atomic batch apply as the required contract surface.

Required contract:

- `applyBatchAtomic(document, edits, options?) -> { ok, nextDocument? , error? }`

Semantics:

- edits are applied in declared order on staged state
- if any edit fails, batch fails and authoritative state is unchanged
- if all edits succeed, authoritative state is replaced exactly once

This gives commit/rollback behavior without requiring explicit transaction handles in V1.

Non-normative example edit shape:

- `{ op: "set_cell_input", target: ..., input: "..." }`
- `{ op: "set_cell_local_format", target: ..., format: ... }`
- `{ op: "set_cell_local_style", target: ..., style: ... }`
- `{ op: "insert_row", sheet: "...", area: "body", rowGapIndex: 3, depth: 1 }`
- `{ op: "delete_row", sheet: "...", rowId: 7, mode: "subtree" }`

## Target Resolution Contract

V1 distinguishes two layers:

- host-facing target forms (index, label/path, etc.)
- core-resolved stable target identity

Normative requirement:

- before mutating authoritative state, each edit target must resolve deterministically against staged state
- unresolved or ambiguous targets fail the batch

### Row Structural Targeting (V1)

V1 uses two distinct row-target concepts:

- `rowGapIndex`: sheet-wide semantic row insertion gap index
- `rowId`: system-assigned row ID for an existing row, stable across in-memory edits and not persisted

Normative behavior:

- insertion targets a gap, not an existing row identity
- deletion targets an existing row identity, not a positional index
- public V1 row edit APIs must not require callers to mutate by raw logical row index

### Allowed Host-Facing Target Forms (V1)

V1 may accept:

- positional target (`sheet`, row index, column index)
- label/path target (`sheet`, row label/path, column label)

Normative behavior:

- host-facing forms are convenience input only
- core mutation semantics are defined on resolved targets, not raw host input text

Row structural edits are the exception:

- `insert_row` is defined on (`sheet`, `area`, `rowGapIndex`, `depth`)
- `delete_row` is defined on (`sheet`, `rowId`, `mode`)

## Structural Edit Bounds in V1

To keep V1 deterministic, structural edit scope is restricted.

Current working direction:

- row insertion/deletion in V1 is body-region only
- column insertion/deletion in V1 is data-region only
- structural edits targeting header-structure coordinates fail with `invalid_operation`
- `insert_row` requires explicit `area`
- V1 accepts `area: "body"` only
- `area: "header"` fails with `invalid_operation`
- `insert_row` allows append when `rowGapIndex === rowCount`
- out-of-range `rowGapIndex` fails with `out_of_bounds`
- `insert_row` must reject invalid depth jumps
- `insert_row` must reject implicit adoption of following deeper rows
- `delete_row` defaults to `mode: "node"`
- `delete_row` with `mode: "node"` must reject non-leaf rows
- `delete_row` with `mode: "subtree"` deletes the target row and all nested descendant rows

## Failure Semantics

V1 is fail-early and all-or-nothing at batch boundary.

Required behavior:

- no partial commit
- no silent fallback
- no compatibility shims that rewrite edit intent

Error categories (minimum):

- `invalid_target`
- `ambiguous_target`
- `out_of_bounds`
- `invalid_operation`
- `rebase_conflict`

Error payload shape is implementation-defined in V1, but category must be stable and machine-readable.

## Rebasing Semantics in V1

V1 rebasing scope:

- row insertion/deletion
- column insertion/deletion

Behavior aligns with RFC-0012:

- positional selectors shift with structural edits
- fixed positional selectors (`#!`) remain rebasing-exempt
- relative selectors keep their numeric offset; origin moves with formula cell

V1 requirement:

- resulting selector meaning must be deterministic for same input state + same edit batch

## Validation and Recalculation Contract

After successful batch application:

- document must remain structurally valid according to active invariants
- dependency invalidation and recalculation state must be consistent with RFC-0009

Conformance requirement:

- incremental post-edit result must equal full-recompute post-edit result

## Display Metadata Interaction

V1 core-edit semantics are value/structure-first.

Normative scope in V1:

- row/column insertion and deletion must keep metadata alignment deterministic
- cell-local display metadata is editable in V1 via structured edits
- `clearCell` clears only input/cache for target cell and does not imply clearing inherited display defaults
- clearing local display means falling back to inherited/default display resolution

Deferred:

- dedicated structured edit operations for `column display defaults`

## Serialization Contract After Edit

After successful apply:

- serialization must produce canonical `.ord` according to active serialization RFCs
- semantic round-trip guarantees remain unchanged

## Concurrency and Version Check (Host Integration)

V1 core does not require lock primitives.

Recommended host integration contract:

- optional `expectedVersion` on batch apply
- reject apply when expected version does not match current authoritative version

This prevents stale asynchronous UI writes from overwriting newer state.

## Testing Requirements

Minimum required suites:

- operation unit tests per V1 operation
- rebasing tests for insertion/deletion paths
- failure atomicity tests (authoritative state unchanged on error)
- conformance tests: incremental vs full recompute equivalence
- serialization stability tests after structural edits
- invalid-input round-trip tests (unparsed source preserved)
- local display edit tests (`format` and `style` independently)

## Deferred to V2+

- header APIs (`add/remove/promote/demote`)
- label rename APIs with rebinding policy options
- general region APIs (`setRegion`, `clearRegion`, `moveRegion`, `copyRegion`)
- axis-level row/column move and duplicate APIs are specified separately by RFC-0034
- explicit transaction handles
- operation log standardization

## Open Questions

- whether host-facing label targets should be mandatory or optional in V1 API
- whether `expectedVersion` should be required in V2 for all mutating calls
- whether V1 should standardize exact error object schema or keep only category guarantees
