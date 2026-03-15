# RFC-0008: Function Contracts and Illustrative Functions

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the initial function contract model for Ordinate.

It does not attempt to define a complete function library. Instead, it defines how functions are described, how arguments are constrained, how runtime types and contract types are distinguished, how view dimensionality participates in function contracts, and a small set of illustrative functions that can serve as examples for implementation and testing.

## Goals

This RFC defines:

- function call syntax
- function contract syntax
- the distinction between runtime types and contract types
- the use of view dimensionality constraints in function contracts
- the basic rules for argument checking
- a small illustrative function set for examples and conformance testing

## Non-Goals

This RFC does not define:

- a complete standard library
- namespace-qualified functions
- variadic aggregate calls such as `sum(a, b, c)`
- explicit conversion functions
- external library integration
- advanced overload resolution
- list literals
- sparse multi-point collection literals

## Core Idea

Functions in Ordinate are described by **contracts**.

A function contract does not necessarily describe the nominal runtime type of an expression. Instead, it describes what kind of evaluated input a function can accept.

This is important because many Ordinate expressions are only fully typed at evaluation time.

For example:

- `3` evaluates to a number
- `@[_,_]` may evaluate to a number, string, boolean, blank, or error depending on the referenced cell
- `@[:,2025]` evaluates to a `view`, whose dimensionality and element values must be checked at function-call time

## Function Call Syntax

The current function call form is:

`name(arg1, arg2, ...)`

Examples:

- `sum(@[:,2025])`
- `abs(-3)`
- `not(true)`
- `dotProduct(@["Revenue",:], @["Cost of Sales",:])`

This RFC assumes lowercase function names in examples.

## Runtime Types

This RFC relies on the current runtime type model established earlier.

The current working runtime types are:

- `number`
- `string`
- `boolean`
- `blank`
- `error`
- `view`

`view` is a real runtime type. It is not a contract type.

A `view` is a table-derived object that preserves cell identity, position, shape, and value access.

## View Shape Constraints

This RFC uses view shape constraints to describe properties of runtime `view` values.

The current working shape forms are:

- `view[d=0]`
- `view[d=1]`
- `view[d=2]`
- `view[d<=2]`

These are not separate runtime type families. They are constrained forms of the runtime type `view`.

Current working interpretation:

- `view[d=0]` means shape `1×1`
- `view[d=1]` means shape `1×N` or `N×1`, with `N >= 1`
- `view[d=2]` means shape `M×N`, with `M > 1` and `N > 1`
- `view[d<=2]` means any currently supported view dimensionality

These constraints are not exclusive; a `1×1` view satisfies both `view[d=0]` and `view[d=1]`.

## Contract Types

This RFC introduces **contract types** for function signatures.

Contract types are not the same as runtime types. They are interface-like acceptance conditions checked against evaluated inputs.

The current working contract types are:

- `Scalar[T]`
- `Iterable[T]`
- `Vector[T]`

## Contract Type Meanings

### `Scalar[T]`

`Scalar[T]` means the argument must evaluate to a single value of type `T`.

This may include:

- a literal or expression that directly evaluates to `T`
- a `view[d=0]` whose referenced cell evaluates to `T`

Examples:

- `Scalar[number]`
- `Scalar[boolean]`

### `Iterable[T]`

`Iterable[T]` means the argument must be consumable as a finite ordered sequence of values of type `T`.

This is a contract-level abstraction. It is not defined in terms of host-language methods such as `__iter__`.

Current working direction:

- a `view` may satisfy `Iterable[T]` when flattening is defined
- a future list literal may also satisfy `Iterable[T]`
- for now, `view` is the only runtime value that satisfies `Iterable[T]`

An iterable does not imply one-dimensionality.

### `Vector[T]`

`Vector[T]` means the argument must be consumable as a one-dimensional ordered sequence of values of type `T`.

Current working direction:

- `view[d=1]` may satisfy `Vector[T]`
- a future one-dimensional list literal may also satisfy `Vector[T]`
- for now, `view[d=1]` is the only runtime value that satisfies `Vector[T]`

A vector is stricter than an iterable because it requires one-dimensional structure.

## Relationship Between Runtime Types and Contract Types

This RFC adopts the following current direction:

- `view[d=0]` may satisfy `Scalar[T]` if its cell value has runtime type `T`
- `view` may satisfy `Iterable[T]` when flattening is defined and its elements have runtime type `T`
- `view[d=1]` may satisfy `Vector[T]` when its elements have runtime type `T`
- scalar runtime values do not satisfy `Iterable[T]` or `Vector[T]` unless they are wrapped in a `view`

These relationships are checked at function-call time.

## Argument Checking

Function argument checking occurs after evaluation.

A function call may fail because:

- the evaluated argument has the wrong runtime value type
- the evaluated argument does not satisfy the required view shape constraint
- the evaluated argument does not satisfy the required contract type
- the evaluated argument contains incompatible element values
- the evaluated argument is `error`

This RFC does not define a static type system.

## Error Policy

Current working direction:

- if a function does not explicitly define special handling for `error`, then `error` propagates
- blank-handling is function-specific unless inherited from previously defined operator semantics
- argument mismatch produces `error`

## No General Overloading in This RFC

This RFC does not define overloads as a general feature.

A function has one contract form in this RFC.

For example:

- `sum(x: Iterable[number]) -> number`

and not both:

- `sum(x: Iterable[number]) -> number`
- `sum(x1: Iterable[number], x2: Iterable[number], ...) -> number`

Support for future collection literals may later make it possible to express multiple inputs through explicit containers instead of overloads.

## Illustrative Functions

This RFC defines a very small set of illustrative functions.

These are examples, not the complete built-in library.

### `abs`

Contract:

`abs(x: Scalar[number]) -> number`

Meaning:

- evaluates `x`
- requires a numeric scalar input
- returns its absolute value

Examples:

- `abs(-3) -> 3`
- `abs(@[_,_])` is valid only if `@[_,_]` evaluates to a numeric scalar

### `not`

Contract:

`not(x: Scalar[boolean]) -> boolean`

Meaning:

- evaluates `x`
- requires a boolean scalar input
- returns logical negation

Examples:

- `not(true) -> false`
- `not(false) -> true`

### `sum`

Contract:

`sum(x: Iterable[number]) -> number`

Meaning:

- accepts an iterable of numbers
- a `view` may satisfy this contract when flattening is defined
- values are reduced using `+`
- scalar values do not satisfy this contract

Its handling of:

- `blank`
- `boolean`
- `error`

is inherited from the semantics of `+` in RFC-0006 whenever that reduction model is applied.

Examples:

- `sum(@[:,2025])`
- `sum(@["Revenue",:])`
- `sum(@[_,_])`

### `dotProduct`

Contract:

`dotProduct(x: Vector[number], y: Vector[number]) -> number`

Meaning:

- both arguments must satisfy `Vector[number]`
- both inputs must have compatible lengths
- values are multiplied pairwise and summed

This function is included mainly as an example of a one-dimensional contract.

Examples:

- `dotProduct(@["Revenue",:], @["Cost of Sales",:])`
- `dotProduct(@[:,2025], @[:,2024])`

This RFC does not yet define the exact mismatch error wording for unequal lengths.

## Examples

### Scalar-Contract Examples

- `abs(3)`
- `abs(@[_,_])`
- `not(true)`
- `not(@[_,_])`

### Iterable-Contract Examples

- `sum(@[:,2025])`
- `sum(@["Revenue",:])`
- `sum(@[_,_])`

### Vector-Contract Examples

- `dotProduct(@["Revenue",:], @["Cost of Sales",:])`
- `dotProduct(@[:,2025], @[:,2024])`

## Deferred Topics

- namespace-qualified functions
- explicit conversion functions such as `toNumber(...)`
- list literals
- `Iterable[T]` as a fully realized user-visible container system
- overload resolution
- variadic functions
- richer aggregate set such as `count`, `min`, `max`, `median`
- structured error contracts
- function purity annotations
- external library bindings

## Open Questions

- whether `sum` should later accept only numeric iterables or more general iterable inputs with coercion
- whether `view[d=0]` should automatically satisfy `Scalar[T]` whenever its value has runtime type `T`
- whether future collection literals should satisfy `Iterable[T]`
- whether future one-dimensional collection literals should satisfy `Vector[T]`
- how function documentation should present view shape constraints to users
- whether any illustrative functions should later become standardized built-ins

## Current Working Assumptions

- functions are defined by contracts, not by broad overload sets
- contract checking happens after evaluation
- `view` is a runtime type
- `view[d=0]`, `view[d=1]`, and related forms are shape constraints on `view`
- `Scalar[T]`, `Iterable[T]`, and `Vector[T]` are contract/interface types
- `sum` currently uses `Iterable[number]` as its contract
- `dotProduct` is the canonical example of a one-dimensional contract
- this RFC defines only an illustrative function subset for examples and testing
