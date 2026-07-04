# RFC-0036: Cross-Sheet References

- Status: Draft
- Project: Ordinate

## Summary

This RFC adds formula references that explicitly target another sheet in the same document.

Current references are sheet-local:

```ord
@[row_selector, col_selector]
```

This RFC adds an explicit sheet-qualified form:

```ord
@[sheet_selector::[row_selector, col_selector]]
```

Examples:

```ord
@["Inputs"::["Tax Rate", Value]]
@["Revenue"::[Product.Total, 2026]]
@["Assumptions"::[#2, #3]]
```

The sheet qualifier applies to the full two-dimensional row/column selector tuple. It does not apply only to the row selector.

## Goals

- Add a deterministic syntax for cross-sheet references.
- Preserve existing sheet-local reference syntax unchanged.
- Make sheet-qualified references work in scalar references, ranges, views, function arguments, and element-wise formulas wherever existing references are accepted.
- Keep `CoreEdit` APIs unchanged in V1; formulas are still edited as input text.
- Define sheet lifecycle behavior for insert, move, rename, and delete.
- Keep frontend changes optional for V1 except adding examples and any desired formula-authoring affordances.

## Non-Goals

- Cross-workbook references.
- External file references.
- Spreadsheet-style `Sheet!A1` syntax.
- UI sheet picker behavior.
- Locale-sensitive sheet name matching.
- User-configurable reference copy modes.
- Cross-sheet contextual selectors in V1.
- Sheet duplication semantics.
- Persisting session-local sheet IDs in `.ord` text.

## Syntax

The sheet-local reference syntax remains:

```ord
@[row_selector, col_selector]
```

The cross-sheet reference syntax is:

```ord
@[sheet_selector::[row_selector, col_selector]]
```

`sheet_selector` is a sheet name selector. In V1 it must be a literal sheet name.

Sheet names are single name components, not hierarchical paths. They follow the same quoting and escaping rules as a single label path component:

```ord
@["Inputs"::["Tax Rate", Value]]
@["Model Assumptions"::[Revenue, 2026]]
```

Clean unquoted sheet names are allowed when they are valid unquoted single components:

```ord
@[Inputs::[TaxRate, Value]]
```

Quoted sheet names are recommended in documentation and examples because sheet names commonly contain spaces.

Sheet names containing `.`, `:`, `::`, `_`, whitespace, quotes, brackets, or other special characters must be quoted and escaped using the same quoted-component rules as row and column labels.

The `::` token binds the sheet selector to the full bracketed row/column selector:

```ord
@["Inputs"::[Revenue, Amount]]
```

This means:

- sheet: `Inputs`
- row selector: `Revenue`
- column selector: `Amount`

It does not mean:

- row selector: `"Inputs"::Revenue`
- column selector: `Amount`

## Grammar Shape

Conceptually:

```text
reference :=
  "@[" reference_target "]"

reference_target :=
  local_reference_target
  | sheet_qualified_reference_target

local_reference_target :=
  row_selector "," col_selector

sheet_qualified_reference_target :=
  sheet_selector "::" "[" row_selector "," col_selector "]"
```

The inner `[row_selector, col_selector]` is required in the sheet-qualified form. This keeps the sheet selector visually and structurally separate from the two-dimensional selector.

The following form is invalid:

```ord
@["Inputs"::Revenue, Amount]
```

It is invalid because it makes the sheet qualifier look like it only applies to the row selector.

## Sheet Selectors

V1 sheet selectors are name selectors.

Supported:

```ord
@[Inputs::[Revenue, Amount]]
@["Inputs"::[Revenue, Amount]]
@["Model Assumptions"::["Tax Rate", Value]]
```

Unsupported in V1:

```ord
@[_::[Revenue, Amount]]
@[thisSheet()::[Revenue, Amount]]
@["Inputs"."Nested"::[Revenue, Amount]]
```

Sheet names are document-local labels. Matching is exact and case-sensitive, consistent with existing sheet name behavior.

`@["Inputs"."Nested"::[Revenue, Amount]]` is invalid because sheet selectors are single sheet names, not sheet-name paths.

## Contextual Selectors

Cross-sheet references do not support contextual row or column selectors in V1.

The following are invalid in V1:

```ord
@["Inputs"::[_, Amount]]
@["Inputs"::[Revenue, _]]
@["Inputs"::[_-1, Amount]]
@["Inputs"::[thisRow(-1), Amount]]
@["Inputs"::[Revenue, thisCol(1)]]
@["Inputs"::[_:Total, Amount]]
@["Inputs"::[Revenue, 2025:_+1]]
```

The reason is semantic clarity. In a cross-sheet reference, `_` could reasonably mean:

- the current row in the formula's sheet
- the same absolute row position in the target sheet
- the same row label in the target sheet
- a contextual row in the target sheet

V1 avoids this ambiguity by requiring explicit row and column selectors in sheet-qualified references.

This restriction applies recursively to range endpoints. A cross-sheet range is valid only when both endpoints use explicit non-contextual selectors.

Sheet-local references keep existing contextual selector behavior:

```ord
@[_, Amount]
@[Revenue, _]
@[_-1, Amount]
```

## Runtime Model

The public edit API remains text-based for formulas:

```ts
{ op: "set_cell_input", target, input }
```

No V1 `CoreEdit` operation shape changes are required.

The formula AST should add an optional sheet selector to `ReferenceExpr`:

```ts
type SheetRefSelector = {
  kind: "sheet_name";
  value: string;
};

type ReferenceExpr = {
  sheetSelector?: SheetRefSelector;
  rowSelector: RefSelector;
  colSelector: RefSelector;
  style?: ReferenceStyle;
};
```

Existing sheet-local references have no `sheetSelector`.

This is an additive public type change for TypeScript consumers that inspect formula ASTs. Consumers that only submit cell input text and render presentation/evaluation output should not need changes.

The public formula AST exposes the source sheet selector only. It must not expose session-local `sheetId` values.

Implementations may keep private bound formula state that records:

- the original source sheet selector text
- the resolved session-local `sheetId`, when bound
- whether a previously bound sheet has been deleted in the current session

That private state is not part of the public `ReferenceExpr` contract.
It must not appear in public AST JSON, serialized `.ord` text, or ordinary object-key inspection of the public AST shape.

## Binding Model

Serialized `.ord` text stores sheet names, not sheet IDs:

```ord
@["Inputs"::[Revenue, Amount]]
```

Runtime binding should resolve a sheet-qualified reference to a session-local `sheetId` when possible.

The implementation should distinguish:

- source selector: the sheet name in formula text
- bound target: the resolved session-local `sheetId`
- rendered selector: the current sheet name for that bound `sheetId`

This mirrors row/column binding: the serialized formula is label-oriented, while the runtime may use stable session-local identities to survive structural edits.

If a reference cannot bind, it remains evaluable as an error-producing reference. The original source text should be preserved for round-trip safety.

If a reference was previously bound to a `sheetId` and that sheet is deleted, the reference becomes an unresolved bound reference in the current session. It must not silently rebind to a later same-name sheet in the same session. Undoing the delete may restore the same `sheetId` and allow the reference to evaluate again.

After serialize/reparse, only sheet names are available. A reopened document may bind by name according to normal parse-time binding rules.

## Evaluation Semantics

For a sheet-local reference:

```ord
@[Revenue, Amount]
```

the target sheet is the current formula sheet.

For a sheet-qualified reference:

```ord
@["Inputs"::[Revenue, Amount]]
```

the target sheet is the unique sheet named `Inputs`.

Evaluation failure cases:

- no sheet with that name: `unresolved_reference`
- multiple sheets with that name: `ambiguous_reference`
- row selector does not resolve in the target sheet: existing row reference error policy
- column selector does not resolve in the target sheet: existing column reference error policy
- row/column selector resolves ambiguously in the target sheet: existing ambiguous reference policy

The row and column selectors are evaluated against the target sheet, not the formula's sheet.

Cross-sheet cycles are cycles. If formulas across sheets depend on each other cyclically, evaluation must produce the existing `cycle` error kind. The result must not depend on sheet order.

## Views and Ranges

Cross-sheet references may produce scalar cells, vectors, or matrices under the same rules as sheet-local references.

Examples:

```ord
sum(@["Revenue"::[:, 2026]])
average(@["Inputs"::[ScenarioA:ScenarioC, Rate]])
lookup("West", @["Regions"::[:, Name]], @["Regions"::[:, TaxRate]])
```

All cells in a single reference view come from one target sheet in V1.

V1 does not define references that union ranges across multiple sheets.

## Dependency and Recalculation Semantics

Cross-sheet references introduce document-level dependencies.

If a formula in `Summary` references a cell or view in `Inputs`, edits to the referenced `Inputs` cells must mark the dependent `Summary` formula dirty.

Minimum dependency behavior:

- changes to a referenced cell in another sheet must invalidate dependent formulas
- row/column insert/delete/move/duplicate in the target sheet must rebind or invalidate dependent formulas using existing row/column reference semantics
- sheet rename must preserve the bound target and refresh rendered source text
- sheet delete must invalidate dependent formulas and evaluate them as `unresolved_reference`
- sheet move must not affect dependencies
- cross-sheet dependency cycles must use the existing cycle detection policy

The incremental evaluator must continue to match full document evaluation within the same `DocumentState`.

Session-only deleted-bound references are the explicit exception to serialize/reparse equivalence: if a reference was bound to a deleted sheet identity, the same editor session must not rebind it to a later same-name sheet, but serialized `.ord` text cannot persist that deleted `sheetId`. After serialize/reparse, the formula binds by sheet name again if the replacement sheet name and referenced selectors resolve.

## Sheet Lifecycle Semantics

### Insert Sheet

`insert_sheet` does not affect existing cross-sheet references.

Core edit APIs reject duplicate sheet names, so they cannot create new sheet-name ambiguity. Parsing existing text may still encounter duplicate sheet headings; references to duplicate names must evaluate as `ambiguous_reference`.

### Move Sheet

`move_sheet` does not affect cross-sheet references.

References are name/identity-bound, not sheet-order-bound.

### Rename Sheet

`rename_sheet` preserves references bound to the renamed sheet.

After rename, serialization should render the current sheet name:

Before:

```ord
@["Inputs"::[Revenue, Amount]]
```

After renaming `Inputs` to `Assumptions`:

```ord
@["Assumptions"::[Revenue, Amount]]
```

This is a structural source refresh, not raw formula text search/replace.

### Delete Sheet

Deleting a referenced sheet does not delete formulas that reference it.

Those formulas should evaluate to `unresolved_reference` until the original sheet identity is restored, the formula is edited, or the document is serialized and reparsed under normal name-binding rules.

Undoing the delete should restore the referenced sheet and allow formulas to evaluate again.

In the same editor session, creating a new sheet with the same name as the deleted sheet does not automatically rebind references that were already bound to the deleted sheet's `sheetId`.

## Serialization and Rendering

Serialization must use current sheet names for bound cross-sheet references.

If a sheet name needs quoting, render it as a quoted selector:

```ord
@["Model Assumptions"::["Tax Rate", Value]]
```

If the reference is unresolved because the sheet is missing, serialization should preserve the original sheet selector text where possible rather than inventing a fallback.

If the sheet target exists but the name is no longer a clean unquoted selector, serialization may render the quoted form.

Serialization must not persist `sheetId`.

## Error Behavior

Cross-sheet reference errors use existing external error categories:

- missing target sheet: `unresolved_reference`
- ambiguous target sheet: `ambiguous_reference`
- cross-sheet dependency cycle: `cycle`
- invalid cross-sheet contextual selector: parse error

Invalid cross-sheet contextual selectors must fail early at parse time.

## Public API Impact

Expected public surface changes:

- formula text accepts a new reference syntax
- `ReferenceExpr` gains optional `sheetSelector`

Expected unchanged surfaces:

- `CoreEdit` operation shapes
- `SheetEvaluation` shape
- presentation result shape
- document serialization format outside formula text
- frontend table rendering requirements

Frontend work is optional for V1 except adding examples. Formula autocomplete or sheet-picker UX can be specified separately in app feature specs.

## Backward Compatibility

Existing formulas continue to parse and evaluate as sheet-local references.

This RFC is additive for `.ord` files that do not use cross-sheet references.

The TypeScript AST shape is additive but may affect consumers that destructure or exhaustively validate `ReferenceExpr`.

This RFC amends RFC-0035. RFC-0035 intentionally kept sheet lifecycle semantics independent of cross-sheet formulas. Once this RFC is implemented, `rename_sheet`, `delete_sheet`, and `move_sheet` must follow the cross-sheet semantics defined here.

## Examples

### Summary Sheet

```ord
# Inputs
| Item     || Value |
| -------- || ----- |
| Revenue  || 100   |
| Cost     || 40    |
| Tax Rate || 0.25  |

# Summary
| Item          || Value |
| ------------- || ----- |
| Revenue       || = @["Inputs"::[Revenue, Value]] |
| Cost          || = @["Inputs"::[Cost, Value]] |
| Pretax Income || = @["Inputs"::[Revenue, Value]] - @["Inputs"::[Cost, Value]] |
| Tax           || = @["Pretax Income", Value] * @["Inputs"::["Tax Rate", Value]] |
```

### Cross-Sheet Vector

```ord
# Revenue
| Region || 2026 |
| ------ || ---- |
| East   || 100  |
| West   || 120  |

# Summary
| Metric        || Value |
| ------------- || ----- |
| Total Revenue || = sum(@["Revenue"::[:, 2026]]) |
```

## Testing Requirements

Core tests must cover:

- parsing sheet-local references unchanged
- parsing quoted and unquoted sheet-qualified references
- rejecting malformed sheet-qualified references such as `@["Inputs"::Revenue, Amount]`
- rejecting cross-sheet contextual selectors in V1
- rejecting contextual selectors inside cross-sheet range endpoints
- evaluating scalar cross-sheet references
- evaluating cross-sheet ranges/views in aggregate functions
- missing sheet -> `unresolved_reference`
- duplicate sheet names -> `ambiguous_reference`
- cross-sheet dependency cycles -> `cycle`
- missing/ambiguous row or column in target sheet follows existing reference error behavior
- serialization round-trip for cross-sheet formulas
- rename sheet refreshes rendered cross-sheet source text
- delete referenced sheet produces `unresolved_reference`
- undo delete restores evaluation
- delete then insert same-name sheet does not rebind previously bound references in the same session
- move sheet does not change evaluation
- incremental recalculation matches serialize/reparse/full evaluation
- no frontend API changes are required for table rendering
- public `ReferenceExpr` includes source `sheetSelector`, while `SheetEvaluation` and presentation output shapes remain unchanged
- serialization never writes `sheetId`

Example app fixtures should include at least one cross-sheet formula so the UI renders the feature with ordinary presentation APIs.

## Future Work

- Cross-sheet contextual selector policy.
- Cross-workbook references.
- Sheet picker and autocomplete behavior in the app feature spec.
- Sheet duplication and copy modes for sheet duplication.
- Cross-sheet range unions.
- Persisted identity for durable references across save/load, if the `.ord` format ever needs it.
