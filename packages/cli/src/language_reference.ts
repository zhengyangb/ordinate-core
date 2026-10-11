import { ORD_FORMAT_VERSION, getStandardFunctionMetadata, listStandardFunctionMetadata, type FunctionMetadata } from "ordinate-core";

type Example = { source: string; sheet: string; checks: { row: number; column: number; kind: string; value: string }[] };
type Topic = { title: string; body: string; examples: Example[] };
const plan = (profit: string) => `# Plan\n| Item || Q1 | Q2 |\n| --- || --- | --- |\n| Revenue || 100 | 120 |\n| Costs || 40 | 50 |\n| Profit || ${profit} | = C2 - C3 |\n`;
const profitCheck = { row: 3, column: 1, kind: "number", value: "60" };
const example = (source: string, checks: Example["checks"], sheet = "Plan"): Example => ({
  source: `---\nord-format: "${ORD_FORMAT_VERSION}"\n---\n\n${source}`,
  sheet,
  checks,
});

// These are author-facing explanations, not another parser or function registry.
// Examples are exposed with the reference and exercised against the bundled Core.
const topics: Record<string, Topic> = {
  syntax: {
    title: "Workbook syntax",
    body: `An .ord workbook is UTF-8 text. Core writes ord-format: "${ORD_FORMAT_VERSION}" as
the first front-matter content line when serializing. This is the file format
version, not an App or CLI version. Directly authored source may omit the envelope;
the next Core serialization adds it. A # heading starts a sheet. Each sheet has
one pipe table and optional notes above/below it. Sheet names should be unique.
A divider row separates header rows from body rows. A doubled pipe || marks
the boundary between header columns (row labels) and data columns.
Prefix a child row label with *; use ** for its child. Indentation is structural,
not decorative. Do not leave a child without its parent.
Inside table cells, escape literal pipes as \\| and backslashes as \\\\.
Quote literal text that could be interpreted as a value or formula: "=1+2".
Empty cells are blank. Numbers, true/false, and ISO temporal literals are typed.
Ordinate is not arbitrary Markdown: use supported sheet notes, not another table
or arbitrary HTML inside a note. See help notes.

Coordinates refer to the semantic table. Markdown dividers and the @meta
frame are not cells. Formula A1/#1 coordinates are one-based; CLI indexes and
formula bracket indexes are zero-based. See help references and help formats.`,
    examples: [
      example(plan("= B2 - B3"), [profitCheck]),
      example(`# Operations\n| Item || 2025 | 2025 |\n| || H1 | H2 |\n| --- || --- | --- |\n| Revenue || | |\n| * Systems || 100 | 120 |\n| * Services || 40 | 50 |\n| Total || = @[Revenue.Systems,#2] + @[Revenue.Services,#2] | = @[Revenue.Systems,#3] + @[Revenue.Services,#3] |\n`, [
        { row: 5, column: 1, kind: "number", value: "140" },
        { row: 5, column: 2, kind: "number", value: "170" },
      ], "Operations"),
    ],
  },
  formulas: {
    title: "Formula expressions",
    body: `Start a formula cell with =. Use ordinary expressions, not Excel formulas:
arithmetic + - * / **, comparisons == != < <= > >=, and parentheses.
Use ** for powers, == for equality, and commas between function arguments.
Text literals use double quotes. Function names are case-insensitive; available
names and signatures come from help functions / help function <name>.

References: B2; @[Revenue,_]; @[:,Q1]; see help references.
Array literals: [1, 2, 3] is one-dimensional; [[1, 2, 3]] is a
two-dimensional 1-by-3 view. Neither spills into cells. A cell's final result
must be scalar: sum([1, 2, 3]) and sum([[1, 2, 3]]) return 6, while [1] alone
is not a cell result. shape(array) returns [length]; shape(view) returns
[rows, columns]. rowCount and columnCount require a view.
filter(values, mask) uses a boolean mask, not a lambda or Excel criteria string.
Binary arithmetic and comparisons align collection axes from the right. An
Array of length N aligns with the columns of an M-by-N View. Axis lengths must
match or be 1, and at least one operand must already have the result shape;
outer-product expansion is not supported. A single-cell reference is a 1-by-1
View and can compare directly with a column: @[:,Client] == @[_,Client].
Paired inputs to filter(values, mask) still require the same kind and shape.
Datetime subtraction produces an elapsed duration, including across midnight:
@[_,End] - @[_,Start]. duration takes components, not total seconds;
see help function duration for parameter limits.
min and max each take one view/array: max([0, amount]), not max(0, amount).
Text/view brackets are zero-based; negative indexes count from the end and
slices are end-exclusive: "Ordinate"[0:3] returns "Ord". Step slices are unsupported.
format(value, spec) and f"Profit: {B4:,.2f}" produce text; display metadata
such as {:.1%} changes presentation without changing the calculated value.

A cache may precede the formula: 60 = B2 - B3. Do not replace the expression
with its result or guess caches. evaluate recalculates; evaluate --write refreshes
caches explicitly. validate checks syntax/structure, not calculation or business
assumptions. Check evaluate too, and test changed inputs for dynamic models.`,
    examples: [example(plan("= B2 - B3"), [profitCheck]), example(`# Expressions\n| Example || Result |\n| --- || --- |\n| Power || = 2 ** 3 |\n| Slice || = "Ordinate"[0:3] |\n| Filter || = sum(filter([100, 120], [true, false])) |\n| Text || = f"Total: {sum([1, 2, 3]):.2f}" |\n| Nonnegative || = max([0, 10 - 20]) |\n`, [
      { row: 1, column: 1, kind: "number", value: "8" },
      { row: 2, column: 1, kind: "string", value: "Ord" },
      { row: 3, column: 1, kind: "number", value: "100" },
      { row: 4, column: 1, kind: "string", value: "Total: 6.00" },
      { row: 5, column: 1, kind: "number", value: "0" },
    ], "Expressions"), example(`# Sessions\n| Session || Client | Start | End | Hours | Client hours | Elapsed |\n| --- || --- | --- | --- | --- | --- | --- |\n| First || Atlas | 2027-02-15T23:00:00Z | 2027-02-16T01:30:00Z | 2.5 | = sum(filter(@[:,Hours], @[:,Client] == @[_,Client])) | = @[_,End] - @[_,Start] |\n| Second || Beacon | 2027-02-16T09:00:00Z | 2027-02-16T10:00:00Z | 1 | = sum(filter(@[:,Hours], @[:,Client] == @[_,Client])) | = @[_,End] - @[_,Start] |\n`, [
      { row: 1, column: 5, kind: "number", value: "2.5" },
      { row: 2, column: 5, kind: "number", value: "1" },
      { row: 1, column: 6, kind: "duration", value: "PT2H30M" },
    ], "Sessions")],
  },
  references: {
    title: "References and coordinates",
    body: `Spreadsheet references: C2, $C$2, C$2, $C2, C2:D3, C:C.
Ordinate references: @[row-selector,column-selector], row first, column second.
Excel A1 notation puts the column first: C2 is @[#2,#3], not @[#3,#2].
Inside @[row,column], bare names such as Q1 or K1 are header labels,
not Excel coordinates. @[:,Q1] selects the column whose header is Q1,
not positional column Q. @[:,K1] requires a column named K1; it does not
select column K or cell K1. For positional column K, use K:K or @[:,#11].
@[Revenue,Q1] selects labels; @[Revenue,_] uses the formula's current column.
@[_,Quantity] instead uses the current row and the column named Quantity.
For a vertical ledger, a line total is @[_,Quantity] * @[_,"Unit price"].
@[Quantity,_] looks for a row named Quantity, not the Quantity column.
Use double quotes (not single quotes) for labels/sheet names with spaces or punctuation.
For example, @["Products"::["AC-1",Price]]; a hyphenated range needs quoted
endpoints too: @["Products"::["AC-1":"AC-3",Price]].
@[_-1,_] means the preceding row in the current column.
@[#2,#3] selects semantic row 2, column 3 (one-based), the same cell as C2.
@["Cost of sales"."Materials",_] selects a hierarchical row path.
Quote labels with spaces/punctuation and quote numeric labels when needed.
Header label text is literal: write 2026 in the table, but "2026" in a selector;
quotes in the header itself become part of its name. Multi-row headers form
column paths: with 2026 above Forecast, use @[Revenue,"2026".Forecast],
not @[Revenue,"2026"]. A leaf label alone works only when unique.
Cross-sheet: @["Plan"::[Revenue,Q1]]. Sheet selectors use exact names;
use explicit row/column selectors, not _ in a sheet-qualified reference.

: selects a whole axis; label ranges have inclusive endpoints:
@[:,Q1], @[Revenue:Costs,Q1], sum(B2:B3).
Range endpoints are independent: @[Costs.Materials:Costs.Labor,Q1], not
@[Costs.Materials:Labor,Q1]; the second endpoint does not inherit the parent.
@[:,Q1] is a view of all data rows in column Q1; sum(@[:,Q1]) is a scalar.
Do not place that whole-column total in Q1 itself: it would include its own cell.
Whole-axis views exclude header surfaces and structural group rows by default.
Postfix brackets instead use zero-based, end-exclusive indexes: view[0], view[0:2].
CLI JSON row indexes/region bounds are also zero-based, with exclusive end.
Do not confuse these systems. CLI selectors are JSON, not formula syntax:
row {"kind":"path","path":["Cost of sales","Materials"]};
column {"kind":"label","label":"Q1"}.

For direct text editing, prefer named selectors for business relationships:
@[Revenue,_] tracks the Revenue row; @[_,Quantity] tracks the Quantity column.
They avoid position drift from unrelated row/column insertions and reordering
while names/paths stay unique and the formula remains in the intended context.
B2/#n and relative offsets can point elsewhere after direct text edits;
use them when position/adjacency is intended, not as a substitute for known labels.
Use full hierarchical row paths for repeated labels. Direct label/sheet renames
or parent changes require updating references; unresolved names fail evaluation.
Named ranges select the rows/columns between their endpoints, so newly inserted
members can affect a total. Use explicit named cells when you mean an exact set.
For insert/move/duplicate/fill, structured edit operations apply Core's reference
rules. Directly rearranging text does not invoke those rules. Reread the affected
source/table inspection after structural changes; do not choose new targets from
an outdated layout or an operation log alone.`,
    examples: [
      example(plan("= @[Revenue,_] - @[Costs,_]"), [profitCheck]),
      example(`# Coordinates\n| Item || Q1 | Q2 | Result |\n| --- || --- | --- | --- |\n| North || 10 | 120 | = C2 |\n| South || 20 | 50 | = @[#2,#3] |\n| Q1 total || | | = sum(@[:,Q1]) |\n`, [
        { row: 1, column: 3, kind: "number", value: "120" },
        { row: 2, column: 3, kind: "number", value: "120" },
        { row: 3, column: 3, kind: "number", value: "30" },
      ], "Coordinates"),
      example(`# Ledger\n| Order || Quantity | Unit price | Line total |\n| --- || --- | --- | --- |\n| North || 2 | 15 | = @[_,Quantity] * @[_,"Unit price"] |\n| South || 3 | 20 | = @[_,Quantity] * @[_,"Unit price"] |\n`, [
        { row: 1, column: 3, kind: "number", value: "30" },
        { row: 2, column: 3, kind: "number", value: "60" },
      ], "Ledger"),
      example(`# Years\n| Item || 2026 | 2027 |\n| Basis || Forecast | Forecast |\n| --- || --- | --- |\n| Revenue || 10 | 20 |\n| Check || = @[Revenue,"2026".Forecast] | = @[Revenue,"2027".Forecast] |\n`, [
        { row: 3, column: 1, kind: "number", value: "10" },
        { row: 3, column: 2, kind: "number", value: "20" },
      ], "Years"),
      example(plan("= @[\"Plan\"::[Revenue,Q1]] - B3"), [profitCheck]),
      example(`# Products\n| SKU || Price |\n| --- || --- |\n| AC-1 || 25 |\n| AC-3 || 40 |\n\n# Orders\n| Order || SKU | Price |\n| --- || --- | --- |\n| O01 || AC-1 | = lookup(@[_,SKU], @["Products"::["AC-1":"AC-3",SKU]], @["Products"::["AC-1":"AC-3",Price]]) |\n| Catalog total || | = sum(@["Products"::["AC-1":"AC-3",Price]]) |\n`, [
        { row: 1, column: 2, kind: "number", value: "25" },
        { row: 2, column: 2, kind: "number", value: "65" },
      ], "Orders"),
    ],
  },
  formats: {
    title: "Display formats and styles",
    body: `Display formats do not change values. Native formats are not Excel codes.
Local cell suffixes: 1234.5 {:,.2f}; 0.583 {:.1%}; 42 {:d}; 1000 {:.2e}.
Numeric types: f fixed decimals, e scientific, % percentage, d integer.
Comma enables grouping; + requests a plus sign; () requests negative parentheses
(for example {:(),.2f}). Integer d rejects precision; scientific e rejects grouping.
Temporal suffixes: {:%Y-%m-%d}, {:%H:%M:%S}, {:%F %T%:z}.
Duration totals: {:%[h] hr}; %[h] is total hours, %H is the wrapped hour field.
Supported directives: %% %Y %m %d %H %M %S %f %z %:z %F %T
and %[d] %[h] %[m] %[s] %[ms]. Offset directives require an offset-qualified value.
Locale names/timezone names are not temporal pattern directives. Unsupported
patterns or combinations fail; an accepted pattern must still suit its value.

Styles use a separate suffix: {::bold}, {::normal}, {::>}, {::<}, {::^},
{::red}, {::green}, {::blue}; multiple style axes may share one block.
For data cells, precedence is cell > row > column > automatic. Style axes
inherit independently; a numeric/temporal format is one atomic specification.
Header surfaces do not inherit body-cell presentation.

@meta is a metadata frame, not an extra logical row/column. Its top row
holds column defaults; its left control column holds body-row defaults. These
control cells contain metadata only, never values/formulas. Use defaults when
an entire data row/column shares presentation; use local suffixes for exceptions.

Structured edit uses Core JSON fields instead of suffix text. Percentage:
{"kind":"numeric","sign":"default","padWidth":null,"grouping":false,"precision":1,"type":"%"}
Date: {"kind":"temporal","pattern":"%Y-%m-%d"}
Style patch: {"weight":"bold","align":"right"}. Omitted axes stay unchanged;
null clears an axis. Use clear_*_format to remove a format and inherit again.
Exact payload schema: edit --help --operation set_column_default_format
or edit --help --operation set_cell_local_style.`,
    examples: [example(`# Plan\n| @meta | | {:,.2f} |\n| | Item || Value |\n| --- | --- || --- |\n| | Revenue || 1234.5 |\n| {::bold} | Margin || 0.583 {:.1%} |\n| | Date || 2026-01-02 {:%Y-%m-%d} |\n| | Elapsed || PT26H {:%[h] hr} |\n`, [
      { row: 1, column: 1, kind: "number", value: "1234.5" },
      { row: 2, column: 1, kind: "number", value: "0.583" },
    ])],
  },
  notes: {
    title: "Sheet notes",
    body: `Notes sit above or below the sheet's single table. Supported Markdown:
paragraphs, **bold**, *italic*, flat unordered and ordered lists, and thematic
separators. Ordered markers may use 1. or 1); start numbers are preserved and
display numbering increments. List items occupy a single nonempty source line.
Separate paragraphs with a blank line. A single soft newline within a paragraph
normalizes to a space; Markdown hard line breaks are unsupported.
A thematic separator (three or more
hyphens) may be presented as a column boundary by the editor; it is still a
separator in source. Escape a literal pipe as \\| to avoid table detection.
Nested lists, arbitrary HTML, links and code blocks are not supported
note constructs. Use literal escaped text when that is the intended content.
CLI validates source; it does not silently convert unsupported Markdown into
a supported note. In structured edit, use set_sheet_note and its exact schema.`,
    examples: [example(plan("= B2 - B3") + "\n**Review:** amounts are dollars.\n\n1. Check revenue assumptions.\n2. Update costs before approval.\n\n-----\n\nLiteral pipe: \\|.\n", [profitCheck])],
  },
};

export class LanguageReferenceError extends Error {}
type Reference = (Topic & { topic: string }) | { topic: "function"; title: string; function: FunctionMetadata } | { topic: "functions"; title: string; functions: FunctionMetadata[] };
export function languageReference(operands: string[]): Reference {
  const [topic, name] = operands;
  if (!topic) return { topic: "index", title: "Language reference", body: "Read-only reference; no workbook or network access.\nUsage: ordinate-cli help <topic> [--json]\nTopics: syntax, formulas, references, formats, notes, functions\nFunction detail: ordinate-cli help function <name> [--json]\nWorkflow skill: packages/cli/skills/ordinate-authoring/SKILL.md (in this repository); skills/ordinate-authoring/SKILL.md (in the CLI package).", examples: [] as Example[] };
  if (topic === "function") {
    if (operands.length !== 2) throw new LanguageReferenceError("Use ordinate-cli help function <name>.");
    const metadata = getStandardFunctionMetadata(name);
    if (!metadata) throw new LanguageReferenceError(`Unknown function '${name}'. Use ordinate-cli help functions.`);
    return { topic, title: metadata.name, function: metadata };
  }
  if (operands.length !== 1) throw new LanguageReferenceError("Supply one topic, or function <name>.");
  if (topic === "functions") return { topic, title: "Standard functions", functions: listStandardFunctionMetadata() };
  if (!Object.hasOwn(topics, topic)) throw new LanguageReferenceError(`Unknown topic '${topic}'. Run ordinate-cli help.`);
  return { topic, ...topics[topic] };
}
function describeFunction(fn: FunctionMetadata): string {
  return `${fn.name} (${fn.category})${fn.aliases?.length ? ` — aliases: ${fn.aliases.join(", ")}` : ""}\n${fn.summary}\n${fn.signatures.map(s => `  ${fn.name}(${s.parameters.map(p => `${p.name}: ${p.type}`).join(", ")}) -> ${s.returns}\n${s.parameters.map(p => `    ${p.name}: ${p.summary}`).join("\n")}`).join("\n")}\nExamples:\n${fn.examples.map(e => `  ${e.expression}${e.result === undefined ? "" : ` -> ${e.result}`}`).join("\n")}\n`;
}
export function renderLanguageReference(ref: Reference): string {
  if ("function" in ref) return describeFunction(ref.function);
  if ("functions" in ref) return `${ref.title}\n\n${ref.functions.map(fn => `${fn.name.padEnd(22)} ${fn.category.padEnd(12)} ${fn.summary}`).join("\n")}\n\nDetails: ordinate-cli help function <name>\n`;
  return `${ref.title}\n\n${ref.body}\n${ref.examples.map(e => `\nExample workbook:\n${e.source}`).join("")}`;
}
