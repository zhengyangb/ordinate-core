# RFC-0030: Temporal Display Formatting

- Status: Draft
- Project: Ordinate

## Summary

This RFC extends Ordinate display formatting with deterministic temporal format specs for:

```text
date
time
datetime
duration
```

Temporal display formats use a constrained `strftime`-style pattern language inside existing display metadata format blocks:

```text
2026-03-24 {:%Y-%m-%d}
14:30:05.250 {:%H:%M:%S.%f}
2026-03-24T14:30:05Z {:%Y-%m-%d %H:%M:%S%:z}
P1DT2H3M4.005S {:%[h]:%M:%S.%f}
2026-03-24T14:30:05Z {:%Y-%m-%d %H:%M:%S%:z} {::>}
```

This RFC does not introduce locale-sensitive formatting, string formatting, or new formula semantics.

## Motivation

RFC-0014 defined temporal value types and display metadata. RFC-0029 refined temporal formula semantics, precision, offsets, and arithmetic. Ordinate now needs a deterministic way to display temporal values without changing the stored value.

Users need common formats such as:

```text
2026-03-24
03/24/2026
14:30
14:30:05.250
2026-03-24 14:30:05Z
```

The format should be part of presentation, not value semantics. Formatting must not depend on host locale, host timezone, browser settings, or the current clock.

## Relationship To Previous RFCs

RFC-0014 remains the source for:

- display metadata block syntax
- the separation between value, format, and style
- numeric format semantics
- column display defaults and cell-local display metadata precedence

RFC-0029 remains the source for:

- temporal value semantics
- offset-qualified versus offset-naive terminology
- millisecond precision
- temporal arithmetic and constructors

This RFC adds temporal display format specs to the display layer.

## Goals

This RFC defines:

- a `FormatSpec` discriminated union
- deterministic temporal format parsing
- a constrained `strftime`-style directive subset
- compatibility rules for `date`, `time`, `datetime`, and `duration`
- formatting behavior for offset-qualified and offset-naive values
- formatting behavior for fixed elapsed durations
- diagnostics for invalid temporal format specs
- diagnostics for format/value incompatibility
- canonical serialization for temporal format specs

## Non-Goals

This RFC does not define:

- locale-sensitive date/time names
- locale-sensitive field ordering
- host timezone conversion
- named IANA timezones
- `today()` or `now()`
- text/string format specs
- boolean display formats
- blank/null placeholders
- error display policies
- temporal parsing from formatted strings
- Excel date serial numbers

## Core Principle

Temporal formatting is presentation-only.

It must not:

- change the stored temporal value
- change formula evaluation
- change offset semantics
- read host locale
- read host timezone
- read the current clock

The same document must produce the same formatted text in every runtime, assuming the same Ordinate version.

## Display Metadata Syntax

This RFC uses the RFC-0014 display metadata syntax after the format/style breaking change:

```text
body {:format_spec}
body {::style_spec}
body {:format_spec} {::style_spec}
```

Temporal examples:

```text
2026-03-24 {:%Y-%m-%d}
14:30:05 {:%H:%M:%S}
2026-03-24T14:30:05Z {:%Y-%m-%d %H:%M:%S%:z}
2026-03-24T14:30:05Z {:%Y-%m-%d %H:%M:%S%:z} {::>}
```

The leading `:` in `{:...}` remains the display format sentinel. It is not a format/style delimiter.

## FormatSpec Model

`FormatSpec` becomes a discriminated union:

```ts
type FormatSpec = NumericFormatSpec | TemporalFormatSpec;

type NumericFormatSpec = {
  kind: "numeric";
  sign: FormatSignPolicy;
  padWidth: number | null;
  grouping: boolean;
  precision: number | null;
  type: NumericFormatType | null;
};

type TemporalFormatSpec = {
  kind: "temporal";
  pattern: string;
  tokens: TemporalFormatToken[];
};
```

`NumericFormatSpec` preserves current numeric behavior.

`TemporalFormatSpec` stores the canonical pattern text and parsed directive tokens.

## Format Parsing Strategy

Ordinate parses supported format specs structurally before presentation.

Rules:

- if the format spec contains at least one supported temporal directive, parse it as `TemporalFormatSpec`
- otherwise parse it as `NumericFormatSpec`
- unsupported specs fail during display metadata parsing
- no format spec is accepted merely as an opaque raw string

Examples:

| Format spec | Parsed kind |
|---|---|
| `,.2f` | `numeric` |
| `.1%` | `numeric` |
| `d` | `numeric` |
| `%Y-%m-%d` | `temporal` |
| `%H:%M:%S` | `temporal` |
| `%Y-%m-%d %H:%M:%S%:z` | `temporal` |

This is intentionally not the same as Python's value-type dispatch model. Python passes the format spec to the value's `__format__` method. Ordinate stores structured document metadata before any particular value is rendered, so it must parse supported specs into stable internal forms.

Future Python-style text or generic formatting may require value-type dispatch. This RFC does not introduce that model.

## Supported Temporal Directives

The first version supports only deterministic numeric and offset directives:

| Directive | Meaning | Example |
|---|---|---|
| `%%` | literal percent sign | `%` |
| `%Y` | four-digit year | `2026` |
| `%m` | two-digit month | `03` |
| `%d` | two-digit day of month | `24` |
| `%H` | two-digit hour, 24-hour clock | `14` |
| `%M` | two-digit minute | `30` |
| `%S` | two-digit second | `05` |
| `%f` | six-digit microsecond-style fraction derived from millisecond precision | `250000` |
| `%z` | numeric offset without colon | `+0000`, `-0400` |
| `%:z` | numeric offset with colon | `+00:00`, `-04:00` |
| `%F` | equivalent to `%Y-%m-%d` | `2026-03-24` |
| `%T` | equivalent to `%H:%M:%S` | `14:30:05` |
| `%[d]` | total whole days in a fixed duration | `1` |
| `%[h]` | total whole hours in a fixed duration | `26` |
| `%[m]` | total whole minutes in a fixed duration | `1563` |
| `%[s]` | total whole seconds in a fixed duration | `93784` |
| `%[ms]` | total milliseconds in a fixed duration | `93784005` |

`%f` follows Python's familiar six-digit spelling, but Ordinate only stores millisecond precision. Therefore:

```text
250 milliseconds -> 250000
005 milliseconds -> 005000
000 milliseconds -> 000000
```

## Unsupported Temporal Directives

Locale-sensitive directives are not supported:

| Directive | Reason |
|---|---|
| `%a` | locale weekday name |
| `%A` | locale weekday name |
| `%b` | locale month name |
| `%B` | locale month name |
| `%p` | locale AM/PM marker |
| `%c` | locale datetime representation |
| `%x` | locale date representation |
| `%X` | locale time representation |
| `%E...` | locale alternative representation family |
| `%O...` | locale alternative digit family |

Week calendar directives are deferred:

```text
%w
%u
%U
%W
%V
%G
%j
```

Timezone name directives are not supported:

```text
%Z
```

Ordinate supports fixed offsets, not named timezones.

Any unsupported directive makes the display metadata invalid.

## Literal Characters

Characters that are not part of a `%` directive are copied literally.

Examples:

```text
{:%Y-%m-%d}
{:%Y/%m/%d}
{:%Y-%m-%d %H:%M:%S}
{:%H:%M:%S.%f}
{:%Y-%m-%dT%H:%M:%S%:z}
```

A bare trailing `%` is invalid.

Unknown directives are invalid:

```text
{:%Q}
{:%[q]}
{:%[hours]}
```

Bracketed duration directives must be closed and must name one of `d`, `h`, `m`, `s`, or `ms`.

## Compatibility Matrix

Temporal directives are compatible with value kinds as follows:

| Directive family | `date` | `time` | `datetime` | `duration` |
|---|---:|---:|---:|---:|
| date directives `%Y`, `%m`, `%d`, `%F` | yes | no | yes | no |
| time directives `%H`, `%M`, `%S`, `%f`, `%T` | no | yes | yes | yes, as wrapped elapsed fields |
| offset directives `%z`, `%:z` | no | yes, if offset-qualified | yes, if offset-qualified | no |
| duration total directives `%[d]`, `%[h]`, `%[m]`, `%[s]`, `%[ms]` | no | no | no | yes |
| literal text and `%%` | yes | yes | yes | yes |

Unlike Python, Ordinate does not substitute default date or time components for incompatible directives.

Examples that produce presentation diagnostics:

```text
2026-03-24 {:%H:%M:%S}
14:30 {:%Y-%m-%d}
2026-03-24 {:%z}
2026-03-24T14:30 {:%z}
P1D {:%Y}
2026-03-24 {:%[d]}
```

## Duration Formatting

Duration formatting uses the same `TemporalFormatSpec` kind as date/time/datetime formatting. The parser cannot know the eventual value kind, so it only validates that the pattern is a supported temporal pattern. Compatibility is checked when the value is rendered.

For fixed durations, Ordinate formats elapsed time from the duration's total milliseconds:

```text
P1DT2H3M4.005S {:%[d]}        -> 1
P1DT2H3M4.005S {:%[h]}        -> 26
P1DT2H3M4.005S {:%[m]}        -> 1563
P1DT2H3M4.005S {:%[s]}        -> 93784
P1DT2H3M4.005S {:%[ms]}       -> 93784005
P1DT2H3M4.005S {:%H:%M:%S.%f} -> 02:03:04.005000
P1DT2H3M4.005S {:%T}          -> 02:03:04
```

The distinction is intentional:

- bracket directives are total elapsed fields
- `%H`, `%M`, `%S`, `%f`, and `%T` are wrapped remainder fields after whole days, hours, and minutes are removed

Negative durations render the sign on the first numeric duration field:

```text
-PT1H30M {:%[h]:%M}        -> -1:30
-PT1H30M {:%H:%M}          -> -01:30
-PT1H30M {:elapsed %[h]h}  -> elapsed -1h
```

Calendar durations with year or month components are not fixed elapsed durations. Any format that needs elapsed duration fields produces a presentation diagnostic:

```text
P1M {:%[d]}
P1Y {:%H:%M}
```

Literal-only formats such as `{:%%}` do not inspect elapsed duration fields and are therefore valid for any duration.

## Offset Formatting

Offset directives require an offset-qualified value.

For offset-qualified values:

```text
2026-03-24T14:30:05Z {:%z}   -> +0000
2026-03-24T14:30:05Z {:%:z}  -> +00:00
14:30:05-04:00 {:%z}         -> -0400
14:30:05-04:00 {:%:z}        -> -04:00
```

For offset-naive values, offset directives produce a presentation diagnostic rather than an empty string.

This differs from Python, which may render empty strings for naive timezone fields. Ordinate fails early because an empty offset can hide a semantic mismatch.

## Format Application

Presentation applies format specs by value kind:

```text
NumericFormatSpec  + number              -> formatted number
TemporalFormatSpec + date/time/datetime  -> formatted temporal text when compatible
TemporalFormatSpec + duration            -> formatted elapsed duration text when compatible
```

Incompatible format/value pairs produce a presentation diagnostic and use the canonical base display text as `displayText`.

Examples:

```text
123 {:%Y-%m-%d}
2026-03-24 {:,.2f}
```

These are presentation errors only. They do not change formula results or serialized values.

## Diagnostics

New diagnostic directions:

```text
unsupported_temporal_format_directive
invalid_temporal_format_trailing_percent
temporal_format_requires_directive
format_value_kind_mismatch
temporal_format_directive_value_mismatch
temporal_format_offset_requires_offset_qualified_value
duration_format_requires_fixed_duration
```

Exact diagnostic names may be refined during implementation, but implementation must distinguish:

- parse-time invalid temporal format specs
- render-time value kind incompatibility
- render-time temporal directive incompatibility
- render-time missing offset qualification
- render-time duration format on calendar durations with year or month components

## Canonical Serialization

Temporal format specs serialize back to their canonical pattern string:

```text
2026-03-24 {:%Y-%m-%d}
14:30:05 {:%H:%M:%S}
P1DT2H3M4S {:%[h]:%M:%S}
2026-03-24T14:30:05Z {:%Y-%m-%d %H:%M:%S%:z} {::>}
```

The serializer must not rewrite supported directives into locale-specific forms.

`%F`, `%T`, and bracketed duration directives may be preserved as authored if parsed successfully. They do not need to expand during canonical serialization.

## Examples

```text
2026-03-24 {:%Y-%m-%d}               -> 2026-03-24
2026-03-24 {:%m/%d/%Y}               -> 03/24/2026
14:30:05.250 {:%H:%M}                -> 14:30
14:30:05.250 {:%H:%M:%S}             -> 14:30:05
14:30:05.250 {:%H:%M:%S.%f}          -> 14:30:05.250000
2026-03-24T14:30:05Z {:%F %T%:z}     -> 2026-03-24 14:30:05+00:00
2026-03-24T14:30:05-04:00 {:%z}      -> -0400
```

## Implementation Notes

Implementation should introduce a temporal formatting module rather than spreading directive logic through presentation code.

Suggested structure:

```text
runtime/displayMetadata.ts
runtime/temporalFormat.ts
presentation.ts
```

Responsibilities:

- `parseFormatSpec` chooses numeric versus temporal parsing
- `validateFormatSpec` validates only parse-time format compatibility
- temporal formatter validates value/directive compatibility at presentation time
- presentation attaches diagnostics without changing evaluation results
- serializer delegates to `serializeFormatSpec`

The implementation should avoid fallback parsing. Unsupported format specs must fail early.

## Test Requirements

Tests must cover:

- `FormatSpec` union parsing for numeric and temporal specs
- numeric format behavior remains unchanged
- temporal canonical serialization
- date formatting with `%Y`, `%m`, `%d`, `%F`
- time formatting with `%H`, `%M`, `%S`, `%f`, `%T`
- datetime formatting with date and time directives
- offset formatting with `%z` and `%:z`
- `Z` normalization to `+0000` / `+00:00`
- unsupported directives fail at parse time
- locale-sensitive directives fail at parse time
- bare trailing `%` fails at parse time
- numeric format on temporal value produces presentation diagnostic
- temporal format on number value produces presentation diagnostic
- date value with time directive produces presentation diagnostic
- time value with date directive produces presentation diagnostic
- offset directive on offset-naive value produces presentation diagnostic
- formula cells carrying temporal display metadata round-trip correctly
- column default temporal display metadata applies to compatible temporal cells

## Future Work

Potential future extensions:

- explicit locale-aware presentation API
- week calendar directives
- weekday and month names under explicit locale
- boolean display formats
- blank/null placeholders
- error display policies
- duration-specific formatting
- text debug/quote display formatting
