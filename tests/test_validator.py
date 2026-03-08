import unittest

from ordinate_core import validate_document


class ValidatorTests(unittest.TestCase):
    def test_validate_header_row_and_column_rfc_example_is_valid(self) -> None:
        text = """
# Revenue
| Item || Jan | Feb |
| ---- || --- | --- |
| Cash || 10  | 12  |
| Debt || 5   | 6   |
""".strip()

        result = validate_document(text)
        self.assertTrue(result.ok)

    def test_validate_inconsistent_boundary_fails(self) -> None:
        text = """
# Revenue
| Item || Jan | Feb |
| Cash | 10 | 12 |
""".strip()

        result = validate_document(text)
        self.assertFalse(result.ok)
        self.assertTrue(any("inconsistent || boundary" in e.message for e in result.errors))

    def test_validate_non_rectangular_table_fails(self) -> None:
        text = """
# Revenue
| A | B | C |
| 1 | 2 |
""".strip()

        result = validate_document(text)
        self.assertFalse(result.ok)
        self.assertTrue(any("not rectangular" in e.message for e in result.errors))

    def test_validate_sheet_without_table_fails(self) -> None:
        text = """
# Revenue
some notes
""".strip()

        result = validate_document(text)
        self.assertFalse(result.ok)
        self.assertTrue(any("has no table" in e.message for e in result.errors))

    def test_validate_separator_cannot_be_first_row(self) -> None:
        text = """
# Revenue
| --- | --- |
| A   | B   |
""".strip()

        result = validate_document(text)
        self.assertFalse(result.ok)
        self.assertTrue(any("separator row cannot be first row" in e.message for e in result.errors))


if __name__ == "__main__":
    unittest.main()
