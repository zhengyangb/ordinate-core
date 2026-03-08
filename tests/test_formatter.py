import unittest

from ordinate_core import format_document


class FormatterTests(unittest.TestCase):
    def test_format_aligns_columns_and_preserves_boundary(self) -> None:
        text = """
# Revenue
| Item || Jan | Feb |
| Cash || 1 | 20 |
""".strip()

        output = format_document(text)

        self.assertIn("| Item || Jan | Feb |", output)
        self.assertIn("| Cash || 1   | 20  |", output)

    def test_format_multiple_sheets(self) -> None:
        text = """
# Revenue
| A | B |
| 1 | 2 |
# Costs
| C | D |
| 3 | 4 |
""".strip()

        output = format_document(text)

        self.assertIn("# Revenue", output)
        self.assertIn("# Costs", output)
        self.assertTrue(output.endswith("\n"))


if __name__ == "__main__":
    unittest.main()
