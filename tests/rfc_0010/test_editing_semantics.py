import unittest

from ordinate_core import DocumentState, evaluate_document


def _assert_same_evaluation(testcase: unittest.TestCase, left, right) -> None:
    testcase.assertEqual(len(left.sheets), len(right.sheets))
    for sheet_left, sheet_right in zip(left.sheets, right.sheets):
        testcase.assertEqual(sheet_left.row_paths, sheet_right.row_paths)
        testcase.assertEqual(sheet_left.col_labels, sheet_right.col_labels)
        testcase.assertEqual(len(sheet_left.values), len(sheet_right.values))
        for row_l, row_r in zip(sheet_left.values, sheet_right.values):
            testcase.assertEqual(len(row_l), len(row_r))
            for val_l, val_r in zip(row_l, row_r):
                testcase.assertEqual(val_l.kind, val_r.kind)
                testcase.assertEqual(val_l.value, val_r.value)


class EditingSemanticsTests(unittest.TestCase):
    def test_clear_cell_is_blank_and_recalculates(self) -> None:
        doc = """
# Sheet
| Item  || 2024 | 2025 | Sum |
| ----  || ---- | ---- | --- |
| A     || 1    | 2    | = sum(@[A,2024:2025]) |
| B     || 3    | 4    | = sum(@[B,2024:2025]) |
| Total || = sum(@[#2:#3,2024:2025]) |  |  |
""".strip()

        updated = """
# Sheet
| Item  || 2024 | 2025 | Sum |
| ----  || ---- | ---- | --- |
| A     ||      | 2    | = sum(@[A,2024:2025]) |
| B     || 3    | 4    | = sum(@[B,2024:2025]) |
| Total || = sum(@[#2:#3,2024:2025]) |  |  |
""".strip()

        state = DocumentState.from_text(doc)
        state.clear_cell("Sheet", "A", "2024")

        actual = state.evaluate()
        expected = evaluate_document(updated)

        _assert_same_evaluation(self, actual, expected)


if __name__ == "__main__":
    unittest.main()
