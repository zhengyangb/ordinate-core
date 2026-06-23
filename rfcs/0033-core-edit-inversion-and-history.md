# RFC-0033: Core Edit Inversion and Session-Local History

- Status: Draft
- Project: Ordinate

## Summary

This RFC extends the core edit contract with session-local edit inversion support for host undo/redo.

The core library already defines atomic `CoreEdit[]` application. This RFC adds a way for a host to apply a batch and receive an opaque memento that can later undo or redo that exact batch inside the same in-memory editing session.

## Goals

- Provide deterministic inversion for the current `CoreEdit` operation set.
- Keep undo/redo history storage and UX in the host/editor layer.
- Avoid generic text diffs and after-the-fact patch reconstruction.
- Preserve session-local row and column identities across undo/redo.
- Fail early when a memento is applied to an incompatible document state.

## Non-Goals

- Persisting undo history in `.ord`.
- Defining file open/save dirty state.
- Defining file watching or external modification conflict handling.
- Defining collaborative merge or distributed operation logs.
- Defining UI command boundaries or keyboard shortcuts.

## API Contract

Core exposes:

```ts
applyBatchWithUndo(document, edits, options?)
applyCoreEditMemento(document, memento, direction, options?)
```

`applyBatchWithUndo` has the same atomic failure behavior as `applyBatchAtomic`. On success, it returns the next document and an opaque `CoreEditHistoryMemento`.

`applyCoreEditMemento` applies the memento in `"undo"` or `"redo"` direction and returns a new document. The operation must fail early if the current document state does not match the expected state encoded in the memento.

## Memento Semantics

The memento is session-local and not a wire format.

Normative requirements:

- mementos must not be serialized into `.ord`
- mementos must not be generic textual diffs
- mementos must store typed semantic state sufficient to restore affected sheets
- row and column IDs restored by undo/redo must remain stable for the current editing session
- formula cache state is non-authoritative and may be recomputed after restore
- applying a memento to a stale or unrelated document must fail early

The first implementation may store affected sheet snapshots as typed semantic state. A snapshot may include row/column IDs, row/column display metadata, cell body state, cell-local display metadata, table source blocks, and structural counters.

## Covered Operations

V1 inversion covers the current core edit surface:

- cell input / clear
- cell local format / style
- column default format / style
- row default format / style
- region set / clear
- row conversion between header/body
- sheet rename
- row insert / delete
- column insert / delete

## Host Responsibilities

The host owns:

- command labels and command boundaries
- undo/redo stack storage
- dirty/clean markers
- source-mode text editing behavior
- file open/save and external modification handling
- stale async job guards

Hosts must clear mementos when a document is reparsed or reloaded because row and column IDs are session-local.

## Testing Requirements

Core conformance must cover:

- do/undo/redo canonical serialization equality for every operation family
- multi-step undo/redo preserving row and column IDs
- batch failure atomicity
- empty/no-op memento behavior
- fail-early behavior when applying a memento to a mismatched state
