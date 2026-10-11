# RFC-0050: Command-Line Interface

- Status: Implemented (V1)
- Project: Ordinate
- Depends on: RFC-0048, RFC-0049

## Summary

Define the `ordinate-cli` CLI as a file-backed adapter for the workbook capabilities
in [RFC-0049](0049-workbook-capability-contract.md). It supports scripts, people,
and external agents with the same semantics. It requires no running GUI, model,
account, or skill.

The executable is implemented in `packages/cli`. The build bundles the shared
TypeScript core; Node.js 20+ is required, but no GUI or global npm installation is.
CLI subprocess and filesystem adapter tests run with `npm run test:cli` at the root.

## Commands

```text
ordinate-cli inspect  <source> [selection] [--notes] [--json]
ordinate-cli validate <source> [--json]
ordinate-cli evaluate <source> [selection] [destination] [--json]
ordinate-cli edit     <source> --operations <operations-source> [destination] [--json]
ordinate-cli --help
ordinate-cli <command> --help
ordinate-cli edit --help --operation <name>
ordinate-cli edit --help --schema
ordinate-cli --version
```

Language-reference commands and the separately maintained authoring skill are
defined in [RFC-0051](0051-language-discovery-and-authoring-skill.md). The normal
command help points to that read-only reference; function queries reuse Core's
registry rather than maintaining another function list.

Selection options:

```text
--sheet <exact-name> [--rows <start:end>] [--columns <start:end>]
```

Destination options, mutually exclusive:

```text
--write
--output <new-file|->
```

`<source>` and `<operations-source>` each mean a file path or `-` for stdin;
angle brackets are documentation placeholders, not literal shell syntax.
An operations file on disk is optional: pipes and here-documents can supply the
same JSON through `--operations -`. There is no second inline-JSON flag or parser.

`--notes` is valid only for inspection and requires `--sheet`. Row/column ranges
also require `--sheet`. These are zero-based, half-open semantic ranges as in
RFC-0049; `--rows 0:10` selects the first ten semantic rows including headers.
Default windows and limits come from that RFC. No A1-range parsing is added.

Reject unknown flags, duplicate options, extra operands, malformed ranges, and
options that do not apply to a command. `--` ends option parsing for a filename
beginning with a hyphen. Shell expansion belongs to the shell; the CLI does not
expand globs, environment variables, or remote URLs.

Paths are resolved relative to the current working directory. Source files do
not need an `.ord` extension. `-` means standard input for a source or operation
file, and standard output for `--output`; it never means a remote resource.

## Reading Input

Decode source and operation files as strict UTF-8. Preserve source line endings
and any leading BOM in the source string and revision calculation; parsing
acceptance remains a core decision. Never silently strip or transcode input.
Reject a source over the shared 16 MiB limit before unbounded buffering.

The operations input has a 4 MiB byte limit in addition to the 1,000-operation
capability limit. A source and its operations cannot both consume stdin. When
stdin is a terminal and `-` was supplied as an input, return a usage error rather
than waiting indefinitely for interactive content. V1 has no interactive prompts.

A single invocation reads one source snapshot. Neither evaluation nor output
selection may trigger a second independent source read. Reads during the commit
check compare against that snapshot; they do not silently restart the command.

## Command Behavior

### Inspect

Without selection, print the ordered sheet summary and source revision.
With `--sheet`, include the selected inputs, axes, display metadata, and paging
information from RFC-0049. `--notes` additionally returns canonical sheet notes.
Inspection never evaluates or writes a workbook.

### Validate

Print validation diagnostics and summary. A malformed workbook produces a
normal validation report and a nonzero exit status. Validation does not verify
cached results or business assumptions.

The default summary explicitly says `Validation passed` or `Validation failed`
with the error count. Failure diagnostics include available locations, codes,
and explanations. Neither successful execution of the validator nor successful
delivery of its report means the workbook passed. These rules hold without any
flags, so discovering failure does not depend on reading documentation or
selecting JSON output.

### Evaluate

Evaluate the full workbook and return the capability report. Without selection,
print a calculation summary; with selection, include typed values for that
window. Errors anywhere in the workbook affect the outcome.

Without a destination, do not materialize or write source. With a destination,
request materialization and write the resulting candidate only when validation
and full evaluation succeed. Cache writeback regenerates canonical `.ord` text;
it can change spacing, quoting, and formula spelling as allowed by RFC-0011.

### Edit

Read `--operations` as the strict RFC-0049 `EditRequest` object:

```json
{
  "baseRevision": "sha256:<64 lowercase hexadecimal characters>",
  "operations": [
    {
      "op": "set_cell_input",
      "target": {
        "sheet": "Start Here",
        "row": { "kind": "path", "path": ["Annual revenue"] },
        "column": { "kind": "label", "label": "Value" }
      },
      "input": "15000000"
    }
  ]
}
```

The revision above is a placeholder; callers must use the actual source revision
returned by inspection or validation. The CLI does not replace a missing or
stale revision with a fresh one. No direct `rowId` / `colId` targeting is accepted.

Resolve, apply, and validate according to RFC-0049. Without a
destination, return a proposal and leave the file unchanged. JSON includes the
candidate source; human output reports the operation count and candidate revision.
It explicitly says the source file is unchanged and identifies `--write` as the
way to apply the proposal. It must not claim edits were saved.
Use `--output -` to obtain the candidate as raw `.ord` text.

With a destination, write the validated candidate. Invalid edits or invalid final
source produce no write. An edit does not run calculation; its result explicitly
says `evaluation: "not_run"`. Existing runtime errors do not block incremental
editing. Use `evaluate` to check the candidate or written file and refresh caches.
V1 has no force, automatic retry, or implicit text-edit alternative.

## Destination Semantics

| Destination | Behavior |
| --- | --- |
| Omitted | Read-only analysis or edit proposal |
| `--write` | Replace the named source file after conflict checks |
| `--output new.ord` | Create a new file; never replace an existing destination |
| `--output -` | Emit only canonical `.ord` to stdout |

`--write` requires a named source; it is invalid with source stdin. `--output`
can be used with either a named source or stdin. `--output -` and `--json` are
mutually exclusive because stdout cannot simultaneously be a JSON envelope
and raw document text. A named output can be combined with `--json`.

If an output path already exists, including a symlink, fail without modifying it.
The output operation must use a filesystem primitive that ensures exclusive
publication; checking existence before an overwriting rename is insufficient.
If source and output name the same file, fail and direct the caller to `--write`.

Before `--write`, reject a symlink source or a source with multiple hard links.
V1 updates a regular file by replacement and does not define link-update semantics.
This restriction does not affect read-only commands.

## Writes, Conflicts, and the Commit Point

For in-place writes:

1. Acquire an exclusive sibling lock file using exclusive creation. Its name is
   `.<source-basename>.ordinate.lock`. Every CLI in-place writer follows this
   convention. Canonicalize the parent directory so directory aliases share a lock.
2. Read the source bytes and file identity under the lock. For edit, verify the
   required base revision. Run the capability operation on this snapshot.
3. If no candidate is available, release the lock and return the corresponding
   diagnostics. Compare candidate bytes with the original snapshot.
4. If bytes differ, write the complete candidate to a uniquely named temporary file
   in the same directory. Preserve source permission bits, flush and close the
   temporary file, and fail before commit if preparation fails.
5. Immediately before replacement, recheck source identity, file type, and exact
   bytes against the original snapshot. A mismatch is a conflict; do not retry.
   Perform this check for identical candidates too; then return `unchanged`
   without replacement or a modification-time change.
6. For changed candidates, rename the prepared file over the source. Successful
   rename is the commit point. Release owned temporary resources and the lock.

The implementation must not truncate the original file before commit. For a new
output file, stage its content in the destination directory and publish it with
an atomic no-replace operation. Do not silently fall back to an overwriting or
partially visible write when the required filesystem primitive is unavailable.

The lock serializes cooperating CLI writers. It does not prevent another editor
from writing between the final check and rename. V1 promises detection of changes
observed at the check, not universal compare-and-swap against arbitrary programs.
Atomic replacement also depends on the filesystem's guarantees. Applications
needing stronger coordination must use a host-owned commit protocol.

Do not delete a pre-existing lock automatically, even if it appears old. Report
its path as a conflict; a user can inspect and remove a stale lock after verifying
that no writer owns it. Remove only the lock created by the current invocation.

Before commit, write failure leaves the original intact. After commit, an output
stream failure, cleanup error, or interruption does not roll back the write.
If a report can still be emitted, it must say the write occurred. If publication
outcome cannot be determined, report `unknown`, never claim that nothing changed.
Do not promise crash durability or preservation of ownership, ACLs, extended
attributes, or timestamps beyond the stated permission-bit behavior in V1.

The write strategy belongs to a shared CLI file adapter, not to individual
commands and not to the pure capability implementation.

## Output Streams and JSON

Default output is concise text. Diagnostic text and operational failures go to
stderr; summaries and requested read results go to stdout. No progress animation
or interactive question appears. Shell redirection should not capture decorative
text alongside a raw document.

Keep text as the default for both terminals and captured output; do not infer
JSON mode from a pipe or an agent environment. For a completed validation or
evaluation with document errors, stdout's summary explicitly reports failure
and stderr carries the details. JSON selection changes representation, never
whether the command succeeds or whether it writes a file.

With `--json`, emit exactly one JSON object followed by a newline to stdout for
every ordinary command outcome, including invalid input and I/O failures:

```ts
type CliReport = {
  contract: "ordinate-cli/1";
  ok: boolean;
  exitCode: number;
  command: "inspect" | "validate" | "evaluate" | "edit" | null;
  input: { path: string | null; revision: SourceRevision | null };
  result: CapabilityResult<Inspection | ValidationReport | EvaluationReport | EditReport> | null;
  error: { kind: "usage" | "io" | "conflict" | "internal" | "interrupted";
           code: string; message: string; path?: string } | null;
  write: { status: "not_requested" | "not_written" | "written" | "unchanged" | "unknown";
           path: string | null; revision: SourceRevision | null };
};
```

One CLI outcome mapping determines the intended exit code, top-level `ok`, and
human summary; `ok` is true exactly when that code is zero. A capability result
with `status: "completed"` and `valid: false`, or with evaluation errors, yields
`ok: false` and the corresponding nonzero code. `error: null` alone is not a
success signal. The intended report code matches the process status on ordinary
completed delivery; a subsequent stream failure or signal can prevent delivery
or cause a later nonzero process status. Consumers must also inspect process status.

The capability `result` is reused verbatim. Host failures use `error`; they do
not replace document diagnostics or pretend that calculation failed. `result`
may therefore be present alongside a write failure. A successful JSON proposal
contains its candidate source without modifying any file.

Paths in JSON are absolute, with null for stdin. Revisions are null until known.
`write.path` names the requested file destination, or null when absent.
`write.revision` is the confirmed candidate revision only for `written` or
`unchanged`. `unknown` carries null. Raw stdout output has no JSON envelope and
no filesystem-write status; a broken pipe is an I/O failure and may have delivered
a prefix to the consumer.

In JSON mode, stderr is reserved for failures that prevent delivery of the JSON
report itself. Help and version are standalone text commands and cannot be
combined with `--json`. Invalid combinations are usage failures. Recognize a
literal `--json` option before `--` even if another argument is invalid, so the
usage failure can use the requested report format.

No stack trace is included in normal reports. Internal errors remain distinct
from workbook diagnostics. Process termination may prevent any report; exit
status and report delivery cannot serve as proof that a requested write did not
commit.

## Exit Status

| Code | Meaning |
| --- | --- |
| `0` | Requested command and output succeeded; any requested validation/evaluation had no errors |
| `2` | CLI usage, malformed operations JSON/schema, invalid query, or configured limit exceeded |
| `3` | Source or final candidate failed validation |
| `4` | Evaluation completed with error-valued cells; no candidate was written |
| `5` | Structured edit failed target resolution or core edit invariants |
| `6` | Stale base revision, external modification, or writer lock conflict |
| `7` | Read, decoding, preparation, publication, cleanup, or output-stream I/O failure |
| `8` | Unexpected internal failure |
| `130` | Interrupted by SIGINT when the platform permits orderly handling |

For read query resolution, missing/ambiguous sheet or out-of-bounds range maps
to `2`; the same target errors during an edit map to `5`. `stale_source` maps
to `6`. An unsupported operation name is schema failure (`2`), not a core edit
failure. Serialization rejection maps to `8`, since valid computed state must
be serializable. A null capability result does not mean successful execution.

The first blocking phase determines the outcome: arguments and request schema,
input I/O/locking, revision checks, source validation, query/edit resolution,
final validation, explicit evaluation when requested, then publication. A failure
stops later phases. An edit's exit 0 does not claim that its formulas were evaluated.
Unexpected exceptions and post-commit delivery/cleanup failures retain their
own exit category while reporting any known completed write.

For CLI-owned failures, use these stable codes (OS-specific details may appear
in the message):

| Kind | Codes |
| --- | --- |
| `usage` | `invalid_arguments`, `invalid_operations_json`, `input_limit_exceeded` |
| `conflict` | `lock_conflict`, `write_conflict` |
| `io` | `read_failed`, `invalid_utf8`, `unsupported_write_target`, `output_exists`, `write_failed`, `output_failed`, `cleanup_failed`, `publication_unknown` |
| `internal` | `internal_error` |

Capability failures keep RFC-0049 codes in `result`; do not duplicate them in
`error`. `publication_unknown` sets the write status to `unknown`. A path that
already exists at an exclusive output destination uses `output_exists` (exit 7).
Malformed JSON uses `invalid_operations_json`; valid JSON violating the shared
request schema uses the capability `invalid_request` failure (exit 2).

## Examples

These examples describe the proposed CLI:

```sh
ordinate-cli inspect examples/00-getting-started.ord --json
ordinate-cli inspect examples/00-getting-started.ord --sheet "Start Here" --rows 0:10 --columns 0:4 --json
ordinate-cli validate examples/00-getting-started.ord --json
ordinate-cli evaluate examples/00-getting-started.ord --sheet "Start Here" --json
ordinate-cli edit model.ord --operations edits.json --json
ordinate-cli edit model.ord --operations edits.json --write --json
ordinate-cli evaluate model.ord --json
ordinate-cli evaluate model.ord --output recalculated.ord
ordinate-cli evaluate model.ord --output -
```

The last command does not alter `model.ord`. Shell redirection to that same
input path is unsafe because the shell can truncate it before the CLI reads it;
use `--write` for in-place changes.

### Batch JSON Without an Operations File

Supply an inline request using a quoted here-document. Replace the revision
placeholder with the exact revision from the snapshot being edited:

```sh
ordinate-cli edit model.ord --operations - --json <<'JSON'
{
  "baseRevision": "sha256:<revision returned by inspect>",
  "operations": [
    {
      "op": "set_region",
      "target": {
        "sheet": "Start Here",
        "rows": { "start": 1, "end": 3 },
        "columns": { "start": 1, "end": 2 }
      },
      "values": [["15000000"], ["0.1"]]
    },
    {
      "op": "set_row_default_style",
      "sheet": "Start Here",
      "row": { "kind": "index", "index": 1 },
      "style": { "weight": "bold" }
    }
  ]
}
JSON
```

Quoting the delimiter prevents the shell from interpreting dollar signs,
backticks, and other formula text. No temporary operations file is needed.
Add `--write` for explicit writeback. Alternatively, any program that generates
a complete request can pipe it to `ordinate-cli edit model.ord --operations -`.

For example, this bash/zsh pipeline uses the optional external tool `jq` to build
a request from inspection of the actual source; it returns a proposal:

```sh
set -o pipefail
ordinate-cli inspect model.ord --json |
  jq -e 'if .ok then {
    baseRevision: .input.revision,
    operations: [{
      op: "set_cell_input",
      target: {
        sheet: "Start Here",
        row: {kind: "path", path: ["Annual revenue"]},
        column: {kind: "label", label: "Value"}
      },
      input: "15000000"
    }]
  } else error("Inspection failed") end' |
  ordinate-cli edit model.ord --operations - --json
```

The core/CLI does not depend on `jq`. A changed source between inspection and
editing still fails the revision check. When stdin supplies the workbook instead,
operations must come from a file; two payloads cannot share the same stdin stream.

## Packaging and Compatibility

Place the CLI in `packages/cli`, depending on the same TypeScript core version
as the application. The capability implementation remains in `packages/core-ts`.
CLI code owns argument parsing, Node file I/O, output, and exit statuses.

The executable is named `ordinate-cli`; `--version` identifies both CLI and core
versions. Desktop packaging may bundle it and its runtime. PATH installation is
a separate distribution action, not a core API or a prerequisite to running it
by its full path. Specific installer UX is outside this RFC.

`ordinate-cli/1` identifies this JSON contract. Before a stable release, drafts
can change together. Do not add legacy command aliases, permissive decoding,
or compatibility shims during initial development. A later incompatible stable
contract requires an explicit revision.

## Implementation Sequence

1. Complete RFC-0049's shared capability schemas and behavior. Create
   `packages/cli` with the `ordinate-cli` executable, argument parsing, and concise
   command help. Reference the shared operation schema instead of copying it.
2. Add strict UTF-8 file/stdin reading and read-only `inspect`, `validate`, and
   `evaluate`. Use one outcome mapper for text, JSON, and exit status. Verify
   failure behavior with subprocess tests before adding file mutation.
3. Add edit requests from a file or stdin and candidate/raw-stdout output. Both
   input routes call the same decoder and capability implementation. Verify
   batches, semantic coordinates, and errors without filesystem writeback.
4. Implement the shared destination adapter: exclusive new-file publication,
   guarded in-place replacement, commit-point reporting, and owned cleanup.
   Route both edit and evaluation writeback through it.
5. Verify end-to-end workflows on disposable example workbooks: inspect revision,
   submit a batch, validate, evaluate, explicitly write, and reopen. Cover shell
   pipes and interrupted/conflicting writes. Packaging/PATH installation follows
   the working executable; a skill can then document these tested commands.

The first usable milestone is headless read-only analysis. The completed RFC
requires the batch and explicit-write milestones too. CLI work adds no second
formula engine, format grammar, target resolver, or rebasing implementation.

## Acceptance Tests

Run the actual CLI process against disposable copies of shared example workbooks.
Tests must establish:

- headless operation and equivalence with RFC-0049 results;
- all command/option combinations, stdin ownership, spaces in paths, `--`,
  invalid UTF-8, unknown fields, and size limits;
- source/proposal revision round trips and rejection of stale edit requests;
- exact JSON framing, stderr separation, raw `.ord` output, and exit-code mapping;
- default validation failure without flags, explicit failed summaries, and
  agreement between JSON `ok`/`exitCode` and process status on completed delivery;
- equivalent file, pipe, and quoted-here-document operation input, including
  formulas containing shell-sensitive characters and competing stdin ownership;
- no file changes for read-only calls, rejected edits, or failed evaluation writeback;
- successful structural edits with existing runtime errors, followed by explicit
  evaluation reporting those errors without claiming the edit failed;
- ordered structural edits and preservation of unrelated workbook semantics;
- canonical cache materialization and unchanged-file behavior;
- exclusive new-file publication, link restrictions, cooperating writer locks,
  detectable external changes, pre-commit failures, and post-commit reporting;
- lock and temporary-file cleanup without deleting another invocation's files.

Passing CLI tests does not establish agent task quality. Skill examples and
agent task evaluations follow the separate milestone in RFC-0048.
