# RFC-0051: Language Discovery and Workbook Authoring Skill

- Status: Draft
- Project: Ordinate
- Depends on: RFC-0048, RFC-0049, RFC-0050

## Summary

Define three layers of discoverability for people and agents editing Ordinate
workbooks: concise CLI help, queryable language reference, and a language-first workbook
authoring skill. Authoring means creating or editing workbook content, not
developing the application. This RFC defines responsibilities, structure,
maintenance, and distribution; it does not embed the skill's instructions.

The V1 implementation lives in `packages/cli`. No agent engine, GUI integration,
account, model, network service, or skill installation is required to use help.

## Motivation

An operation schema explains how to submit `set_cell_input`; it does not explain
the formula language inside `input`. A format schema describes JSON fields but
not source suffixes, defaults, or precedence. Operation discovery alone therefore
does not make native workbook authoring discoverable. Validation/calculation
cannot teach every language feature through error messages.

## Three Layers

### Command Help

Keep `ordinate-cli --help` and command-specific help concise. Include links expressed
as executable commands to language topics and operation schemas. Retain explicit
write semantics, nonzero failure status, and existing capability boundaries.

### Queryable Language Reference

```text
ordinate-cli help
ordinate-cli help syntax
ordinate-cli help formulas
ordinate-cli help references
ordinate-cli help formats
ordinate-cli help notes
ordinate-cli help functions
ordinate-cli help function <name>
```

Topics cover currently supported authoring, not every planned RFC feature.
Functions come directly from Core's standard function metadata, including
signatures, aliases, parameter descriptions, and examples. No independent CLI
function list is maintained. Alias/case resolution uses the same Core registry.

Language explanations reside in one CLI reference module. The format topic
explains both source suffixes and portable JSON, with operation-specific schemas
remaining authoritative for complete payloads. Distinguish semantic A1/#n,
zero-based brackets/CLI selectors, and the nonsemantic metadata frame. Include
the limits of notes, formula caches, and final scalar results.

All reference commands are read-only and offline, accept no workbook operand,
and work from the bundled executable without access to the source repository.
Unknown topics, functions, extra operands, and incompatible flags are usage
errors (exit 2); do not guess or fetch substitutes. Success is plain text by
default. `--json` returns a standalone `ordinate-language-reference/1` object
with topic and CLI/Core versions, not a fictitious workbook capability result.
Ordinary failures retain RFC-0050's JSON error report when requested. `help --help`
prints the reference index; it cannot be combined with topic operands or JSON.

Topic JSON carries the same body and example workbooks as text. Example checks
make their advertised outputs machine-verifiable. Function JSON exposes public
metadata only, never evaluator functions or internal workbook IDs.

### Workbook Authoring Skill

Maintain one self-contained authoring entrypoint with supporting references:

```text
packages/cli/skills/ordinate-authoring/SKILL.md
packages/cli/skills/ordinate-authoring/references/{syntax,formulas,references,formats,notes,functions}.md
```

Required YAML frontmatter: `name` and `description`. The body contains:

- native workbook/table syntax, hierarchy, literal escaping and complete examples;
- named, relative, positional, hierarchical and cross-sheet references;
- expressions, scalar/view distinctions, common functions and unsupported syntax;
- local/default display formats, the nonsemantic frame, precedence and notes;
- the workbook-authoring scope and how to locate `ordinate-cli`;
- routing to relevant packaged references and queryable help for further detail;
- criteria for text editing versus structured operations;
- revision, explicit write, and staged-coordinate implications;
- validation versus evaluation, cache handling, and business-model checks;
- distinguishing supplied assumptions from inferred ones and testing input
  changes on isolated copies rather than only checking initial results.

The entrypoint must support ordinary direct text authoring without first querying
CLI help. The CLI is complementary, not the only editing route: syntax guidance
must not merely tell the agent to read `--help`. Supporting references are
loadable by need and ship with the skill, including when the executable is absent.

Do not maintain a second function catalog or operation schema. Generate the
topic references from the CLI's shared language explanations and checked examples;
generate common function signatures and parameter meanings from Core metadata.
`skill_reference.mjs --write` synchronizes derived Markdown; `--check` rejects
drift. Generated references are committed artifacts so repository-based skill
installation does not require a build. Tests and prepack check freshness; they
do not silently rewrite references. Keep the hand-authored entrypoint compact and
test its complete workbooks and claimed outputs independently.

No engine-specific metadata is required. Both CLI reference and skill remain
independently usable. The skill is guidance rather than a runtime dependency or
authorization to install tools, publish files, or change unrelated configuration.

## Ownership and Versions

Core owns evaluation and function metadata. CLI owns language-reference prose,
command routing, and this skill. The application reuses Core and does not own
a separate agent-facing catalog. RFCs record contracts and decisions; changing
ordinary examples or improving skill wording does not require a new RFC.

Keep reference and skill in the same repository and release as the CLI. They
share its package version; no independently maintained skill version or duplicate
version in SKILL.md. `--version` and reference JSON identify the installed CLI
and Core. Runtime catalogs always describe that bundled Core, not a remotely
updated website. A language/operation change must review affected reference,
examples, and affected skill instructions/references in the same change. A workflow-only improvement
updates the skill without touching parser/evaluator semantics.

## Packaging and Installation

The CLI package includes `dist` and `skills`; language reference is bundled in
the executable. A skill is a directory of text/resources, not an npm runtime
module. It does not require a separate npm package or a global npm installation.
If the CLI is later published through npm, it can carry the same skill directory.
The package is currently private; publication/PATH/desktop distribution remain
separate work under RFC-0050.

Agent discovery is host-specific. Users may explicitly install/copy the skill
into their host's skill location or provide its path. Bundling does not make
every host discover it automatically. Do not use npm postinstall to change agent
configuration, overwrite an existing skill, or install into a user's home.
V1 supplies the source and package contents, not an installer. Hosts that bundle
the CLI later should distribute the matching skill rather than maintain copies.

## Verification

- Subprocess tests for topic/function discovery, alias/case resolution, JSON,
  invalid queries/flags, and failure status with no file mutation.
- Parse and evaluate each complete reference workbook using the bundled Core;
  assert advertised results and metadata scopes, not only successful rendering.
- Verify the skill frontmatter, linked references, generated-reference freshness,
  and actual commands. Validate/evaluate all complete skill workbooks, assert
  advertised values and formats, and perturb inputs to check dependency behavior.
  Verify package contents with a pack dry-run. This does not prove behavioral
  effectiveness in an agent trial.
- Future agent comparisons use the same task, seed, concrete business rules,
  and language guidance. Do not confound skill access with different tasks or
  editing methods. Check changed inputs, formulas, references, and presentation.

The earlier help-only trials were exploratory observations, not evidence that
skills are unnecessary or that text editing is a better forecasting method.
