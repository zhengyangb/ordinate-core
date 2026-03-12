# RFC-0003: Sections and Hierarchy

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines Sections as hierarchical structural groups in an Ordinate table.

A Section groups a contiguous range of rows. Sections may be nested. This RFC is only about document structure. It does not define formulas, references, aggregation rules, or evaluation behavior.

## Goals

This RFC defines:

- what a Section is
- that Sections are row-oriented
- that Sections may be nested
- that a Section spans a contiguous range of rows
- that a Section may contain child Sections
- that ordinary rows and Sections may appear as siblings at the same level
- that hierarchy is part of the table structure

## Non-Goals

This RFC does not define:

- formula syntax
- reference syntax
- row selection rules
- aggregation behavior
- row kinds beyond ordinary rows and Sections
- column hierarchy semantics
- evaluation, caching, or recalculation

## Core Idea

A Section is a structural grouping of consecutive rows.

A Section begins at a section marker row and continues until:

- the next sibling Section at the same level
- the end of its parent Section
- or the end of the table

A Section may contain:

- ordinary rows
- child Sections

Not every row must be a Section. A parent scope may directly contain both ordinary rows and child Sections.

## Scope

In this RFC, Section is a row-oriented concept only.

This RFC does not define a column-oriented equivalent.

## Candidate Section Marking

This RFC uses bracket depth as a candidate notation for nested Sections:

- `[X]` for a top-level Section
- `[[X]]` for a child Section
- `[[[X]]]` for a deeper child Section

This is a candidate notation, not a final commitment.

Indentation is used to indicate hierarchy for ordinary rows and nested Sections.

## Example: Financial Statement

# Income Statement

| Line Item                || 2024 | 2025 |
| ------------------------ || ---- | ---- |
| [Revenue]                ||      |      |
|   [[Product Revenue]]    ||      |      |
|     Phone Revenue        || 400  | 450  |
|     Computer Revenue     || 500  | 560  |
|     Headphones Revenue   || 300  | 390  |
|   Service Revenue        || 200  | 240  |
| [Cost of Sales]          ||      |      |
|   Materials              || 400  | 460  |
|   Fulfillment            || 80   | 95   |
|   Depreciation           || 20   | 25   |
| Operating Income         || 500  | 620  |

In this example:

- `Revenue` and `Cost of Sales` are top-level Sections
- `Product Revenue` is a child Section inside `Revenue`
- `Phone Revenue`, `Computer Revenue`, and `Headphones Revenue` belong to `Product Revenue`
- `Service Revenue` belongs directly to `Revenue`, not to `Product Revenue`
- `Operating Income` is an ordinary top-level row, not a Section
- `Operating Income` is a sibling of the top-level Sections, not a child of `Cost of Sales`

## Example: Non-Financial Table

# Study Plan

| Topic                    || Target Hours | Actual Hours |
| ------------------------ || ------------ | ------------ |
| [Math]                   ||              |              |
|   [[Algebra]]            ||              |              |
|     Linear Equations     || 4            | 3            |
|     Quadratics           || 5            | 6            |
|   [[Geometry]]           ||              |              |
|     Triangles            || 3            | 2            |
|     Circles              || 4            | 4            |
| [Language]               ||              |              |
|   [[Reading]]            ||              |              |
|     Short Stories        || 2            | 2            |
|     Essays               || 3            | 1            |
|   [[Writing]]            ||              |              |
|     Grammar Exercises    || 2            | 2            |
|     Practice Essay       || 4            | 3            |
| Total Weekly Study Time  || 27           | 23           |

In this example:

- `Math` and `Language` are top-level Sections
- `Algebra`, `Geometry`, `Reading`, and `Writing` are child Sections
- `Total Weekly Study Time` is an ordinary top-level row, not a Section
- hierarchy is structural and does not depend on formulas

## Structural Interpretation

Sections define hierarchy in the row dimension.

A row may therefore be understood in terms of:

- its containing Section
- its parent Section, if any
- its child Sections, if any
- its sibling rows and sibling Sections within the same parent scope

This RFC does not yet define how formulas or references use that structure.

## Current Working Assumptions

- a Section spans a contiguous range of rows
- nested Sections are allowed
- a nested Section belongs to the nearest enclosing parent Section
- sibling Sections at the same level do not overlap
- ordinary rows may appear directly inside a Section
- child Sections may appear inside a Section
- ordinary rows and Sections may appear as siblings in the same parent scope
- section hierarchy is part of document structure, not only visual formatting

## Open Questions

- how Sections should interact with later reference semantics
- how Sections should interact with later formula semantics
