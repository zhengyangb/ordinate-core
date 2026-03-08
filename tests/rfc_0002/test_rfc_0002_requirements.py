import unittest
from pathlib import Path

from ordinate_core import format_document, validate_document

_FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "rfc_0002"


def _read_fixture(name: str) -> str:
    return (_FIXTURE_DIR / name).read_text(encoding="utf-8")


class Rfc0002RequirementTests(unittest.TestCase):
    def test_valid_header_row_and_header_column(self) -> None:
        result = validate_document(_read_fixture("valid_header_row_and_column.ord"))
        self.assertTrue(result.ok)

    def test_valid_multi_level_header_rows(self) -> None:
        result = validate_document(_read_fixture("valid_multi_level_header_rows.ord"))
        self.assertTrue(result.ok)

    def test_valid_multiple_sheets(self) -> None:
        result = validate_document(_read_fixture("valid_multiple_sheets.ord"))
        self.assertTrue(result.ok)
        self.assertEqual(result.summary.sheet_count, 2)
        self.assertEqual(len(result.summary.sheets), 2)
        self.assertEqual(result.summary.sheets[0].name, "Revenue")
        self.assertEqual(result.summary.sheets[0].row_count, 2)
        self.assertEqual(result.summary.sheets[0].column_count, 3)
        self.assertEqual(result.summary.sheets[0].header_row_count, 0)
        self.assertEqual(result.summary.sheets[0].header_column_count, 1)

    def test_invalid_inconsistent_boundary_presence(self) -> None:
        result = validate_document(_read_fixture("invalid_inconsistent_boundary.ord"))
        self.assertFalse(result.ok)
        self.assertTrue(any("inconsistent || boundary" in e.message for e in result.errors))

    def test_invalid_inconsistent_boundary_position(self) -> None:
        result = validate_document(_read_fixture("invalid_boundary_position_mismatch.ord"))
        self.assertFalse(result.ok)
        self.assertTrue(any("inconsistent || boundary" in e.message for e in result.errors))

    def test_invalid_non_rectangular_table(self) -> None:
        result = validate_document(_read_fixture("invalid_non_rectangular.ord"))
        self.assertFalse(result.ok)
        self.assertTrue(any("not rectangular" in e.message for e in result.errors))

    def test_invalid_separator_row_first(self) -> None:
        result = validate_document(_read_fixture("invalid_separator_first.ord"))
        self.assertFalse(result.ok)
        self.assertTrue(any("separator row cannot be first row" in e.message for e in result.errors))

    def test_invalid_multiple_tables_in_one_sheet(self) -> None:
        result = validate_document(_read_fixture("invalid_multiple_tables_one_sheet.ord"))
        self.assertFalse(result.ok)
        self.assertTrue(any("multiple tables" in e.message for e in result.errors))

    def test_file_level_escape_rules_for_pipe_and_backslash(self) -> None:
        text = _read_fixture("valid_escaped_pipe.ord")
        result = validate_document(text)
        self.assertTrue(result.ok)

        formatted = format_document(text)
        self.assertIn(r"a\|b", formatted)
        self.assertIn(r"slash\\test", formatted)

    def test_format_matches_expected_fixture(self) -> None:
        text = _read_fixture("format_input_unaligned.ord")
        expected = _read_fixture("format_expected_unaligned.ord")
        self.assertEqual(format_document(text), expected)


if __name__ == "__main__":
    unittest.main()
