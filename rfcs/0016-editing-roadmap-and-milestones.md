# RFC-0016: Editing Roadmap and Milestones

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the staged roadmap for the Ordinate core editing library.

The goal is to provide programmatic editing APIs for UI/CLI/automation hosts so they do not need to edit `.ord` text manually.

It is scope-planning only. It does not define full API signatures.

## Goals

This RFC defines:

- phased delivery plan for the core editing library surface
- phased milestones for editing capabilities
- what is in scope vs out of scope per phase
- entry and exit criteria per phase
- terminology alignment for display metadata editing

## Non-Goals

This RFC does not define:

- exact function signatures
- exact TypeScript types
- internal storage layout
- wire protocol or network API
- collaborative merge protocol

## Core Principle

Adopt capability in layers:

1. deterministic core editing semantics first
2. structure-aware semantics second
3. advanced transaction/concurrency and ecosystem integration third

This roadmap is paired with RFC-0017, which defines the first formal core-edit API contract.

## Terminology

- `display metadata` is the umbrella concept
- `cell display metadata` means cell-local `format/style`
- `column display defaults` means column-level default `format/style`
- `format` and `style` are fields, not separate top-level feature families

## Milestone V1: Core Edit Foundation

### Scope

- target resolution model (entry-level label/index -> core-level stable identity)
- atomic batch edit application
- canonical cell model (input/cache/local display) for both read and write APIs
- core edits:
  - set cell input
  - clear cell
  - set/clear cell-local format
  - set/clear cell-local style
  - insert/delete row
  - insert/delete column
- rebasing v1 for row/column insertion and deletion
- fail-early error behavior for invalid edit application
- raw input preservation for invalid-input round-trip safety
- conformance testing: incremental result must match full recalculation result

### Explicitly Out of Scope

- header promotion/demotion APIs
- label rename APIs
- first-class region move/copy APIs
- explicit transaction handle lifecycle
- collaborative conflict handling

### Exit Criteria

- stable V1 edit contract RFC accepted
- full V1 edit test matrix passing
- deterministic serialization after edit operations

## Milestone V2: Structure-Aware Editing

### Scope

- header-row structural operations
- label rename with rebinding semantics
- region clear/set APIs
- structured API for column display defaults

### Explicitly Out of Scope

- cross-client collaboration protocol
- first-class move/copy region semantics as required APIs

### Exit Criteria

- structural edit + reference rebasing behavior covered by conformance suite
- ambiguous rename/rebind behavior deterministic and documented

## Milestone V3: Advanced Transactions and Integration

### Scope

- explicit transaction handles (`begin/apply/commit/abort`) if needed by host applications
- optimistic version checks (`expectedVersion`) to prevent stale async writes
- operation-log based replay hooks
- checkpointing strategy guidance for long edit histories

### Exit Criteria

- deterministic conflict rejection behavior in async host integration
- replay reproducibility validated from operation log + checkpoints

## Why Version Checks Exist

JavaScript single-thread execution does not remove stale async write risk.

Example:

- user makes edit A
- async action based on older snapshot returns later
- older result overwrites newer state unless version check rejects it

Version checks are therefore a state-correctness mechanism, not a traditional lock.

## Normative vs Non-Normative Boundaries

Normative (must be specified in phase RFCs):

- edit semantics
- rebasing semantics
- failure and atomicity semantics

Non-normative (implementation-chosen unless later RFC standardizes):

- snapshot vs delta storage layout
- checkpoint cadence
- internal data structures

## Implementation Strategy Notes (Non-Normative)

Simplest safe path:

- V1 can use full-state snapshot replacement at commit boundary
- all edits applied to staged state
- commit only on full validation success

Scalable path:

- operation deltas plus periodic checkpoints
- deterministic replay for audit/debug

## Open Questions

- whether V3 transaction handles are necessary for all host environments
- whether region move/copy should be required API or optional convenience layer
- whether display metadata edit APIs should accept patch-style updates or full replacement objects
