# RFC-0010: Document Model and Editing Semantics

## 1. Summary

Defines Ordinate’s internal document model and the semantic meaning of structured edits.

## 2. Goals

This RFC is intended to define:

- the core objects in the internal document model
- the primary editable representation
- the role of cells, labels, headers, hierarchy, and sections in the model
- semantic edit categories
- how edits affect resolution, cache invalidation, and dirty propagation
- how multi-level headers exist as part of the document model

## 3. Non-Goals

This RFC does not yet define:

- exact core-edit API names
- serialization canonical form
- exact rebasing rules
- formatting and metadata
- the complete column hierarchy RFC
- the complete collection literal system
- collaborative editing

## 4. Core Principle

- the internal document model is the primary editable representation
- the `.ord` file is the serialized form, not the primary editing surface for structured operations
- the internal model described here is conceptual and recommended; implementations may choose different internal representations so long as the semantics are preserved
- `.ord` is an external interchange format, not a required in-memory structure

## 5. Core Document Objects

The internal model is expected to contain at least the following core objects:

- `Document`
- `Sheet`
- `Cell`
- `CellInput`
- `CachedValue`
- `DirtyState`

The model may also contain higher-level structural objects such as:

- labels
- headers
- hierarchy nodes
- sections

## 6. Cell Model

A cell should be able to carry at least the following semantic information:

- raw input
- cached value
- dirty state
- optionally parsed expression / AST
- optionally resolved dependencies

This RFC does not require a particular implementation language or class layout.

## 7. Hierarchical Labels and Multi-Level Headers

The document model may contain hierarchical labels on either axis.

A multi-level header is treated as an axis-independent hierarchy mechanism:

- it may be used on columns
- it may be used on rows

Each logical row or column must be reducible to a canonical path.

The internal representation should treat this path as the semantic identity used for selector and reference resolution.

Visual grouping constructs such as sections are distinct from, but may coexist with, hierarchical labels.

Illustrative column example:

```text
|      || 2025 | 2025 | 2025 |
|      || 03   | 03   | 04   |
| Item || 14   | 15   | 01   |
| ---- || ---- | ---- | ---- |
| Rev  || 100  | 120  | 130  |
```

In this example, the three logical column paths are:

- `2025.03.14`
- `2025.03.15`
- `2025.04.01`

## 8. Semantic Edit Categories

This RFC defines semantic edit categories rather than concrete API names.

### Cell Input Edit

Changes the literal or formula input of a cell.

### Cell Clear

Removes a cell’s current input.

Current working direction:

- clearing a cell yields `blank`

### Label Edit

Changes a row label, column label, section label, or sheet label.

### Hierarchy / Header Edit

Changes a multi-level header structure or the hierarchy path of a logical row or column.

Current working direction:

- acknowledged but not yet specified; exact semantics are deferred to the hierarchy RFC

### Structural Edit

Changes grid structure or table layout.

Examples:

- inserting a row
- deleting a column
- changing header structure
- changing section structure

### Sheet Edit

Adds, removes, or renames a sheet.

### Batched / Transactional Edit

Represents a group of edits that should be treated as one semantic unit.

## 9. Edit Application Semantics

The abstract semantic flow of an edit is:

1. apply the edit to the internal document model
2. update semantic resolution if required
3. invalidate affected caches
4. mark the dirty closure
5. schedule recomputation according to recalculation strategy
6. serialize later if needed

## 10. Relationship to Recalculation

RFC-0010 defines what an edit means semantically.

RFC-0009 defines what happens after semantic change:

- dirty propagation
- dependency invalidation
- incremental or eager/lazy recalculation

In other words:

- RFC-0010 says what changed
- RFC-0009 says how change propagates computationally

## 11. Relationship to Serialization

RFC-0010 defines the internal document model.

A later serialization RFC defines how that model is written to and reconstructed from `.ord`.

## 12. Illustrative API Shapes

The following names are illustrative only and are not normative API commitments:

- `setCellInput(...)`
- `clearCell(...)`
- `renameLabel(...)`
- `beginTransaction()`
- `commitTransaction()`

They are included only to suggest the shape of future editing interfaces.

## 13. Deferred Topics

- exact core-edit API surface
- exact column hierarchy semantics
- exact interaction rules between sections and hierarchy
- exact rebasing after structural edits
- formatting and metadata
- collaborative editing

## 14. Open Questions

- the formal row-side representation of multi-level hierarchy
- the interaction model when sections and hierarchy coexist
- whether label rename implies rebinding or unresolved reference behavior
- the dirty granularity of hierarchy edits
