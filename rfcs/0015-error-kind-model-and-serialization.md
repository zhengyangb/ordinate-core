# RFC-0015: Error Kind Model and Serialization

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines a structured error model for Ordinate values.

The runtime error category remains unified as `error`, but each error value carries a stable `kind`.

The canonical textual form is `error[kind]`.

For backward compatibility, bare `error` is still accepted and is treated as `error[generic]`.

## Goals

This RFC defines:

- the error literal syntax direction
- stable error kind naming
- the internal structured error value model
- serialization behavior for errors
- compatibility with legacy bare `error`
- forward-compat behavior for unknown kinds

## Non-Goals

This RFC does not define:

- human-readable localized error message text in serialized files
- rich serialized error payloads
- complete UI wording for each error kind
- full arithmetic semantics for all error-producing operations

## Core Principle

Error is one runtime value category, but not one undifferentiated value.

Current working direction:

- keep a single runtime category: `error`
- require stable machine-meaningful `kind`
- keep serialized representation stable and compact

## Error Literal Syntax

Supported syntax direction:

- canonical: `error[kind]`
- compatibility input: `error` (equivalent to `error[generic]`)

Examples:

- `error[parse_error]`
- `error[type_error]`
- `error[div_by_zero]`
- `error` (parsed as `error[generic]`)

Notes:

- this RFC uses bracket syntax to avoid confusion with function-call syntax
- this RFC does not define serialized payload syntax

## Error Kind Naming

Current working direction:

- kinds are stable identifiers in lowercase snake_case
- kinds are semantic codes, not user-facing prose

Initial closed set (v1 direction):

- `generic`
- `parse_error`
- `type_error`
- `div_by_zero`
- `unresolved_reference`
- `ambiguous_reference`
- `cycle`

The set is versioned by RFC evolution and may be extended in future RFCs.

## External vs Internal Kinds

Current working direction:

- `external kind` is the stable serialized/public contract
- `internal kind` is optional runtime diagnostics detail
- internal kind is not part of `.ord` ABI

Example shape direction:

- external: `error[type_error]`
- runtime diagnostics (non-serialized): internal detail such as `invalid_arithmetic`

Internal detail may be shown in debug tooling but is not guaranteed stable across versions.

## Internal Model

Current working direction:

- model error values as structured tagged data
- recommended shape:
  - `kind: "error"`
  - `errorKind: string` (stable external code, for example `div_by_zero`)
  - optional runtime diagnostics:
    - `internalKind?: string`
    - `diagnostics?: object`

This RFC defines semantic shape, not implementation style.

Implementations may use union types, enums, or classes internally, but externally visible semantics must follow this RFC.

## Serialization and Round-Trip

Current working direction:

- canonical output uses `error[kind]`
- compatibility input `error` canonicalizes to `error[generic]`
- only stable external kind is serialized
- payload/message text is not serialized

Round-trip requirement:

- `error[kind]` must preserve `kind` through parse/serialize cycles

## Unknown Kind Handling

Current working direction:

- parsers must accept unknown kinds syntactically if valid identifier format
- unknown kind must still be represented as `error` with the original `kind` string preserved
- evaluators may treat unknown kinds as generic runtime error behavior

This preserves forward compatibility across versions.

## UI and Diagnostics Guidance

Current working direction:

- default cell display may remain `error`
- UI inspector/tooltip may show specific `kind`
- UI may optionally show internal diagnostics in debug/inspector surfaces
- localized user message is derived at render time from `kind`, not stored in serialized text
- UI mapping from `kind` to display text is frontend-defined

## Mapping Guidance

Current working direction:

- implementations may map many internal details to one external kind
- mapping should be deterministic and documented

Illustrative mapping direction:

- parse-level failures -> `parse_error`
- invalid operations/type mismatches -> `type_error`
- unresolved selectors/references -> `unresolved_reference`
- division by zero -> `div_by_zero`
- dependency cycles -> `cycle`
- fallback/unknown runtime failures -> `generic`

## Validation and Conformance

Conformance checks should include:

- parse accepts `error[kind]` and `error`
- serialize canonicalizes bare `error` to `error[generic]`
- parse/serialize preserves known and unknown `kind`
- invalid kind syntax is rejected deterministically
- if internal diagnostics exist, external-kind projection is deterministic

## Future Work

- optional in-memory diagnostic payloads (not serialized)
- richer error taxonomy and operation-specific codes
- standardized mapping from `kind` to UI severity and help text
