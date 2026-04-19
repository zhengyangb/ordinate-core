# RFC-0003: Row Hierarchy

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines row hierarchy in an Ordinate table.

Hierarchy is represented only by row depth. There is no separate `section row` kind. Every body row is the same structural kind of row:

- it has a label
- it may have values
- it may have children

This RFC is only about row structure. It does not define formulas, references, aggregation rules, or evaluation behavior.

## Goals

This RFC defines:

- row hierarchy as a structural part of the table
- `*` prefixes as the row-depth syntax
- parent/child relationships derived from row order and depth
- that every body row may have both values and children
- that hierarchy is row-oriented only

## Non-Goals

This RFC does not define:

- formula syntax
- reference syntax
- aggregation behavior
- data-region selection rules
- column hierarchy semantics
- evaluation, caching, or recalculation

## Core Idea

Each body row has a depth:

- no prefix means depth `0`
- `* ` means depth `1`
- `** ` means depth `2`
- and so on

`*` prefixes are structural syntax, not visual indentation.

The parent of a row is the nearest previous row whose depth is exactly one less.

Examples:

- a depth-1 row belongs to the nearest previous depth-0 row
- a depth-2 row belongs to the nearest previous depth-1 row

Depth jumps greater than 1 are invalid.

Example:

- a depth-2 row cannot appear unless there is already an enclosing depth-1 row

## Scope

In this RFC, hierarchy is a row-oriented concept only.

This RFC does not define a column-oriented equivalent.

## Example: Financial Statement

```text
# Income Statement

| Line Item                || 2024 | 2025 |
| ------------------------ || ---- | ---- |
| Revenue                  ||      |      |
| * Product Revenue        ||      |      |
| ** Phone Revenue         || 400  | 450  |
| ** Computer Revenue      || 500  | 560  |
| ** Headphones Revenue    || 300  | 390  |
| * Service Revenue        || 200  | 240  |
| Cost of Sales            ||      |      |
| * Materials              || 400  | 460  |
| * Fulfillment            || 80   | 95   |
| * Depreciation           || 20   | 25   |
| Operating Income         || 500  | 620  |
```

In this example:

- `Revenue` and `Cost of Sales` are top-level rows
- `Product Revenue` is a child of `Revenue`
- `Phone Revenue`, `Computer Revenue`, and `Headphones Revenue` are children of `Product Revenue`
- `Service Revenue` is also a child of `Revenue`
- `Operating Income` is a top-level row

## Example: Non-Financial Table

```text
# Study Plan

| Topic                    || Target Hours | Actual Hours |
| ------------------------ || ------------ | ------------ |
| Math                     ||              |              |
| * Algebra                ||              |              |
| ** Linear Equations      || 4            | 3            |
| ** Quadratics            || 5            | 6            |
| * Geometry               ||              |              |
| ** Triangles             || 3            | 2            |
| ** Circles               || 4            | 4            |
| Language                 ||              |              |
| * Reading                ||              |              |
| ** Short Stories         || 2            | 2            |
| ** Essays                || 3            | 1            |
| * Writing                ||              |              |
| ** Grammar Exercises     || 2            | 2            |
| ** Practice Essay        || 4            | 3            |
| Total Weekly Study Time  || 27           | 23           |
```

In this example:

- `Math` and `Language` are top-level rows
- `Algebra`, `Geometry`, `Reading`, and `Writing` are depth-1 rows
- `Total Weekly Study Time` is another top-level row

## Structural Interpretation

Hierarchy defines the row tree.

A row may therefore be understood in terms of:

- its depth
- its parent row, if any
- its child rows, if any
- its sibling rows at the same depth under the same parent

This RFC does not yet define how formulas or references use that structure.

## Current Working Assumptions

- hierarchy is derived from row order and depth
- child rows must appear contiguously beneath their parent branch
- depth jumps greater than 1 are invalid
- every body row may carry values
- every body row may also have children
- hierarchy is part of document structure, not only visual formatting

## Open Questions

- how hierarchy should interact with later reference semantics
- how hierarchy should interact with later formula semantics
