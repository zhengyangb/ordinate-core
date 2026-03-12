import unittest
from pathlib import Path

from ordinate_core import parse_document_model, validate_document

_FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "rfc_0003"


def _read_fixture(name: str) -> str:
    return (_FIXTURE_DIR / name).read_text(encoding="utf-8")


class Rfc0003SectionsTests(unittest.TestCase):
    def test_valid_sections_and_summary(self) -> None:
        text = _read_fixture("valid_sections_hierarchy.ord")
        result = validate_document(text)
        self.assertTrue(result.ok)

        sheet = result.summary.sheets[0]
        self.assertEqual(sheet.section_count, 3)
        self.assertEqual(sheet.max_section_level, 2)

    def test_invalid_section_level_jump(self) -> None:
        text = _read_fixture("invalid_section_jump.ord")
        result = validate_document(text)
        self.assertFalse(result.ok)
        self.assertTrue(any("section level jumps" in e.message for e in result.errors))

    def test_invalid_row_indent_exceeds_section_level(self) -> None:
        text = _read_fixture("invalid_row_indent.ord")
        result = validate_document(text)
        self.assertFalse(result.ok)
        self.assertTrue(any("indentation level" in e.message for e in result.errors))

    def test_parse_document_model_exposes_hierarchy(self) -> None:
        text = _read_fixture("valid_sections_hierarchy.ord")
        model = parse_document_model(text)

        self.assertEqual(len(model.sheets), 1)
        table = model.sheets[0].table
        assert table is not None
        self.assertEqual(table.section_count, 3)
        self.assertEqual(table.max_section_depth, 2)
        self.assertEqual(table.sections[0].name, "Revenue")


if __name__ == "__main__":
    unittest.main()
