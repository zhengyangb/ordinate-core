---
name: ordinate-authoring
description: Create or edit Ordinate (.ord) workbooks, including importing Excel/CSV/TSV sources, native tables, formulas, named and relative references, notes, and display formats. Use direct text editing or ordinate-cli operations to author and check workbooks, not to develop the Ordinate application.
---

# Ordinate workbook authoring

An `.ord` file is the editable workbook: UTF-8 text with one table per sheet.
You can write it directly, like Markdown; the CLI is a complementary tool, not
a prerequisite for authoring. Preserve calculations as formulas, not snapshots.
Core serialization writes `ord-format: "0.1"` as the first front-matter line;
the field versions the ORD file format, not the workbook's content. Directly
authored source may omit it, but an unsupported explicit version is rejected.

Before composing a formula, identify its target `(sheet, row path, column)` and
each dependency. Choose the reference that expresses the relationship: named
`@[row,column]` (**row first**) for business labels, A1 (`B2`) when the exact
coordinates are known and the layout is stable (including when a long
hierarchical selector would make the formula harder to write or check),
absolute `@[#n,_]` for a stable row position in the current column,
or relative `@[_-1,_]` when the preceding row in that column is intentional.
`_` means the target's own row or column, so a selector that
resolves back to the target is a cycle. Name both axes in a cross-sheet
reference. After `evaluate`, check the *requested
dependency*, not only the displayed answer: if a decision is specified for
2028 Net income, its formula must not instead test a three-year total. Use an
input probe that makes those two possible sources disagree.

## Write a working workbook

A `#` heading starts a sheet. Header rows and header columns are optional and
independent: a divider separates header rows from body rows; `||` separates
header columns (row labels) from data columns. Without `||`, column A is data,
not an implicit row-label column. Keep every table row rectangular. Notes
belong before or after the table, not in another table.
Every table row, including the last one before a note or sheet boundary, ends
with `|`.

<canonical_workbook>
This complete four-sheet workbook is the context for the syntax contrasts
below. It uses numeric year headers, hierarchical rows, forecasts, a sales
ledger, cross-sheet results, and a sheet with no headers. Enter formulas
without cached values.

```ord
---
ord-format: "0.1"
---

# Plan

**Acme Manufacturing — operating plan.** Amounts are in thousands of dollars;
2026 is the base year and 2027–2028 are forecasts.

| Line item || 2026 | 2027 | 2028 |
| --- || --- | --- | --- |
| Revenue || | | |
| * Equipment || 900 | = @["Revenue"."Equipment","2026"] * 1.08 | = @["Revenue"."Equipment","2027"] * 1.08 |
| * Service || 300 | = @["Revenue"."Service","2026"] * 1.12 | = @["Revenue"."Service","2027"] * 1.12 |
| Total revenue || = @["Revenue"."Equipment",_] + @["Revenue"."Service",_] | = @["Revenue"."Equipment",_] + @["Revenue"."Service",_] | = @["Revenue"."Equipment",_] + @["Revenue"."Service",_] |
| Cost of sales || | | |
| * Materials || 320 | = @["Cost of sales"."Materials","2026"] * 1.06 | = @["Cost of sales"."Materials","2027"] * 1.06 |
| * Labor || 150 | = @["Cost of sales"."Labor","2026"] * 1.05 | = @["Cost of sales"."Labor","2027"] * 1.05 |
| Total cost of sales || = @["Cost of sales"."Materials",_] + @["Cost of sales"."Labor",_] | = @["Cost of sales"."Materials",_] + @["Cost of sales"."Labor",_] | = @["Cost of sales"."Materials",_] + @["Cost of sales"."Labor",_] |
| Gross profit || = @["Total revenue",_] - @["Total cost of sales",_] | = @["Total revenue",_] - @["Total cost of sales",_] | = @["Total revenue",_] - @["Total cost of sales",_] |
| Operating expenses || | | |
| * Sales and marketing || 80 | = @["Operating expenses"."Sales and marketing","2026"] * 1.05 | = @["Operating expenses"."Sales and marketing","2027"] * 1.05 |
| * Administration || 70 | = @["Operating expenses"."Administration","2026"] * 1.05 | = @["Operating expenses"."Administration","2027"] * 1.05 |
| Total operating expenses || = @["Operating expenses"."Sales and marketing",_] + @["Operating expenses"."Administration",_] | = @["Operating expenses"."Sales and marketing",_] + @["Operating expenses"."Administration",_] | = @["Operating expenses"."Sales and marketing",_] + @["Operating expenses"."Administration",_] |
| Operating profit || = @["Gross profit",_] - @["Total operating expenses",_] | = @["Gross profit",_] - @["Total operating expenses",_] | = @["Gross profit",_] - @["Total operating expenses",_] |
| Tax || = @["Operating profit",_] * 0.25 | = @["Operating profit",_] * 0.25 | = @["Operating profit",_] * 0.25 |
| Net income || = @["Operating profit",_] - @["Tax",_] | = @["Operating profit",_] - @["Tax",_] | = @["Operating profit",_] - @["Tax",_] |
| Net margin || = @["Net income",_] / @["Total revenue",_] {:.1%} | = @["Net income",_] / @["Total revenue",_] {:.1%} | = @["Net income",_] / @["Total revenue",_] {:.1%} |

# Sales Ledger

| Item || Quantity | Unit price | Line total |
| --- || --- | --- | --- |
| AC-1 || 2 | 15 | = @[_,"Quantity"] * @[_,"Unit price"] |
| AC-2 || 4 | 12 | = @[_,"Quantity"] * @[_,"Unit price"] |
| AC-3 || 3 | 20 | = @[_,"Quantity"] * @[_,"Unit price"] |
| AC-4 || 1 | 40 | = @[_,"Quantity"] * @[_,"Unit price"] |

# Review

| Metric || Value |
| --- || --- |
| 2028 revenue || = @["Plan"::["Total revenue","2028"]] {:,.2f} |
| Net income growth || = @["Plan"::["Net income","2028"]] - @["Plan"::["Net income","2026"]] {:,.2f} |
| Highest annual profit || = max(@["Plan"::["Net income","2026":"2028"]]) {:,.2f} |
| Order total || = sum(@["Sales Ledger"::["AC-1":"AC-4","Line total"]]) {:,.2f} |
| Decision || = if(@["Net income growth",_] > 0, "On track", "Review") |

# Scratch Grid

| 1 | 2 | 3 |
|   |   |   |
```
</canonical_workbook>

The 2026 Gross profit is 730; Net income is 435. The 2028 Total revenue is
1426.08; Net income is 551.8335. Review's Order total is 178. Changing 2026
Equipment revenue must propagate through later years and Review; it must not
merely change a displayed cache.
Scratch Grid has neither a divider nor `||`: it has zero header rows and zero
header columns. Its first row is three data cells, A1 = 1, B1 = 2, C1 = 3;
column A must not be left blank just because another sheet uses row labels.
When editing an existing table, check its actual structure: a divider can
mark an empty header row (making A2:C2 the first body row), but only `||`
creates a header column. Do not reserve column A by convention.

For full-size source workbooks beyond the compact example above, read the
relevant worked example rather than extrapolating from an isolated cell:

- [Getting started](references/worked-getting-started.md) is a six-sheet
  Acme Manufacturing plan. Its Operating Report shows the entire `@meta`
  frame, column defaults, percentage row defaults, hierarchical totals, and
  formulas that connect to inputs and the other sheets.
- [Inventory replenishment](references/worked-inventory-replenishment.md) is
  a five-sheet operational model with a 48-item catalog, column formats,
  replenishment calculations, supplier orders, and review. Its Purchasing
  Summary calculates Net available units from the preceding row with
  `@[_-1,_]`, avoiding a long row label when adjacency is the actual intent.

Both are complete `.ord` source files copied from the repository's examples
when the skill is generated. Read the one that matches the structure you are
building; keep formulas live instead of imitating a displayed cache.

<formula_cache_example>
Do not write cached values yourself. Author formula input only as
`= expression`; `ordinate-cli evaluate model.ord --write` computes and writes
the cache. For example, author Plan's 2026 Gross profit cell as
`= @["Total revenue",_] - @["Total cost of sales",_]`. After evaluation writes
the result, its serialized source may read
`730 = @["Total revenue",_] - @["Total cost of sales",_]`: the computed cache
is left of `=`; the formula on the right remains authoritative. A string
result has a quoted string cache, for example Review's
`"On track" = if(@["Net income growth",_] > 0, "On track", "Review")`.
Never copy a stale cache into a newly authored formula.
The edit API's cell `input` is also `= expression`, not the serialized
`cached_value = expression`.
</formula_cache_example>

For hierarchical rows, prefix a child label with `*`, a grandchild with `**`.
In Plan, `* Equipment` belongs to `Revenue`; reference it as
`@[Revenue.Equipment,"2026"]`, not `@[Equipment,"2026"]` or
`@[* Equipment,"2026"]`. The `*` marks structure in the table, not a
character in the selector. For multiple header rows, put them all above the
divider. Do not invent indentation or a second table to represent hierarchy.
Read [syntax](references/syntax.md)
for complete structural examples, literals, and escaping.

Header labels are literal text: write `2026` in Plan's header. In a selector,
both `@[Revenue.Equipment,2026]` and `@[Revenue.Equipment,"2026"]` resolve
that label; use the quoted form in new formulas to make the year-as-label
intent explicit and consistent with names that require quotes. These selector
quotes do not become part of the header's name. Multi-row headers form column
paths: with `2026` above `Forecast`, use
`@[Revenue.Equipment,"2026".Forecast]`, not `@[Revenue.Equipment,"2026"]`
(the parent alone is not a column name).

## References and expressions

Ordinate writes `@[row,column]`; Excel A1 notation puts the column first.
For example, `C2` (column C, row 2) is `@[#2,#3]`, not `@[#3,#2]`.
Inside `@[row,column]`, bare names such as `Q1` or `K1` are header labels,
not Excel coordinates. `@[:,Q1]` means the column whose header is `Q1`, not
column Q. `@[:,K1]` only works if a column is named `K1`; to select positional
column K, use `K:K` or `@[:,#11]`.

When authoring new formulas, put double quotes around **every named** sheet,
row, and column label, including one-word names: `@["Revenue","2026"]`,
`@["Sales Ledger"::["AC-1","Quantity"]]`. This uniform convention avoids
deciding which names require quotes. Bare names in existing formulas are valid;
structural `_`, `#n`, and `:` are not labels and stay unquoted.
For hierarchy, quote each path segment separately:
`@["Portfolio"."Product A","2026"]`, not `@[Portfolio.Product A,"2026"]`.
The dot joins path segments; `@["Portfolio.Product A","2026"]` is one literal
label, not the `Portfolio` → `Product A` path.

<critical_syntax_rule name="quoted-names-and-text">
MUST use double quotes for quoted sheet names, labels, and text literals.
Single-quoted names and strings are INVALID Ordinate syntax. Reject them; do
not write them to a workbook, even if they look familiar from Excel.
Any selector label containing spaces must be quoted as one segment:
`@["Unit cost",_]` is valid; `@[Unit cost,_]` is not.

<invalid>@['Sales Ledger'::["AC-1",Quantity]]</invalid>
<valid>@["Sales Ledger"::["AC-1",Quantity]]</valid>
</critical_syntax_rule>

<same_cell_references context="canonical_workbook">
In Plan, the 2026 Gross profit cell is B10. Its inputs are B5 (Total revenue =
1200) and B9 (Total cost of sales = 470). Any ONE of these complete formulas
produces 730 **in B10**:

- `= @["Total revenue",_] - @["Total cost of sales",_]` — named rows, current
  column: `_` means B here, because the formula is in column B.
- `= @["Total revenue","2026"] - @["Total cost of sales","2026"]` — both row
  and column are explicitly named.
- `= @[#5,_] - @[#9,_]` — fixed row positions, current column.
- `= B5 - B9` — positional A1 references to those same input cells.

In Sales Ledger, AC-1's Line total is D2. B2 holds Quantity 2 and C2 holds
Unit price 15. These likewise all produce 30 **in D2**:

- `= @[_,Quantity] * @[_,"Unit price"]` — current row, named columns: `_`
  means AC-1's row here.
- `= @["AC-1",Quantity] * @["AC-1","Unit price"]` — row and columns named.
- `= B2 * C2` — positional A1 references.

The alternatives agree at these particular cells, not under every edit. A
formula using `_` follows its own row or column when reused elsewhere;
explicit names keep targeting the named row or column; `#n` and A1 positions
can drift after direct text insertion or movement.
</same_cell_references>

Other useful forms:
- Preceding row in the current column: `@[_-1,_]`. In Inventory replenishment's
  Purchasing Summary, `Net available units` uses
  `= @[_-1,_] - @["Allocated units",_]`: its preceding row is
  `Available before allocation`, so inserting an unrelated row between them
  would change the meaning. For a forecast that grows
  the **same** product from 2026 to 2027, use `@[_,"2026"]` in the product's
  2027 cell, not `@[_-1,"2026"]` (the preceding product row).
- Position with copy behavior: `C2`, `$C$2`, `C$2`, `$C2`, or `@[#2,#3]`.
- Hierarchical: `@[Revenue.Service,"2026"]`.
- Cross-sheet: `@["Plan"::[Revenue.Equipment,"2026"]]`; use explicit selectors, not `_`.
- Inclusive reference range: `@["Net income","2026":"2028"]`, `B2:B3`.
- Whole data column: `@[:,Q1]` selects all data rows of column Q1; use
  `sum(@[:,Q1])` for a scalar total. Avoid placing that total in Q1 itself,
  which would include its own cell; select an explicit input range instead.

<syntax_contrasts context="canonical_workbook">
<contrast name="punctuation-in-a-row-label">
<invalid>@["Sales Ledger"::[AC-1,Quantity]]</invalid>
<valid>@["Sales Ledger"::["AC-1",Quantity]]</valid>
<reason>A hyphenated label must be quoted; quote both endpoints of a range.</reason>
</contrast>
<contrast name="row-before-column">
<invalid>@[Quantity,_]</invalid>
<valid>@[_,Quantity]</valid>
<reason>In Sales Ledger's Line total cells, `_` selects the current row; Quantity is a column.</reason>
</contrast>
<contrast name="horizontal-table-current-column">
<invalid>@[_,"Total revenue"]</invalid>
<valid>@["Total revenue",_]</valid>
<reason>In Plan's B10, Total revenue is the row B5; `_` in the second slot selects the current 2026 column. Check each selector against the table's row and column headers.</reason>
</contrast>
<contrast name="numeric-percentage-input">
<invalid>10%</invalid>
<valid>0.1 {:.0%}</valid>
<reason>A bare `10%` is text, not an arithmetic rate. Store numeric `0.1`; the optional display format renders it as 10% without changing its value.</reason>
</contrast>

For example, both Annual growth cells below display as `10%` through one row
default. Their stored values remain numeric `0.1`, so 2027 members evaluates
to `88`:

<percentage_input_example>
```ord
# Membership forecast

| @meta | | | |
| | Metric || 2026 | 2027 |
| --- | --- || --- | --- |
| | Members || 80 | = @["Members","2026"] * (1 + @["Annual growth","2027"]) |
| {:.0%} | Annual growth || 0.1 | 0.1 |
```
</percentage_input_example>

Replacing the 2027 `0.1` with bare `10%` makes it text; the formula then fails
at evaluation. Use a row default when a whole row shares one format, a column
default when a whole column does, and a cell suffix for an exception. Formatting
changes only the display, not the value. In the `@meta` frame above, the
header control cell (`| | Metric`) is empty: row defaults belong only beside
body rows, never beside a header row. A row-default control cell also requires
the `@meta` frame and its extra control column; do not prepend
`| {:.1%} |` to a row of an ordinary table.
For a whole report using this pattern, see the Operating Report in
[Getting started](references/worked-getting-started.md).

<contrast name="numeric-year-header">
<table_header>2026</table_header>
<preferred>@["Plan"::["Net income","2026"]]</preferred>
<also_valid>@["Plan"::["Net income",2026]]</also_valid>
<reason>Both select Plan's column named 2026. Quoting is a clarity convention, not a syntax requirement. The header itself stays unquoted. Do not confuse the label with an absolute index such as `#3`.</reason>
</contrast>
<contrast name="multiword-row-label">
<invalid>@["Plan"::[Net income,"2026"]]</invalid>
<valid>@["Plan"::["Net income","2026"]]</valid>
<reason>Quote the complete multiword row label, not just the year or sheet name.</reason>
</contrast>
<contrast name="cross-sheet-reference-envelope">
<invalid>@"Plan"::["Net income","2028"]</invalid>
<invalid>@[["Plan"::["Net income","2028"]]]</invalid>
<invalid>@[@["Plan"::["Net income","2028"]]]</invalid>
<valid>@["Plan"::["Net income","2028"]]</valid>
<reason>A cross-sheet reference has exactly one outer `@[...]`: the sheet name, `::`, then a two-axis `[row,column]` selector inside it. Do not omit or nest that outer envelope.</reason>
</contrast>
<contrast name="hierarchy-path">
<cell>Plan's B5 Total revenue sums the two indented accounts under Revenue.</cell>
<invalid>= @["Equipment",_] + @["Service",_]</invalid>
<valid>= @["Revenue"."Equipment",_] + @["Revenue"."Service",_]</valid>
<invalid>@["Plan"::[Equipment,"2026"]]</invalid>
<invalid>@["Plan"::["Revenue.Equipment","2026"]]</invalid>
<valid>@["Plan"::["Revenue"."Equipment","2026"]]</valid>
<reason>Equipment and Service are children under Revenue in Plan, not top-level rows. A bare child label fails to resolve even if it is currently unique and visible in the table; use its complete parent-to-child path in both same-sheet and cross-sheet formulas. Quote each path segment separately: the dot is structural, not part of one label. Omit the source `*` marker. Evaluate after writing formulas; validation alone cannot detect this unresolved reference.</reason>
</contrast>
<contrast name="nested-hierarchy-selector">
<cell>Plan's B5, the 2026 Total revenue cell; B3 is Equipment and B4 is Service.</cell>
<invalid>= @[@["Revenue"]."Equipment",_] + @[@["Revenue"]."Service",_]</invalid>
<valid>= @["Revenue"."Equipment",_] + @["Revenue"."Service",_]</valid>
<also_valid>= B3 + B4</also_valid>
<reason>The invalid formula nests `@[...]` inside another selector; `@["Revenue"]` is not a row-path segment, and evaluation rejects this as `invalid_reference_selector_syntax`. A hierarchical path has one outer `@[row,column]` and separately quoted parent and child labels joined by a dot. A1 targets the same cells in this stable layout and is a reasonable simpler choice when a path becomes cumbersome; recheck B3 and B4 after inserting or moving rows.</reason>
</contrast>
<contrast name="one-argument-for-max">
<invalid>max(@["Plan"::["Net income","2026"]], @["Plan"::["Net income","2028"]])</invalid>
<valid>max(@["Plan"::["Net income","2026":"2028"]])</valid>
<reason>Native max takes one array or view, not separate arguments.</reason>
</contrast>
<contrast name="self-reference">
<invalid>= @["Net income growth",_] * 2</invalid>
<valid>= @["Plan"::["Net income","2028"]] - @["Plan"::["Net income","2026"]]</valid>
<reason>In Review's Net income growth cell, `_` selects that formula's own column; the invalid expression refers to itself. Evaluate to detect cycles: validate alone cannot.</reason>
</contrast>
</syntax_contrasts>

A1 and `#n` coordinates are one-based semantic table coordinates, including
headers. Postfix brackets and CLI indexes are zero-based; their slice ends are
exclusive. In a table with one header row, `@[#1,_]` selects a header cell;
the first data row is `#2`. Markdown dividers and `@meta` controls do not
count as cells.
When directly editing text, use row/column names for business relationships:
`@[Revenue.Equipment,_]` still finds Equipment after another row is inserted above it;
`@[_,Quantity]` still finds Quantity after columns are reordered. Positional
`B2`/`#n` are also appropriate when the intended first, second, or other row
has a stable position; relative offsets such as `_-1` are appropriate when
adjacency itself is the dependency. Positional and relative references can
select a different target after a text insertion or move, so check them after
structural edits or preserve their targets with structured Core operations;
do not rewrite existing references merely for style.

Names must resolve uniquely: use full row paths for repeated labels, such as
`@["Operations"."Supplies",_]` versus `@["Administration"."Supplies",_]`.
Range endpoints are independent: `@[Revenue.Equipment:Revenue.Service,"2026"]`,
not `@[Revenue.Equipment:Service,"2026"]`; the second endpoint does not
inherit the parent.
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
= f"Gross profit: {B10:,.2f}"
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
suffixes. This complete `@meta` frame has a currency-like column default,
one bold row default, and a local percentage exception:

```ord
# Summary
| @meta | | {:,.2f} |
| | Item || Value |
| --- | --- || --- |
| | Revenue || 1234.5 |
| {::bold} | Profit || 300 |
| | Margin || = @[Profit,_] / @[Revenue,_] {:.1%} |
```

`@meta` is a nonsemantic frame: its top row sets column defaults, its left
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

When the user supplies an Excel `.xlsx`, CSV, or TSV file, prefer the import
capability to manually transcribing its cells. It uses the same Core conversion
as Ordinate's file import, preserves the source file, and reports unsupported
or lossy content. Import to a **new** `.ord` working file, inspect the resulting
headers and formulas, then edit that file. Import is not proof that translated
formulas produce the intended business results; evaluate and spot-check them.
The MCP tool `ordinate_import` exposes the same conversion for hosts using MCP.

```sh
ordinate-cli import source.xlsx --format xlsx --output working.ord --json
ordinate-cli import source.csv --format csv --options import-options.json --output working.ord --json
```

For that CSV command, `import-options.json` can contain
`{"sheetName":"Data","valueMode":"infer","headers":[{"sheetName":"Data","headerRows":1,"headerColumns":0}]}`.
CSV/TSV fields remain text unless `valueMode: "infer"` is explicitly chosen;
choose header rows/columns from the actual file, not a convention. XLSX import
rejects unsupported content by default; `unsupportedContent: "preserve-text"`
is an explicit lossy choice that requires reviewing its diagnostics. The
command never overwrites an existing output. Use `import --help` for options.

```sh
ordinate-cli inspect model.ord --sheet Plan --notes --json
ordinate-cli evaluate model.ord --json
ordinate-cli evaluate model.ord --sheet Plan --rows 9:10 --columns 1:2 --json
ordinate-cli edit --help --operation move_rows
```

Choose direct text editing for new tables, notes, formulas, and coherent bulk
authoring. Choose structured insert/move/duplicate/fill operations when Core
should preserve reference targets and presentation. Set explicit inputs with
`set_cell_input`/`set_region`; use default/local format and style operations for
presentation. Use the current workbook snapshot when it already shows the
needed headers, paths, and indexes; inspect when those facts are missing or
stale. Take exact payloads from the tested examples below for common
operations. Use `edit --help --operation NAME` only for an operation or detail
not covered here.
When adding a calculated column to an existing table, prefer one seed formula
plus `fill_region` in the same edit batch over repeating that formula in every
`set_cell_input` or `set_region` value. This is especially concise with `_`:
each filled cell refers to its own row/column without an A1-style number to
rewrite. A whole new table authored as text can still use direct editing.

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

For example, after inspecting the Plan sheet above, this batch changes 2026
Equipment revenue by name. Replace the revision token with the inspected revision, then
submit it via `ordinate-cli edit model.ord --operations - --write`:

```json
{
  "baseRevision": "REVISION_FROM_INSPECT",
  "operations": [
    {
      "op": "set_cell_input",
      "target": {
        "sheet": "Plan",
        "row": {"kind": "path", "path": ["Revenue", "Equipment"]},
        "column": {"kind": "label", "label": "2026"}
      },
      "input": "1000"
    }
  ]
}
```

Keep source text literal in the shell: `<<'JSON'` preserves dollar signs and
backticks inside formulas; unquoted shell input can change them before parsing.

<batch_row_example context="canonical_workbook Sales Ledger">
To append AC-5 with quantity 2 at unit price 18, insert a body row at gap `5`
after the header and four existing body rows. The next operation writes its
four cells as a `1 × 4` matrix; region bounds are end-exclusive. The note is
part of the same atomic request. Use the current revision from `inspect`.

```json
{
  "baseRevision": "REVISION_FROM_INSPECT",
  "operations": [
    {"op":"insert_row","sheet":"Sales Ledger","area":"body","rowGapIndex":5,"depth":0},
    {"op":"set_region","target":{"sheet":"Sales Ledger","rows":{"start":5,"end":6},"columns":{"start":0,"end":4}},"values":[["AC-5","2","18","= @[_,\"Quantity\"] * @[_,\"Unit price\"]"]]},
    {"op":"set_sheet_note","sheet":"Sales Ledger","position":"afterTable","markdown":"AC-5 was added after the original four items."}
  ]
}
```

The row label occupies column `0`; data start at column `1`. Keep matrix
dimensions equal to the target region. If the change is to an existing
rectangle, omit `insert_row` and use `set_region` directly. For a repeated
formula across many rows, use the one-seed `fill_region` batch below instead
of listing that formula in every matrix entry.
</batch_row_example>

<batch_column_example context="canonical_workbook Sales Ledger">
Suppose the complete Sales Ledger above needs a `Net after fee` column equal
to 95% of each row's Line total. After inspecting that sheet for its current
revision and dimensions, submit this **one** `edit --operations - --write`
request. The zero-based, end-exclusive row range `2:5` is AC-2 through AC-4;
row `1` is the seed AC-1. The new column is index `4` after Line total.

```json
{
  "baseRevision": "REVISION_FROM_INSPECT",
  "operations": [
    {"op":"insert_column","sheet":"Sales Ledger","colIndex":4},
    {"op":"set_cell_input","target":{"sheet":"Sales Ledger","row":{"kind":"index","index":0},"column":{"kind":"index","index":4}},"input":"Net after fee"},
    {"op":"set_cell_input","target":{"sheet":"Sales Ledger","row":{"kind":"index","index":1},"column":{"kind":"index","index":4}},"input":"= @[_,\"Line total\"] * 0.95"},
    {"op":"fill_region","source":{"sheet":"Sales Ledger","rows":{"start":1,"end":2},"columns":{"start":4,"end":5}},"target":{"sheet":"Sales Ledger","rows":{"start":2,"end":5},"columns":{"start":4,"end":5}},"mode":"copy"}
  ]
}
```

All four resulting cells use the same `= @[_,"Line total"] * 0.95` formula:
`_` binds to AC-1, AC-2, AC-3, or AC-4 in its own row. Repeating the formula as four
separate values in a `set_region` matrix or four `set_cell_input` operations is
unnecessary. `fill_region` materializes those per-cell inputs in the `.ord`
file; it is a batch editing operation, not a single shared array formula.
</batch_column_example>

<batch_edit_failure_contrasts context="canonical_workbook Sales Ledger">
<contrast name="format-in-cell-input">
<invalid>`set_cell_input` with `input: '= @[_,"Line total"] * 0.95 {:,.2f}'`</invalid>
<valid>`set_cell_input` with `input: '= @[_,"Line total"] * 0.95'`</valid>
<reason>The edit API's `input` contains only the cell value or formula, not a
serialized display suffix. Use a separate `set_cell_local_format` or
`set_column_default_format` operation for presentation; an existing local
format is preserved when changing only the input.</reason>
</contrast>
<contrast name="fill-gap-after-seed">
<invalid>`fill_region` from rows `1:2` to rows `3:5` in column `4`</invalid>
<valid>`fill_region` from rows `1:2` to rows `2:5` in column `4`</valid>
<reason>CLI bounds are zero-based and end-exclusive: row `2` immediately
follows the seed row `1`. The source and target must touch along the fill
axis and match on the other axis. A skipped row makes the whole edit batch
fail; seed each disjoint block separately or use `set_region`. Recheck staged
indexes after earlier insertions in the same batch.</reason>
</contrast>
</batch_edit_failure_contrasts>

For a completed workbook, run `evaluate --json` as the final check. If you want
to review computed results throughout an agent-owned working copy, use
`evaluate --write --json` instead, then read that copy with its refreshed
caches; this is one evaluation, not an extra pass. It performs
the same syntax and structure validation as `validate` first, then recalculates
every sheet and detects formula errors and cycles. A validation failure appears
in its diagnostics with nonzero exit status; do not run `validate` immediately
before `evaluate` on unchanged source. Use `validate` alone only for an interim
structure-only check while drafting. Successful `edit` does not imply successful
calculation.

Without `--sheet`, evaluation JSON contains status, summary, and diagnostics,
not every cell value. Add `--sheet` and narrow `--rows`/`--columns` to return
specific computed values; these options limit the response, not the calculation.
For example, the Plan command above selects B10 in the canonical workbook:
`result.data.selection.values[0][0]` is `{"kind":"number","value":"730"}`.
For a spot check, read that JSON value and compare it with the expected
business result. For a broader review, prefer the materialized working copy
over returning every cell in JSON; a file-writing JSON report contains the
write status and evaluation summary, not the full workbook source.
Zero formula errors alone does not prove the numbers are right. Check status
and `ok`, not just `error: null`. Evaluation ignores stored caches and does not
change the file by default; `evaluate --write` refreshes caches in the working
copy. Do not use it on the user's original file merely for inspection. Do not
invent caches or replace formulas with results.
If evaluation fails, repair from its diagnostics and rerun it; if you cannot
finish, report the remaining failure instead of claiming completion. An unknown
selector or function does not by itself prove the requested feature is unsupported.

Check business relationships too: in a disposable copy, change representative
inputs and confirm dependent results update while unrelated values stay intact.
Distinguish user-supplied assumptions from inferred ones. Report only checks
actually performed. This skill does not authorize installing tools, publishing
files, or changing unrelated agent configuration.
