# RFC-0004: Basic Reference Model

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the first basic reference model for Ordinate.

The goal of this RFC is to define a small, stable core for references before the language grows to include ranges, multi-cell selectors, unions, shorthand operators, and more advanced contextual selection.

This RFC only defines **single-cell references**.

## Goals

This RFC defines:

- a basic reference form for label-based references
- a basic place for contextual references
- the `_` placeholder for the current row or column
- quoting rules for path components
- the rule that references in this RFC resolve to exactly one cell

## Non-Goals

This RFC does not define:

- ranges
- multi-cell selectors
- selector unions
- array-valued references
- copy/fill semantics
- insert/delete rewrite behavior
- Excel-style absolute or mixed references such as `$A$1`
- formula evaluation rules
- dependency graph algorithms
- performance optimization
- filtering rules such as skipping structural rows

## Core Idea

A reference in this RFC has the following shape:

`@[row_selector, col_selector]`

This is the core selector form for Ordinate references.

In this RFC:

- `row_selector` identifies a row target
- `col_selector` identifies a column target
- a reference must resolve to exactly one cell
- selectors must be explicit; `_` denotes the current row or column

## Formula Context

This RFC defines references as expressions that may appear inside formulas.

A formula cell begins with `=`.

Examples:

- `=@["Revenue"."Total Revenue",2025]`
- `=@["Cost of Sales",_]`
- `=@[thisRow(-1),_]`

This RFC does not define full evaluation behavior.

## `_` Placeholder Rules

`_` is the explicit placeholder for the current row or column.

Examples:

- `@[Revenue,_]` means row `Revenue`, current column
- `@[_,_]` means current cell
- `@[_-1,_]` means previous row, current column

`_` is reserved and must be quoted (`"_"`) to be used as a literal label component.

## Selector Families

This RFC defines three selector families at a high level.

### 1. Label-Based Selectors

These use labels and hierarchical paths.

Examples:

- `@[Revenue.TotalRevenue,2025]`
- `@["Revenue"."Total Revenue",2025]`
- `@["Cost of Sales",_]`
- `@[_,Actual]`
- `@[_,_]`

### 2. Contextual Selectors

These refer to positions relative to the current cell.

This RFC introduces contextual selectors as function-like selectors.

Examples:

- `@[thisRow(-1),_]`
- `@[_,thisCol(-1)]`
- `@[thisRow(0),thisCol(0)]`
- `@[thisRow(1),Actual]`

In this RFC, contextual selectors are only introduced in scalar form.

### 3. Coordinate-Based References

Coordinate-based references are recognized as a separate family and may later support spreadsheet-style coordinate syntax such as `A1`.

This RFC does not fully define coordinate-based reference behavior.

## Path Rules

A label-based selector may consist of one or more path components separated by `.`.

Examples:

- `@[Revenue.TotalRevenue,2025]`
- `@["Operating Expenses"."Research & Development",Actual]`

In the first example:

- `Revenue` is one path component
- `TotalRevenue` is another path component

In the second example:

- `Operating Expenses` is one quoted path component
- `Research & Development` is another quoted path component

## Quoting Rules

Unquoted path components are allowed only when they are clean identifiers.

A quoted path component is required whenever a component contains a reserved or otherwise special character.

At minimum, quoted path components should be used when a component contains:

- whitespace
- `.`
- `,`
- `"`
- `@`
- `(`
- `)`
- `[`
- `]`
- `_` (reserved placeholder)

Examples:

- `@["Revenue"."Total Revenue",2025]`
- `@["Cost of Sales",2025]`
- `@["U.S. Revenue"."Sales, International",Actual]`
- `@["EBITDA (Adj)",2025]`

This RFC does not fully define escape syntax inside quoted components, but quoted components are reserved as the escape mechanism for otherwise invalid literal label text.

## Contextual Selectors

A selector ending in `()` is interpreted as a contextual selector rather than a textual path component.

Examples:

- `@[thisRow(-1),_]`
- `@[_,thisCol(-1)]`

This allows future contextual selectors to accept parameters while remaining syntactically distinct from label-based paths.

If a label literally contains parentheses, it must be quoted.

Example:

- `@["EBITDA (Adj)",2025]`

## Example Table

```text
# Income Statement

| Line Item                || 2024 | 2025 | Actual |
| ------------------------ || ---- | ---- | ------ |
| Revenue                ||      |      |        |
| * Product Revenue      ||      |      |        |
| ** Phone Revenue         || 400  | 450  | 445    |
| ** Computer Revenue      || 500  | 560  | 558    |
| ** Headphones Revenue    || 300  | 390  | 392    |
| * Service Revenue        || 200  | 240  | 241    |
| Cost of Sales          ||      |      |        |
| * Materials              || 400  | 460  | 455    |
| * Fulfillment            || 80   | 95   | 96     |
| * Depreciation           || 20   | 25   | 24     |
| Operating Income         || 500  | 620  | 619    |
```

## Example References Against the Table

Current column implied:

- `@["Revenue"."Phone Revenue",_]`
- `@["Cost of Sales"."Depreciation",_]`
- `@["Operating Income",_]`

Explicit row and column:

- `@["Revenue"."Phone Revenue",2025]`
- `@["Cost of Sales"."Depreciation",Actual]`
- `@["Operating Income",2024]`

Current row implied:

- `@[_,2025]`
- `@[_,Actual]`

Current cell:

- `@[_,_]`

Contextual scalar references:

- `@[thisRow(-1),_]`
- `@[thisRow(1),_]`
- `@[_,thisCol(-1)]`
- `@[_,thisCol(1)]`
- `@[thisRow(0),thisCol(0)]`

## Single-Cell Rule

Every valid reference in this RFC must resolve to exactly one cell.

This means that this RFC does not include:

- selectors that produce multiple rows
- selectors that produce multiple columns
- selectors that produce rectangular regions
- unions of multiple references

Those topics are deferred.

## Invalid References

A reference is invalid in this RFC if:

- it resolves to no cell
- it resolves ambiguously to more than one cell
- it uses unsupported syntax from a future extension
- it participates in a cyclic dependency, once dependency semantics are introduced

This RFC does not fully define evaluation behavior, but cycle invalidity is recognized as a required property of the system.

## Deferred Topics

- **Ranges**: examples include `@["Revenue":"Cost of Sales",2025]` and `@[thisRow(-3):thisRow(-1),_]`
- **Multi-selector lists**: examples include `@[[ "Revenue", "Cost of Sales" ],2025]`
- **Selector unions**: examples include `@union(@["Revenue",2025], @["Cost of Sales",2025])`
- **Contextual collection selectors**: examples include `@[above(),_]` and `@[_,left()]`
- **Shorthand syntax**: examples include `@[^,_]`, `@[_,<]`, and `@[_,>]`
- **Coordinate-based syntax**: examples include `A1` and `B3`
- **Structural filtering**: examples include `@[above(skipStructural=true),_]`

## Open Questions

- whether `@[row_selector, col_selector]` should remain the only core reference shell
- whether coordinate-based references should remain secondary or become first-class
- whether contextual collection selectors should use names like `above()` or different names entirely
- how quoted path components should escape embedded quote characters
- how insertion, deletion, copying, and rebasing should interact with references
- whether future range syntax should use `:`
- whether future multi-selector syntax should use nested square brackets
- whether future shorthand operators such as `^`, `<`, and `>` should be adopted

## Current Working Assumptions

- the core reference shell is `@[row_selector, col_selector]`
- `_` is the explicit placeholder for the current row or current column
- quoted path components are the escape mechanism for special characters
- contextual scalar selectors use function-like notation
- this RFC only covers references that resolve to a single cell
