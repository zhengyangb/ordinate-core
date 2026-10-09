---
name: ordinate-authoring
description: Create or edit plain-text Ordinate (.ord) workbooks, including native tables, formulas, named and relative references, notes, and display formats. Use direct text editing or ordinate-cli operations to author and check workbooks, not to develop the Ordinate application.
---

# Ordinate workbook authoring

An `.ord` file is the editable workbook: UTF-8 text with one table per sheet.
You can write it directly, like Markdown; the CLI is a complementary tool, not
a prerequisite for authoring. Preserve calculations as formulas, not snapshots.

## Write a working workbook

A `#` heading starts a sheet. The divider separates header rows from body rows;
`||` separates header columns (row labels) from data columns. Keep every table
row rectangular. Notes belong before or after the table, not in another table.

This complete example links two sheets and uses one formula across columns:

```ord
# Plan

**Acme Manufacturing — quarterly plan.** Amounts are dollars.

| Item || Q1 | Q2 |
| --- || --- | --- |
| Revenue || 100 | 120 |
| Costs || 40 | 50 |
| Profit || = @[Revenue,_] - @[Costs,_] | = @[Revenue,_] - @[Costs,_] |
| Margin || = @[Profit,_] / @[Revenue,_] {:.1%} | = @[Profit,_] / @[Revenue,_] {:.1%} |

# Review

| Metric || Value |
| --- || --- |
| Annualized profit || = sum(@["Plan"::[Profit,Q1:Q2]]) * 2 {:,.2f} |
| Decision || = if(@["Annualized profit",_] > 200, "Proceed", "Review") |
```

Profit is 60/70; Margin is 60.0%/58.3%; Annualized profit is 260.
Changing Revenue must change those results, not only the displayed cache.

For hierarchical rows, prefix a child label with `*`, a grandchild with `**`.
Reference the path, for example `@["Cost of sales"."Materials",_]`. For
multiple header rows, put them all above the divider. Do not invent indentation
or a second table to represent hierarchy. Read [syntax](references/syntax.md)
for complete structural examples, literals, and escaping.

Header labels are literal text: write `2026` in the table, but `"2026"` in a
selector; quotes in the header itself become part of its name. Multi-row headers
form column paths: with `2026` above `Forecast`, use `@[Revenue,"2026".Forecast]`,
not `@[Revenue,"2026"]` (the parent alone is not a column name).

## References and expressions

Ordinate writes `@[row,column]`; Excel A1 notation puts the column first.
For example, `C2` (column C, row 2) is `@[#2,#3]`, not `@[#3,#2]`.
Inside `@[row,column]`, bare names such as `Q1` or `K1` are header labels,
not Excel coordinates. `@[:,Q1]` means the column whose header is `Q1`, not
column Q. `@[:,K1]` only works if a column is named `K1`; to select positional
column K, use `K:K` or `@[:,#11]`.

- Named: `@[Revenue,Q1]`. Use double quotes for spaces/punctuation:
  `@["Tax rate",Value]`, never single quotes.
- Fixed row, current column: `@[Revenue,_]` (a horizontal report).
- Current row, fixed column: `@[_,Quantity]` (a vertical ledger).
  A line total can be `@[_,Quantity] * @[_,"Unit price"]`.
- Preceding row in the current column: `@[_-1,_]`.
- Positional: `C2`, `$C$2`, `C$2`, `$C2`, or `@[#2,#3]`.
- Hierarchical: `@[Revenue.Services,Q1]`.
- Cross-sheet: `@["Plan"::[Revenue,Q1]]`; use explicit selectors, not `_`.
- Inclusive reference range: `@[Revenue:Costs,Q1]`, `B2:B3`.
- Whole data column: `@[:,Q1]` selects all data rows of column Q1; use
  `sum(@[:,Q1])` for a scalar total. Avoid placing that total in Q1 itself,
  which would include its own cell; select an explicit input range instead.

Common mistakes (wrong → correct):

| Wrong | Correct | Why |
| --- | --- | --- |
| `@["Products"::[AC-1,Price]]` | `@["Products"::["AC-1",Price]]` | The hyphen is punctuation, not part of a bare label. Quote range endpoints too: `"AC-1":"AC-3"`. |
| `@['Products'::["AC-1",Price]]` | `@["Products"::["AC-1",Price]]` | Ordinate uses double quotes, not Excel-style single quotes. |
| `@[Quantity,_]` | `@[_,Quantity]` | For a vertical ledger, select the current row first, then the Quantity column. |
| `max(0, amount)` | `max([0, amount])` | Native min/max take one array or view, not multiple scalar arguments. |

A1 and `#n` coordinates are one-based semantic table coordinates, including
headers. Postfix brackets and CLI indexes are zero-based; their slice ends are
exclusive. Markdown dividers and `@display` controls do not count as cells.
When directly editing text, prefer row/column names for business relationships:
`@[Revenue,_]` still finds Revenue after another row is inserted above it;
`@[_,Quantity]` still finds Quantity after columns are reordered. Positional
`B2`/`#n` and relative offsets such as `_-1` can silently select a different
target after a text insertion or move. Use them when position/adjacency is the
intended meaning, or preserve their targets with structured Core operations;
do not rewrite existing references merely for style.

Names must resolve uniquely: use full row paths for repeated labels, such as
`@["Operations"."Supplies",_]` versus `@["Administration"."Supplies",_]`.
Range endpoints are independent: `@[Costs.Materials:Costs.Labor,Q1]`, not
`@[Costs.Materials:Labor,Q1]`; the second endpoint does not inherit the parent.
Named references are not immune to every edit. Directly renaming a label/sheet
or changing a row's parent requires updating affected references. A named range
can include newly inserted rows between its endpoints; for an exact set, select
the named cells explicitly. Direct text edits do not invoke Core's rebasing.
Read [references](references/references.md) for coordinate and selection rules.

Formula cells start with `=`. Use `**` for powers, `==` for equality, double
quotes for text, and commas between function arguments. Functions are
case-insensitive. Some native expressions:

```text
= sum([1, 2, 3])
= sum(filter([100, 120], [true, false]))
= lookup("Beta", ["Alpha", "Beta"], [10, 20])
= max([0, 10 - 20])
= "Ordinate"[0:3]
= f"Profit: {B4:,.2f}"
```

`[1, 2]` is a one-dimensional array; `[[1, 2]]` is a two-dimensional view.
Both support intermediate calculation, but a cell's final result must be
scalar. `sum` accepts either. `filter(values, mask)` returns an array and takes a same-shape boolean
mask, not a lambda or Excel criteria string. There is no general `map`/lambda
syntax. Do not assume an Excel function name or argument convention is native.
Binary arithmetic and comparisons align axes from the right. An Array of
length N aligns with the columns of an M-by-N View; one operand must already
have the result shape, so outer-product expansion fails. A single-cell
reference is a 1-by-1 View and can compare directly with a column:
`@[:,Client] == @[_,Client]`. `filter(values, mask)` still requires matching
kinds and shapes.
Read [formulas](references/formulas.md) for array/slice and cache rules.

Common functions include `sum`, `average`, `count`, `min`, `max`, `if`, `filter`,
`lookup`, `round`, `format`, `date`, `time`, `duration`, `pmt`, `npv`, and `irr`.
Their signatures and parameter meanings are in
[common functions](references/functions.md), generated from Core rather than
maintained as a separate catalog. Find other functions with
`ordinate-cli help functions` and exact overloads with
`ordinate-cli help function <name>`.

## Values, formats, and notes

Numbers and `true`/`false` are typed values. Temporal literals use ISO forms:
`2026-01-02`, `14:30`, `2026-01-02T14:30:00Z`, `PT26H`. Durations are elapsed
time, not a clock time. Quote text that looks typed, such as `"00123"` or `"true"`.
Escape literal table pipes as `\|` and backslashes as `\\`.
Datetime subtraction, `@[_,End] - @[_,Start]`, produces an elapsed duration,
including across midnight. `duration(days,hours,minutes,seconds)` takes
components, not total elapsed seconds; see its parameter limits in the reference.

Formats preserve the value: `1234.5 {:,.2f}`, `0.08 {:.1%}`,
`2026-01-02 {:%Y-%m-%d}`, `PT26H {:%[h] hr}`. Styles are separate:
`{::bold}`, `{::>}`, `{::^,blue}`. `format(value, spec)` and f-strings produce
text instead; do not use them when a downstream formula needs a numeric value.

For consistent presentation, prefer row/column defaults to repeated cell
suffixes. This complete `@display` frame has a currency-like column default,
one bold row default, and a local percentage exception:

```ord
# Summary
| @display | | {:,.2f} |
| | Item || Value |
| --- | --- || --- |
| | Revenue || 1234.5 |
| {::bold} | Profit || 300 |
| | Margin || = @[Profit,_] / @[Revenue,_] {:.1%} |
```

`@display` is a nonsemantic frame: its top row sets column defaults, its left
column sets body-row defaults, and its control cells contain metadata only.
For data cells: cell > row > column > automatic; individual style axes inherit
independently. Headers do not inherit body presentation. Read
[formats](references/formats.md) before editing frames or structured formats.

Notes support paragraphs, **bold**, *italic*, flat bullet/ordered lists, and
thematic separators of three or more hyphens. Separate paragraphs with a blank
line. A single newline normalizes to a space. Escape literal pipes as `\|`.
Do not add nested lists, arbitrary HTML, links, or code blocks as note syntax.
Preserve existing opaque front matter; it is not a place to invent workbook
settings. Read [notes](references/notes.md) for source constraints.

## Use the tool when useful

The executable is `ordinate-cli`. In this repository, after the CLI is built,
use `node packages/cli/dist/ordinate-cli.mjs` instead. Do not assume a global
installation. No executable means you can still edit text, but cannot claim
CLI validation or evaluation was performed.

```sh
ordinate-cli inspect model.ord --sheet Plan --notes --json
ordinate-cli validate model.ord
ordinate-cli evaluate model.ord --sheet Plan --json
ordinate-cli edit --help --operation set_cell_input
ordinate-cli edit --help --schema
```

Choose direct text editing for new tables, notes, formulas, and coherent bulk
authoring. Choose structured insert/move/duplicate/fill operations when Core
should preserve reference targets and presentation. Set explicit inputs with
`set_cell_input`/`set_region`; use default/local format and style operations for
presentation. Inspect before selecting named paths or indexes. Discover the
exact payload from operation help, not guessed field names.

Keep the current workbook in view. Before editing, read the affected source
table or inspect it with its headers, row paths, formulas, notes, and display
frame; an old command/result is not a current table snapshot. After a structural
batch, reread the affected table and relevant cross-sheet references before
choosing the next targets. Text edits and CLI edits can be mixed: neither removes
the need to observe current state. For large sheets, inspect relevant regions
and check truncation flags rather than assuming the default slice is complete.

For batches, take `baseRevision` from the exact inspected `input.revision`.
Operations apply in order against the current staged state. Without a destination,
`edit` returns a proposal; `--write` commits; `--output new.ord` creates a copy.
Supply JSON with `--operations changes.json` or `--operations -` through a pipe
or a quoted here-document. Stale revisions reject the batch; inspect and reassess.
CLI region bounds are zero-based and end-exclusive, including headers.

For example, after inspecting the Plan sheet above, this batch changes one
input by name. Replace the revision token with the inspected revision, then
submit it via `ordinate-cli edit model.ord --operations - --write`:

```json
{
  "baseRevision": "REVISION_FROM_INSPECT",
  "operations": [
    {
      "op": "set_cell_input",
      "target": {
        "sheet": "Plan",
        "row": {"kind": "path", "path": ["Revenue"]},
        "column": {"kind": "label", "label": "Q1"}
      },
      "input": "200"
    }
  ]
}
```

Keep source text literal in the shell: `<<'JSON'` preserves dollar signs and
backticks inside formulas; unquoted shell input can change them before parsing.

Validate structure, then evaluate formulas; both report failures with nonzero
exit status. `--json` returns machine-readable reports: check status and `ok`,
not just `error: null`. Successful `edit` does not imply successful calculation.
Evaluation ignores stored caches; `evaluate --write` refreshes them explicitly.
Do not invent caches or replace formulas with cached results.
If checks fail, use the diagnostics to repair and rerun them; if you cannot
finish, report the remaining failure instead of claiming completion. An unknown
selector or function does not by itself prove the requested feature is unsupported.

Check business relationships too: in a disposable copy, change representative
inputs and confirm dependent results update while unrelated values stay intact.
Distinguish user-supplied assumptions from inferred ones. Report only checks
actually performed. This skill does not authorize installing tools, publishing
files, or changing unrelated agent configuration.
