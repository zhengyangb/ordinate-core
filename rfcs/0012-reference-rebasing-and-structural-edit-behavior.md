# RFC-0012: Reference Rebasing and Structural Edit Behavior

## 1. Summary

Defines how references, ranges, label-based selectors, and relative selectors change semantically after structural edits.

## 2. Goals

This RFC is intended to define:

- the rebasing semantics of positional and relative references
- the default semantics of label rename
- how ranges change after insertion and deletion
- which structural changes affect selector resolution
- the distinction between value-only changes and target-changing changes

## 3. Non-Goals

This RFC does not yet define:

- exact CRUD API names
- stable row or column IDs
- collaborative editing
- formatting or metadata
- the full transaction API
- exact UI behavior

## 4. Core Principle

Structural edits are defined in terms of how reference meaning changes, not in terms of concrete editing API names.

## 5. Reference Kinds

This RFC distinguishes the following reference kinds:

- **positional reference**  
  for example `#1`, meaning an absolute position

- **relative reference**  
  for example `_`, `_+1`, `_-1`

- **label-based reference**  
  for example `Revenue`, `2025.03.15`

- **range reference**  
  for example `#1:#5`, `"Revenue":"Cost of Sales"`

## 6. Positional Reference Semantics

`#` is positional.

Current working direction:

- `#n` refers to the current nth position on an axis
- without stable row/column IDs, `#n` is not identity-based
- after insertion or deletion, positional references shift naturally with the axis

## 7. Relative Reference Semantics

`_` is relative to the formula cell.

Current working direction:

- `_` is anchored to the cell containing the formula
- `_+n` and `_-n` are offsets from that formula cell
- if structural edits move the formula cell, the reference *origin* moves with it
- the numeric offset does **not** change during structural edits
- absolute position should be expressed with `#`, not `_`

## 8. Label Rename Semantics

Default direction:

- if a rename preserves a unique target, label-based references may be automatically rebound
- if rebinding would be ambiguous or impossible, the reference becomes unresolved and evaluates to error

This applies to:

- row label rename
- column label rename
- sheet rename
- hierarchy path component rename

## 9. Range Rebasing

### Insertion Inside a Range

If insertion occurs inside a referenced range, the range expands to include the inserted rows or columns.

### Deletion Inside a Range

If deletion occurs inside a referenced range, the range shrinks and the deleted portion is removed.

### Deletion of an Endpoint

If a range endpoint is deleted, the range is reconstructed from the remaining valid boundary.

### Full Deletion of a Range

If all covered rows or columns are deleted, the resulting behavior remains an open question.

Current candidates:

- empty view
- unresolved / error

## 10. Structural Changes That Affect Selector Resolution

The following changes are treated as structural changes that may alter selector resolution:

- row label rename
- column label rename
- header hierarchy change
- section structure change
- row insertion
- row deletion
- column insertion
- column deletion
- sheet rename

These changes are not merely value changes. They may change what a selector refers to.

## 11. Value-Only Change vs Target-Changing Change

### Value-Only Change

A value-only change modifies cell input but does not alter selector meaning.

Examples:

- changing `3` to `4`
- changing `= 1 + 2` to `= 1 + 3`

### Target-Changing Change

A target-changing change modifies what a reference resolves to.

Examples include:

- label rename
- hierarchy change
- row or column insertion
- row or column deletion
- range boundary change
- sheet rename

## 12. Relationship to Dirty and Dependency

This RFC defines how reference targets change.

RFC-0009 defines how such semantic changes propagate computationally through:

- dirty marking
- dependency invalidation
- recalculation

In other words:

- RFC-0012 defines what a reference means after a structural edit
- RFC-0009 defines what happens after that change is known

## 13. Cross-Sheet References

If cross-sheet references use `Sheet::...`, then sheet rename follows the same label-like rebasing principle:

- unique continued target -> automatic rebinding
- ambiguous or missing target -> unresolved / error

## 14. Hierarchy Path Rebasing

For hierarchical labels and multi-level headers:

- if a path component rename preserves a unique path target, rebinding may occur
- if the resulting path is ambiguous or unresolvable, the reference becomes unresolved
- hierarchy restructure is treated as a target-changing structural edit

## 15. Deferred Topics

- stable row/column IDs
- fixed reference semantics beyond the current `#`
- user-configurable rebasing policies
- exact empty-view semantics after total deletion
- collaborative conflict handling

## 16. Open Questions

- whether full range deletion should yield an empty view or unresolved/error
- whether rename semantics should later become configurable
- how fine-grained hierarchy rebinding should be
- when section changes should affect resolution versus only presentation
