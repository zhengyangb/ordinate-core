# RFC-0029: Temporal Formula Semantics

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines deterministic formula semantics for Ordinate temporal values:

```text
date
time
datetime
duration
```

It extends RFC-0014 by defining temporal precision, offset policy, constructors, extractors, conversions, and arithmetic.

This RFC intentionally does not define temporal display formatting or non-deterministic clock functions.

## Motivation

RFC-0014 introduced temporal value types and ISO 8601-oriented literals, but it explicitly left temporal utility functions and temporal arithmetic as future work.

Ordinate now needs a coherent formula-level temporal model so users can:

- construct temporal values from parts
- extract year/month/day/hour/minute/second components
- combine a date and a time into a datetime
- add fixed durations to date/time/datetime values
- subtract dates or datetimes to obtain durations
- convert offset-qualified datetimes to and from Unix timestamps

The core requirement is deterministic evaluation. Formula results must not depend on the host system timezone, locale, or current clock time.

## Relationship To RFC-0014

RFC-0014 remains the source for:

- the existence of `date`, `time`, `datetime`, and `duration` value types
- native literal parsing direction
- `offset-qualified` and `offset-naive` terminology
- the principle that value semantics and display formatting are separate

This RFC refines temporal formula semantics without changing RFC-0014 display metadata rules.

## Goals

This RFC defines:

- a strict temporal literal subset policy
- date offset rules
- offset-only timezone policy
- millisecond precision policy
- deterministic temporal constructors
- temporal component extractors
- explicit temporal conversions
- supported temporal arithmetic
- Unix millisecond conversion for offset-qualified datetimes
- error behavior for mixed offset semantics and unsupported durations

## Non-Goals

This RFC does not define:

- temporal display format syntax
- locale-sensitive formatting
- IANA timezone database support
- daylight saving time rules
- `today()`
- `now()`
- automatic use of the host system clock
- automatic use of the host system timezone
- nanosecond or microsecond precision
- implicit rounding of fractional seconds
- calendar-month or calendar-year duration arithmetic
- Excel serial date numbers

## Temporal Literal Subset

Ordinate temporal literals are a strict ISO 8601-inspired subset, not full ISO 8601.

Supported literal forms:

```text
date      YYYY-MM-DD
time      HH:MM
time      HH:MM:SS
time      HH:MM:SS.sss
datetime  YYYY-MM-DDTHH:MM
datetime  YYYY-MM-DDTHH:MM:SS
datetime  YYYY-MM-DDTHH:MM:SS.sss
duration  P... / PT...
```

Supported offset suffixes for `time` and `datetime`:

```text
Z
+HH:MM
-HH:MM
```

Unsupported examples:

```text
20260324
2026-W13-2
2026-084
2026-03-24Z
America/New_York
```

Quoted temporal-looking text remains text:

```text
"2026-03-24" -> text
```

## Offset Policy

Ordinate supports fixed offsets only.

Supported:

```text
Z
+08:00
-04:00
```

Unsupported:

```text
America/New_York
Asia/Shanghai
Europe/Berlin
```

`Z` is equivalent to `+00:00`.

An offset is a fixed offset from UTC. It is not a named timezone and does not imply daylight saving time rules.

Core evaluation must not read the host system timezone.

## Offset-Naive And Offset-Qualified Values

`date` values are always offset-naive.

Valid:

```text
2026-03-24
```

Invalid:

```text
2026-03-24Z
2026-03-24+08:00
```

`time` and `datetime` may be offset-naive or offset-qualified:

```text
14:30
14:30:00-04:00
2026-03-24T14:30
2026-03-24T14:30:00Z
```

Offset-qualified datetimes represent absolute timeline instants.

Offset-naive datetimes represent calendar datetimes without a known timeline instant.

Offset-naive and offset-qualified datetimes must not be mixed in arithmetic.

## Precision Policy

Temporal precision is millisecond.

Fractional seconds may contain zero to three digits:

```text
14:30:00
14:30:00.1
14:30:00.12
14:30:00.123
PT0.001S
```

More than three fractional second digits is invalid:

```text
14:30:00.1234
2026-03-24T14:30:00.1234Z
PT0.0001S
```

There is no implicit rounding or truncation.

Core temporal arithmetic may use millisecond integer arithmetic internally. It must not silently lose fractional precision.

Implementation note: RFC-0014-era parsing currently accepts more than three fractional second digits. Implementing this RFC requires tightening temporal literal validation so unsupported precision fails early instead of being silently accepted.

## Duration Classes

ISO-like durations can contain calendar components and fixed-time components.

Calendar components:

```text
Y
M in the date part
```

Fixed components:

```text
D
H
M in the time part
S
```

Examples:

```text
P1Y      # calendar duration
P1M      # calendar duration
P7D      # fixed day duration
PT1H     # fixed time duration
PT30M    # fixed time duration
PT0.001S # fixed time duration
```

Arithmetic supports only fixed durations.

Calendar duration arithmetic is not defined:

```text
date(2026, 1, 31) + P1M -> error
```

This avoids implicit choices about month-end behavior.

## Constructors

### `date(year, month, day)`

Contract:

```text
date(year: number, month: number, day: number) -> date
```

All arguments must be integers.

The resulting calendar date must be valid.

Examples:

```text
date(2026, 3, 24) -> 2026-03-24
date(2026, 2, 29) -> error
```

### `time(hour, minute, second?)`

Contract:

```text
time(hour: number, minute: number) -> time
time(hour: number, minute: number, second: number) -> time
```

`hour` and `minute` must be integers.

`second` may be an integer or a millisecond-precision decimal.

Examples:

```text
time(14, 30) -> 14:30
time(14, 30, 5.25) -> 14:30:05.250
```

### `datetime(date, time)`

Contract:

```text
datetime(date: date, time: time) -> datetime
```

The resulting datetime inherits the time offset state.

Examples:

```text
datetime(2026-03-24, 14:30) -> 2026-03-24T14:30
datetime(2026-03-24, 14:30:00Z) -> 2026-03-24T14:30:00Z
```

### `duration(...)`

This RFC supports explicit duration construction only for fixed durations.

Open design choice:

```text
duration(days?, hours?, minutes?, seconds?) -> duration
```

or:

```text
duration(text) -> duration
```

This RFC prefers the part-based form because it avoids reparsing text in formulas:

```text
duration(days, hours, minutes, seconds)
```

All omitted components are zero.

## Signed Durations

Duration literals and runtime duration values may carry a leading `-`.

Examples:

```text
PT1H
-PT1H
P1D
-P1D
```

Signed durations are necessary because subtraction can produce negative elapsed time:

```text
2026-03-24T13:30:00Z - 2026-03-24T14:30:00Z -> -PT1H
```

## Extractors

### Date Components

```text
year(date | datetime) -> number
month(date | datetime) -> number
day(date | datetime) -> number
```

### Time Components

```text
hour(time | datetime) -> number
minute(time | datetime) -> number
second(time | datetime) -> number
millisecond(time | datetime) -> number
```

`second` returns the whole second component.

`millisecond` returns the millisecond component.

Example:

```text
second(14:30:05.250) -> 5
millisecond(14:30:05.250) -> 250
```

## Conversions

### `date(datetime)`

`date(datetime)` extracts the calendar date component.

```text
date(2026-03-24T14:30:00Z) -> 2026-03-24
```

### `time(datetime)`

`time(datetime)` extracts the time component and preserves offset state.

`time(date)` is invalid. A date does not implicitly acquire a midnight clock.
Callers that need midnight must explicitly construct `datetime(date, 00:00)`.

The standard type predicate `isDate(value)` returns true only for the native
`date` kind. It returns false for `datetime` (including midnight), date-looking
text, numbers, blank, null and errors. Like the predicates in RFC-0023, it maps
over views element-wise. This distinguishes calendar types without changing
extraction or arithmetic semantics; Excel adapter decisions are in RFC-0042.

```text
time(2026-03-24T14:30:00Z) -> 14:30:00Z
```

### `datetime(date, time)`

Combines a date and a time into a datetime.

There is no conversion from `time` alone to `date`.

There is no conversion from offset-naive datetime to offset-qualified datetime without an explicit offset operation.

## Arithmetic

### Date Arithmetic

Supported:

```text
date + fixed-day-duration -> date
date - fixed-day-duration -> date
date - date -> duration
```

Only whole-day fixed durations are valid with dates.

Invalid:

```text
date + PT1H -> error
date + P1M  -> error
```

### Time Arithmetic

Supported:

```text
time + fixed-time-duration -> time
time - fixed-time-duration -> time
time - time -> duration
```

Open design choice:

- allow wrapping across midnight
- or fail if the result exits the same day

This RFC prefers fail early in V1:

```text
time(23, 30) + PT2H -> error
```

### Datetime Arithmetic

Supported:

```text
datetime + fixed-duration -> datetime
datetime - fixed-duration -> datetime
datetime - datetime -> duration
```

Rules:

- offset-qualified datetime minus offset-qualified datetime is timeline arithmetic
- offset-naive datetime minus offset-naive datetime is naive calendar datetime arithmetic
- offset-qualified datetime minus offset-naive datetime is invalid
- offset-naive datetime minus offset-qualified datetime is invalid

Examples:

```text
2026-03-24T14:30:00Z - 2026-03-24T13:30:00Z -> PT1H
2026-03-24T14:30 - 2026-03-24T13:30 -> PT1H
2026-03-24T14:30:00Z - 2026-03-24T13:30 -> error
```

## Unix Millisecond Conversion

Unix timestamps are absolute timeline values. Therefore V1 only supports Unix conversion for offset-qualified datetimes.

### `unixMillis(datetime)`

Contract:

```text
unixMillis(datetime: datetime[offset-qualified]) -> number
```

Returns milliseconds since `1970-01-01T00:00:00Z`.

The returned value must be exactly representable as an Ordinate `number`. If the millisecond timestamp is outside the JavaScript safe-integer range, the function returns `error`.

Invalid:

```text
unixMillis(2026-03-24T14:30) -> error
```

### `datetimeFromUnixMillis(number)`

Contract:

```text
datetimeFromUnixMillis(ms: number) -> datetime[offset-qualified]
```

Returns a UTC datetime using `Z`.

The input must be an integer.

The input must be exactly representable as an Ordinate `number` integer. Values outside the JavaScript safe-integer range return `error`.

## Non-Deterministic Clock Functions

This RFC does not define:

```text
today()
now()
```

Future RFCs may define deterministic clock injection through evaluator context, but core evaluation must not read the host clock implicitly.

## Display Formatting

Temporal display formatting is out of scope.

Default display remains canonical temporal text.

Future display-format RFCs may define:

- date format tokens
- time format tokens
- datetime format tokens
- duration format tokens
- locale-aware rendering
- app-level regional defaults

Such formatting must not change runtime value semantics.

## Error Behavior

Temporal functions fail early when:

- a date is invalid
- a time is invalid
- fractional seconds exceed millisecond precision
- an arithmetic operation mixes offset-naive and offset-qualified datetimes
- a date operation receives a non-day duration
- arithmetic receives a calendar duration
- Unix conversion receives an offset-naive datetime
- a constructor receives non-integer components where integers are required

## Future Work

- temporal display formats
- deterministic `today` and `now` with injected evaluator clock
- explicit offset conversion functions
- named timezone support with a pinned timezone database
- calendar duration arithmetic
- month-end policy
- microsecond or nanosecond precision
- richer duration constructors
- temporal comparison and sorting policy
