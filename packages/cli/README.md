# Ordinate CLI

A headless file adapter for the same Core used by the editor. Both the npm package
and executable are named `ordinate-cli`; there is no `ordinate` command alias.
Requires Node.js
20 or newer. No GUI, API key, global npm install, or agent skill is required.

From the repository root:

```sh
npm --prefix packages/cli install
npm run build:cli
node packages/cli/dist/ordinate-cli.mjs --help
```

Use the executable directly for clean stdout. `npm run cli -- ...` is convenient
interactively, but npm prints a script banner. PATH/app-bundle installation and
registry publication are separate distribution work; this package is private.

## Language reference and authoring skill

Command help describes the adapter; queryable reference describes what goes
inside the workbook. These commands need no source file or network:

```sh
node packages/cli/dist/ordinate-cli.mjs help
node packages/cli/dist/ordinate-cli.mjs help formulas
node packages/cli/dist/ordinate-cli.mjs help references
node packages/cli/dist/ordinate-cli.mjs help formats
node packages/cli/dist/ordinate-cli.mjs help functions
node packages/cli/dist/ordinate-cli.mjs help function sum --json
```

`syntax` and `notes` are also topics. Function names, signatures and examples
come from the bundled Core registry, not a separate CLI list. Reference JSON
uses `ordinate-language-reference/1` and includes CLI/Core versions; unknown
topics/functions fail with exit 2. Operation schemas remain under `edit --help`.

The optional [workbook authoring skill](skills/ordinate-authoring/SKILL.md)
teaches native workbook syntax, references, formulas, formats and notes with
complete working examples, then explains how CLI operations complement direct
text editing. Its six supporting references are generated from the same help
topics and Core function metadata, not a separately maintained manual.
Run `npm --prefix packages/cli run sync:skill` after changing those sources;
tests and the pack check reject outdated generated references. It ships in this
package and shares its release version; installation into an agent host is
explicit, not an npm postinstall side effect. The package remains private;
no registry publication or global/agent installation is implied.
See [RFC-0051](../../rfcs/0051-language-discovery-and-authoring-skill.md)
for structure, ownership, and distribution decisions.

## Read and check

```sh
node packages/cli/dist/ordinate-cli.mjs inspect model.ord --json
node packages/cli/dist/ordinate-cli.mjs inspect model.ord --sheet Plan --notes --json
node packages/cli/dist/ordinate-cli.mjs validate model.ord
node packages/cli/dist/ordinate-cli.mjs evaluate model.ord --sheet Plan --json
```

Inspection without `--sheet` gives an overview and an exact `input.revision`.
Selection ranges use **zero-based semantic coordinates** and half-open ends:
`--rows 1:4 --columns 1:3`. Headers and label columns count; Markdown dividers
and display control cells do not. Default selection is the first 50 rows and
20 columns; explicit ranges must be in bounds. No guessed/clipped matches.

Validation checks syntax and structure, not formula results. Evaluation
recalculates the entire workbook, ignoring stored caches, even when the returned
selection is small. Inspect and evaluate do not change files by default.

## Atomic edits

Supply an exact source revision and an ordered batch. This example assumes a
sheet named Plan with a Revenue row and a Q1 column. Replace the revision with
the value returned by inspection:

```sh
node packages/cli/dist/ordinate-cli.mjs edit model.ord --operations - --write <<'JSON'
{
  "baseRevision": "sha256:REPLACE_WITH_THE_64_CHARACTER_REVISION",
  "operations": [
    {
      "op": "set_cell_input",
      "target": {
        "sheet": "Plan",
        "row": {"kind": "path", "path": ["Revenue"]},
        "column": {"kind": "label", "label": "Q1"}
      },
      "input": "150"
    }
  ]
}
JSON
```

The quoted here-document keeps formulas containing `$`, backticks, and other
shell-sensitive text literal. A pipe works too. `--operations changes.json`
reads a file. Source and operations cannot both own stdin. Missing/ambiguous
selectors, stale revisions, invalid inputs, or invalid later operations reject
the entire batch; no partial file is written.

Edits include cells, exact regions, fill, duplicate/move/insert/delete axes,
sheet operations, notes, and local/row/column format/style operations. Names
resolve against current staged state after each operation. Row paths are arrays,
so dots inside names are literal. Internal IDs are not public selectors.

```sh
node packages/cli/dist/ordinate-cli.mjs edit --help
node packages/cli/dist/ordinate-cli.mjs edit --help --operation duplicate_columns
node packages/cli/dist/ordinate-cli.mjs edit --help --operation fill_region
node packages/cli/dist/ordinate-cli.mjs edit --help --operation set_row_default_format
node packages/cli/dist/ordinate-cli.mjs edit --help --schema
```

Fill source/target rectangles must be adjacent and in the same sheet. Choose
`copy`, `series`, or `auto` explicitly; positional formulas shift using native
Core rules. Duplicate body rows must cover full subtrees. Duplicate destination
gaps are before insertion; move destination gaps are after removal.

Format requests use Core fields, not Excel strings. A percentage format for a
ratio is `{"kind":"numeric","sign":"default","padWidth":null,"grouping":false,
"precision":1,"type":"%"}`. Temporal formats use patterns such as `%Y-%m-%d`.
Style patches preserve omitted axes and clear axes set to null. Prefer row or
column defaults when the whole axis shares a format/style.

Direct `.ord` text editing remains supported. Validate and evaluate afterwards.
Structural operations are especially useful when inserting/moving/copying data
must preserve formula targets and display metadata. `edit` does not implicitly
evaluate: it returns a validated candidate with affected caches invalidated.

## Writing and errors

No destination means no mutation, including `edit` (a proposal only).
`--write` explicitly replaces the source. `--output new.ord` publishes a new file
without replacing anything already there. `--output -` emits raw candidate
source and cannot be combined with `--json`. Evaluation materializes caches only
when a destination is requested and no calculation errors occurred.

In-place writes use a sibling exclusive lock, exact snapshot recheck, staged
file, and atomic replacement; symlinks/multiple hard links are rejected. Identical
bytes leave mtime unchanged. Existing locks are never automatically removed.
This coordinates cooperating CLI writers, not arbitrary external editors in
the final check/rename interval. Permission bits are preserved; ACLs, xattrs,
and crash durability are not promised.

Default output is human-readable, including when piped. Errors always return a
nonzero status. `--json` emits one report object to stdout, with ordinary errors
inside that object and no stderr output. Stream delivery failures go to stderr.
Inspect both process status and report `ok`/`exitCode`; a successful edit can
already be written before a later cleanup/output failure. The `write` field
records any known commit.

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 2 | Usage, request schema, limits, or query selection |
| 3 | Validation failure |
| 4 | Calculation errors |
| 5 | Edit target/invariant failure |
| 6 | Stale revision, lock, or source conflict |
| 7 | File/stream I/O failure |
| 8 | Unexpected internal failure |
| 130 | Orderly SIGINT interruption |

## Verification

```sh
npm run test:cli
npm --prefix packages/core-ts test
```

Core unit tests cover capability behavior. CLI tests launch real processes to
check streams, statuses, stdin, proposals, and file writes. Adapter tests cover
intervening source changes, competing writers, cancellation, and post-commit
cleanup errors. [Agent trial notes](AGENT_TRIALS.md) record separate, non-benchmark
observations about discoverability and tool/text choices.
