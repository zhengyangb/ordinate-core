# RFC-0039: Multiline Plain Text

- Status: Draft (TypeScript/editor implemented; Python parity deferred)
- Supersedes: RFC-0017's blanket rejection of literal line breaks

## Scope

Data cells support multiline implicit text. No rich-text model, HTML, `<br>`
interpretation, string chips, or automatic conversion to quoted input is introduced.
Formula and explicit quoted input remain source editing. Hierarchy labels and header
editing remain single-line in the editor/core edit contract for this revision.

## Two encoding layers

The semantic cell input and `.ord` table wire representation are different surfaces.
The table encoder escapes backslash first, pipe second, and physical LF/CR as `\n`
and `\r`. The decoder consumes each escape once, before cell semantic parsing.
Thus implicit `first` + LF + `second` is stored as `first\nsecond`, whereas literal
backslash+n is stored as `\\n`. Quotes do not protect pipes from table splitting.
Serialization remains one physical line per table row, including caches and invalid
cell source. Formatting must preserve leading/trailing semantic newlines.

Quoted value strings and quoted literals in formulas use JSON string escapes:
`\n`, `\r`, `\t`, `\b`, `\f`, `\\`, `\"`, `\/`, and `\uXXXX`.
Literal tabs inside quotes are also accepted as whitespace characters. Invalid
escapes produce a parse error rather than silently discarding backslashes. Reference
path/sheet-name escaping is unchanged and separate from value-string escaping.
String generation (formula rendering and cached values) uses one shared encoder.
In a `.ord` file a quoted string escape goes through table encoding too, e.g.
`| "first\\nsecond" |`. The cell editor receives `"first\nsecond"` instead.

This is an intentional syntax change: previously unknown table `\n`/`\r` sequences
now decode, and quoted escapes no longer discard an arbitrary backslash. Literal
backslashes must be encoded. Existing canonical serializer output already doubles
table-layer backslashes. No ambiguous legacy interpretation is retained.

## Editing contract

`isImplicitTextInput` is the shared eligibility predicate: not formula/quoted input,
not display metadata or cached formula input, and parsed as string or blank.
`set_cell_input` and `set_region` allow physical line breaks only for this input in
data cells. CRLF/CR normalize to LF in implicit text; leading/trailing line breaks
are preserved. Formula/explicit input must express a newline inside a quoted string
using its escape syntax. Invalid structural multiline edits fail atomically.

The editor uses a textarea for non-formula input. Shift+Enter inserts a newline only
when the resulting draft is eligible, including converting an unquoted number,
Boolean or date into text. Eligibility is checked after inserting the newline at
the caret/replacing the selection, not against the previous cell's value type.
Any physical newline in unquoted literal input takes precedence over number,
Boolean, temporal (date, time, datetime, duration), null and error recognition.
Removing the newline restores the ordinary single-line type inference.
Enter commits, Ctrl/Cmd+Enter keeps apply-to-selection, Escape cancels.
IME confirmation must not submit or split the draft. Newline insertion replaces the
native selection without resetting the caret. Pasted multiline implicit text follows
the same core contract. Literal `\n` typed in implicit mode remains two characters.

The textarea grows with content and wrapping, capped at 10rem or 35vh before internal
scrolling. It shrinks after deletion. Read mode stays one line, with compact line
separators and a line count; entering edit mode reveals actual newlines. The
floating shell expands upward and reports measured height to the table's bottom safe
space so the last row and append control can still scroll above it. Read mode and
single-line editing stay vertically centered; multiline editing aligns side
controls to the bottom. Its backing surface expands in 300ms (220ms on collapse),
without per-frame layout or scaling text. The editor reveals upward in sync using
translation and clipping; reduced-motion disables both transitions.
Shell and input use fixed radii derived from the collapsed design, unchanged in
multiline mode. Extra vertical padding keeps multiline text clear of the corners.
The shell animation counter-scales its vertical corner radius to preserve circular
corners instead of stretching them with the background.
The action circle shares its center with the shell's bottom-right corner arc.
Shell padding is derived from the radius and control size (not from edit mode),
so the action and metadata keep their position when the input grows. Multiline
overflow uses a thin scrollbar with a transparent track and theme-aware thumb;
system scrollbar visibility preferences remain respected.
Existing wrapped
text/automatic row heights keep rails, frozen cells and body aligned.

## Verification

Cover implicit/explicit distinctions, actual versus literal escapes, quotes/pipes,
CRLF, blank lines, trailing LF, style, formulas/caches, fill, atomic failure, undo/redo,
canonical serialization stability, and desktop/narrow-screen editing. Python parsing
and serialization must adopt the same grammar before cross-runtime newline support
can be claimed.
