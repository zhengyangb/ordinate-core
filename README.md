# ordinate-core

Core library for Ordinate documents.

Primary implementation: TypeScript (`packages/core-ts`).
Python (`src/ordinate_core`) is a frozen reference and is not actively maintained.

Current capabilities:
- parse sheets and pipe tables from text
- validate RFC-0002 structural rules
- validate RFC-0003 section hierarchy rules
- parse/evaluate RFC-0004 scalar references (`@[row_selector, col_selector]`)
- parse/evaluate RFC-0005 minimal formulas (`+-*/`, `==`, parentheses, references)
- parse literal/formula cells with optional cached form (`cached = expression`)
- return validation summary stats (sheet count, row/column counts, header row/column counts)
- format document text to a normalized readable layout
- formatter auto-expands separator row dashes based on column widths
- apply file-level escaping inside cells:
  - `\|` for literal pipe
  - `\\` for literal backslash
- expose an internal object model via `parse_document_model` / `parse_file_model`
- expose runtime APIs via `parse_cell`, `evaluate_document`, `evaluate_file`
- expose cell-level eval API via `evaluate_cell` (no full table required)
- expose RFC5 pipeline API via `evaluate_and_format_document` / `evaluate_and_format_file`

Planned:
- formula parsing and calculation engine

Tests:
- generic unit tests: `tests/test_*.py`
- RFC-organized compliance tests: `tests/rfc_0002/test_rfc_0002_requirements.py`
- RFC-organized compliance tests: `tests/rfc_0003/test_rfc_0003_sections.py`
- fixture documents: `tests/fixtures/rfc_0002/*.ord`
- formatter expectation snapshots are compared via fixture-to-fixture assertions
- runtime parser/evaluator tests: `tests/test_runtime_model.py`
- RFC4 reference spec tests: `tests/rfc_0004/test_reference_cases.py`
- RFC4 single-file readable cases: `tests/fixtures/rfc_0004/reference_cases.cases`
- RFC5 formula-eval spec tests: `tests/rfc_0005/test_formula_eval_cases.py`
- RFC5 single-file readable cases: `tests/fixtures/rfc_0005/formula_eval_cases.cases`
- RFC5 ORD input->output cache snapshot test: `tests/rfc_0005/test_evaluate_and_format_ord_file.py`
- RFC5 ORD fixtures: `tests/fixtures/rfc_0005/profit_statement_input.ord` and `tests/fixtures/rfc_0005/profit_statement_expected.ord`
- RFC6 types/operators spec tests: `tests/rfc_0006/test_types_and_operators.py`
- RFC6 single-file readable cases: `tests/fixtures/rfc_0006/types_and_operators.cases`

Spec format note:
- `*.cases` here is a project-local readable DSL (`=== case`, `[doc]...[/doc]`, `expect_*`), not an external standard format.
