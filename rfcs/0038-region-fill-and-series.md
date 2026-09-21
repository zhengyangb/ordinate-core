# RFC-0038: Region Fill and Series

- Status: Draft
- Project: Ordinate

## Summary

Add a platform-independent, atomic `fill_region` core edit. The editor owns pointer
gestures and viewport geometry; the core owns inference, formula copying and writes.
Web and desktop use the same implementation. No AG Grid Enterprise dependency.

## Contract

`{ op: "fill_region", source: CoreRegionTarget, target: CoreRegionTarget, mode }`
uses stable row/column IDs (RFC-0017). Both rectangles belong to the same sheet.
The target excludes the seed, adjoins exactly one of its four sides, and has the
same width (vertical fill) or height (horizontal fill). It must lie inside existing
body/data cells. Headers and hierarchy labels are not fillable. Invalid shapes,
unknown IDs, unsupported modes and out-of-bounds operations fail atomically.

`planFillRegion(sheet, sourceRect, targetRect, mode)` is the shared pure planner.
Its rectangles use zero-based inclusive semantic indices. It returns a matrix of
input strings and `canSeries`, without mutating the document or evaluating formulas.
The edit applies this matrix in one history entry using existing dependency updates.
Derived values are recalculated by the normal editing pipeline.

## Modes and inference

Inference is per column when filling vertically and per row when filling horizontally.
It uses literal runtime kinds, not display formatting, locale strings, or cached formula results.

| Seed | Auto | Explicit series |
| --- | --- | --- |
| One numeric literal | Repeat | Increment by 1 |
| Two or more equally spaced numbers | Continue the interval | Continue the interval |
| One date | Advance one day | Advance one day |
| Equally spaced dates, times, datetimes, durations | Continue the interval | Continue the interval |
| Numbered text with matching prefix/suffix, e.g. Item 01, Item 03 | Item 05, Item 07 | Same |
| One numbered text literal | Repeat | Increment suffix by 1 |
| Formula, arbitrary text, boolean, blank, mixed kinds, irregular numbers | Repeat the seed pattern | Unavailable |

`copy` always repeats the seed pattern. Repetition uses modulo relative to the seed
origin, including upward/leftward fill and partial pattern lengths. `series` fails
if any lane has no supported series; `auto` may extend one lane and repeat another.
No polynomial fitting, locale-dependent weekday/month names, or speculative pattern
guessing. Month-end/calendar-month inference is deferred; dates use fixed day intervals.
Temporal operations reuse RFC-0029 arithmetic (including timezone and range rules).
Numbered text preserves uniform leading-zero padding and rejects negative/unsafe suffixes.
Floating point output removes arithmetic noise at 15 significant digits; non-finite
results fail. Near-zero cancellation uses a magnitude-relative machine-epsilon bound.

## Formula semantics

Copy formulas as formulas, never as their computed values. Parse the current source
input, visit its reference nodes and translate each non-fixed positional selector by
the destination-minus-seed-cell offset. This includes ranges, cross-sheet selectors,
calls, arrays and indexing expressions. It does not rewrite quoted strings.

Label selectors retain their meaning. Current/relative selectors (`_`, `_-1`) remain
relative at the destination. Fixed axes (`#n!`) remain fixed. Negative positions become
invalid reference selectors and evaluate as unresolved references. Ordinary out-of-range
references follow the existing evaluator. Existing reference syntax is unchanged;
this RFC does not introduce the deferred spreadsheet `$` syntax. Invalid formula input
is copied verbatim, preserving the editor's existing invalid-input semantics.

## Formatting and history

Fill is content-only. Preserve destination local format/style and its row/column/default
cascade; do not flatten resolved styles or copy seed formatting implicitly. Source cells
are never changed. Each fill (including choosing a different mode afterward) is one
atomic, undoable edit. Mode changes reapply from the same original seed, not from the
generated cells. Each mode change has its own undo step.

## Editor interaction

- Use the existing selection overlay's scroll planes, geometry and frozen boundaries.
- A small corner dot is hidden until hovered/focused (visible for touch); no permanent toolbar.
- Drag horizontally or vertically, including backward; a dashed preview shows the destination.
- Drag near viewport edges to scroll. Never silently fill collapsed/hidden rows.
- Escape, pointer cancellation, loss of window focus, document revision or sheet/mode change
  cancels an unfinished gesture. Pointer motion never edits data.
- On release, select the combined region and show a compact Auto / Copy / Series chooser.
  A new selection or document change dismisses it so it cannot reapply stale work.
- A focused handle supports Alt + arrow key to fill one step. Controls have accessible labels.
- Search, normal cell selection, editing and undo continue through their existing pathways.

## Validation

Core tests cover four directions, arbitrary step, decimals, text padding, mixed lanes,
temporal intervals, reference translation, fixed/relative references, invalid shapes,
metadata preservation, atomic failure, undo and redo. Editor tests cover geometry,
hidden rows and selection union. Browser validation covers search toggle/highlight,
drag preview/commit, mode changes, undo, cancellation and frozen/scrolling layouts.

## Deferred

Multiple disjoint regions, filling headers, automatic sheet growth, copying formats,
custom series lists, polynomial patterns and concurrent collaborative fill are not
part of this revision. Python core parity is a separate implementation task; the TS
editing API used by both current clients is the implementation target here.
