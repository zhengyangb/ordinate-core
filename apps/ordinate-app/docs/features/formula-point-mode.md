---
title: Formula Point Mode
status: Proposed
area: editor
owner: ordinate-app
updated: 2026-05-23
---

# Formula Point Mode Feature Spec

## Summary

Formula Point Mode lets a user edit a formula while clicking or dragging cells in the sheet to insert or revise references in the formula draft.

This is an editor feature, not a core public contract. It should not be folded into RFC-0018. Core already defines reference syntax, evaluation, rebasing, and edit operations; this spec defines how the Ordinate app helps users author those references interactively.

## Goals

- Let users insert a cell reference by clicking a cell while editing a formula.
- Let users insert a rectangular range reference by dragging a range while editing a formula.
- Let users revise an existing reference token by selecting that token and picking a new cell or range.
- Show formula reference tokens and their linked sheet ranges with matching colors.
- Provide a lightweight way to switch the inserted reference representation, such as A1 style versus Ordinate style.
- Keep formula editing anchored to the source cell while point selection happens elsewhere on the sheet.
- Keep the model compatible with future cross-sheet reference picking.

## Non-Goals

- This is not a core edit RFC and does not define new core operations.
- V1 does not attempt full Excel compatibility.
- V1 does not support multi-range references such as `SUM(A1, C1, E1)` through point picking.
- V1 does not support cross-sheet reference picking.
- V1 does not implement every possible reference representation.
- V1 does not implement formula autocomplete, function argument help, or formula linting beyond what is needed for point mode.

## Terminology

- **Source cell**: the cell whose formula is being edited.
- **Formula draft**: the editable text in the formula bar before commit.
- **Reference token**: a parsed reference substring inside the formula draft, such as `B4`, `B4:D8`, or `@[Revenue,2025]`.
- **Point Mode**: the temporary mode active while the user is picking a reference target from the sheet.
- **Pick target**: the cell or range currently being picked for insertion or replacement.
- **Active reference token**: the reference token currently selected or being edited in the formula draft.
- **Reference style**: the textual representation chosen for the picked target.

Point Mode is separate from normal sheet selection:

- Normal selection is for sheet commands such as edit, clear, and apply to selection.
- Point Mode selection is for authoring formula text.
- Point Mode may show range overlays, but those overlays are not the app's normal command selection.

## Prior Art

Common spreadsheet editors follow a similar mental model:

- While editing a formula, clicking a cell inserts a reference instead of moving the active edit cell.
- Dragging over cells inserts or updates a range reference.
- Reference tokens are color-coded, and the corresponding sheet ranges use matching colors.
- If a reference token is active, picking a new cell or range replaces that token.
- If the cursor is positioned after an operator or separator, picking creates a new token.

Ordinate should copy the useful interaction model, not the entire historical behavior of any one spreadsheet.

## User Model

The user should be able to think:

1. "I am editing this formula."
2. "I can point at the cells I want to reference."
3. "The colored ranges tell me which formula parts point where."
4. "If I select a colored reference and drag a different range, I am changing that reference."
5. "If I type an operator and pick another range, I am adding another reference."

The app should not make users understand focus, anchor, semantic coordinates, row IDs, or column IDs.

## State Model

Formula Point Mode should introduce a dedicated formula editing session rather than overloading the existing sheet selection state.

```ts
type FormulaEditSession = {
  source: LogicalCell;
  draft: string;
  caretStart: number;
  caretEnd: number;
  tokens: FormulaDraftToken[];
  pointMode: FormulaPointMode | null;
};

type FormulaPointMode = {
  activeTokenId: string | null;
  anchor: LogicalCell | null;
  focus: LogicalCell | null;
  range: Rect | null;
  replacementRange: { start: number; end: number } | null;
  preferredStyle: ReferenceStyle;
};

type ReferenceStyle =
  | "spreadsheet-a1"
  | "ordinate-label"
  | "ordinate-positional"
  | "ordinate-relative";
```

The existing `SheetSelection` remains the single source of truth for ordinary sheet commands. `FormulaEditSession.pointMode` is the source of truth for formula reference picking.

## V1 Scope

V1 should support:

- same-sheet point picking only
- single-cell reference picking
- single rectangular range reference picking
- insertion into formulas that are currently being edited
- replacement of one active reference token
- color-coded reference tokens and overlays
- reference style switcher for the newly inserted or active token
- default A1-style output when the picked target can be represented in A1 style

V1 should defer:

- cross-sheet picking
- multi-range point picking
- function argument helper UI
- automatic choice among all Ordinate selector variants
- drag handles on colored reference outlines
- formula parse recovery beyond a clear fail state

## Entering Point Mode

Point Mode becomes available when the user is editing a formula draft.

Recommended V1 rules:

- If the draft starts with `=` or the user types `=`, the formula bar enters formula editing mode.
- While formula editing mode is active, clicking a sheet cell enters Point Mode for that click.
- Dragging from a sheet cell enters Point Mode with an anchor and updates the picked range as the drag moves.
- Typing ordinary formula characters updates the draft and exits any active pick gesture.
- Pressing `Esc` while a pick gesture is active cancels the pick and returns to formula editing.
- Pressing `Esc` when no pick gesture is active cancels formula editing, matching the existing edit cancel behavior.

## Insertion And Replacement Rules

The hardest interaction is deciding whether a new pick creates a new reference token or replaces an existing one.

V1 should use deterministic editor rules:

### Replace Existing Token

Picking a new cell or range replaces an existing reference token when:

- the text selection overlaps exactly one reference token
- the caret is inside one reference token
- the active token was selected by clicking a colored formula token
- the active token was selected by clicking its matching colored range overlay

In these cases, the new pick replaces that token's text. This matches the common spreadsheet behavior where editing an existing colored reference and then selecting another range revises the reference.

### Insert New Token

Picking inserts a new reference token when:

- the caret is not inside a reference token
- no active reference token is selected
- the text selection is empty and positioned after an operator, opening parenthesis, comma, or function argument separator
- the text selection is a non-reference substring

The inserted text replaces the current text selection if the selection is not empty.

### Ambiguous Cases

If the text selection overlaps multiple reference tokens, V1 should fail early by showing a small inline error and not modifying the draft. The user must narrow the selection.

If the caret is immediately adjacent to a token boundary, V1 should prefer insertion unless the token is visibly active. This avoids surprising replacement when a user types `+` after a reference and then picks another cell.

## Drag Behavior

When the user drags while editing a formula:

- drag start sets the pick anchor
- drag movement updates the pick focus
- the preview range is normalized from anchor to focus
- the formula draft updates live with the current range text
- releasing the pointer finalizes the draft text but keeps formula editing active

If there is an active reference token, the drag replaces that token.

If there is no active reference token, the drag inserts a new token at the caret or replaces the current non-reference text selection.

Dragging a second range does not create an implicit second argument. To create another reference, the user must first type an operator or separator, such as `+` or `,`, then pick again.

This keeps V1 predictable and avoids inventing syntax-specific behavior for each function.

## Reference Style Policy

Point Mode must separate target selection from text representation. The picked target is semantic; the formula draft can render it in several styles.

Candidate styles:

- **A1 style**: `B4`, `B4:D8`
- **Ordinate label style**: `@[Revenue,2025]`
- **Ordinate positional style**: `@[#4,#2]`
- **Ordinate relative style**: `@[_-1,2025]`

Recommended V1 default:

- Use A1 style for same-sheet cell and rectangular range picks when the existing formula context does not indicate another style.
- If replacing an existing reference token, preserve that token's style when possible.
- If a target cannot be represented in the active style, use the closest valid Ordinate style and show the style switcher.

Future style policy may consider:

- per-user preference
- per-workbook preference
- preserving the dominant style in the current formula
- choosing label style for semantically named rows/columns
- choosing relative style when the target is near the source cell and the formula is likely copied

## Reference Style Switcher

After a pick is inserted or an active token is selected, the app should show a lightweight anchored control that lets the user switch reference style.

The control is closer to a paste-options popover than a tooltip:

- It is anchored to the selected reference token in the formula bar when visible.
- If the formula token is not visible or the user is interacting with the sheet overlay, it may anchor to the colored range outline.
- It is small, non-modal, and dismisses on typing, commit, cancel, or outside click.
- It has explicit actions, so it should not be implemented as a pure hover tooltip.

Working name: **Reference Options Popover**.

V1 options:

- `A1`
- `Label`
- `Position`
- `Relative` when available

The popover should preview the exact resulting text for each option, for example:

- `A1` -> `B4:D8`
- `Label` -> `@[Revenue,2025]`
- `Position` -> `@[#4:#8,#2:#4]`

If an option is invalid or ambiguous, it should be disabled with a concise reason.

## Visual Design

Reference visualization has two linked surfaces:

- colored formula tokens in the formula draft
- colored overlays on the sheet

Rules:

- Each reference token receives a stable color while the formula draft is open.
- The matching sheet cell or range uses the same color for border and a soft fill.
- The active token uses a stronger border and higher contrast.
- Non-active references should remain visible but quiet.
- Colors must remain distinguishable in light and dark themes.
- Point Mode overlays must be visually distinct from ordinary command selection.

The formula input eventually needs token-aware rendering. A plain `<input>` or `<textarea>` cannot style substrings. V1 may need to replace the formula text field with either:

- a contenteditable code-like editor with controlled parsing, or
- an overlay-rendered text editor where highlighted tokens are drawn behind the text.

This is a major implementation dependency and should be designed before building full token coloring.

## Keyboard And Mouse Behavior

Recommended behavior:

- `Enter`: commit the formula draft.
- `Esc`: cancel the active pick; if no pick is active, cancel formula editing.
- `Tab`: commit and move focus according to normal sheet navigation.
- Arrow keys in the formula input move the caret, not the sheet selection.
- Mouse click in formula token selects that token.
- Mouse drag in formula input selects text.
- Mouse click in sheet while formula editing inserts or replaces a reference.
- Mouse drag in sheet while formula editing inserts or replaces a range reference.

Shift and modifier behavior should be conservative in V1. Do not overload normal range selection shortcuts until Point Mode has a tested state model.

## Cross-Sheet Plan

Cross-sheet point picking should be V2.

Required behavior:

- The source formula edit session survives sheet tab changes.
- The formula bar remains bound to the source cell, not the visible sheet selection.
- The visible sheet can show point-mode overlays for the picked target.
- The generated reference must include a sheet qualifier.
- Returning to the source sheet restores source-cell context and all token overlays.

Open dependency:

- Cross-sheet reference syntax and serialization must be settled enough for the app to generate canonical text. RFC-0012 mentions the possible `Sheet::...` direction, but that is not a complete editor contract.

## Error Handling

Point Mode should fail early and visibly when:

- the picked target cannot be represented by the selected style
- the label style would be ambiguous
- the target is non-contiguous
- the formula draft cannot be parsed enough to identify reference tokens
- a text selection overlaps multiple reference tokens

Errors should not silently rewrite the formula. The draft should remain unchanged unless the operation is valid.

## Implementation Notes

Likely implementation pieces:

- `FormulaEditSession` state in `App.tsx` or a dedicated hook/store.
- Formula draft tokenizer that can identify reference token ranges and style hints.
- Point-mode overlay layer separate from ordinary selection overlays.
- Reference text generator that accepts a semantic target and style policy.
- Reference Options Popover component.
- Formula input replacement or overlay mechanism for token colors.

Do not reuse normal `SheetSelection` as the source of truth for point picking. It is acceptable to derive temporary visual rectangles from point-mode state, but command selection and formula reference picking must remain separate concepts.

## Acceptance Criteria

V1 is complete when:

- Editing `=` then clicking a cell inserts an A1-style reference.
- Editing `=` then dragging a range inserts an A1-style range reference.
- Selecting an existing reference token and picking another cell replaces the token.
- Typing `+` after a reference and picking another cell inserts a second token instead of replacing the first.
- Each reference token has a matching colored sheet overlay.
- The active token and active overlay are visually linked.
- Reference Options Popover can switch between valid reference styles.
- Invalid style options are disabled with a reason.
- Formula commit preserves existing edit semantics.
- Formula cancel restores the previous cell input.
- Ordinary selection behavior is unchanged when not editing a formula.

## Open Questions

- Should the Reference Options Popover appear immediately after every pick, or only when the user hovers/clicks a small options affordance?
- Should default style be a user preference, workbook preference, or formula-local inference?
- Should label style be preferred when both row and column labels are stable and unique?
- Should relative style be exposed in V1, or kept behind a later advanced option?
- How should colors be assigned when formulas contain more references than the palette supports?
- Should clicking a colored range overlay select its token or start replacing it immediately?
- What is the exact cross-sheet reference surface syntax?
- How much formula parsing recovery is required before token highlighting is reliable?

