# RFC-0009: Recalculation, Dependency Graph, and Change Propagation

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines how Ordinate propagates change through a document after edits.

It defines the dependency graph model, dirty semantics, cache invalidation, change categories, cycle invalidity, and the current direction for recalculation behavior.

## Goals

This RFC defines:

- the dependency graph model
- the meaning of dirty state
- cache invalidation semantics
- change categories at the semantic layer
- the distinction between value edits and structural edits
- the role of incremental recalculation
- eager and lazy modes of incremental recalculation
- cycle invalidity
- the role of transactional or batched edits

## Non-Goals

This RFC does not define:

- the full editing API
- the exact semantics of reference rebasing
- the exact semantics of row/column insertion and deletion
- volatile functions
- concurrency or collaborative editing
- serialization strategy
- scheduler or prioritization details
- partial expression-level memoization

## Core Model

The dependency graph is defined at cell granularity.

Current working direction:

- each cell is a graph node
- a formula cell may depend on one or more other cells
- scalar references induce single-cell dependencies
- view/range references induce dependencies on all covered cells
- dependencies may cross sheet boundaries
- although the conceptual model is cell-level, implementations should use compressed range or interval dependencies to avoid exploding edge counts for large views

## Semantic Change Categories

This RFC defines semantic categories of change rather than a concrete core-edit API.

### Value Edit

A value edit changes the literal or formula input of a cell.

Examples:

- replacing `3` with `4`
- replacing `= 1 + 2` with `= 1 + 3`

### Label Change

A label change modifies a row label, column label, section label, or sheet label.

Such changes may affect selector resolution and may therefore invalidate dependencies even when the textual formula in a dependent cell has not changed.

Current working direction:

- the rebinding policy is configurable by the application
- a label change may either trigger immediate rebinding or mark dependents dirty and rebind lazily on next observation

### Structural Edit

A structural edit changes document layout or table structure.

Examples include:

- inserting a row
- deleting a column
- changing header structure
- changing section structure

Structural edits may change selector resolution, view shape, or dependency edges.

### Sheet-Level Change

A sheet-level change affects sheet existence or sheet identity.

Examples include:

- creating a sheet
- deleting a sheet
- renaming a sheet

## Dirty Semantics

A cell is dirty when its cached value is no longer authoritative.

Dirty does not mean the cell is permanently invalid. It means the cell must be reevaluated before its value can again be treated as current.

Current working direction:

- when a change occurs, directly affected cells become dirty
- all transitively dependent cells also become dirty
- stale cached values are not authoritative once their dependencies have changed

## Cache Invalidation

Cache invalidation follows semantic change, not merely textual change.

Examples:

- a value edit invalidates the edited cell and its dependents
- a label change may invalidate selector resolution in dependent formulas
- a structural edit may invalidate large regions of the graph even if many formulas remain textually unchanged
- persisted cache (such as cached values stored in an `.ord` file) is non-authoritative and must be invalidated when dependencies change

## Incremental Recalculation

This RFC treats **incremental recalculation** as the primary scalable model.

Incremental recalculation means that the implementation tracks affected cells and avoids recomputing the whole document when only part of it has changed.

This RFC recognizes two modes of incremental recalculation.

### Eager Incremental Recalculation

After a change, the implementation promptly recomputes the affected dirty closure.

This is suitable when up-to-date results are needed immediately.

### Lazy Incremental Recalculation

After a change, the implementation marks the affected closure dirty but delays recomputation until values are actually observed or needed.

This is suitable when:

- the user is still editing
- many edits occur in a batch
- affected results are currently off-screen or otherwise not yet observed

## Full Recalculation

A conforming implementation may still perform full recomputation.

However, this RFC treats full recomputation as a simpler implementation strategy, not the main conceptual model for interactive systems.

Current working direction:

- CLI-style implementations may use full recomputation
- app-style implementations are expected to benefit from incremental recalculation

## Topological Evaluation

If the dependency graph is acyclic, recalculation may proceed in dependency order.

This RFC does not mandate a specific graph algorithm, but the conceptual model assumes that acyclic dependencies admit an evaluation order compatible with the graph.

## Cycles

Cyclic dependencies are invalid.

Current working direction:

- cycle detection is a required property
- cyclic components cannot be assigned valid ordinary cached values
- cycle-related results evaluate to `error`

## Transactional and Batched Edits

Some user-visible actions may consist of multiple internal edits.

Examples include:

- dragging or moving a cell
- pasting a block
- complex structural edits

This RFC allows the implementation to treat such edits as transactional or batched operations.

Current working direction:

- intermediate states need not be externally observed
- dirty marking and recomputation may occur at transaction commit boundaries rather than after every internal micro-step

## Observable Correctness

This RFC defines correctness in terms of observable results.

Regardless of implementation strategy:

- observed values must reflect the latest valid dependencies
- stale cache must not be treated as authoritative
- cycle-invalid states must not appear as ordinary successful values

## Deferred Topics

- precise rebasing semantics after structural edits
- exact row/column insertion behavior
- exact sheet rename semantics for references
- volatile functions
- collaborative editing
- expression-level memoization
- scheduling and prioritization policies

## Open Questions

- how fine-grained structural dirty propagation should be
- whether label rename should imply rebinding, invalidation, or a later configurable policy
- when lazy incremental recalculation should be triggered in interactive applications
- how formal the transaction model should become in a later RFC

## Current Working Assumptions

- cell is the dependency graph node granularity
- implementations should use compressed range or interval dependencies for large views
- semantic change categories are more fundamental than concrete editing API names
- dirty means cache is no longer authoritative
- stale cache must not be trusted after dependency invalidation
- incremental recalculation is the primary scalable model
- incremental recalculation may be eager or lazy
- full recomputation remains a valid simpler strategy
- cycles are invalid
