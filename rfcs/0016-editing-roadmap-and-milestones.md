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
- editor session lifecycle
- undo/redo UX or history storage
- file watching or external modification handling
- desktop host integration

## Core Principle

Adopt capability in layers:

1. deterministic core editing semantics first
2. structure-aware semantics second

Host/editor concerns such as undo/redo, stale async job handling, file watching, desktop host integration, and external modification conflict handling are outside this core editing roadmap unless a later core RFC identifies a concrete public core-library contract need.

This roadmap is paired with RFC-0017, which defines the first formal core-edit API contract.

## Terminology

- `display metadata` is the umbrella concept
- `cell display metadata` means cell-local `format/style`
- `column display defaults` means column-level default `format/style`
- `format` and `style` are fields, not separate top-level feature families
- `rowId` means a system-assigned row ID; stable across in-memory edits, not persisted
- `rowGapIndex` means a sheet-wide semantic row insertion gap index
- `area` means the structural row area selector (`header` or `body`)

### Cell Source Terminology

This RFC defines the shared terminology used by later read/edit contracts.

These terms describe `.ord` cell text segments and read/edit contracts. They are conceptual terms, not a requirement to keep an opaque raw cell text field in the implementation.

Core terms:

- `cell`: the full serialized cell text
- `body`: the cell text excluding trailing `display`
- `display`: trailing display metadata, when present
- `input`: read/edit-facing formula or literal text
- `literal`: a non-formula `body`
- `expr`: the formula expression text, excluding any leading formula marker
- `cached value`: the serialized cached value in a cached formula body
- `formula marker`: the leading `=` in formula input (`= expr`)
- `cache separator`: the `=` between cached value and expression in serialized cached-formula body (`cached value = expr`)

The `input` term is the read/edit-facing cell text and applies to both formulas and literals.

For literals, `input` is the literal `body`.

For formulas, `input` is always the formula-marker form `= expr`, even when the serialized `body` is a cached formula written as `cached value = expr`.

Formula without cached value:

```text
cell
+------------------------------+
| = B2 + 1        {:,.2f} {::>,blue}|
+------------------------------+
  [  body  ]       [  display  ]
  [  input ]
  formula marker: "="
  expr: "B2 + 1"
```

Formula with cached value:

```text
cell
+----------------------------------+
| 6 = B2 + 1        {:,.2f} {::>,blue}  |
+----------------------------------+
  [    body    ]       [  display  ]
  cached value: "6"
  cache separator: "="
  expr: "B2 + 1"

input, derived from body:
+--------+
|= B2 + 1|
+--------+
formula marker: "="
expr: "B2 + 1"
```

Literal:

```text
cell
+------------------+
| "abc"   {::green}|
+------------------+
  [body]  [display]
  [input]
  [literal]
```

Comparison:

| Concept | Formula, no cache | Formula, with cache | String literal | Number literal |
|---|---|---|---|---|
| `cell` | `= B2 + 1 {:,.2f} {::>,blue}` | `6 = B2 + 1 {:,.2f} {::>,blue}` | `"abc" {::green}` | `12.3 {::red}` |
| `body` | `= B2 + 1` | `6 = B2 + 1` | `"abc"` | `12.3` |
| `display` | `{:,.2f} {::>,blue}` | `{:,.2f} {::>,blue}` | `{::green}` | `{::red}` |
| `input` | `= B2 + 1` | `= B2 + 1` | `"abc"` | `12.3` |
| `literal` | none | none | `"abc"` | `12.3` |
| `expr` | `B2 + 1` | `B2 + 1` | none | none |
| `cached value` | none | `6` | none | none |

Read/edit APIs must not expose a cached formula `body` directly as `input`.

## Milestone V1: Core Edit Foundation

### Scope

- target resolution model (entry-level label/index -> core-level stable identity)
- atomic batch edit application
- canonical cell model (input/cache/local display) for both read and write APIs
- body-row insertion using `area + rowGapIndex + depth`
- body-row deletion using `rowId`
- core edits:
  - set cell input
  - clear cell
  - set/clear cell-local format
  - set/clear cell-local style
  - insert/delete row
  - insert/delete column
- rebasing v1 for row/column insertion and deletion
- fail-early error behavior for invalid edit application
- unparsed source preservation for invalid-input round-trip safety
- conformance testing: incremental result must match full recalculation result

### Explicitly Out of Scope

- header promotion/demotion APIs
- header row insertion/deletion APIs
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

## Deferred Host and Editor Concerns

The following topics are important for application hosts, but they are not immediate core edit milestones:

- editor session lifecycle
- command boundaries for undo/redo
- undo/redo UX and history storage
- stale async job handling
- file watching and external modification conflict handling
- desktop host integration
- operation-log based replay hooks
- checkpointing strategy guidance for long edit histories
- collaborative conflict handling

These topics should be specified in application feature specs or future host-integration specs unless they require a concrete change to the `.ord` format or the public core library contract.

If a later core RFC standardizes transaction handles, version checks, or replay semantics, it must explain why the concern belongs in the core library contract rather than the host/editor layer.

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

- whether region move/copy should be required API or optional convenience layer
- whether display metadata edit APIs should accept patch-style updates or full replacement objects
