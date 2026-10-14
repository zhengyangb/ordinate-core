# Ordinate CLI

A headless file adapter for the same Core used by the editor. The package and
CLI executable are named `ordinate-cli`; it also builds `ordinate-mcp` for
MCP hosts. There is no `ordinate` command alias.
Requires Node.js 20 or newer. No GUI, API key, or agent skill is required.

Once published, install the CLI and use the `ordinate-cli` command:

```sh
npm install -g ordinate-cli
ordinate-cli --help
```

For a one-off invocation after publication, use `npx ordinate-cli --help`.
To run from this repository before installing the published package, build from
the repository root with `npm --prefix packages/cli install` and
`npm run build:cli`, then run `node packages/cli/dist/ordinate-cli.mjs --help`.
That `.mjs` path is a local build artifact, not the public command name.

## Language reference and authoring skill

Command help describes the adapter; queryable reference describes what goes
inside the workbook. These commands need no source file or network:

```sh
ordinate-cli help
ordinate-cli help formulas
ordinate-cli help references
ordinate-cli help formats
ordinate-cli help functions
ordinate-cli help function sum --json
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
explicit, not an npm postinstall side effect. `npm install ordinate-cli` provides
the files at `node_modules/ordinate-cli/skills/ordinate-authoring`, but does not
register them with Codex or another agent host. Install that folder through the
host's skill installer or copy it to a recognized skill location. The skill is
not a separate npm package.
See [RFC-0051](../../rfcs/0051-language-discovery-and-authoring-skill.md)
for structure, ownership, and distribution decisions.

## Read and check

```sh
ordinate-cli inspect model.ord --json
ordinate-cli inspect model.ord --sheet Plan --notes --json
ordinate-cli validate model.ord
ordinate-cli evaluate model.ord --sheet Plan --json
```

Inspection without `--sheet` gives an overview and an exact `input.revision`.
Selection ranges use **zero-based semantic coordinates** and half-open ends:
`--rows 1:4 --columns 1:3`. Headers and label columns count; Markdown dividers
and metadata control cells do not. Default selection is the first 50 rows and
20 columns; explicit ranges must be in bounds. No guessed/clipped matches.

Validation checks syntax and structure, not formula results. Evaluation
recalculates the entire workbook, ignoring stored caches, even when the returned
selection is small. Inspect and evaluate do not change files by default.

## Import Excel and delimited files

The `import` command projects the same Core XLSX/CSV/TSV conversion used by the
editor into a new `.ord` workbook. The input is never changed. Choose the format
explicitly; no file-extension guessing occurs.

```sh
ordinate-cli import source.xlsx --format xlsx --output working.ord --json
ordinate-cli import source.csv --format csv --options import.json --output working.ord --json
```

For the second command, `import.json` might contain
`{"sheetName":"Data","valueMode":"infer","headers":[{"sheetName":"Data","headerRows":1,"headerColumns":0}]}`.
CSV/TSV requires an explicit sheet name in `--options`; fields remain text unless
`valueMode: "infer"` is selected. XLSX rejects unsupported content by default;
`unsupportedContent: "preserve-text"` is an explicit lossy option. Conversion
diagnostics are returned for review. Without `--output`, the command returns a
candidate; `--output -` prints raw `.ord` text. A named output refuses to replace
an existing file. Inspect and evaluate the imported workbook before further edits.

An optional stdio MCP server is built as `dist/ordinate-mcp.mjs`. It exposes
`ordinate_import` with absolute input/output paths and the same Core import
semantics; it also refuses to replace an existing output. The agent host must
explicitly register this executable as an MCP server. The desktop assistant
continues to use the CLI; MCP registration is not automatic.

## Atomic edits

Supply an exact source revision and an ordered batch. This example assumes a
sheet named Plan with a Revenue row and a Q1 column. Replace the revision with
the value returned by inspection:

```sh
ordinate-cli edit model.ord --operations - --write <<'JSON'
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
ordinate-cli edit --help
ordinate-cli edit --help --operation duplicate_columns
ordinate-cli edit --help --operation fill_region
ordinate-cli edit --help --operation set_row_default_format
ordinate-cli edit --help --schema
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
For `--write --json` or a named `--output` with `--json`, the report retains
evaluation summaries, diagnostics, and write metadata but omits the candidate
source text. Read the written file to review all refreshed caches.

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
| 5 | Edit target/invariant or import conversion failure |
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
