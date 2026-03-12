import unittest
from pathlib import Path

from ordinate_core import evaluate_and_format_document, evaluate_document, validate_document

_FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "rfc_0005"


class Rfc0005EvaluateAndFormatOrdFile(unittest.TestCase):
    def test_profit_statement_ord_input_to_ord_output(self) -> None:
        input_text = (_FIXTURE_DIR / "profit_statement_input.ord").read_text(encoding="utf-8")
        expected_text = (_FIXTURE_DIR / "profit_statement_expected.ord").read_text(encoding="utf-8")

        output_text = evaluate_and_format_document(input_text)
        self.assertEqual(output_text, expected_text)

        v = validate_document(output_text)
        self.assertTrue(v.ok)

        evaluated = evaluate_document(output_text)
        sheet = evaluated.sheets[0]
        gross_profit_2025_row = sheet.row_paths.index("Gross Profit")
        col_2025 = sheet.col_labels.index("2025")
        self.assertEqual(sheet.values[gross_profit_2025_row][col_2025].value, 315)


if __name__ == "__main__":
    unittest.main()
