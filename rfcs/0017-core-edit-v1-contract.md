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

- `input`: user-authored input state
- `cache`: cached runtime value plus dirty-state
- `localDisplay`: cell-local display metadata (`format` and `style`)

Normative requirements:

- read APIs and write APIs must use this conceptual split
- serialization layout does not redefine this model
- input/cache/localDisplay must not be conflated into one opaque cell-text field

## Public Read Contract (V1)

V1 read surfaces are split by concern.

### 1. Input Surface

Input is what the user authored for formula/literal semantics.

Current contract terms:

- `parseState`: `parse_ok` or `parse_failed`
- when `parse_ok`:
  - `inputText`: editable semantic input (formula/literal content, excluding display metadata wrapper)
  - `parsedInput`: parsed representation of `inputText`
- when `parse_failed`:
  - `unparsedSourceRaw`: exact source text fragment preserved for lossless round-trip

Normative requirements:

- on edit, parser attempts parse immediately
- parse success stores `parse_ok` state and clears `unparsedSourceRaw`
- parse failure stores `parse_failed` state and preserves exact `unparsedSourceRaw`
- serializer must emit `unparsedSourceRaw` verbatim when `parse_failed`

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

## Raw Input Preservation

V1 requires preserving raw user input to prevent data loss.

Normative requirements:

- `setCellInput` attempts parse on every write
- parse-success path does not rely on persistent raw-source storage
- parse-failure path preserves exact `unparsedSourceRaw`
- invalid input must still round-trip through parse/serialize without information loss
- cache and local display may change independently of input state

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

## Target Resolution Contract

V1 distinguishes two layers:

- host-facing target forms (index, label/path, etc.)
- core-resolved stable target identity

Normative requirement:

- before mutating authoritative state, each edit target must resolve deterministically against staged state
- unresolved or ambiguous targets fail the batch

### Allowed Host-Facing Target Forms (V1)

V1 may accept:

- positional target (`sheet`, row index, column index)
- label/path target (`sheet`, row label/path, column label)

Normative behavior:

- host-facing forms are convenience input only
- core mutation semantics are defined on resolved targets, not raw host input text

## Structural Edit Bounds in V1

To keep V1 deterministic, structural edit scope is restricted.

Current working direction:

- row insertion/deletion in V1 is data-region only
- column insertion/deletion in V1 is data-region only
- structural edits targeting header-structure coordinates fail with `invalid_operation`
- `insert*` allows append when index equals current region length
- out-of-range indexes fail with `out_of_bounds`

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
- invalid-input round-trip tests (raw input preserved)
- local display edit tests (`format` and `style` independently)

## Deferred to V2+

- header APIs (`add/remove/promote/demote`)
- label rename APIs with rebinding policy options
- region APIs (`setRegion`, `clearRegion`, `moveRegion`, `copyRegion`)
- explicit transaction handles
- operation log standardization

## Open Questions

- whether host-facing label targets should be mandatory or optional in V1 API
- whether `expectedVersion` should be required in V2 for all mutating calls
- whether V1 should standardize exact error object schema or keep only category guarantees
