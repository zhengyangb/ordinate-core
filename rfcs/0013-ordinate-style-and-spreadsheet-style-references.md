# RFC-0013: Ordinate Style and Spreadsheet Style References

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines dual surface syntax for references in Ordinate.

Ordinate supports two reference styles:

- **Ordinate style** (`@-style`)
- **Spreadsheet style** (`A1-style`)

These are surface syntaxes only. They do not define separate semantic models. Both normalize to the same internal reference representation.

## Goals

This RFC defines:

- the distinction between Ordinate style and Spreadsheet style
- where Spreadsheet style is valid
- how Spreadsheet style references normalize into the canonical internal model
- how rebasing semantics are shared across both styles
- the current direction for fixed positional references in Ordinate style
- reference-level preferred-style preservation for round-trip serialization
- example correspondences between the two styles

## Non-Goals

This RFC does not define:

- replacement of Ordinate style as the primary explicit syntax
- a separate evaluator or dependency model for Spreadsheet style
- full Excel historical behavior
- all future spreadsheet-compatible function forms
- exact UI control shapes for serializer mode switching

## Core Principle

Ordinate style and Spreadsheet style are two ways of writing references.

They share:

- the same reference semantics
- the same dependency model
- the same rebasing behavior
- the same internal representation

Spreadsheet style is a compatibility-oriented surface syntax, not a separate semantic layer.

## Reference Styles

### Ordinate Style (`@-style`)

Ordinate style uses explicit selector syntax.

Examples:

- `@[Revenue,2025]`
- `@[#3,#2]`
- `@[_-1,2025]`

### Spreadsheet Style (`A1-style`)

Spreadsheet style uses spreadsheet-like coordinates.

Examples:

- `A1`
- `B3`
- `A1:B5`
- `A:A`
- `1:1`

This RFC treats Spreadsheet style as available in formula-expression context.

## Formula-Expression Scope

Current working direction:

- Spreadsheet style is recognized only inside formula expressions
- outside formula-expression context, text such as `A1` is not automatically treated as a reference
- quoted strings remain strings

This reduces ambiguity between ordinary cell contents and reference syntax.

## Normalization to the Internal Model

Both styles normalize to the same internal reference representation.

Examples of conceptual correspondence:

- `A1` ↔ the same internal single-cell positional reference as an explicit positional `@-style` form
- `A1:B5` ↔ the same internal rectangular view/range reference as an explicit `@-style` form
- `A:A` ↔ the same internal whole-column view reference
- `1:1` ↔ the same internal whole-row view reference

Style is syntax metadata over this shared semantic model. It does not change evaluation meaning.

## Reference-Level Preferred Style

Preferred style is tracked per reference, not per formula and not per sheet.

Current working direction:

- each parsed reference stores a style hint: `ordinate` or `spreadsheet`
- mixed-style formulas are valid (for example `A1 + @[#2,#2]`)
- serializer preserves the hint per reference when possible
- style hint is non-semantic metadata and does not affect dependency/evaluation/rebasing semantics

## Shared Rebasing Semantics

Structural edits affect both styles through the same semantic rules.

Current working direction:

- Spreadsheet style references and Ordinate style references share the same rebasing semantics
- insertion, deletion, rename, and hierarchy-related structural changes are interpreted through the same underlying model
- RFC-0012 remains the source of rebasing semantics

## Positional References in Ordinate Style

Ordinate style continues to support explicit positional selectors.

Current working direction:

- `#n` denotes a positional selector on an axis
- positional selectors are not label-based
- they are sensitive to structural shifts because they refer to positions, not stable identities

Example:

- `@[#3,#2]`

## Relative, Positional, and Fixed Positional Forms

This RFC distinguishes three relevant ideas in Ordinate style:

### Relative

Relative selectors depend on the formula cell.

Examples:

- `_`
- `_+1`
- `_-1`

### Positional

Positional selectors identify current axis positions.

Examples:

- `#1`
- `#2`

### Fixed Positional

Fixed positional selectors use positional selection plus explicit anchoring.

Current working direction:

- `#1!` denotes a fixed positional selector
- `#1!` is distinct from ordinary `#1`
- ordinary positional selectors such as `#1` track the current nth position on an axis and therefore shift under row or column insertion and deletion
- fixed positional selectors such as `#1!` remain anchored and do not change target under such structural edits
- rebasing must not rewrite fixed positional selectors

Examples:

- `@[#1!,#1!]`
- `@[#1!,2025]`

This RFC treats `#1!` as the preferred notation for fixed positional selection in Ordinate style.

Spreadsheet style may later support familiar fixed-reference forms such as:

- `$A$1`
- `$A1`
- `A$1`

These correspond to fixed positional references that remain anchored rather than shifting under structural edits.

## Labels

Label-based selectors remain part of Ordinate style.

Current working direction:

- label selectors are semantically stable by default
- they are not position-based
- they do not need the fixed positional marker

Examples:

- `Revenue`
- `2025`
- `"Cost of Sales"`

## Spreadsheet Style and Function Calls

Spreadsheet style may appear inside function arguments in formula expressions.

Examples:

- `sum(A1:B5)`
- `sum(A:A)`
- `dotProduct(A1:A5, B1:B5)`

This RFC does not yet fully define spreadsheet-style variadic aggregate forms such as `SUM(A1, B2, C3)`, but such forms are compatible with the long-term direction.

## Serialization Direction

Current working direction:

- the internal model is unified
- serializer default behavior is style-preserving per reference
- parser records preferred style per reference during parse
- serializer emits each reference in its recorded style when representable
- when no style hint exists, serializer uses project default style (default: Ordinate style)
- explicit canonicalization modes may still exist, but they are opt-in

Fallback rule:

- if a reference cannot be represented in Spreadsheet style (for example label-based or relative-selector-only forms), serializer falls back to Ordinate style for that reference only
- fallback is a serialization safety rule, not a semantic conversion

## Parsing and Disambiguation

Current working direction:

- in formula-expression context, tokens matching supported Spreadsheet style patterns are parsed as Spreadsheet style references
- quoted strings are parsed as strings
- Ordinate style remains available at the same time

This RFC intentionally limits Spreadsheet style recognition to formula-expression context to reduce ambiguity.

## Examples

### Equivalent Surface Forms: Single Cells

| Meaning | `@-style` | `A1-style` |
|---|---|---|
| first row, first column | `@[#1,#1]` | `A1` |
| third row, second column | `@[#3,#2]` | `B3` |
| fifth row, fourth column | `@[#5,#4]` | `D5` |

### Equivalent Surface Forms: Rectangular Ranges

| Meaning | `@-style` | `A1-style` |
|---|---|---|
| first row/first col through fifth row/second col | `@[#1:#5,#1:#2]` | `A1:B5` |
| third row/third col through seventh row/fifth col | `@[#3:#7,#3:#5]` | `C3:E7` |
| second row, columns two through four | `@[#2,#2:#4]` | `B2:D2` |
| rows three through eight of column three | `@[#3:#8,#3]` | `C3:C8` |

### Equivalent Surface Forms: Whole Rows and Whole Columns

| Meaning | `@-style` | `A1-style` |
|---|---|---|
| whole first column | `@[:,#1]` | `A:A` |
| whole third column | `@[:,#3]` | `C:C` |
| whole first row | `@[#1,:]` | `1:1` |
| whole fifth row | `@[#5,:]` | `5:5` |

### Equivalent Use in Functions

| Meaning | `@-style` | `A1-style` |
|---|---|---|
| sum of first row/first col through fifth row/second col | `sum(@[#1:#5,#1:#2])` | `sum(A1:B5)` |
| sum of the whole first column | `sum(@[:,#1])` | `sum(A:A)` |
| sum of the whole first row | `sum(@[#1,:])` | `sum(1:1)` |
| dot product of first five cells in columns one and two | `dotProduct(@[#1:#5,#1], @[#1:#5,#2])` | `dotProduct(A1:A5, B1:B5)` |

### Fixed / Anchored Examples

| Meaning | `@-style` | `A1-style` |
|---|---|---|
| fixed first row, fixed first column | `@[#1!,#1!]` | `$A$1` |
| fixed first column, third row not fixed | `@[#3,#1!]` | `$A3` |
| fixed first row, second column not fixed | `@[#1!,#2]` | `B$1` |

These examples are illustrative correspondence examples. Spreadsheet-style absolute anchoring with `$` remains deferred and is not yet fully specified by this RFC.

### Examples Without Natural A1-Style Equivalents

The following `@-style` forms currently have no direct Spreadsheet-style equivalent in this RFC:

- `@[Revenue,2025]`
- `@[_-1,_]`
- `@[Revenue,"Cost of Sales"]`

These examples rely on label-based or relative-selector features that go beyond ordinary A1 coordinates.

## Deferred Topics

- full variadic spreadsheet aggregate forms
- sheet-qualified Spreadsheet style forms

## Open Questions

- how broad Spreadsheet style support should become beyond A1/range/row/column forms

## Current Working Assumptions

- Ordinate style and Spreadsheet style are two surface syntaxes over one semantic model
- Spreadsheet style is recognized in formula-expression context
- both styles normalize to the same internal representation
- both styles share the same rebasing semantics
- fixed positional selectors (`#n!`) are rebasing-exempt
- label selectors remain semantically stable by default
