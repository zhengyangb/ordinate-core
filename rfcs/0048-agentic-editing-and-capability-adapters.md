# RFC-0048: Agentic Editing and Capability Adapters

- Status: Draft
- Project: Ordinate

## Summary

Ordinate supports agentic editing through two complementary paths: direct
editing of plain-text `.ord` documents, and structure-aware operations backed
by the existing core. Both paths use the same parser, evaluator, serializer,
and diagnostics to check their results.

This RFC proposes a small, host-independent capability boundary and a delivery
roadmap for CLI, skills, and optional integrations. It does not specify an
agent engine, model provider, frontend, or conversation interface.

The capability projection and user-facing CLI are now implemented under
RFC-0049/0050, including fill and row/column duplication. A dedicated skill,
embedded agent UI, and protocol adapters remain separate roadmap items.
Lightweight fresh-context agent trials are recorded in
[the CLI trial notes](../packages/cli/AGENT_TRIALS.md); they are not an automated benchmark.

The concrete contracts are specified in
[RFC-0049](0049-workbook-capability-contract.md) (shared capabilities) and
[RFC-0050](0050-command-line-interface.md) (CLI behavior).

## Motivation

A readable source format lets agents edit a workbook using ordinary text
editing tools. Requiring a dedicated tool call for every cell would undermine
that advantage. However, some edits benefit from semantic operations: moving
rows, changing hierarchy, and inserting columns can require reference rebasing
and preservation of display metadata.

Neither path should introduce another implementation of Ordinate semantics.
Agents also need concise, machine-readable feedback rather than attempting to
infer correctness from serialized caches or rendered screenshots.

## Goals

- Keep direct text editing a first-class workflow.
- Reuse existing structure-aware edits where preserving semantic targets matters.
- Expose inspection, validation, evaluation, and atomic editing consistently.
- Keep capabilities independent of file I/O, UI state, and agent protocols.
- Make failures explicit and changes attributable to the document examined.
- Deliver useful external automation before requiring an embedded assistant.

## Non-Goals

- Choosing or implementing an agent engine, model, or authentication mechanism.
- Chat panels, terminal embedding, settings, approvals UI, or other frontend UX.
- A hosted backend, collaboration protocol, or automatic conflict merging.
- A new parser, evaluator, reference model, or document format.
- A universal wrapper exposing every internal core function as an agent tool.
- Exact command syntax, wire schemas, package layout, or distribution mechanism.

## Relationship to Existing RFCs

- [RFC-0016](0016-editing-roadmap-and-milestones.md) defines the core editing
  milestones. This RFC describes consumers of those capabilities, not a
  replacement core editing roadmap.
- [RFC-0017](0017-core-edit-v1-contract.md) owns input/cache/display separation,
  target resolution, atomic edits, and failures.
- [RFC-0012](0012-reference-rebasing-and-structural-edit-behavior.md) owns reference
  rebasing; later structural edit RFCs extend the operation families.
- [RFC-0011](0011-serialization-and-round-trip-semantics.md) owns serialization
  and round-trip semantics.
- [RFC-0033](0033-core-edit-inversion-and-history.md) owns session-local core
  inversion. Host history and source-text command boundaries remain outside core.

These contracts remain authoritative. Adapters must not redefine their semantics
or treat session-local identities and history mementos as persistent wire data.

## Architecture

Arrows below indicate dependency, not document ownership or execution order.

```text
                    Ordinate Core
              parser / evaluator / serializer
                  structural edit contracts
                           ^
                           |
               Shared Capability Boundary
             inspect / validate / evaluate / edit
                    ^      ^      ^
                   /       |       \
                  /        |        \
                CLI    In-process    Optional MCP
                         adapter        adapter
```

The capability boundary is a thin projection of existing public core behavior,
not a second engine or a generic command framework. Reuse existing APIs and
types where suitable; add abstractions only for a concrete shared consumer need.

Existing applications may continue to call the public core APIs directly.
This boundary standardizes automation requests and serializable results; it
does not require routing all frontend edits through a new service. Stateful
core identities and inversion remain useful within their owning session.

Its inputs and outputs must not depend on filesystem paths, browser objects,
frontend stores, process handles, or provider-specific message types. Adapters
own transport decoding, file access, and host integration.

An in-process adapter means a host can call capabilities directly. It does not
require a particular application layout or agent implementation. MCP is an
optional transport, not a prerequisite for CLI or in-process use.

## Capability Families

### Inspect

Expose workbook structure and bounded reads of selected sheets or regions.
Relevant information includes names, hierarchy, headers, editable inputs, and
formula text. Function documentation should derive from core metadata.

Keep editable input, stored cache, evaluated value, and display text distinct.
Evaluated values must identify the document snapshot they describe; inspection
must not imply that a stored cache has been recomputed.

### Validate

Check document structure, input syntax, and display metadata using the existing
validator. Return machine-readable diagnostics and the available location.

Validation does not prove business correctness and is not a substitute for
evaluation. Preserve actual diagnostic precision; do not invent source offsets
when core only supplies a semantic cell location.

### Evaluate

Recompute with the existing evaluator and expose typed values and located
runtime errors. Do not substitute stored caches for failed calculations.

Evaluation is read-only from the caller's perspective by default. Persisting
recomputed caches is a separate, explicit adapter action. If that action also
canonicalizes `.ord` text, disclose that it is not a cache-only byte rewrite.

### Edit

Apply an ordered batch through existing core edit contracts. Resolve targets
against staged state and reject unresolved or ambiguous targets. A failed batch
must not partially mutate the authoritative document.

Boundary decoding must reject malformed or unsupported operations. It must not
guess another operation, silently reinterpret intent, or fall back to text edits.
Successful edit application is distinct from validation and evaluation success;
an adapter must report those outcomes separately.

Persistable requests use names, paths, and positions. Session-local row/column
IDs are resolved inside the current operation and are never saved as portable
edit targets. Resolve each operation against the state produced by preceding
operations, rather than resolving a whole batch against its original state.

## Direct Text and Structured Editing

Direct text editing is appropriate for authoring notes, formulas, inputs, and
new workbook content. Hosts or external agents provide ordinary file-reading
and patching tools; Ordinate does not need to recreate a general text editor.

Structure-aware edits are appropriate when the desired action depends on
preserving reference targets, hierarchy, or metadata through an existing core
operation. They are not mandatory for every text change.

Named references, hierarchy paths, and `_` reduce dependence on positions.
They do not eliminate all structural considerations: duplicate names, renamed
paths, deleted targets, and relative offsets retain their specified semantics.
In particular, an unchanged relative offset need not refer to the same old row
after another row is inserted between the formula and its target.

Ordinary text editing does not automatically acquire core rebasing semantics.
The agent must choose the appropriate path and examine the resulting formulas
and values. Passing validation alone does not establish that intent was preserved.

Core's invalid-input round-trip support remains unchanged. A host may stage an
invalid draft for diagnosis without presenting it as a verified result or
replacing an existing document silently.

## Adapter and Host Responsibilities

Adapters translate transport inputs and project results; semantic work stays
in core. CLI and in-process calls must produce equivalent semantic outcomes
for the same document and request.

File-backed adapters own reading, explicit writes, failure-safe replacement,
and external-modification handling. A CLI write must not knowingly overwrite
a document that changed since it was read. The concrete concurrency mechanism
and its guarantees must be specified and tested with the CLI implementation.

Stateful hosts own authoritative document state, revisions, permissions,
commit boundaries, and history. Asynchronous proposals must be associated with
their base document and rejected if that base is stale. Do not silently merge,
overwrite newer state, or use a source URL as document identity. A digest of
source text identifies content, not a document or an editing session; hosts
must also associate proposals with their target resource and session revision.

Whether a host uses an isolated text workspace or direct capability calls is
an integration choice. Either must cross the host's explicit commit boundary.
Detailed editor lifecycle, undo UX, file watching, and save behavior belong in
host specifications, not this RFC.

Agent output and workbook notes are untrusted inputs, not authority to grant
filesystem or network access. Hosts enforce access independently of instructions
given to an agent. Local execution does not by itself imply offline inference;
data-sharing policy belongs to the selected integration.

## Skills and Documentation

A skill is an optional instructional layer, not an execution dependency.
Direct human and scripted use of the CLI must work without it.

The skill should explain `.ord` authoring, named references and `_`, choosing
text versus structural edits, and the inspect/edit/validate/evaluate workflow.
It must distinguish syntax validity, runtime success, and business correctness,
and must not encourage hand-authoring caches as proof of computation.

Examples must use actual supported capabilities. Derive function inventories
from core metadata and check executable examples against the same core and CLI
version, rather than maintaining a separate language specification in the skill.

## Delivery Roadmap

### Phase 1: Capability Contract

Inventory existing core APIs and define the smallest shared request/result
projections. Start with inspection, validation, and evaluation; add structured
editing from the existing operation contracts. Do not block useful read-only
capabilities on wrapping every edit operation.

Exit: deterministic projections, explicit failure categories, and tests showing
that the boundary reuses core semantics rather than implementing another engine.

### Phase 2: CLI

Expose the initial capability families with human-readable and machine-readable
output. Default inspection and evaluation to no file writes. Specify command
syntax, exit codes, write policy, and installation in the CLI implementation.

Exit: CLI works without a GUI; integration tests cover paths and escaping,
malformed input, runtime errors, batch failure, write failure, external changes,
and the write commit boundary. Failure before commit preserves the original;
a failure to deliver the response after commit must not imply rollback.

### Phase 3: Skill and Task Evaluation

Provide concise authoring guidance and run representative tasks against shared
example workbooks: input changes, formula authoring, cross-sheet calculations,
notes, and structural edits with reference consequences.

Exit: test final values, formulas, unrelated content, and failure behavior, not
only successful parsing. Separate deterministic contract tests from repeatable
agent task evaluations, whose results may vary by engine and model.

At this point external agents have a useful file-editing workflow without any
embedded assistant or MCP dependency.

### Phase 4: Generic Host Integration

Connect capabilities to a host's document and commit boundaries. Define its
revision and conflict policy separately. Read-only integration can precede
mutations; stale mutation proposals must fail explicitly.

Exit: equivalent outcomes across adapters, stale-result rejection, and host
tests showing that existing content and history are not silently replaced.

### Phase 5: Optional Agent and Protocol Adapters

An embedded agent or MCP adapter can reuse the same capabilities and authoring
guidance. Direct text editing may remain available alongside semantic tools.
Select protocols and runtime dependencies in separate integration specifications.

Exit: no duplicated semantics, tested access boundaries, and explicit reporting
of execution, validation, evaluation, and commit failures.

## Follow-on Contracts

RFC-0049 specifies bounded inspection, typed values, portable edit targets,
operation coverage, and the distinction between computation and publication.
RFC-0050 specifies command syntax, streams, exit codes, and file-write guarantees.
Both remain drafts until implementation and conformance establish their behavior.
Provider and application integration decisions remain separate.
