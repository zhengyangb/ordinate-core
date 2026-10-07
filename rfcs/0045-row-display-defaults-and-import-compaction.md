# RFC 0045: Row display defaults and import compaction

Status: Accepted

## Motivation

Financial imports repeat bold, alignment, color and numeric display metadata
across total rows. Row defaults already exist, but their label-column carrier
prevents their use on ordinary unheaded sheets. Import compaction currently
extracts only column defaults.

## Model and precedence

Reuse `rowDisplayMetadata`, stable row IDs and existing row edit operations.
No second formatting model or evaluation dependency is introduced.
Data-cell precedence is cell > row > column > automatic. Style axes resolve
independently; a numeric/temporal format is an atomic specification. Missing
metadata means inherit, not reset. Explicit `normal` cancels inherited bold.
Automatic color/alignment/number format cannot cancel an inherited value;
compaction must not invent such overrides. Header surfaces remain semantic
labels and do not inherit data-cell presentation.

## Source representation

Use the existing serialization-only `@display` frame symmetrically: top row
contains column defaults, left column contains body-row defaults.

```
# Results
| @display  |              | {:.0f} | {:.0f} |
|           | Revenue      | 100    | 120    |
| {::bold}  | Total        | 100    | 120    |
```

The frame is emitted when either axis has defaults. It is not part of the
logical grid and never shifts A1 coordinates, row IDs, formula targets, header
boundaries or exported cells. Row defaults no longer require a header column.
Existing label-attached row metadata remains a source shorthand when no row
control is supplied; serialization has one canonical carrier, the control
column. Supplying both carriers for one row is an error, never a precedence
guess. Control cells accept metadata only; header rows cannot carry row defaults.
Removing the last header column preserves row defaults. This supersedes that
restriction in RFC 0018. Row promotion to a header still clears its data defaults.

## Import factoring

First extract column defaults, then row defaults from the original effective
presentation. Reuse the existing conservative rule: at least three occurrences,
at least 80% agreement, and no automatic exception on a populated cell.
Promote each style axis separately; retain explicit minority cell exceptions.
Only add a row default when it removes at least three actual cell overrides;
do not repeat an already inherited column format on every row. Blank spacer
cells are not evidence, but explicitly formatted blanks are. Existing row
defaults are not refactored. Repeated configuration is idempotent.

## Rails

Replace the column-format glyph with a short green underline under its label;
use the same indicator under row numbers. Only explicit axis metadata is
marked, not inherited cell presentation. Reuse the theme-aware green token;
indicators do not change rail dimensions or pointer targets. Accessible names
include “custom formatting”. Existing row context-menu controls also work on
unheaded sheets. Header-row formatting remains unavailable.

## Verification

Test axis precedence and normal exceptions, headed/unheaded serialization,
invalid/duplicate control sources, A1 stability, row movement/undo, boundary
changes, format factoring/idempotence and XLSX effective-style export. Verify
the supplied financial workbook without copying it into the repository, keeping
its content and generated artifacts outside version control. Report source
size/metadata reduction and compare nonblank effective presentation before and
after compaction, rather than merely asserting shorter output.
