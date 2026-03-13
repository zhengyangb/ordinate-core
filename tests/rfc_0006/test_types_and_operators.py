import unittest
from pathlib import Path

from ordinate_core import evaluate_document

from tests.spec_loader import load_spec_cases, parse_scalar

_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "rfc_0006" / "types_and_operators.cases"


class Rfc0006TypesAndOperators(unittest.TestCase):
    def test_types_and_operators_spec_cases(self) -> None:
        for case in load_spec_cases(_FIXTURE):
            with self.subTest(name=case["name"]):
                result = evaluate_document(case["doc"])
                sheet = result.sheets[0]

                row_path = case["target_row"]
                col_label = case["target_col"]

                r = sheet.row_paths.index(row_path)
                c = sheet.col_labels.index(col_label)
                value = sheet.values[r][c]

                self.assertEqual(value.kind, case["expect_kind"])
                if "expect_value" in case:
                    self.assertEqual(value.value, parse_scalar(case["expect_value"]))


if __name__ == "__main__":
    unittest.main()
