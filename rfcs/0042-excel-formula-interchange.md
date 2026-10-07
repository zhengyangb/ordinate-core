# RFC-0042: Excel Workbook and Formula Interchange

- Status: Implemented — directional core profile; readable-export policy revised 2026-10-03; shared statistical/financial/view rules added 2026-10-05
- Extends: RFC-0006, RFC-0011, RFC-0013, RFC-0036, RFC-0041
- Scope: TypeScript core library; .xlsx, not legacy .xls or macros
- Host interaction: [Spreadsheet import and export](../apps/ordinate-app/docs/features/spreadsheet-interchange.md)

## Objective and priority

Export editable, recognizable Excel formulas. Preserve the user's operation,
expression structure and referenced cells before trying to reproduce every
Ordinate evaluation rule. Excel evaluates the resulting workbook using its own
coercion, blank, error, rounding and comparison rules. Different results at those
boundaries are accepted and disclosed.

This deliberately replaces the previous requirement to emulate the native
evaluator inside every exported formula. That requirement generated unreadable
type/error guards, LET conversion programs and INDIRECT address interpreters.
Equal current results are not sufficient evidence of a good export.

“Preserve intent” does not mean full semantic equivalence between languages.
It means preserving the recognizable operation and reference relationships,
with explicitly documented target-language differences.

## Architecture

1. The workbook adapter owns XLSX container IO and third-party types.
2. An isolated Excel lexer/parser handles imported formula syntax.
3. Export consumes the existing native AST and reference resolver; it does not
   parse native formula strings again or change the native evaluator.
4. Import translates its independent supported profile to ordinary native
   expressions, then uses the existing parser and document constructor.
5. Registries classify every native function in both directions. Adding a native
   function without an inbound and outbound decision fails a test. Import has an
   executable dispatch manifest with an exhaustive rule union, not a same-name
   fallback. An inbound decision may be translated, helper-only, or unsupported.
   Unsupported does not mean the native function stops working.

The XLSX codec loads only when Excel IO is used. Public APIs exchange documents
and byte arrays, not file paths, dialogs, browser state or ExcelJS types. Native
documents, serialization, editing and evaluation remain the single source of truth.

## Public contract

`importExcelWorkbook(bytes, options)` returns a DocumentState result.
`exportExcelWorkbook(document, options)` returns a Uint8Array result.
Both use discriminated `ok` results and structured diagnostics: stable code,
severity, message, sheet/cell and source formula when relevant.

Fatal failure returns no partial document/file. Known unsupported conversions,
invalid inputs and resource violations are diagnostic failures; programmer
invariant failures are not disguised as compatibility errors. Export operates
on a clone and never mutates source cells, bindings or evaluation state.

All sheets participate so cross-sheet targets remain available. There is no
whole-workbook values-only mode. Supported formulas are actual formula cells, **without
Ordinate result caches**: native values could contradict Excel's eventual result.
The workbook requests full recalculation on load. A reader that does not calculate
formulas may initially show no result. Import uses formula source even with
missing, stale or poisoned caches.

### Explicit blank-cell policy

`cellErrors: "reject"` is the core default: an unsupported cell conversion fails
the operation. It does not require evaluator parity for supported formulas.
An executable translated formula may itself produce a target-language error.

`cellErrors: "blank"` is the web/desktop export policy. Runtime-error cells,
invalid inputs and cell-local unsupported/unrepresentable conversions become
empty cells; each omission has a located `cell_omitted` warning. Other cells,
rows and sheets still export. Dependents already evaluating to errors are also
blanked. Retained formulas may change after an input is omitted.

This is explicit lossy conversion, not generic exception recovery. Workbook
name/structure problems, invalid options, resource limits, encoding/write errors
and invariant violations remain fatal. Unsupported formulas never silently become
cached values, literal formula strings or zero. Import is atomic; its explicit
text-preserving policy is described below.

### Explicit calculated-value projection

`unsupportedFormulas: "reject" | "value"` is independent of `cellErrors`. The
core defaults to `reject`. The shared export review offers a whole-row **Keep
unsupported formula results** choice, initially selected. With `value`, only a
valid formula rejected with `unsupported_formula` or an unrepresentable formula
operand and successfully evaluated on the immutable export snapshot becomes a
literal. Each such cell has a located
`formula_exported_as_value` warning: the original formula is no longer editable
or recalculated in Excel. Supported formulas and their downstream references
remain formulas, without caches. Deselecting the choice restores the host's
explicit blank-cell loss policy for unsupported formulas.

This is a boundary projection, not a new evaluator/cache assumption. Imported
cached values are never consulted. Invalid syntax, failed evaluation, non-finite
or otherwise unrepresentable values, resource limits and invariant errors never
masquerade as successful calculated answers. Null projects to an empty cell with
its existing null/blank distinction warning. A value Excel cannot represent
remains a declared failure/omission; this option does not invent a replacement.

### Explicit text-preserving import policy

`unsupportedContent: "reject"` remains the core default. The web/desktop preview
uses `unsupportedContent: "preserve-text"` to prepare a candidate, not adopt it.
The review requires explicit consent if formulas were preserved as text, external
data links removed, or other import content omitted. Changing header settings
invalidates consent; cancel/back/reopen never reuses it.

Under this policy, formula syntax/profile/reference failures are cell-local:
store the exact original Excel formula with a leading `=` as an ordinary quoted
string literal. `TODAY()` becomes the string `=TODAY()`, not an unknown native
function, a cached result, or text annotated with extra prose. Preserve source
spelling, arguments and `$` locks. Do not apply a numeric/date format to that
string. The located `formula_preserved_as_text` warning explains why it could
not translate and that dependent results may change. Supported formulas remain
executable; errors in their results remain visible. XLSX re-export keeps these
strings inert. CSV formula-like-text security still applies.

Named definitions may be discarded with `import_content_omitted` warnings;
their unresolved formula uses follow the same text policy. External workbook
links and refreshable data connections are removed from a detached, sanitized
package before decoder loading. No relationship target is read or fetched.
The original file is unchanged. Compatibility import also removes macros, OLE
attachments, ActiveX controls and non-hyperlink external relationships, including
unrecognized external relationship types. Remove their package parts, declarations
and owner references together; normalize macro-enabled XML workbook declarations
to a plain workbook. These features are omitted, not retained as opaque executable
payloads in ORD. Report losses and require confirmation before adoption. Local
worksheet data remains importable even if another worksheet is external-only.
Invalid XML/ZIP, no remaining local worksheets, resource exhaustion and
implementation errors remain fatal. The sanitized archive passes strict preflight
again before the workbook decoder receives it.

In text-preserving mode, value-free trailing cells, rows, column spans and merge
extents may be omitted with a notice before allocating the native dense grid.
Real values, typed empty strings and formula cells determine the data rectangle.
Keep their coordinates; do not compact internal gaps or silently truncate data.
Resource checks still bound original expanded bytes, entry and serialized-cell
counts, and the resulting rectangle. The default is 1,000,000 cell positions
across the workbook; callers may explicitly override `limits.maxCells` subject
to their own memory budget. Real far-right formulas cannot be trimmed as styling.

Future support belongs in the Excel adapter and its bidirectional compatibility
tests. No Excel-only nodes or fallback calls are added to native representation.
Already saved text is never automatically reactivated; reimport the original file
to take advantage of a newly supported translation.

Successful conversion with warnings is prepared, not saved. Hosts show a short
warning list and require an explicit Export action before saving/downloading.
No-warning exports need no additional confirmation. The confirmed bytes must be
the same prepared snapshot, not a second conversion of possibly changed content.

## Readable export rules

Use a small, direct target expression when one represents the intended operation.
Do not inject a runtime type-dispatch or error-propagation program around it.
Necessary address/index convention conversions are distinct from emulating an
entire evaluator.

| Native operation | Excel output | Policy |
| --- | --- | --- |
| `A1+B1` | `A1+B1` | Remains addition, regardless of current cell values |
| `A1-B1`, `A1*B1`, `A1/B1` | Same operators | Excel coercion/errors |
| `A1**B1` | `A1^B1` | Preserve grouping, including unary negation |
| `A1==B1`, `A1!=B1` | `A1=B1`, `A1<>B1` | Excel comparison/collation |
| `text(A1)+text(B1)` | `A1&B1` | Explicit concatenation intent |
| `"Revenue: "+text(B2)` | `"Revenue: "&B2` | No redundant conversion wrappers |
| `number(A1)` | `VALUE(A1)` | Excel's conversion grammar/locale |
| `boolean(A1)` | `A1<>0` | Target truth conversion |
| `text(A1)` | `A1&""` | Target text conversion |
| `sum(A1:B2)` | `SUM(A1:B2)` | Same selected cells, target aggregate rules |
| `round(-1.5,0)` | `ROUND(-1.5,0)` | Excel -2 versus native -1 is allowed |
| `mod(-7,3)` | `MOD(-7,3)` | Excel 2 versus native -1 is allowed |
| `if(A1>0,"yes","no")` | `IF(A1>0,"yes","no")` | Preserve branches |
| `contains(A1,"*")` | `ISNUMBER(FIND("*",A1))` | Literal case-sensitive search, not wildcard search |
| `replace(A1,"a","b")` | `SUBSTITUTE(A1,"a","b")` | Text replacement, target edge cases |
| `index(A1:B2,0,1)` | `INDEX(A1:B2,1,2)` | Convert zero-based coordinates |
| `pmt(A1,B1,C1)` | `PMT(A1,B1,C1)` | No generated native argument validators |

Concatenation is selected by syntax-derived text intent (literals, text-returning
functions and their expressions), never by evaluating referenced cells or inspecting
cached values. An unknown reference plus another reference remains `+`.
Changing cell contents must not change the exported operator. Existing explicit
IF/ISERROR logic in the user's AST remains present; the prohibition is on injecting
it to defend every ordinary operation.

Keep enough parentheses to preserve grouping and precedence, especially power,
unary negation, right operands and comparisons. Escape Excel string literals and
sheet names correctly. No algebraic flattening that changes expression grouping.

### Function profile

- Aggregates: SUM, PRODUCT, AVERAGE, MIN, MAX, SUMSQ, COUNT, COUNTA, COUNTBLANK.
- Conditions/logical/predicates: IF, AND, OR, NOT, ISNUMBER, ISTEXT, ISLOGICAL,
  ISBLANK, ISERROR. Target eager/lazy and error behavior applies.
- Numeric: ABS, SIGN, SQRT, INT (floor), CEILING(x,1), POWER, MOD, PI, ROUND,
  ROUNDUP, ROUNDDOWN, TRUNC.
- Text: LOWER, UPPER, LEN, literal contains/startsWith/endsWith, SUBSTITUTE,
  slice via MID. Negative/end-relative slice normalization is necessary coordinate
  conversion; no generated integer/type validation. Unicode conventions can differ.
- Statistics: MEDIAN, PERCENTILE.INC, QUARTILE.INC, VAR.S/VAR.P,
  STDEV.S/STDEV.P, AVEDEV, DEVSQ, GEOMEAN, HARMEAN, LARGE/SMALL,
  RANK.EQ, MODE.SNGL, CORREL, COVARIANCE.S/COVARIANCE.P, SLOPE,
  INTERCEPT, FORECAST.LINEAR and STANDARDIZE. Import accepts the corresponding
  legacy names. Inclusive percentile/quartile and competition rank are explicit;
  exclusive percentiles and average-tie ranks are not silently substituted.
- Finance: all 21 native operations map to Excel: FV, PV, PMT, NPER, RATE,
  IPMT, PPMT, CUMIPMT, CUMPRINC, ISPMT, NPV, IRR, MIRR, XNPV, XIRR,
  EFFECT, NOMINAL, SLN, SYD, DB and DDB. Preserve argument order/defaults;
  supply the native default payment type when exporting five-argument cumulative
  payments. Native deterministic root solving is not Excel's initial-guess
  solver. Explicit imported guess arguments are unsupported, never ignored.
  Report the solver difference in both directions.
- TEXTJOIN maps to native join plus explicit text conversion. A constant
  ignore_empty flag can request filtering empty strings; this expresses the
  source operation, not defensive coercion. Native join exports with FALSE to
  retain empty strings. Native trim remains Unicode edge trimming and is not
  mapped to Excel's interior-space-compressing TRIM.
- Exact MATCH converts one-based/zero-based positions. INDEX of MATCH emits
  a direct INDEX/MATCH without duplicate position conversions. Exact forward
  XLOOKUP maps to lookup; approximate/reverse lookup and if_not_found options
  are unsupported. dotProduct maps to two-vector SUMPRODUCT.
- VLOOKUP with explicit FALSE/0 and a constant integer return-column position
  projects a finite source rectangle into two vectors and calls native lookup.
  Keep A1 coordinates, both endpoint copy locks and cross-sheet identity. Do not
  expand it into filter/map, coercion or error guards. Omitted/TRUE or dynamic
  match modes and dynamic return columns remain located compatibility failures;
  out-of-range constant columns remain visible reference errors. Known literal
  wildcard keys are unsupported. Report native strict/case-sensitive equality
  explicitly rather than claiming Excel case-insensitive/wildcard equivalence.
  Export the existing lookup operation as exact forward XLOOKUP; round-trip
  operation/value preservation does not require retaining the VLOOKUP spelling.
- One-dimensional FILTER is supported as an intermediate view, not a spilled
  cell result. Native filter flattens to a row vector; export transposes a column
  FILTER to preserve that shape. Dynamic cardinality is tracked explicitly and
  must not pass scalar-context checks. INDEX of such an imported view requires
  a positive constant or exact MATCH. TAKE/DROP operate on rows of matrices or
  the single axis of vectors; horizontal Excel vectors use the columns slot.
  Import does not silently reinterpret a two-axis selection as one-axis.
- Views: supported scalar INDEX/bracket indexing and ROWS/COLUMNS/size/shape.
  Zero-based and negative indices need coordinate conversion. Reference slices
  with integer-literal bounds (including negative/omitted bounds and nested
  slices) reuse native indexing to select addresses, then emit direct A1 ranges
  or exact sparse areas. End bounds are exclusive; native clipping applies.
  For example `sum(@[#2:#3,Revenue][0:2])` becomes `SUM($B2:$B3)` when
  Revenue is column B. No cell values are evaluated to specialize the formula.
  Empty selections, dynamic slice bounds, slices of computed/temporary views,
  whole-result multi-cell values and incompatible view shapes remain unsupported.
- Temporal export follows the explicit calendar/clock projection below. Other
  registry-listed unsupported operations fail explicitly. No same-name
  passthrough for unimplemented functions.

## References, locks and selection membership

Resolve every reference through native bindings at export time. Emit direct A1
addresses and ranges, not INDIRECT, OFFSET or runtime string construction merely
to mimic native editing behavior.

- Ordinary coordinates preserve their relative/copy-fixed axes.
- Named row/column axes become copy-fixed Excel axes. For example a named row
  with current column can become `B$4`; both named axes can become `$B$4`.
- Current/offset axes resolve to current A1 positions and remain relative.
- Native fixed-position `#n!` resolves to a copy-fixed `$n` address. Subsequent
  Excel structural edits follow Excel's rules, not Ordinate's fixed-position rule.
- Cross-sheet names are escaped and refer to the actual exported target sheet.
- Whole-axis/dynamic selections are materialized to the exported sheet extent.

Selection membership is not negotiable: never replace a noncontiguous selection
with a bounding rectangle that includes unrelated cells or parent totals.
Aggregates can use multiple exact rectangular areas. Other supported consumers
use a bounded CHOOSE array. Respect Excel's argument/array limits.

Native `#n!` and copy locks are distinct. The native optional `copyFixed`
property introduced with this RFC remains unchanged: `#n$` / `$A$1` locks
copy/fill while tracking structural identity; `#n!` fixes position. Native
serialization preserves each endpoint and axis. This replaces RFC-0013's
illustrative equivalence, not the existing fixed-position behavior. Export
simplification must not alter the native parser, reference model or fill planner.

## Import remains directional

Import and export need not be inverse operations. A supported import stays useful
even if its translated native expression cannot be re-exported. Likewise a
supported exported target function can be outside the import profile.

Import follows the same readability contract as export: preserve the operation,
operand order, selected coordinates and copy locks, then use the target runtime's
calculation rules. Do not synthesize blank/type/error guards, range filters or
coercion trees to reproduce Excel's results. A supported operation can produce a
different result for text, booleans, blanks, rounding or domain boundaries; report
that difference rather than building an Excel emulator in the formula text.

Use A1 spelling by default, including `$A$1`, `A$1` and `$A1`. These locks remain
copy/fill locks, NOT native fixed-position selectors (`#n!`). Cross-sheet A1 uses
the existing sheet-qualified reference envelope, e.g. `@["Inputs"::$A$1]`.
Header detection does not rewrite positional references into label references.
Array expressions accept A1 operands using the shared reference parser;
index-axis numeric slices keep their existing syntax. Grouped/call expressions
within index axes can contain A1 references without confusing slice colons with
whole-row references. No additional reference representation or evaluator mode
is introduced.

Examples:
- `A1+B1` → `A1 + B1`
- `SUM(A1:A8)` → `sum(A1:A8)`
- `MIN(A1,B1)` → `min([A1, B1])`
- `IF(A1="","",A1)` → `if(text(A1) == "", "", A1)`
- `A1&B1` → `text(A1) + text(B1)`

### Narrow source-semantic conversions

Two syntax-directed exceptions preserve the source operation without introducing
an Excel evaluator or defensive formula scaffolding:

1. For Excel binary `+` only, an operand statically known to return text gets an
   ordinary `number(...)` conversion. `"1"+"2"` becomes
   `number("1") + number("2")`; `LEFT(A1,1)+2` becomes
   `number(slice(A1, 0, 1)) + 2`. Numeric operands stay unwrapped. Unknown
   references such as `A1+B1` stay unchanged: do not sample current cell values,
   infer permanent types from them, or wrap every reference. Excel `&` retains
   concatenation; imported literal cell text and native `+` semantics are unchanged.
   Invalid numeric text produces the native conversion error, never a fallback
   to concatenation, zero or a cached result. Native number parsing is not Excel's
   full locale-dependent conversion grammar.
2. For Excel `=`/`<>` only, when either source operand is the literal `""`,
   convert non-text operands with existing `text(...)` before comparison.
   `A1=""` becomes `text(A1) == ""`; `""<>A1` becomes `"" != text(A1)`.
   This treats blank and empty text alike, but keeps zero, false, whitespace and
   native null distinct from empty text. Errors propagate through the conversion.
   Nonempty text comparisons, ordering, ISBLANK and comparisons to computed
   empty strings do not acquire this rule. Existing view shape rules remain;
   conversion over a view uses the native element-wise conversion.

These rules apply at the binary-operator boundary, not in IF/CUMIPMT or other
function-specific patches. Scope is determined by source syntax and static
expression domains only. They introduce no functions, truthiness, native type
changes, speculative type checks, generated IF/IFERROR guards, swallowed errors,
or recursive coercion trees. Broader compatibility requires an explicit separate
design; it must not expand these exceptions implicitly.

Explicit concatenation stays concatenation when inputs change type. Source IFERROR
retains its error handling; none is invented for other operations. Multiple
aggregate ranges require native reductions because native aggregates accept one
view. Variadic statistical and NPV calls accept one range or multiple scalar
arguments. Combining multiple ranges needs a native view-concatenation feature;
do not average medians or independently discount range segments. TEXTJOIN has
the same multi-range restriction. Financial and rounding functions map directly.

A single executable signature manifest supplies native/Excel names, aliases,
scalar/view/vector/date argument kinds, arity and meaningful defaults to both
directions. Registry coverage still requires a decision for every native function;
there is no generic same-name fallback. Finance is already present in the native
runtime: this profile extends adapters, not a second calculation engine.
XLSX future functions use their required `_xlfn.` file spelling (FILTER additionally
uses `_xlws.`), per Microsoft MS-XLSX §2.2.3; the importer consumes these namespaces
before dispatch. They are file encoding, never prefixes in native formulas.

Necessary coordinate/unit conversions remain: text offsets, INDEX's one-based
positions and zero-axis selection, and Excel serial dates versus native dates.
INDEX bounds checks prevent native slice clamping/negative indexing from selecting
different cells; they are selection translation, not type coercion. Unsupported
forms fail explicitly. Saved formula results never replace executable formulas.
Import/export are still directional and do not promise lossless round-tripping.

XML parts are validated as UTF-8 or BOM/signature-identified UTF-16, including
custom XML. Invalid encoding still fails. Reserved filter/print names are
presentation metadata and may be omitted with a notice; user-defined formula
names referring to fixed, sheet-qualified ranges or scalar constants resolve at
the adapter boundary; local scope takes precedence over global scope. Relative,
calculated, circular and external definitions remain explicit unsupported cases.
Compatibility import preserves their unresolved uses as inert text and detaches
external links. Named references never introduce a second native reference syntax.

Inbound exact MATCH maps to `match(...) + 1`; vector INDEX with exact MATCH maps
directly to `index(range, match(...))`. SWITCH uses nested ordinary `if` expressions.
Two equally shaped vectors in SUMPRODUCT map to `dotProduct`; literal CHAR codes
1–127 become text. Approximate MATCH, dynamic/code-page-dependent CHAR, other
SUMPRODUCT shapes, TEXT format strings and TODAY remain unsupported, not guessed.

The codec reads raw XML value types before consulting a library-decoded value.
A date number format cannot change string/boolean/error caches into Date objects.
Import notices consolidate by code, message and sheet, retaining the occurrence
count and first location; export omissions retain individual affected locations.

## Diagnostics and presentation

Import review consolidates formatting, formula-result and metadata notices into
flat entries. Each distinct explanation remains visible, with total notice counts,
sheet counts and the first location. Fatal errors and omitted cells remain separate.
There are no details toggles or expandable warning groups. The core keeps located
diagnostics; consolidation is a presentation concern, not a loss of diagnostic data.

A formula-containing export reports once that formulas recalculate under Excel's
rules and results can differ. Materialized contextual/fixed-position references
have located editing-semantics warnings. Omitted cells carry their own locations.
Unsupported conversions and losses must remain distinguishable from fatal errors.

Basic text presentation crosses the boundary through the existing native StyleSpec:
bold/normal weight, left/center/right alignment and red/green/blue text color.
Import materializes supported cell styles (including resolved Excel row/column
defaults on serialized cells) as cell-local native metadata. Export uses the same
effective per-axis style cascade as the native presentation layer. Styles survive
ORD serialization and apply independently of formula translation, including on
blank cells. Export additionally applies the neutral presentation policy below.

Color mapping is deliberately bounded, not a nearest-color match for every hue:
resolve RGB or the workbook's related theme color (including HSL-lightness tint),
then classify red at 345–360/0–20 degrees, green at 80–165, blue at 195–255.
Require HSL saturation >= 0.2 and tinted lightness within 0.08–0.92. Exact canonical
colors produce no warning; approximations produce `presentation_approximated`.
Black/white remain the host's adaptive default text color. Other neutral colors,
unsupported hues, unresolved themes and indexed palettes use default text with a
located `presentation_omitted` warning. No color is guessed for an unresolved theme.
Export colors are fixed RGB red FF0000, green 008000, blue 0000FF, independent of
the host theme. Background fill is not mapped to text color.

Unsupported font attributes, rich-text runs, alignment features and number
formats outside the supported subset remain warnings, not blockers.
This is partial style preservation, not visual fidelity or lossless round-tripping.
Font/color/alignment transfer must not change formula ASTs or numeric evaluation
semantics. Calendar number formats additionally supply input-type evidence, as
specified below; decoding dates is value conversion, not presentation transfer.

### Neutral export presentation (2026-10-06)

Workbook container defaults are not a layout policy. A separate export-presentation
module owns display-only geometry and header decoration; the codec applies its
result, without changing source values, formulas, format precision or cached results.
Use existing resolved presentation text to size formulas and formatted values, never
formula source. Formula result caches remain absent and Excel still recalculates.

Use the workbook's minor/body theme font (Office fallback Calibri 11, family 2),
not a CSS `sans-serif` name or a custom product typeface. Include this complete font
on explicit bold/color records as well, so viewers do not guess a missing face.
User style axes override defaults. Header rows/label columns get modest bold weight
and neutral theme-light fills (8%/4% darkening). Header rows default to centered
horizontal alignment; explicit alignment overrides that default. Body label
columns and data cells keep their existing automatic alignment. Header freezing is independent of
decoration and defaults off. `freezeHeaders: true` freezes each sheet's own known
header rows/columns; it never invents headers for headerless sheets.
Do not infer new headers, add banding/heavy borders/filters, or synthesize Excel
Tables: Tables impose single-row, unique, nonblank column names which native
multi-level headers do not necessarily satisfy.

Export header rows as horizontal merged cells using core's `groupHeaderSpans`,
the same grouping policy as screen and print: adjacent identical display labels
(including blanks), without crossing the header-column/data-column boundary.
Do not merge vertically or merge repeated body values. Apply merges after writing
cell values and styles, so writing a covered cell cannot overwrite its master.
Fit merged header heights using the combined column widths of each span.

For the first header column, replace hierarchy markers with two literal leading
spaces per resolved hierarchy level. Use `resolveSheetRowStructure`, as the UI
does, rather than counting raw markers independently. Source labels and formulas
remain unchanged; all body rows export, including collapsed descendants. Excel
expand/collapse structure is not recreated, and one sheet-level notice reports
that approximation.

Estimate widths in normal-font digit units, accounting for narrow/wide characters,
CJK, emoji and hard line breaks. Use an 80th-percentile bounded histogram for text
(linear time), but the largest displayed numeric value. Text columns span 14–44
units, label columns 20–36; empty columns use 8 and numeric columns at least 12.
Long text wraps; numeric values do not wrap. Fit row heights to estimated wrapped
lines (20pt body, 24pt headers minimum), subject to XLSX's 255-unit width/409pt row
limits. This is heuristic readable layout, not exact cross-platform font measuring
or preservation of an imported workbook's original geometry. Never truncate text.
Generic codec writes without native presentation do not invent semantic structure.

### Numeric formatting and native date conversion

Import translates the supported fixed-point subset (precision, grouping, percent,
negative parentheses) into existing NumericFormatSpec. Currency symbols, accounting
padding and decorated zero sections are simplified with a located approximation
warning. Conditional, scaled, fraction and other unrecognized formats are explicitly
omitted, not guessed. Raw numeric precision is never rounded during conversion.
Export writes supported effective number formats without imposing a default format.

Calendar-formatted numbers are converted at the import boundary to existing native
date or datetime literals. For example, 45837 with a date format in a 1900-calendar
workbook becomes `2025-06-29`, with runtime kind `date` and no local format metadata.
The workbook epoch is decoding information, not an Ordinate display mode, type, or
new syntax. No Excel-specific temporal display presets are accepted. Date-only
formats with fractional-day literal values retain the hidden time as native datetime values.
Calendar layout is not evidence of the author's system locale: no month/day order
is guessed, and the native ISO display remains the default without extra format
metadata. If Excel's date-only display hides stored time, preserve the datetime
value and use the existing `%F` display format to hide (not delete) its time.
Date-only formula cells retain `%F` as display intent across recalculation.
Their values are not forced to `date`: integral serial results become `date`,
while fractional results become floating `datetime`, even if millisecond rounding
lands on midnight. Classification never specializes a formula from its cache.
For example, with a date in A1, a numeric day fraction in B1, and date-formatted
C1=`A1+B1`, changing B1 from 0 to 0.5 changes C1 from `date` to noon `datetime`
without exposing the hidden clock in its `%F` presentation. Imported
D1=`(C1-A1)*24` remains numeric hours (0 then 12), not a native duration.
These display rules use the existing row/column format compaction; they do not
introduce implicit system locale, locale preferences, or Excel-specific presets.
Datetimes are unqualified local calendar values with native millisecond precision.
Nonexistent dates (1900 serial 0/60), negative or out-of-range dates fail explicitly.
Independent supported font/color/alignment styles still transfer normally.

Formatted formula results become native dates using ordinary temporal expressions;
caches are never substituted. Scalar references to converted dates translate units
inside the imported formula only, so edits and native save/reopen remain meaningful.
Date-containing ranges remain unsupported in numeric aggregates. XNPV/XIRR's
date arguments instead consume the converted native dates directly, without
serial round-trip expressions. Explicit serial-date array literals in those slots
are decoded with the workbook's date system. Untyped numeric reference ranges
are unsupported rather than guessed. Original text remains text, even when it
looks like a date. Native date literals inside exported formulas become numeric
Excel date literals. Fixed timezone offsets are removed with a located warning,
preserving wall-clock components, never converting through the host timezone.
This does not change native arithmetic or existing temporal function semantics.
In particular, `time(date)` still fails; native datetime subtraction still returns
a duration, and mixed date/datetime subtraction is not implicitly promoted.
The ordinary `isDate(value)` predicate tests the exact native type (not datetimes,
date-looking strings or integer serials), including element-wise view inspection.
Only mixed calendar references require this branch in the inbound unit conversion.
It belongs to the standard function registry, so formula assistance and explicit
interchange decisions cannot silently omit it.

On export, calendar type decisions come from source literals, declared return
types, temporal arithmetic and conditional branches, never evaluated values.
Conditional source-cell inspection resolves references at that cell's original
sheet and coordinate. Excel has no distinct date type, so an unknown type producer
is unsupported rather than guessed from serial integrality; `isDate` export is
currently scalar. Predicates return false for errors, as in the native runtime.
Exact structural inverses of imported calendar unit conversions reuse the import
lowering itself as their templates. For a proven compatible calendar source they
remove redundant serial/epoch round-trips on export, keeping formulas editable
and avoiding repeated conversion expansion. Arbitrary user formulas are not
algebraically rewritten and caches are not used. Only source workbook epoch and
date-vs-datetime unit differences are translated; no global coercion policy or
Excel-specific runtime mode is introduced.

### Remaining financial compatibility plan

1. Keep the now-connected annuity/payment, depreciation, NPV/MIRR and typed-date
   XNPV/XIRR paths covered by independently authored fixtures and external
   recalculation. Test edits/save/reopen, both workbook epochs, missing slots and
   poisoned caches. Do not commit downloaded third-party workbooks.
2. Decide a native explicit-guess/root-selection contract before accepting Excel
   RATE/IRR/XIRR guess arguments. Do not discard them or modify deterministic
   native solver semantics only to imitate Excel. Multiple-root and non-convergent
   cases need specific tests and user-facing diagnostics.
3. Add genuine view composition/date conversion operations if multi-range cash
   flows and unformatted date vectors are required. Those capabilities belong in
   the native language/runtime, then in the shared adapter manifest; not in
   generated validation trees or cache-derived special cases.
4. Separately scope additional financial families (bonds, day-count conventions,
   yield/duration and dated schedules) with explicit native semantics, tests and
   metadata before connecting them through the same manifest.

Native date/datetime literals export to Excel calendar values with the required XLSX
date format (1900 epoch), without attaching display metadata to the native document.
Offsets cannot be represented faithfully: export explicitly discards them with
a warning. Previously imported numeric documents are
not migrated automatically: reimport their original XLSX to obtain native dates.
The host uses a compact warning list with grouped duplicates and occurrence counts,
and distinguishes cell omission from ordinary compatibility notes.

### Temporal export and source-syntax audit

One temporal adapter owns literal serial units, constructor/component functions,
fixed-offset metadata and default XLSX formats. Dates/datetimes use 1900-calendar
days; time and fixed durations use fractions of a day, with millisecond precision.
DATE, INT and MOD express calendar extraction/construction. Time and duration
constructors translate their components to days. YEAR/MONTH/DAY/HOUR/MINUTE,
whole SECOND and millisecond extraction are connected. `unixMillis` and
`datetimeFromUnixMillis` translate day/millisecond units, including Excel's
fictitious 1900 leap day. `unixMillis` requires a statically known fixed offset
from a literal/constructor (including a source literal cell); it never guesses
UTC from a current formula-cell result. Conditional metadata survives only if
both branches agree. Known offset-qualified instant comparisons/subtraction
account for the fixed offsets, even though displayed literals lose their offsets.

Calendar durations with years/months have no fixed day value. Values outside the
Excel calendar, offset-dependent expressions whose offsets cannot be determined
from syntax, and arbitrary localized/offset/microsecond TEXT formats are not
claimed compatible. Valid unsupported formulas can use the explicit static-value
choice. Native strict constructor validation is not replicated as Excel guards;
Excel's normalization, Unicode version and error/coercion rules still apply.
Negative elapsed-time numbers are retained but Excel's 1900-calendar display may
show `####`; they carry a located presentation warning, not a fake positive value.

| Source syntax | Export decision |
| --- | --- |
| Parentheses, negation, exponent and comparisons | Precedence-aware Excel expressions |
| Literal string concatenation / scalar `format` | `&`, explicit supported `TEXT` codes |
| f-strings | The same lowered concat/format nodes, not a separate adapter |
| Implicit temporal text in f-strings / `format` / `text` | ISO literals or date TEXT; computed time/datetime/duration needs explicit format or declared static result, never numeric serial text |
| Text `[i]`, `[start:end]`, omitted/negative bounds | MID and the existing scalar slice rule |
| Text TAKE/DROP | LEFT/RIGHT/MID with negative-count direction and clipping |
| Arrays / indexed arrays / view arithmetic | Constants or CHOOSE; scalar INDEX/consumer, array formula where needed |
| Reference bracket indices / static reference slices | Shared reference selector; zero/negative address conversion |
| Structured / A1 / cross-sheet references and aliases | Shared bindings and canonical function registry |
| Dynamic reference slices / temporary-array slices / whole multi-cell results | Declared unsupported, optional fresh static scalar result |
| Null literal / semantic TRIM differences | No guessed Excel null or legacy TRIM emulation |

The compatibility gate checks every registered native function **and alias**
through the actual export path, not just presence in a decision map. Positive
literal text slice bounds use MID's own clipping (`"abcdef"[1:4]` becomes
`MID("abcdef",2,3)`), rather than generated sign/length guards. Dynamic and
negative bounds include only the coordinate/clipping rules that they need.
Parser expression categories and sugar have explicit tests; f-string temporal/numeric
formats, postfix slicing, temporal constructors/components and offset unit
conversions also have independent recalculation cases. These are coverage gates,
not a claim of identical results for every Excel corner case.

## Safety and resource budgets

Bound compressed bytes, expanded archive bytes, archive entries, sheet/row/column/
cell counts, formula length, AST depth and generated formula length. Preflight
merged extents, row indices and column spans before adapter allocation. Stale
dimension hints do not count as allocated data. Exported packages must pass the
same expanded-byte and entry budgets before returning bytes.

Reject malformed/encrypted packages, data tables and unimplemented spill semantics.
Strict import rejects macros and external content; compatibility import removes
those attachments and relationships with explicit loss confirmation. Never execute macros, external
links or scripts, and never follow external network references.

Formula-looking literal text remains typed XLSX text. SpreadsheetML ST_Xstring
escaping is centralized, including literal underscore protection and XML-invalid
characters. Decode XML once and ST_Xstring once, not recursively. Rich-text runs
are decoded separately; phonetic annotations are not cell text. Preserve typed
empty strings on input despite adapter normalization.

## Verification contract

1. Exact formula goldens test recognizable operators/functions, parentheses,
   literal escaping, named/cross-sheet references, locks and exact range membership.
2. Changing referenced cell types must not specialize emitted operators.
3. Test every supported rule, invalid arity/shape, unsupported operation, formula
   budget and cell omission. Registry coverage fails for unclassified new functions.
4. Inspect emitted XLSX independently with ExcelJS and XML: actual formulas,
   literal types, no native formula caches and full recalculation requested.
5. Independent engine expectations follow **target** behavior. Include intentional
   differences such as rounding, remainder, coercion and ignored aggregate text.
   Never add generated guards just to make these match native evaluation.
6. Preserve import fixtures, package-security tests, copy-lock/edit/fill tests,
   directional failures, source immutability and native startup regressions.
7. UI tests assert no save/download before warning confirmation; cancellation,
   retry, duplicate-click prevention, immutable snapshot, popup geometry and
   keyboard behavior on both web and desktop.
8. Run full core and app tests/builds. Self round-trips may supplement but cannot
   prove either direction correct.

`test:excel` retains coverage floors of 95% lines/statements/functions and 90%
branches. Parameterized inputs are cases, not distinct features. Coverage does
not measure how much of Excel is supported.

`test:excel:recalc` requires soffice and uses only an isolated temporary profile.
It poisons caches before external recalculation and checks results using an
independent workbook reader. The current engine is LibreOfficeDev, **not Microsoft
Excel**. Separate calibration fixtures record known engine quirks; they are not
proof of Excel parity and must not dictate native semantics.

## Import header structure and presentation compaction

Import accepts optional per-sheet `headers` settings (`sheetName`, `headerRows`,
`headerColumns`). Hosts preview the imported document and let the user adjust
these counts before adoption. There is no post-import guidance protocol.

- Adopt one visible Excel Table header row when a single Table starts at A1,
  covers the occupied width and all occupied rows, has body data, and its labels
  can be represented by native header syntax. Keep every worksheet coordinate.
- Offset, partial, multiple, or syntactically unrepresentable Table headers are
  not flattened into one sheet-wide header. Header counts default to zero.
- Bold/fill and text distribution do not establish structural headers. The user
  chooses boundaries in the preview; zero is a valid choice.
- Frozen panes and print titles are not authoritative semantic headers. No
  automatic header column is inferred from Excel Table metadata.
- Import formula parsing, reference coordinates and unsupported-formula policy
  remain unchanged. Table structured-reference formulas are not added here.

Changing a boundary reimports the original bytes with the selected counts. This
preserves original styling when reversing an automatically adopted header. The
core validates counts, preserves at least one data row/column, rejects formula
or invalid-input headers, and uses existing header conversion semantics. Sheet
coordinates and A1 formula locks do not change. CSV/TSV use the same native
configuration operation after parsing.

After boundaries are established, core extracts repeated body-cell formatting
into existing column defaults. Numeric formats are considered as a complete
specification; alignment, weight and color are considered independently. A
default requires at least three matching cells and 80% agreement. Local
exceptions remain explicit. Empty unformatted cells are not evidence for a
format and remain blank. Row defaults are not rewritten.

General numbers receive no precision metadata; neither integers nor fractions
cause inferred decimal places. Explicit source precision, percent, grouping and
other supported formats remain meaningful and are preserved. Null means inherit
in native presentation metadata: a nonempty General/automatic exception therefore
prevents promotion of that axis, rather than silently inheriting the proposed
default. Compaction must preserve effective presentation, be idempotent, and
survive serialization and export. It does not introduce a second format model.
