# RFC-0001: Core Model

- Status: Draft
- Project: Ordinate

## Summary

Ordinate is a text-first spreadsheet language. It is designed to feel familiar like Markdown, while supporting formulas, references, sections, and structured tables.

## Goals

Ordinate should be:

- plain-text first
- readable and writable by humans
- suitable for version control
- more semantic than raw cell coordinates alone
- implementable with a calculation engine

## Non-Goals

This RFC does not yet define:

- the full surface syntax
- all formula syntax
- all built-in functions
- serialization details
- plugin or Python extension rules

## Core Concepts

### Sheet
A named document region containing table content.

### Cell
A unit that contains either:
- a literal value
- a formula

### Value
The evaluated result of a cell.

### Formula
An expression that computes a value.

### Reference
A way to select other cells, rows, columns, or ranges.

### Section
A row-grouping concept used to model structured tables such as financial statements.

### Label
A human-readable row or column identifier.

### Path
A hierarchical label, such as `Expense.COGS`.

## Design Direction

Ordinate prefers:

- text that looks lightweight and familiar
- references that are not limited to A1 notation
- support for labels and sections as first-class ideas
- a calculation model that stores formula input separately from computed value

## Tentative Decisions

The following are current working assumptions:

- the first implementation will likely be in Python
- sheet structure should feel Markdown-like
- references should move toward a Python-like selector model
- hierarchical labels should be supported

## Open Questions

- how sheets are delimited in the text format
- exact reference syntax
- how sections are written explicitly
- how path escaping works
- how much compatibility with A1 notation is needed

## Next RFCs

Expected follow-up topics:

- document structure
- reference model
- sections and hierarchical labels
- surface syntax
- formula language
- calculation engine
