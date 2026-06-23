# RFC-0005: Formula and Evaluation Model

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the minimal formula and evaluation model for Ordinate.

It defines the distinction between literal cells and formula cells, the role of `=`, the basic value model, the role of cached values, and the rule that formulas in this RFC evaluate to a single value.

## Goals

This RFC defines:

- the distinction between literal cells and formula cells
- how formulas are introduced
- the minimal runtime value model
- the distinction between user literal parsing and cache serialization
- the role of cached values
- the basic status of null, error, and blank-related values
- the rule that formulas in this RFC produce a single value

## Non-Goals

This RFC does not define:

- range evaluation
- multi-cell expressions
- aggregate functions over collections
- full function library design
- external library integration
- dependency graph algorithms
- recalculation strategy
- performance optimization
- date parsing rules
- detailed coordinate-based evaluation rules

## Core Distinction

A cell input is either:

- a **literal cell**
- a **formula cell**

A literal cell stores a literal value.

A formula cell stores an expression and may also store a cached result.

## Formula Form

A formula cell is identified by a top-level `=`.

There are two valid forms:

- `= expression`
- `cached_value = expression`

The first form means the formula has no stored cache value.

The second form means the formula has a stored cached value on the left and an expression on the right.

Examples:

- `= 1 + 2`
- `3 = 1 + 2`
- `true = 1 == 1`
- `null = someExpression`
- `error = someExpression`

A top-level `=` inside quoted text does not introduce a formula.

Example:

- `"=1+2"` is a literal string, not a formula

## Top-Level `=` Rule

In a formula cell, the top-level `=` separates:

- the optional cached value on the left
- the expression on the right

Parsing must ignore `=` characters that occur inside quoted strings.

This RFC assumes normal parser behavior for quoted strings and does not treat this as a special design problem.

## Literal Parsing

Ordinate uses weak, inferred literal typing for ordinary user input.

This RFC distinguishes between:

- **user literal parsing**
- **cache literal serialization**

These are related, but not identical.

## User Literal Parsing

For ordinary user input, Ordinate applies a literal parsing order.

Current working direction:

1. quoted text parses as string
2. numeric literal parses as number
3. reserved literals parse as their reserved meanings
4. all other unquoted text parses as string

This RFC does not yet define date inference.

Examples:

- `"hello"` → string
- `"=1+2"` → string
- `123` → number
- `3.14` → number
- `Cost of Sales` → string
- `null` → reserved literal
- `error` → reserved literal

## Cache Literal Serialization

The cached value on the left side of a formula uses a stricter serialization form.

Because cached values are machine-generated, they must use a canonical and unambiguous literal syntax.

In particular:

- numbers may appear unquoted
- booleans may appear unquoted
- reserved literals may appear unquoted
- strings must be quoted
- plain unquoted strings are not allowed as cached values

Examples of valid cached values:

- `3 = 1 + 2`
- `"hello" = someExpression`
- `true = 1 == 1`
- `null = someExpression`
- `error = someExpression`

Example of invalid cached value form:

- `hello = someExpression`

That form is invalid because cached strings must be quoted.

## Value Model

In this RFC, a formula evaluates to exactly one value.

The minimal runtime value categories are:

- number
- string
- boolean
- null
- error

This RFC does not yet define date as a first-class runtime value.

`blank` is recognized as an important value category for later RFCs, but its concrete runtime semantics are deferred in this RFC.

## Reserved Literals

This RFC treats the following as reserved literals:

- `null`
- `error`

These may not be used as unquoted plain strings.

Examples:

- `null` means the null literal
- `error` means the error literal
- `"null"` means the string `"null"`
- `"error"` means the string `"error"`

Future RFCs may expand the reserved literal set.

`blank` is not introduced as a reserved literal in this RFC.

## Null and Error

### Null

`null` is a first-class value used primarily to represent an empty or missing **evaluation result** in a strict serialized form.

Literal `null` input is still syntactically allowed, but this RFC treats `null` primarily as an evaluated outcome rather than a commonly authored business literal.

This RFC does not fully define the relationship between:

- null
- blank cell input
- empty string

Those distinctions remain open, but `null` is adopted here as the canonical serialized null-like value.

### Error

`error` is a first-class evaluated value.

It is not source input in itself, but one possible result of evaluation.

Examples of future error causes may include:

- unresolved reference
- ambiguous reference
- cyclic dependency
- invalid operation

Structured error kind modeling is defined later in RFC-0015.

Current cross-RFC direction:

- runtime category remains `error`
- stable error kind codes use RFC-0015 syntax and semantics

## References Inside Formulas

References may appear inside formulas.

This RFC relies on RFC-0004 for reference syntax.

Examples:

- `= @["Revenue"."Total Revenue",2025]`
- `620 = @["Operating Income",2025]`
- `true = @["Revenue",2025] == @["Cost of Sales",2025]`

In this RFC, references used in formulas must resolve to a single cell value.

## Minimal Expression Model

This RFC defines only a minimal expression model.

Examples of expression forms that are in scope:

- literals
- references
- parentheses
- basic arithmetic operators
- basic comparison operators
- simple function calls as syntactic examples

Examples:

- `= 1`
- `= 1 + 2`
- `= @["Revenue"."Total Revenue",2025]`
- `= (@["Revenue",2025] - @["Cost of Sales",2025])`
- `true = 1 == 1`

## Function Calls

This RFC allows function call syntax to exist, but does not define a function library.

Examples:

- `= ABS(-3)`
- `= LOWER("Hello")`

This RFC does not define aggregate functions over ranges or collections.

## Single-Value Rule

Every formula in this RFC evaluates to exactly one value.

This means this RFC does not include:

- range-valued expressions
- list-valued expressions
- collection-valued references
- aggregate functions over multi-cell selections

Those topics are deferred.

## Cached Values

A formula cell may store a cached value.

The cached value is:

- derived
- persistable
- visible in the text form
- not the source of truth

The source of truth for a formula cell is the expression on the right side of the top-level `=`.

Examples:

- `= 1 + 2` has no stored cache
- `3 = 1 + 2` has a stored cache of `3`

A processor may recompute or replace cached values.

## Evaluation

Evaluation takes an expression and produces a single runtime value.

That value may be:

- number
- string
- boolean
- null
- error

This RFC does not define the full evaluation algorithm.

It only establishes the conceptual output model.

## Cycles

Cyclic references are invalid.

This RFC does not define the implementation algorithm for cycle detection, but it recognizes cycle invalidity as a required property of the system.

## Example Table

```text
# Income Statement

| Line Item                || 2024 | 2025 | Actual |
| ------------------------ || ---- | ---- | ------ |
| Revenue                ||      |      |        |
| * Product Revenue      ||      |      |        |
| ** Phone Revenue         || 400  | 450  | 445    |
| ** Computer Revenue      || 500  | 560  | 558    |
| ** Headphones Revenue    || 300  | 390  | 392    |
| * Service Revenue        || 200  | 240  | 241    |
| Cost of Sales          ||      |      |        |
| * Materials              || 400  | 460  | 455    |
| * Fulfillment            || 80   | 95   | 96     |
| * Depreciation           || 20   | 25   | 24     |
| Operating Income         || 500  | 620  | 619    |
```

## Example Formula Cells

```text
= 1 + 2
3 = 1 + 2

= @["Revenue"."Phone Revenue",2025]
450 = @["Revenue"."Phone Revenue",2025]

= (@["Revenue"."Phone Revenue",2025] + @["Revenue"."Computer Revenue",2025])
1010 = (@["Revenue"."Phone Revenue",2025] + @["Revenue"."Computer Revenue",2025])

= "hello"
"hello" = "hello"

= 1 == 1
true = 1 == 1

= @["Missing Row",2025]
error = @["Missing Row",2025]

= someExpressionThatProducesNull
null = someExpressionThatProducesNull
```

## Deferred Topics

- **Date inference and date literals**: examples include `2025-03-09` and typed date semantics
- **Blank value type**: introduction of `blank` as a first-class value type is deferred
- **Blank versus null versus empty string**: the exact distinction is deferred
- **Blank coercion rules**: examples include future behavior such as coercion to `0` or `""` in selected contexts
- **Aggregate functions over collections**: examples include `SUM(...)` over future range selectors
- **Collection-valued references**: examples depend on future range and selector RFCs
- **Function libraries and extensions**: built-ins, namespaces, and external integrations are deferred
- **Structured error values**: examples include future forms such as `error(unresolved_reference)`
- **Recalculation and dependency algorithms**: topological ordering, dirty propagation, and incremental recomputation are deferred

## Open Questions

- whether `null` should remain the canonical serialized null-like value
- whether `error` should later gain structured subtypes
- whether booleans should be limited to `true` and `false`
- how quoted strings should escape embedded quote characters
- whether future literal parsing should include dates
- whether the cached value should always be emitted by serializers or remain optional
- how blank cells should relate to `null` in later RFCs
- whether and where `blank` should coerce to `0` or `""`

## Current Working Assumptions

- a cell is either a literal cell or a formula cell
- a top-level `=` marks a formula cell
- `= expression` means no stored cache
- `cached_value = expression` means a stored cache exists
- quoted strings are explicit string literals
- cached values use a stricter literal serialization than ordinary user input
- formulas in this RFC evaluate to exactly one value
- cyclic references are invalid
