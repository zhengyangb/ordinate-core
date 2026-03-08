# ordinate-core

A Python core library for Ordinate documents.

Current capabilities:
- parse sheets and pipe tables from text
- validate RFC-0002 structural rules
- return validation summary stats (sheet count, row/column counts, header row/column counts)
- format document text to a normalized readable layout
- apply file-level escaping inside cells:
  - `\|` for literal pipe
  - `\\` for literal backslash

Planned:
- formula parsing and calculation engine

Tests:
- generic unit tests: `tests/test_*.py`
- RFC-organized compliance tests: `tests/rfc_0002/test_rfc_0002_requirements.py`
- fixture documents: `tests/fixtures/rfc_0002/*.ord`
- formatter expectation snapshots are compared via fixture-to-fixture assertions
