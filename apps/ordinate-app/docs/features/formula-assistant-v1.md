# Formula Assistant V1

## Status

Draft implementation spec.

## Problem

Ordinate formulas now have a growing standard function library. Users should not have to memorize function names, signatures, argument order, or examples. The formula editor needs an inline assistant that makes functions discoverable while keeping the formula bar compact.

## Goals

- Provide a visible `fx` entry point in the formula bar tool cluster.
- Show function suggestions while typing a function name in formula edit mode.
- Show function signature help while the caret is inside a function call.
- Insert function skeletons with the caret placed inside parentheses.
- Source function names, categories, signatures, summaries, and examples from the core function metadata registry.
- Keep the assistant keyboard-operable.

## Non-goals

- Full spreadsheet compatibility documentation.
- Formula AST validation in the assistant.
- Argument-level type checking before evaluation.
- Natural language formula generation.
- A separate documentation page.

## Interaction Model

The `fx` button lives with formula edit tools, near format and style controls. It opens the full function browser. It does not live next to the commit checkmark, because it is an editing aid rather than a completion action.

When editing a formula:

- Typing after `=` or after an operator opens suggestions.
- Typing a prefix filters function names.
- `ArrowUp` and `ArrowDown` move through suggestions.
- `Enter` or `Tab` inserts the highlighted function as `name()`.
- The caret is placed inside the inserted parentheses.
- `Escape` closes the assistant before canceling formula edit.

When the caret is inside an existing function call:

- The assistant shows the function signature.
- The active argument is highlighted.
- Examples and summary remain visible.

## Data Contract

The app consumes:

- `listStandardFunctionMetadata()`
- `getStandardFunctionMetadata(name)`

from `@ordinate/core`.

The app must not maintain a separate function list. If a function appears in autocomplete, it must come from core metadata.

## Layout

The assistant is an anchored popover above the formula editor. It follows the existing formula bar visual language:

- compact translucent shell
- small grouped function list
- signature/detail panel
- small triangular pointer toward the editor

The list and detail are one surface, not nested cards.

## V1 Acceptance

- Clicking `fx` opens the function browser.
- Typing `=a` shows matching functions such as `abs`, `average`, and `and`.
- Selecting `average` inserts `average()` and places the caret between `(` and `)`.
- Typing inside `round(12.345, )` shows `round(x, digits) -> number` and highlights `digits`.
- Suggestions and function details are sourced from core metadata.
- Reference options popover takes priority when a reference token is active.
