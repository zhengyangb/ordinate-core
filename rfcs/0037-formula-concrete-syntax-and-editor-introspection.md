# RFC-0037: Formula Concrete Syntax and Editor Introspection

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines one shared, lossless concrete-syntax pipeline for Ordinate
formulas and a public, read-only projection for editor hosts.

The pipeline accepts incomplete formula drafts, preserves every source code
unit, and classifies the structures that affect editor behavior: calls,
grouping, array literals, postfix indexes, references, and direct call
separators. Strict formula parsing and tolerant editor introspection must derive
from this same concrete-syntax result.

The public editor API exposes source-aligned tokens, shallow structural nodes,
lexical and delimiter diagnostics, and optional caret context. It does not
evaluate, resolve, validate, or rewrite formulas.

## Motivation

The core parser understands syntax including:

- strings and escapes
- temporal and error literals
- Ordinate and spreadsheet-style references
- function calls and grouping
- array literals from RFC-0032
- postfix indexing and slicing from RFC-0026
- cross-sheet references from RFC-0036

The app currently contains independent partial scanners for autocomplete,
parameter hints, and reference tokens. These scanners must reproduce parser
decisions that are not purely lexical.

For example:

```ord
=dotProduct([1, 2], [3, 4])
=if(sum(@[:, Revenue:Cost][0:2, 0:1]) > 0, @["Inputs"::[Key, Value]], 0)
```

The commas in `[1, 2]` and `[0:2, 0:1]` belong to an array and a postfix index,
respectively. The comma in the cross-sheet reference belongs to one reference
token. None advances an outer call argument. Whether `[` begins an array or a
postfix index also depends on syntactic position, not on tokenization alone.

A shared lexer without shared structural parsing would still permit the strict
parser and editor scanner to disagree. This RFC therefore makes a tolerant
concrete-syntax representation the common source for both consumers.

## Goals

- Make core the single source of truth for formula lexical and shallow
  structural syntax.
- Use one lossless concrete-syntax pipeline for strict parsing and editor
  introspection.
- Provide a public API for autocomplete, parameter hints, syntax highlighting,
  reference highlighting, token selection, and delimiter matching.
- Preserve exact source offsets compatible with browser text-selection APIs.
- Return deterministic structure for incomplete and malformed drafts.
- Define non-crossing delimiter recovery and complete caret boundary rules.
- Avoid exposing the calculation AST or parser implementation.

## Non-Goals

- Formula evaluation or dependency resolution.
- Resolving sheet, row, or column selectors.
- Function lookup, alias canonicalization, arity checking, or type checking.
- Full parse, validation, or runtime diagnostics.
- Formula rewriting, formatting, or completion.
- Syntax-highlight colors or UI behavior.
- An incremental parsing API in V1.
- Persisting concrete-syntax nodes in document state.

## Canonical Pipeline

Core must implement this conceptual pipeline:

```text
formula source
    |
    v
lossless lexical scan
    |
    v
tolerant concrete-syntax parse
    |                         |
    v                         v
strict AST lowering      editor projection
    |
    v
existing validation and evaluation
```

The lossless lexical scan recognizes source tokens without discarding
whitespace or unknown input.

The tolerant concrete-syntax parse owns grammar-dependent classification,
including:

- call versus grouping parentheses
- array versus postfix-index brackets
- direct call separators
- delimiter nesting and recovery
- contexts in which spreadsheet references are recognized

Strict AST lowering consumes the same concrete-syntax result. It applies the
existing strict grammar and produces the existing AST or parse error behavior.
The editor projection is a flattened, deeply readonly view of that same result.
Openers, matching closers, direct separators, and index colons carry
concrete-syntax ownership before strict lowering; the strict parser must not
re-decide which structure owns those tokens.

The implementation must not retain an independent strict expression parser or
an independent editor structure scanner that can classify the same syntax
differently. Parser-specific AST nodes may remain private.

## Source and Offset Contract

The public entry point accepts RFC-0016 editor-facing `inputText`, including the
formula marker:

```ts
type FormulaInspectionOptions = Readonly<{
  caret?: number;
}>;

function inspectFormulaInput(
  input: string,
  options?: FormulaInspectionOptions,
): FormulaEditorInspection;
```

The first non-whitespace character must be `=`. Otherwise the result has
`kind: "not_formula"` and empty tokens, structures, and diagnostics.

The argument is not raw serialized `cellText` or `bodyText`. A host must first
use the existing cell-read contract that removes cached-value prefixes and
trailing display metadata. For example, stored `42 = sum(A:A) {:,.2f}` is
inspected as `= sum(A:A)`, not as the stored text.

All offsets are zero-based UTF-16 code-unit offsets into the exact input
JavaScript string. This matches `HTMLTextAreaElement.selectionStart` and
`selectionEnd`.

All spans are half-open:

```ts
type FormulaSourceSpan = Readonly<{
  start: number;
  end: number;
}>;
```

The represented text is `input.slice(start, end)`. Implementations must not
trim, normalize line endings, normalize Unicode, or rewrite escapes before
calculating spans.

If supplied, `caret` must be an integer in `[0, input.length]`. Invalid caret
values fail early. Caret context is calculated during the same inspection call,
so core never accepts a caller-mutated or stale inspection object as input.

## Public Result

```ts
type FormulaEditorInspection =
  | Readonly<{
      kind: "not_formula";
      source: string;
      tokens: readonly [];
      structures: readonly [];
      diagnostics: readonly [];
      caret: null;
    }>
  | Readonly<{
      kind: "formula";
      source: string;
      tokens: readonly FormulaEditorToken[];
      structures: readonly FormulaEditorStructure[];
      diagnostics: readonly FormulaEditorDiagnostic[];
      caret: FormulaEditorCaretContext | null;
    }>;
```

All nested public arrays and records are readonly. Core never consumes this
result again, so callers cannot corrupt later core operations by mutating or
forging an inspection.

`source` is the exact input string. `caret` is non-null only when the caller
supplied a valid caret and the input is a formula.

### Shared Reference Syntax Projection

Formula point mode needs selector semantics after it receives a reference token
span. It must not parse the Ordinate reference subgrammar independently. Core
therefore also exposes the existing strict reference parser through a read-only
projection:

```ts
type FormulaReferenceSelectorSyntax =
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "current" }>
  | Readonly<{ kind: "offset" | "absolute" | "absolute_fixed"; value: number }>
  | Readonly<{ kind: "label"; value: readonly string[] }>
  | Readonly<{
      kind: "range";
      value: readonly [FormulaReferenceSelectorSyntax | null, FormulaReferenceSelectorSyntax | null];
    }>;

type FormulaReferenceExpressionSyntax = Readonly<{
  sheetSelector?: Readonly<{ kind: "sheet_name"; value: string }>;
  rowSelector: FormulaReferenceSelectorSyntax;
  colSelector: FormulaReferenceSelectorSyntax;
  style?: "ordinate" | "spreadsheet";
}>;

type FormulaReferenceSyntax = Readonly<{
  style: "ordinate" | "spreadsheet";
  crossSheet: boolean;
  sheetName: string | null;
  reference: FormulaReferenceExpressionSyntax | null;
}>;

function parseFormulaReferenceSyntax(text: string): FormulaReferenceSyntax | null;

function formatFormulaReferencePathComponent(text: string): string;
function formatFormulaSheetSelector(text: string): string;
```

The input is the exact source slice of a complete `ordinate_reference` or
`spreadsheet_reference` token. `reference` is `null` when the lexical token is
complete but its selectors are strict-invalid. `sheetName` uses the same
backslash-unescaping semantics as strict parsing. This projection parses only
reference syntax. It does not look up sheets, resolve labels, detect ambiguity,
or rewrite the reference. The formatting helpers use the same quoted-component
escaping and reserved-selector rules as strict parsing. UI code must use them
when it generates label or cross-sheet variants; it must not use JSON string
escaping or duplicate the selector grammar.

## Tokens

```ts
type FormulaEditorSimpleTokenKind =
  | "formula_marker"
  | "whitespace"
  | "identifier"
  | "keyword"
  | "number"
  | "temporal_literal"
  | "spreadsheet_reference"
  | "operator"
  | "punctuation"
  | "unknown";

type FormulaEditorSimpleToken = Readonly<{
  kind: FormulaEditorSimpleTokenKind;
  span: FormulaSourceSpan;
}>;

type FormulaEditorCompletableToken = Readonly<{
  kind: "string" | "error_literal" | "ordinate_reference";
  span: FormulaSourceSpan;
  complete: boolean;
}>;

type FormulaEditorToken =
  | FormulaEditorSimpleToken
  | FormulaEditorCompletableToken;
```

Tokens are ordered by `span.start`, non-overlapping, and cover every UTF-16
code unit in a formula input exactly once. Concatenating token substrings must
reproduce `source` exactly.

### Lexical Productions and Precedence

The V1 lexical productions preserve the current strict tokenizer:

```text
whitespace  := one or more ECMAScript WhiteSpace or LineTerminator code units
identifier  := [A-Za-z_][A-Za-z0-9_]*
number      := [0-9][0-9.]*
keyword     := the complete identifier "true", "false", or "null"
operator    := "**" | "==" | "!=" | "<=" | ">="
             | "+" | "-" | "*" | "/" | "<" | ">"
punctuation := "(" | ")" | "[" | "]" | "," | ":"
```

`whitespace` is one maximal contiguous token. Identifiers are intentionally
ASCII in V1. Non-ASCII letters are not identifiers unless a later grammar RFC
changes that rule.

Number scanning preserves current maximal-munch behavior. Thus `1.2.3` is one
`number` token, and strict AST lowering preserves the current `Number.parseFloat`
behavior that lowers it to numeric `1.2`. This behavior is undesirable but is
not changed silently by an editor-introspection RFC. Correcting number grammar
requires a separate grammar RFC and compatibility decision.

At each source offset after the formula marker, candidate recognition uses this
precedence:

1. maximal whitespace
2. string beginning with `"`
3. an Ordinate reference beginning with the `@[` prefix
4. error-literal prefix `error[`
5. longest multi-code-unit operator
6. one single-code-unit operator or punctuation
7. temporal literal with the lexical shape defined by RFC-0029
8. spreadsheet reference when enabled by structural context
9. maximal number
10. maximal identifier, reclassified to `keyword` when applicable
11. one unknown Unicode code point or unpaired surrogate

Compound temporal and error tokens require an expression-token boundary after
their recognized text. A boundary is end of input or a next code unit outside
`[A-Za-z0-9_[]`. Ordinate references use the scanner defined below and do not
require an additional following boundary.

When enabled by structural context, spreadsheet-reference recognition tests
these patterns in order and accepts the first boundary-valid match:

```text
[A-Za-z]+[1-9][0-9]*:[A-Za-z]+[1-9][0-9]*  # cell range
[A-Za-z]+:[A-Za-z]+                        # whole-column range
[1-9][0-9]*:[1-9][0-9]*                    # whole-row range
[A-Za-z]+[1-9][0-9]*                        # single cell
```

A spreadsheet-reference boundary is end of input or a next code unit outside
`[A-Za-z0-9_]`. A candidate that fails this boundary is rejected and scanning
continues with the next ordered pattern at the same source offset. A failed
range candidate may therefore fall back to the single-cell pattern. This
directly preserves existing behavior for `A1_`, `A1.`, and `A1:B3x`.

The first non-whitespace `=` is `formula_marker`. A later lone `=` is
`unknown`; `==` is one operator by longest match. For `===`, the first two code
units form `==` and the last is `unknown`.

Recognized temporal literals are classified by lexical shape, not calendar
validity. For example, a lexically complete `2026-13-01` is a
`temporal_literal`; strict parsing remains responsible for rejecting invalid
calendar components.

Any otherwise unrecognized Unicode code point is one `unknown` token. Adjacent
unknown code points are separate. A supplementary code point occupies one token
with a two-code-unit span. Each unpaired UTF-16 surrogate occupies one
one-code-unit `unknown` token.

### Incomplete Compound Tokens

A string starts at `"` and scans UTF-16 code units in order. A backslash consumes
and escapes exactly the following code unit. A `"` terminates the token only
when it was not consumed by a preceding backslash. Equivalently, quote
termination depends on odd/even parity of the immediately preceding backslash
run. Newlines are ordinary string content. A trailing backslash at draft end
remains part of the incomplete token.

An unterminated string consumes through the end of the draft, is emitted as a
`string` with `complete: false`, and produces `unterminated_string`.

An Ordinate reference beginning with `@[` starts at bracket depth one. It scans
UTF-16 code units using these rules:

- a backslash consumes and escapes exactly the following code unit, both inside
  and outside quotes
- an unescaped `"` toggles quoted mode
- unescaped `[` increments depth only outside quoted mode
- unescaped `]` decrements depth only outside quoted mode
- the token completes when an unescaped `]` returns depth to zero
- newlines are ordinary reference content and do not terminate the token

Because backslash applies outside quotes, `@[a\],b]` is one complete reference:
the first `]` is escaped and the final `]` closes the token. Odd/even backslash
runs determine whether a following quote or bracket is escaped. A trailing
backslash at draft end remains part of an incomplete reference.

An Ordinate reference consumes through its matching closing bracket or draft
end. An unclosed reference is emitted with `complete: false` and produces
`unterminated_reference`.

Error-literal handling is:

- valid `error[kind]`: one complete token, no editor diagnostic
- `error[` or `error[kind` through draft end: one incomplete token and
  `unterminated_error_literal`
- closed but malformed `error[...]`: one complete token and
  `malformed_error_literal`
- a well-shaped literal followed by a forbidden boundary, such as
  `error[bad]suffix` or `error[bad][0]`: one complete token through `]`, plus
  `malformed_error_literal`; scanning then continues after `]`

Error literals do not nest. The first `]` after `error[` terminates the compound
token, even when the content contains another `[`. Thus `error[a[b]]` emits the
malformed token `error[a[b]` followed by an unexpected `]` punctuation token.

Brackets inside string, error-literal, and Ordinate-reference tokens do not
produce structural nodes.

Only complete temporal literals and spreadsheet references are recognized as
such. Partial forms are tokenized by the remaining rules; V1 does not create
incomplete temporal or spreadsheet-reference tokens.

Spreadsheet-reference recognition follows strict grammar context. Under the
RFC-0042 amendment, arrays accept A1 operands. Bare postfix-index axes retain
their existing tokenization: `@[Rows, Cols][A1]` exposes `A1` as an identifier.
Calls or groups inside index axes may contain A1 references, separating reference
ranges from the index axis's slice colon. Sheet-qualified `@[Inputs::$A$1]`
remains one complete envelope token; reference inspection reports spreadsheet
style and the target sheet, so editor hosts do not infer style from the envelope.

## Structural Nodes

The editor projection exposes shallow concrete structures:

```ts
type FormulaEditorStructureBase = Readonly<{
  open: FormulaSourceSpan;
  close: FormulaSourceSpan | null;
  contentSpan: FormulaSourceSpan;
  parent: number | null;
}>;

type FormulaEditorGroup = FormulaEditorStructureBase & Readonly<{
  kind: "group";
}>;

type FormulaEditorArray = FormulaEditorStructureBase & Readonly<{
  kind: "array";
}>;

type FormulaEditorIndex = FormulaEditorStructureBase & Readonly<{
  kind: "index";
}>;

type FormulaEditorCall = FormulaEditorStructureBase & Readonly<{
  kind: "call";
  name: string;
  nameSpan: FormulaSourceSpan;
  separatorSpans: readonly FormulaSourceSpan[];
}>;

type FormulaEditorStructure =
  | FormulaEditorGroup
  | FormulaEditorArray
  | FormulaEditorIndex
  | FormulaEditorCall;
```

Structures are emitted in preorder, ordered by `open.start`. `parent` is the
index of the immediately enclosing structure and always refers to an earlier
entry. Sibling structures with the same opening offset are impossible.

For every structure:

- `open` is the one-code-unit opening delimiter span
- `close` is the matching one-code-unit closing delimiter span, or `null`
- `contentSpan.start === open.end`
- for a complete structure, `contentSpan.end === close.start`
- for an incomplete structure, `contentSpan.end === source.length`

Structure spans are properly nested and never cross.

For a call, `nameSpan` contains the source-spelled name and ends before `open`.
Whitespace between the name and `(` is allowed and belongs to ordinary tokens.
`separatorSpans` contains only commas whose immediate structural owner is that
call. Each separator is a one-code-unit punctuation-token span and is ordered
by source position.

Each reference token corresponds to exactly one semantic reference span: the
token span itself. References do not have a second public collection. Each call
structure corresponds to exactly one call-opening parenthesis. Facts are not
duplicated across independently mutable projections.

### Array and Index Classification

The concrete-syntax parser uses the same expression-position rules as strict
parsing:

- `[` in primary-expression position begins an `array`
- `[` in postfix position after an expression begins an `index`
- `@[` begins one Ordinate-reference token
- `error[` begins one error-literal token

This classification is shared with strict AST lowering. It is not independently
reconstructed by the editor projection.

## Deterministic Expression Recovery

Each open structural content scope tracks one recovery state:

```text
expect_operand
expect_operator
```

A new formula, group, call argument, array element, or index axis begins in
`expect_operand`.

The tolerant concrete-syntax parser applies these transitions:

- whitespace never changes recovery state
- a literal, keyword, identifier, or reference in `expect_operand` completes a
  primary and changes to `expect_operator`
- an identifier or keyword followed, ignoring whitespace, by `(` starts a call;
  this preserves the existing `true()`, `false()`, and `null()` call behavior
- `(` in `expect_operand` starts a group
- `[` in `expect_operand` starts an array
- `[` in `expect_operator` starts a postfix index
- unary `-` in `expect_operand` leaves the state at `expect_operand`
- a binary operator in `expect_operator` changes to `expect_operand`
- any other operator in `expect_operand` leaves the state at `expect_operand`
- a direct comma starts the next call argument, array element, or index axis and
  resets that scope to `expect_operand`
- a direct `:` in an index axis resets that axis to `expect_operand`
- a comma or colon with no applicable call, array, or index owner resets the
  current scope to `expect_operand` but is not recorded as a call separator
- a matching closer completes its structure as a primary in the parent scope,
  leaving the parent at `expect_operator`
- an unexpected closer does not change the current recovery state
- an `unknown` token resets the current scope to `expect_operand`

When a primary token or primary opener appears in `expect_operator` without an
operator, the tolerant parser starts a recovered sibling expression at that
token and processes it as if the state were `expect_operand`. Strict AST
lowering still reports the missing operator or trailing expression.

A compound token carrying `malformed_error_literal`, or any incomplete compound
token, does not complete a primary; it resets the scope to `expect_operand`.
Other complete compound tokens complete a primary even when strict semantic
validation will later reject their value.

These rules make malformed drafts deterministic without promoting recovery to
valid formula syntax. Required classifications include:

```text
=1 2[3]      # [3] is an index on the recovered primary 2
=foo bar(1)  # bar(1) is a recovered call
=1 ? [2]     # ? resets recovery; [2] is an array
=1 + ) [2]   # unexpected ) preserves expect_operand; [2] is an array
=error[bad][0] # malformed error token; [0] is a recovered array
```

An actual newline is also a recovery no-op. In the following source, `[2]` is
an index on `1`:

```ord
=1
 [2]
```

Missing operands, adjacent expressions, and other strict grammar errors remain
strict-parser diagnostics. They do not need additional editor diagnostic kinds
to produce deterministic structures.

## Deterministic Delimiter Recovery

The concrete-syntax parser maintains a stack of open structures.

When a closing delimiter matches the top structure, it closes and pops that
structure.

When a closing delimiter does not match the top structure, or no structure is
open, the parser:

1. emits the closer as a punctuation token
2. emits `unexpected_closing_delimiter` over that closer
3. does not pop or search the stack
4. continues scanning

At the end of the draft, every remaining open structure has `close: null` and
produces `unclosed_delimiter` over its opening delimiter.

For example, in:

```ord
=f([1), 2]
```

`)` is unexpected and does not close `f` through the still-open array. The
comma belongs to the array. `]` closes the array. The call remains unclosed at
the end. This policy prevents crossing spans and makes parent and separator
ownership deterministic.

## Caret Context

```ts
type FormulaEditorCaretContext = Readonly<{
  offset: number;
  tokenIndex: number | null;
  referenceTokenIndex: number | null;
  callStructureIndex: number | null;
  argumentIndex: number | null;
}>;
```

`referenceTokenIndex`, when non-null, indexes an `ordinate_reference` or
`spreadsheet_reference` token. `callStructureIndex`, when non-null, indexes a
`call` structure. `argumentIndex` is an editor argument-slot index, not an index
into a parsed AST argument array.

The active call is the innermost call for which:

- `caret >= open.end`, and
- for a complete call, `caret < close.end`, or
- for an incomplete call, `caret <= source.length`

Therefore a caret immediately after `(` is in argument slot zero, a caret on
`)` is still inside the call, and a caret immediately after `)` is outside.

For an active call, `argumentIndex` equals the count of its direct separators
whose `span.end <= caret`. It is always non-null when `callStructureIndex` is
non-null, including for a syntactically empty call. For `=sum()` with the caret
on `)`, the editor argument slot is zero even though strict parsing sees zero
arguments. Function metadata decides whether a parameter hint exists.

Token ownership is:

- normally, a token owns `caret` when `span.start <= caret < span.end`
- when `caret === source.length`, an incomplete string, error literal, or
  Ordinate-reference token ending there also owns the caret
- otherwise EOF has no active token

`referenceTokenIndex` follows the same rule. A caret at EOF in an incomplete
reference whose prefix is `@[` therefore remains in that reference. Opening
and closing delimiters otherwise
use normal token ownership; structural call context follows the separate rules
above.

## Diagnostics

```ts
type FormulaEditorDiagnosticKind =
  | "unterminated_string"
  | "unterminated_reference"
  | "unterminated_error_literal"
  | "malformed_error_literal"
  | "unclosed_delimiter"
  | "unexpected_closing_delimiter"
  | "unknown_character";

type FormulaEditorDiagnostic = Readonly<{
  kind: FormulaEditorDiagnosticKind;
  span: FormulaSourceSpan;
}>;
```

Diagnostic spans are normative:

- compound-token diagnostics cover the complete compound token span
- `unclosed_delimiter` covers only the opening delimiter
- `unexpected_closing_delimiter` covers only the unexpected closer
- `unknown_character` covers the corresponding unknown token

Every `unknown` token produces exactly one `unknown_character` diagnostic with
the same span, including supplementary code points and unpaired surrogates.

Diagnostics are ordered by `span.start`, then by discovery order for equal
starts. Scanning continues after unknown characters and mismatched closing
delimiters. An unterminated string, reference, or error literal consumes through
draft end, so no later independent token can be recovered.

These diagnostics are lexical or shallow-structural only. Missing operands,
array shape, unsupported spreadsheet references in arrays, malformed temporal
literals, function names and arity, selector validity, and type errors remain
strict parser, validator, or runtime concerns.

## Tolerant Draft Examples

The API must return a valid inspection rather than throw for:

```ord
=sum(
=dotProduct([1, 2
=@[:, Revenue:Cost][1,
=@["Inputs"::[Revenue,
="unterminated
=error[bad
=f([1), 2]
```

Malformed formula source is data. Public calls fail early only for an invalid
API argument such as a non-integer or out-of-bounds caret. Internal violations
of token coverage, span nesting, parent order, or index integrity must throw.

## Complexity

`inspectFormulaInput` must run in `O(n)` time and `O(n)` output space for source
length `n`. It must not repeatedly parse prefixes or perform unbounded
backtracking.

V1 may rescan when only the caret changes. Incremental inspection and reusable
opaque inspection handles are future work; they must preserve the same result
semantics.

## App Integration

The Ordinate app should use this API as follows:

- autocomplete and parameter hints consume `caret.callStructureIndex` and
  `caret.argumentIndex`
- formula point mode filters reference tokens
- reference style and overlay logic consumes `parseFormulaReferenceSyntax`
- generated label and sheet selector text uses the core formatting helpers
- reference coloring and token activation use token spans
- delimiter matching uses structures

The app owns suggestion selection, colors, popover placement, and reference
style choices. Those concerns do not belong in core.

Migration must delete frontend utilities that independently scan nested formula
grammar. There is no frontend fallback scanner. Invalid core invariants fail
early during development.

## Testing Requirements

Core tests must use exact golden inspections and cover:

- `not_formula`, `formula_marker`, and RFC-0016 `inputText` rather than raw
  stored cell text
- token-source round trip including leading, internal, and trailing whitespace
- maximal whitespace grouping and every lexical-precedence boundary
- UTF-16 spans with BMP characters, surrogate pairs, and unpaired surrogates
- every operator and punctuation token
- `true`, `false`, `null`, and ordinary identifiers
- malformed numbers such as `1.2.3`
- strict lowering of `1.2.3` to the existing numeric value `1.2`
- complete and incomplete strings with odd and even backslash runs, trailing
  backslashes, and newlines
- complete, incomplete, multiline, quoted, and cross-sheet Ordinate references
- reference escapes inside and outside quotes, odd/even backslash runs, escaped
  brackets and quotes, nested brackets, and a trailing backslash
- `error[kind]`, `error[`, `error[kind`, and closed malformed error literals
- first-`]` malformed error termination such as `error[a[b]]`
- compound boundaries including `error[bad]x` and `error[bad][0]`
- valid, partial, and lexically complete but calendar-invalid temporal literals
- spreadsheet references `A1`, `A1:B3`, `A:A`, and `1:1`
- spreadsheet boundary cases `A1_`, `A1.`, `A1:B3x`, and competing prefixes
- spreadsheet-like identifiers inside arrays and postfix indexes
- one- and two-dimensional arrays
- scalar indexes, two-axis indexes, and slices
- array versus index classification in nested expressions
- grouping and known or unknown function names
- keyword-shaped calls `true()`, `false()`, and `null()`
- direct separators, nested calls, empty calls, and trailing empty slots
- mismatched and unexpected closing delimiters with exact recovery output
- recovery after unknown tokens, missing operators, and adjacent expressions
- unclosed nested structures and exact diagnostic order
- unknown BMP and supplementary characters
- every caret boundary around tokens, `(`, `)`, commas, brackets, and EOF
- invalid caret arguments
- innermost-call selection
- proof that array, index, string, and reference commas do not advance an outer
  call argument
- parent indexes, preorder, and non-crossing structure invariants

Required regression formulas include:

```ord
=dotProduct([1, 2], [3, 4])
=sum([[1, 2], [3, 4]])
=if(sum(@[:, Revenue:Cost][0:2, 0:1]) > 0, @["Inputs"::[Key, Value]], 0)
=if(contains("a,b", ","), sum(@[:, Revenue]), 0)
=error[bad]
```

The strict parser and editor projection must share a conformance corpus. Every
complete valid formula in that corpus must retain the existing AST, evaluation,
and canonical rendering. Every strict-invalid formula must retain its existing
strict parse behavior unless another RFC intentionally changes it.

App tests must verify:

- autocomplete and parameter hints consume core caret context
- array and two-axis-index commas do not advance outer parameters
- incomplete drafts remain interactive
- complete and incomplete references use core token spans
- no app utility independently classifies nested formula grammar

## Compatibility and Evolution

This RFC adds public API without changing formula syntax, serialization, or
evaluation.

Once this RFC is Accepted, token, structure, and diagnostic discriminant unions
are closed for its V1 contract. Existing syntax classification, source spans,
ordering, recovery, and caret boundary behavior are compatibility guarantees.

Before the core package has a published semantic version, changing one of those
guarantees requires an explicit amendment or superseding RFC. Once the API is
published as a versioned package, adding a discriminant or reclassifying source
that was already accepted by an older version is a breaking public TypeScript
API change and requires a major version.

A future grammar RFC may add syntax using existing classifications without a
major version only when all source accepted by `inspectFormulaInput`, including
malformed drafts, retains identical inspection results. Reclassifying a prior
`unknown` token or recovered structure is therefore a breaking editor API
change even when the old source was not a valid formula. The grammar RFC must
update the shared conformance corpus. Consumers should still include a
defensive default branch when rendering editor-only classifications from a
newer core version.

The app migration may remove private scanner utilities as a breaking internal
refactor. No compatibility wrapper is required.

## Future Work

- incremental inspection and token deltas
- reusable opaque inspection handles for repeated caret queries
- full parser diagnostics associated with source spans
- semantic tokens after name and reference resolution
- overloaded-signature selection
- optimized matching-delimiter queries
- editor services for reference conversion or rename
