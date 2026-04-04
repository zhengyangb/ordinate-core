# RFC-0011: Serialization and Round-Trip Semantics

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines how Ordinate’s internal document model is serialized to `.ord` text and how `.ord` text is expected to round-trip back into the internal model.

It defines the primary role of the internal model, the serializer’s canonical output direction, cache serialization behavior, quoting behavior, and the structural output rules for headers and divider rows.

## Goals

This RFC defines:

- the relationship between the internal document model and `.ord` text
- the expected round-trip guarantees
- canonical serialization direction
- formula and cache serialization behavior
- error value serialization behavior
- label and path serialization rules
- header and divider serialization rules

## Non-Goals

This RFC does not define:

- collaborative merge behavior
- exact textual preservation of the original file
- tolerant parsing or partial recovery after parse failure
- comment preservation
- formatting metadata
- the full editing API

## Core Principle

The internal document model is the primary representation.

`.ord` is the serialized form.

Saving a document means regenerating `.ord` from the internal model. It does not mean applying textual patches to a previously loaded `.ord` file.

## Round-Trip Semantics

This RFC requires **semantic round-trip**.

That means:

- parsing a valid `.ord` document into the internal model
- then serializing it again

must preserve the same document meaning.

Semantic meaning here includes:

- sheet order
- row order
- column order
- section hierarchy and levels
- header structure and hierarchy paths
- labels and reference resolution behavior
- cell inputs (literal vs formula vs cached-formula form)

This RFC does **not** require exact textual round-trip.

The serializer may normalize the textual form (spacing, padding, line breaks, quoting) as long as semantic meaning is preserved.

Current working direction: implementations should still aim to produce stable output that is *as close as possible* to the original, differing primarily in formatting.

## Canonical Output Direction

Serialization emits a canonical form.

Current working direction:

- excess blank lines are not preserved
- spacing may be normalized
- quoting may be normalized
- header and divider placement may be normalized

The serializer is therefore allowed to rewrite user-authored formatting into a standard canonical representation.

## Formula Serialization

Formula cells are serialized in one of two forms:

- `= expression`
- `cached_value = expression`

A clean formula cell with a valid cache may be serialized using the cached form.

A formula cell whose cache is not authoritative must be serialized without a cache.

## Error Serialization

Error serialization follows RFC-0015.

Current working direction:

- canonical error literal is `error[kind]`
- compatibility input bare `error` canonicalizes to `error[generic]`
- only stable external error kind is serialized
- runtime diagnostics/internal error details are not serialized

## Dirty and Stale Cache Serialization

Dirty state is not itself serialized as a separate file-level marker in this RFC.

However, dirty state affects formula serialization.

Current working direction:

- if a formula cell is clean and has an authoritative cached value, the serializer may emit `cached_value = expression`
- if a formula cell is dirty or its cached value is stale, the serializer must emit `= expression`

This prevents stale cached values from being written as if they were current.

## Label and Path Serialization

Ordinate uses different textual representations depending on context.

### Table-Embedded Hierarchy

When hierarchy is part of the table itself, it is serialized using the table’s header representation.

This includes multi-level header rows.

### Reference Paths

When hierarchy is expressed inside a reference, it is serialized using the reference/path syntax.

This RFC therefore distinguishes between:

- hierarchy represented structurally in table layout
- hierarchy represented textually in selector syntax

## Canonical Quoting

Serialization uses canonical quoting.

If a label or path component requires quoting according to the language rules, the serializer must emit it quoted.

If quoting is not required, the serializer may emit the unquoted canonical form.

Serialization does not attempt to preserve the exact original user quoting style.

## Header and Divider Serialization

Divider rows separate the header block from the body.

Current working direction:

- divider appears exactly once between the header block and the body
- multi-level headers do not cause multiple divider rows
- all header rows appear above the divider
- body rows appear below the divider

Illustrative example:

```text
|      || 2025 | 2025 | 2025 |
|      || 03   | 03   | 04   |
| Item || 14   | 15   | 01   |
| ---- || ---- | ---- | ---- |
| Rev  || 100  | 120  | 130  |
```

## Hierarchy and Internal Paths

Internally, hierarchical labels may be represented as canonical paths.

When serialized as part of the table, these paths are rendered back into multi-level header rows.

When serialized inside references, these paths are rendered using reference/path syntax.

The serializer therefore maps one internal semantic representation to two different textual contexts.

## Serialization Preconditions

Canonical serialization assumes a valid internal model.

If parsing has failed and no valid internal model exists, canonical serialization is not defined by this RFC.

This RFC does not define tolerant recovery or partial-file serialization after parse failure.

## Relationship to Editing

Editing operates on the internal model.

Serialization is a later step that materializes the current internal model as canonical `.ord` text.

Serialization may be performed asynchronously relative to editing, as long as the serialized result reflects a valid internal state.

## Deferred Topics

- tolerant parsing and recovery after parse failure
- comment preservation
- preservation of user-authored whitespace and layout
- formatting and metadata serialization
- advanced hierarchy layout preservation policies

## Open Questions

- whether canonical serialization should always emit cache when available, or allow serializer policy variation
- whether some hierarchy layout choices should be preserved more faithfully when multiple equivalent renderings exist
- whether future versions should allow optional preservation modes in addition to canonical form

## Current Working Assumptions

- the internal model is primary
- `.ord` is regenerated from the internal model
- semantic round-trip is required
- exact textual round-trip is not required
- dirty or stale cache must not be serialized as authoritative cache
- hierarchy in the table is serialized as header rows
- hierarchy in references is serialized as reference/path syntax
- canonical quoting is used during serialization
- divider appears exactly once between header rows and body rows
