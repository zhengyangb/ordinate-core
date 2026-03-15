import unittest

from ordinate_core import ChangeKind, DocumentState


class IncrementalRecalcTests(unittest.TestCase):
    def _build_state(self) -> DocumentState:
        doc = """
# Sheet
| Item  || 2024 | 2025 | Sum |
| ----  || ---- | ---- | --- |
| A     || 1    | 2    | = sum(@[A,2024:2025]) |
| B     || 3    | 4    | = sum(@[B,2024:2025]) |
| Total || = sum(@[#2:#3,2024:2025]) |  |  |
""".strip()
        return DocumentState.from_text(doc)

    def test_value_edit_updates_dependents(self) -> None:
        state = self._build_state()
        before = state.evaluate().sheets[0]
        row_a = before.row_paths.index("A")
        row_b = before.row_paths.index("B")
        col_sum = before.col_labels.index("Sum")
        self.assertEqual(before.values[row_a][col_sum].value, 3)
        self.assertEqual(before.values[row_b][col_sum].value, 7)

        state.set_cell("Sheet", "A", "2024", "10", kind=ChangeKind.VALUE)
        after = state.evaluate().sheets[0]
        self.assertEqual(after.values[row_a][col_sum].value, 12)
        self.assertEqual(after.values[row_b][col_sum].value, 7)

    def test_range_dependency_updates_total(self) -> None:
        state = self._build_state()
        before = state.evaluate().sheets[0]
        row_total = before.row_paths.index("Total")
        col_2024 = before.col_labels.index("2024")
        self.assertEqual(before.values[row_total][col_2024].value, 10)

        state.set_cell("Sheet", "A", "2024", "10", kind=ChangeKind.VALUE)
        after = state.evaluate().sheets[0]
        self.assertEqual(after.values[row_total][col_2024].value, 19)


if __name__ == "__main__":
    unittest.main()
