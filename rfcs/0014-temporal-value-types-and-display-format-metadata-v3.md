# RFC-0014: Temporal Value Types and Display Format Metadata

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the current direction for temporal value types, inline display metadata, and table-level default display metadata in Ordinate.

It introduces `date`, `time`, `datetime`, and `duration` value types, adopts native ISO 8601-oriented literal parsing for them, defines offset terminology (`offset-qualified` vs `offset-naive`) for temporal parsing, defines inline cell-level format and style syntax using `{: ... }`, and defines canonical metadata serialization via a display control frame (`@display`) that is stripped from semantic table content.

## Goals

This RFC defines:

- the current value-type set, including `date`, `time`, `datetime`, and `duration`
- native literal parsing direction for `date`, `time`, `datetime`, and `duration`
- offset semantics terminology for temporal values
- inline cell-level display metadata syntax
- the supported first-version numeric format subset
- the supported first-version style subset
- column-level default display metadata semantics
- precedence between cell-level and column-level display metadata
- canonical serialization layout for display metadata

## Non-Goals

This RFC does not define:

- currency
- validation and constraints
- conditional styling
- editor controls
- locale policy
- date/time arithmetic

## Core Principle

Value semantics, display formatting, style, and serialization layout are distinct concerns.

Current working direction:

- value types define runtime meaning
- format defines how a value is rendered into display text
- style defines how that display text is visually presented
- column display defaults are stored as column metadata in the internal model
- display control frame is a serialization convention, not semantic table content

## Supported Value Types

| Type | Example |
|---|---|
| `number` | `1234.5` |
| `string` | `"Revenue: North"` |
| `boolean` | `true` |
| `blank` | `blank` |
| `error` | `error[type_error]` |
| `date` | `2026-03-23` |
| `time` | `14:30` |
| `datetime` | `2026-03-23T14:30:00Z` |
| `duration` | `PT1H30M` |

## Native Temporal Literals

### Offset Terminology

- `offset-qualified`: temporal text with explicit offset suffix (`Z` or `±HH:MM`)
- `offset-naive`: temporal text without explicit offset suffix
- this RFC uses `offset` terminology only; it does not define IANA zone-database semantics

### `date`

- valid unquoted ISO 8601 date forms are parsed as `date`
- `date` literals are always offset-naive
- quoted equivalents remain strings

Example: `2026-03-23`

### `time`

- valid unquoted ISO 8601 time forms are parsed as `time`
- both offset-naive and offset-qualified forms are accepted
- quoted equivalents remain strings

Examples: `14:30`, `14:30:00-04:00`

### `datetime`

- valid unquoted ISO 8601 datetime forms are parsed as `datetime`
- both offset-naive and offset-qualified forms are accepted
- quoted equivalents remain strings

Examples: `2026-03-23T14:30`, `2026-03-23T14:30:00Z`

### `duration`

- valid unquoted ISO 8601 duration forms are parsed as `duration`
- quoted equivalents remain strings

Example: `PT1H30M`

## Inline Cell-Level Display Metadata Syntax

Supported forms:

| Syntax | Meaning | Example |
|---|---|---|
| `body` | no display metadata | `1234.5` |
| `body {: format_spec}` | format only | `1234.5 {:,.2f}` |
| `body {: : style_spec}` | style only | `42 {: :>}` |
| `body {: format_spec : style_spec}` | format and style | `1234.5 {:,.2f:>,red}` |

`body` follows RFC-0016 cell source terminology. It may be a literal body, formula body, or cached-formula body.

Display metadata is a trailing `display` segment and is not part of `input`.

Example: `= sum(A:A) {:,.2f}`

## Format vs Style

### Format

Format changes how a value is rendered into display text.

Examples:

- decimal precision
- thousands separator
- scientific notation
- percentage
- sign policy such as explicit plus or negative parentheses

### Style

Style does not change the display text itself. It changes how the display text is visually presented.

Examples:

- alignment
- color
- bold

## Supported Numeric Format Subset

Current grammar direction:

```text
[sign][0][width][,][.precision][type]
```

Supported components:

| Component | Syntax | Meaning | Example |
|---|---|---|---|
| sign policy default | none | default sign behavior | `1234.5 {:,.2f}` |
| sign policy plus | `+` | always show positive sign | `1234.5 {:+,.2f}` |
| sign policy parentheses | `()` | show negatives with parentheses | `-1234.5 {:(),.2f}` |
| zero padding | `0` | zero-pad to width | `42 {:06.2f}` |
| width | digits | minimum width | `42 {:6.2f}` |
| grouping | `,` | thousands separator | `1234.5 {:,.2f}` |
| precision | `.N` | decimal precision | `0.125 {:.1%}` |
| fixed-point type | `f` | fixed decimal format | `1234.5 {:,.2f}` |
| scientific type | `e` | scientific notation | `1234.5 {:.3e}` |
| percent type | `%` | percentage format | `0.125 {:.1%}` |
| decimal integer type | `d` | decimal integer display | `12345 {:,d}` |

### Format Compatibility Rules

The numeric format grammar is shared across types, but not every component is valid for every type.

| Type | Precision | Grouping | Sign | Width | Zero Pad |
|---|---|---|---|---|---|
| `d` | no | yes | yes | yes | yes |
| `f` | yes | yes | yes | yes | yes |
| `e` | yes | no | yes | yes | yes |
| `%` | yes | yes | yes | yes | yes |

Rules:

- unsupported field and type combinations are invalid
- integer format (`d`) disallows `precision`
- scientific format (`e`) disallows `grouping`
- `zeroPad` requires `width`
- invalid display metadata is preserved in source, but does not produce a local effective format
- structured edit APIs must reject invalid combinations

## Supported Style Subset

Current grammar direction:

```text
style_item ( "," style_item )*
```

Supported style items:

| Style | Full Form | Shorthand | Example |
|---|---|---|---|
| left align | `align=left` | `<` | `42 {: :<}` |
| right align | `align=right` | `>` | `42 {: :>}` |
| center align | `align=center` | `^` | `42 {: :^}` |
| bold weight | `weight=bold` | `bold` | `42 {: :bold}` |
| normal weight | `weight=normal` | `normal` | `42 {: :normal}` |
| red text | `color=red` | `red` | `42 {: :red}` |
| green text | `color=green` | `green` | `42 {: :green}` |
| blue text | `color=blue` | `blue` | `42 {: :blue}` |

Current direction:

- both full form and shorthand are accepted
- canonical serialization rewrites style to shorthand tokens
- canonical style token order is `align -> weight -> color`
- `normal` is distinct from unspecified weight

## Column-Level Default Display Metadata

Ordinate supports default display metadata for an entire column.

Current working direction:

- column-level display metadata is the recommended default mechanism
- cell-level inline format or style remains supported as an override
- the internal model stores column display metadata as column metadata

This means column display metadata does **not** semantically belong to ordinary table rows, even though canonical `.ord` may carry it in serialization-only control frame cells.

## Display Control Frame Serialization

Canonical serialization uses a display control frame when any column default metadata is present.

Current working direction:

- first row is a control row
- first cell in that row is `@display`
- remaining cells in that row correspond to semantic columns and carry metadata-only blocks such as `{:,.2f}` or `{::>}`
- every semantic row is serialized with a leading reserved control column cell
- when a header divider exists, divider dashes must include the control-column cell
- parser/runtime strips this control frame before semantic validation, evaluation, and selector resolution
- control-frame cells (except top-left marker) must be metadata-only or blank

The control frame is serialization-only scaffolding. It is not part of semantic row/column addressing.

## Precedence

Current working precedence:

| Priority | Source | Example |
|---|---|---|
| 1 | cell inline format/style | `999.9 {:.3f}` |
| 2 | column display metadata | `Price {:,.1f:>}` |
| 3 | UI / regional default | browser/app default |

For style specifically, precedence is resolved per axis (`align`, `weight`, `color`) rather than as whole-object replacement.

## Cache and Display Metadata

Current working direction:

- caches store evaluated values, not rendered display strings
- format and style do not become part of value cache
- locale does not become part of value cache

Formula caches store evaluated values, not formatted or styled display text.

Future versions may consider optional display-text caching as an implementation optimization, but such cached display text would not be authoritative and would not replace value-cache semantics.

## Full Example

```text
| @display |      || {:,.1f:>} | {:(),.2f:red} | {:.1%:^} | {:,.2f:>} |
|          | Item || Rev       | Cost          | Margin   | Total      |
| -------- | ---- || --------- | ------------- | -------- | ---------- |
|          | A    || 1234.5    | -456.7        | 0.125    | = sum(@[#1,#1:#2]) {:,.2f:>} |
|          | B    || 999.9 {:.3f} | -88.1 {: :bold} | 0.314 {:.2%:^,blue} | = sum(@[#2,#1:#2]) |
```

Interpretation:

- `Rev` column default format is `,.1f`
- `Rev` column default style is `align=right`
- `Cost` column default format is `(),.2f`
- `Cost` column default style is `color=red`
- `Margin` column default format is `.1%`
- `Margin` column default style is `align=center`
- `Total` column default format is `,.2f`
- `Total` column default style is `align=right`

Cell-level overrides:

- `999.9 {:.3f}` overrides the `Rev` column format
- `-88.1 {: :bold}` keeps the column format but adds cell-level style
- `0.314 {:.2%:^,blue}` overrides both format and style
- `= sum(@[#1,#1:#2]) {:,.2f:>}` shows that formulas may also carry display metadata

Formula-cache note:

- the cached value for `= sum(@[#1,#1:#2])` is the evaluated numeric value
- the cache does not store the formatted text produced by `{:,.2f:>}`

## Future Work

- currency
- validation and constraints
- conditional styling
- editor controls such as dropdown, slider, checkbox
- richer style properties
- row-level default display metadata (reserved control column; future extension)
- locale customization policy
- structured internal temporal representation (keep parsed object + raw lexical form for round-trip stability)
- temporal utility functions (for example `date(datetime)`, `time(datetime)`)
- explicit temporal arithmetic semantics (for example `date + duration`)
- full date/time/datetime/duration arithmetic
- extended format mini-language beyond the initial subset
- header demotion and rebinding behavior

## Current Working Assumptions

- `date`, `time`, `datetime`, and `duration` are value types
- `offset-qualified` means explicit `Z` or `±HH:MM`, and `offset-naive` means no offset suffix
- `date` is offset-naive only
- `time` and `datetime` may be offset-naive or offset-qualified
- valid supported unquoted ISO 8601 forms are parsed natively before string fallback
- quoted equivalents remain strings
- inline cell format uses `body {: format_spec}`
- inline cell style uses `body {: : style_spec}`
- combined display metadata may use `body {: format_spec : style_spec}`
- numeric format specs are inspired by a constrained Python-like mini-language
- sign policy includes bare default, `+`, and `()`
- style is separate from format
- style uses axis-level cascading (`cell axis > column axis > UI default`)
- style supports `weight` with `bold` and `normal`, and `normal` is distinct from unspecified
- column display metadata is internal column metadata
- cell inline display metadata overrides column display metadata
- canonical serialization emits display defaults through an `@display` control frame (control row + reserved control column)
- control frame is stripped before semantic table processing
- canonical style serialization uses shorthand tokens and may reorder style items
- caches store values, not rendered strings
