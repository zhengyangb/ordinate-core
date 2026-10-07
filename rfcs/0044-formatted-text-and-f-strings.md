# RFC-0044: Formatted Text and F-Strings

- Status: Implemented — TypeScript core and shared web/Mac formula editor
- Project: Ordinate
- Scope: core formula syntax, formatted text values, source editing and Excel adaptation

## Summary

Introduce one formula function:

```text
format(value, spec?) -> string
```

Then introduce `f"..."` as syntax sugar for string literals, `format(...)`
and ordinary string concatenation. It is not a second
formatting language, evaluator or templating runtime.

```text
= f"Revenue: {B2:,.2f} USD"
= "Revenue: " + format(B2, ",.2f") + " USD"

= f"Margin: {C2:.1%}"
= "Margin: " + format(C2, ".1%")

= f"Item: {A2}"
= "Item: " + format(A2)
```

These pairs have the same calculation meaning. Source editing should retain
the authored f-string, rather than display its expanded implementation.

## Motivation and boundaries

Users need readable formula-generated labels, units, percentages and dates.
Today `text(value)` converts a value to text, but accepts no format argument.
The display layer already parses structured numeric and temporal format specs.
Excel's `TEXT(value, format_text)` exposes the missing calculation capability.

This RFC reuses the existing formatting rules from [RFC-0014](0014-temporal-value-types-and-display-format-metadata-v3.md)
and [RFC-0030](0030-temporal-display-formatting.md). It extends their application
to formula results; it does not turn existing display metadata into calculation
dependencies. [RFC-0024](0024-text-function-library-v1.md) still defines text
operations, and [RFC-0037](0037-formula-concrete-syntax-and-editor-introspection.md)
governs formula source inspection and editing.

The distinction is deliberate:

| Form | Result / effect |
| --- | --- |
| `1234.5 {:,.2f}` | Number remains `1234.5`; displays `1,234.50` |
| `= text(1234.5)` | String `"1234.5"` |
| `= format(1234.5, ",.2f")` | String `"1,234.50"` |
| `= f"Total: {1234.5:,.2f}"` | String `"Total: 1,234.50"` |

Neither function reads a referenced cell's display metadata, inherited column
format, style, rendered DOM text or cached display value. Changing those must
not change the function's result. The value and explicit spec are authoritative.

Non-goals: arbitrary Python syntax, host-language evaluation, locale inference,
clock access, alignment/color/bold inside a string, automatic formatting in Sheet
Notes, user-defined formatters, a complete Excel format-code implementation,
and changing existing arithmetic/coercion semantics.

## `format` contract

`format(value, spec?)` accepts one or two arguments. When provided, `spec` is a scalar string
containing the native format specification, without the surrounding `{:...}`.
It may be a literal or a formula expression returning a string. Omitting it uses
the existing scalar `text(value)` conversion, not a cell's display format. An
explicit empty/null spec is not omission. There is no `text(value, spec)` alias.

V1 returns one scalar string. References which resolve to a scalar are allowed;
multi-cell ranges, arrays and view-valued results are not implicitly joined,
flattened or mapped. Existing element-wise `text(view)` behavior is unchanged.
The same scalar restriction applies to every f-string interpolation. Using the
scalar `format` call for both field forms enforces this even when the enclosing
expression accepts views; lowering an unformatted field to element-wise
`text(view)` would accidentally allow a template to return a view.

Supported pairs are exactly the existing format/value compatibility rules:

- Numeric spec with a finite number: grouping, precision, sign, padding and
  numeric type follow the existing numeric formatter.
- Temporal spec with a compatible native date, time, datetime or duration:
  directives, millisecond precision and offset requirements follow RFC-0030.
- Explicit specs with strings, booleans, blank or null are incompatible in V1.
  There is no number-from-string or Excel-style blank-to-zero coercion.
- Error values propagate as errors, not the literal string `"#ERROR"`.

Examples:

```text
format(1234.5, ",.2f")         -> "1,234.50"
format(0.125, ".1%")           -> "12.5%"
format(-1234.5, "(),.2f")       -> "(1,234.50)"
format(2025-06-29, "%Y-%m-%d") -> "2025-06-29"
format(2025-06-29, "%m/%d/%Y") -> "06/29/2025"
```

The numeric `d` format truncates according to the existing numeric contract;
this RFC does not reinterpret it as a validation that its input is an integer.
No locale-sensitive month names, host timezone or implicit reporting date are
introduced. `%B` does not become supported merely because it occurs in `format`.

Empty specs, malformed specs and incompatible value/spec pairs produce normal
formula errors with structured diagnostics. Literal specs are validated as early
as possible during formula validation; computed specs are validated when the
call executes. Evaluation respects the ordinary function/branch evaluation rules.
Do not substitute `text(value)`, an empty string, zero or an old cached result
when formatting fails. Rounding/precision behavior has a single implementation;
any separately discovered numerical formatting defect is a shared-core change,
not a special case inside f-strings.

## F-string grammar

V1 accepts only the lowercase prefix immediately followed by a double quote:

```text
f"literal {expression} literal"
f"literal {expression:spec} literal"
```

This is an expression available wherever an ordinary string expression is
allowed. At the cell surface it must occur inside an explicit formula (`=`);
plain text cells, headers and Sheet Notes do not execute interpolation.

Rules:

1. Literal portions use the existing JSON-style string escapes, including `\n`,
   `\"` and `\\`. `.ord` table escaping is a separate outer layer and is applied
   exactly once by the existing cell serializer.
2. `{{` and `}}` in a literal portion produce literal braces. A lone unmatched
   brace is invalid. `\{` is not a new escape. Recognize interpolation boundaries
   in source before decoding escapes, so `\u007B` remains a literal brace.
3. A replacement field contains one nonempty ordinary Ordinate expression.
   Use the existing expression parser, not a regex splitter or host `eval`.
   Calls, references, operators, quoted strings and indexing retain their rules.
4. Only a colon after a complete field expression introduces a format spec.
   Colons inside A1 ranges, structured references, slices, temporal tokens or
   quoted strings belong to that expression. The parser must respect nesting
   and existing tokenization rather than split on the first colon.
5. After the separator, the spec is static format text up to the field's closing
   brace, with the same string-escape decoding as literal portions. Further
   colons are part of the spec, e.g. `%H:%M:%S%:z`. Parse the decoded text using
   the shared format parser. An empty explicit spec (`{B2:}`) is invalid; omit
   the colon to request `format(B2)`, i.e. scalar text conversion.
6. The lexer switches into expression mode inside a field. A quoted string
   within that expression does not end the enclosing f-string. Source spans
   remain offsets in the original source, including escapes.
7. Nested f-strings, nested replacement fields in specs, raw/triple-quoted
   prefixes, implicit adjacent-string concatenation, Python `!r`/`!s` conversion
   flags and debug fields such as `{B2=}` are outside V1. Ordinary existing `!=`
   comparisons remain valid. A spec needing a literal brace can be supplied to
   `format` as a regular string expression instead.

Examples at the formula-input layer, before `.ord` cell escaping:

```text
= f"{{Total}}: {sum(B2:B6):,.2f}"
= f"Net: {B2 - C2:,.0f}"
= f"Period: {D2:%Y-%m-%d}"
= f"{if(B2 > 0, "Profit", "Loss")}: {B2:,.2f}"
= f"First line\nSecond line: {A2}"
```

Without a spec, a scalar field has exactly `text(value)` semantics: blank becomes
`""`, null becomes `"null"`, booleans become `"true"`/`"false"`, temporal values use
their canonical text, and errors propagate. No additional quoting is introduced.

## Representation and shared implementation

Extract the reusable format parser, serializer and value formatter from their
current presentation-oriented locations into a dependency-neutral core module.
It must depend on value/format types, not document presentation or UI. The flow is:

```text
display metadata ──┐
format(value,spec) ─┼── shared FormatSpec parser + value formatter
f-string fields ───┘       (fields lower to format calls)
```

The shared value formatter returns formatted text or a diagnostic, never a
fabricated successful replacement. Presentation and calculation own their
different error policies: the existing display layer may still expose canonical
base text alongside a presentation diagnostic; the formula function propagates
a calculation error. Do not change display behavior merely to share code.

The source parser represents f-string parts and their spans in its concrete
syntax/source-inspection model. It lowers them into existing semantic AST nodes:

- Literal segment → string literal.
- Field without spec → `format(expression)`.
- Field with spec → `format(expression, specString)`.
- Multiple segments → ordinary left-to-right string `+` operations.
- Empty f-string → empty string literal; a single field needs no dummy prefix.

Each field expression executes once per evaluation of the f-string, subject to
existing error propagation. Do not expand a field into repeated runtime type
checks, coercion guards or speculative evaluation of its referenced cells.

There is no separate f-string runtime value, evaluator dispatch or mutable
expanded-formula store. Parsed/compiled literal specs may be derived caches;
source/spec changes invalidate them. Dynamic spec caches, if needed, are bounded
and keyed by exact spec text. Output size, precision/padding, expression depth
and segment count need explicit limits validated before large allocation.

## Editing, references and persistence

References inside fields are real formula references. Dependency collection,
incremental recalculation, cycle detection, cross-sheet bindings, `$` locks,
copy/fill, row/column edits and renames use the ordinary semantic reference path.
No regex-only reference rewriting or independently maintained f-string walker.

The shared scanner/source map exposes field expressions to source inspection and
point-mode editing, while keeping literal text and specs opaque. A string such
as `f"B2: {C2}"` depends on C2, not B2. Unsupported/incomplete syntax remains
editable with precise diagnostics and cannot execute a partial formula.

Save/reload and canonical formatting preserve f-string syntax, escaping and
field boundaries. Structural reference edits regenerate changed fields from
the syntax/source map rather than flattening the whole formula to concatenation.
This source form is derived from the parsed source, not a second semantic AST
which can disagree with the calculation tree. Synthesized adapter expressions
may serialize as explicit `format(...)`; do not heuristically rewrite every
string concatenation into an f-string.

## Excel interchange

Excel adaptation is part of implementing this feature, not a later optional
cleanup. Extend the executable import/export compatibility registries and their
exhaustiveness tests so a future function or format extension requires an
explicit adapter decision. Do not maintain a disconnected support checklist.

Initial executable compatibility is the bounded numeric, literal-spec subset:

| Excel source | Native expression |
| --- | --- |
| `TEXT(B2,"#,##0.00")` | `format(B2, ",.2f")` |
| `TEXT(B2,"0.0%")` | `format(B2, ".1%")` |
| `"Total: "&TEXT(B2,"#,##0.00")` | `"Total: " + format(B2, ",.2f")` |

The corresponding native `format` expressions export to `TEXT`; f-strings
export through their lowered expression using `&` and `TEXT`, never through
generated IF/ISERROR/ISNUMBER coercion machinery. Existing user-authored guards
remain untouched. Ordinate versus Excel value/coercion differences are disclosed
under RFC-0042; source operations remain readable rather than emulating every
target-engine calculation detail.

Use a shared format-code mapping with explicit exact, approximate and unsupported
outcomes. Formula-result formatting accepts only exact format-rule mappings in
V1. Display metadata's existing permissive approximations must NOT be reused to
silently strip a currency symbol, change a negative-number section or discard a
literal from `TEXT`: these characters are now part of a calculated string.
An exact mapping does not promise identical engine rounding/coercion behavior.

Locale-dependent formats, conditional/multi-section formats without an exact
mapping, and Excel formulas whose format argument is computed remain explicitly
unsupported for executable translation. Native dynamic specs likewise cannot
be exported by simply passing native format text to Excel's `TEXT` function.
Temporal Excel `TEXT` uses RFC-0042's explicit date/serial-unit projection.
Static `%F`/`%Y-%m-%d`, `%T`/`%H:%M:%S`, their space/ISO-T combinations and
unambiguous year/month/day/hour components have outbound mappings. Offset,
microsecond and arbitrary localized layouts remain unsupported. Inbound temporal
TEXT remains separately unsupported until its serial-unit rules are connected;
outbound support does not imply a lossless formula round trip. Never infer a date
from a textual cache.

Unsupported imports follow the existing confirmed preserve-as-text policy.
Unsupported exports follow the existing export diagnostic/omission policy.
Do not silently freeze either into its current evaluated string. CSV/TSV still
export evaluated text, including their existing formula-like-text safety policy.

## Implementation stages and acceptance

Implementation is organized into these independently verifiable stages:

1. Extract the shared formatter and add `format(value, spec?)` with registry
   metadata and errors. Preserve existing display and `text()` behavior.
2. Add the supported Excel numeric TEXT mappings in both directions and explicit
   unsupported decisions. Recheck synthetic import/export and third-party reader
   fixtures; downloaded samples remain local and uncommitted.
3. Add f-string scanning, source inspection, lowering, reference editing and
   canonical source serialization. Ship syntax only when these work together.
4. Verify the shared editor in web and Mac. No new format picker or modal is
   required; completion/highlighting should use the existing formula facilities.

Required tests:

- Shared formatting parity: grouping, precision, percentages, signed zero,
  rounding boundaries, padding and temporal formats/offsets/durations. Numeric
  values remain numeric when only their display format changes.
- Formula errors: arity, non-string/empty/unknown spec, incompatible value kind,
  invalid dynamic spec, blank/null, propagated errors, ranges and arrays. Test
  inactive branches and existing lazy/eager evaluation behavior explicitly.
- F-string grammar: empty strings, Unicode, JSON escapes, literal/doubled braces,
  adjacent fields, quoted expressions, ranges/slices/structured references,
  temporal colons, invalid/nested constructs and incomplete editing states.
- Equivalence of each f-string to its lowered formula, including exact text,
  errors, scalar requirements, evaluation count and no metadata dependencies.
- Reference graph, cycles, mixed `$` locks, cross-sheet references, copy/fill,
  insert/delete/rename, undo/redo, point mode and source spans after escapes.
- Parse/serialize/reparse, `.ord` pipe/backslash/newline escaping, cache handling,
  and authored f-string preservation without a second source of truth.
- Resource boundaries fail early without truncating output or accepting partial
  templates. No host locale, timezone, clock, network or host-code execution.
- Both Excel directions: exact mapped specs, unsupported currency/locale/sections
  and dynamic specs, ordinary references after edits, readable output without
  generated guards, and no substitution of cached/evaluated values for formulas.
- Regression of plain strings, `text()`, cell/column display formatting, Sheet
  Notes and both host editors. Registry exhaustiveness must include `format`.

Completion means these contracts and tests pass, not merely that a handful of
f-string examples render correctly. The scope remains deliberately smaller than
Python f-strings or Excel's full formatting language.

## Implementation record

- `runtime/formatting.ts` owns format parsing, canonical serialization and strict
  value formatting. Presentation retains its own base-text/diagnostic policy;
  formulas propagate errors. `runtime/functions/format.ts` registers the scalar
  function through the normal function manifest.
- The boundary scanner records literal/field spans. Concrete syntax exposes
  interpolation scopes and ordinary expression tokens, including unfinished
  fields. Lowering uses only existing literal, call and binary nodes. Small
  source-notation tags on those nodes preserve authored f-string syntax during
  reference regeneration; they contain no duplicate expressions or values.
- Allocation budgets are shared: 65,536 UTF-16 units for format specifications,
  padding, formatted results and concatenation results; numeric precision at
  most 100. An f-string source has the same 65,536-unit budget, at most 128
  segments, and fields have at most 256 parser tokens and depth 64. These are
  diagnostic errors, not truncation. Ordinary string concatenation shares the
  result budget so sugar and its explicit expansion remain equivalent.
- Excel functional formatting initially accepts literal `0` / `#,##0`, optional
  1–20 decimal zeros, and optional `%`. Display-only approximations are separate
  classified outcomes and cannot execute as `TEXT`. Native dynamic specs,
  exponent notation, padding and sign decorations remain explicitly unsupported.
  RFC-0042 connects static calendar/clock TEXT formats through the same lowered
  expression. Other valid formats can explicitly export their calculated text,
  with a formula-loss warning, never using imported caches.
- Registry exhaustiveness, scalar/value errors, temporal formats, escaping,
  incremental dependencies, mixed locks, structural edits, cross-sheet rename,
  undo/redo, source round trips, incomplete editing and CSV safety have synthetic
  regression tests in `rfc_0044_*.test.ts`. ExcelJS independently reads generated
  workbooks; those checks do not claim to run Excel's calculation engine.
- App tests cover completion and point-mode editing inside fields. The
  `desktop/interchange-smoke.mjs --formatted-text-only` integration test exercises
  production assets in separate test-owned web/native hosts, including formula
  entry, editing and source save/reopen. No downloaded workbooks are fixtures.
