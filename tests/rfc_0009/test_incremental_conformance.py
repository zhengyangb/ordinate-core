import unittest

from ordinate_core import ChangeKind, DocumentState, evaluate_document
from ordinate_core.parser import escape_cell_text, parse_document, parse_table_row
from ordinate_core.runtime import _SEPARATOR_CELL_RE, _build_body_rows, _header_row_count


def _rebuild_doc(sheets: list[tuple[str, list[str]]]) -> str:
    lines: list[str] = []
    for name, rows in sheets:
        lines.append(f"# {name}")
        lines.extend(rows)
    return "\n".join(lines)


def _update_cell_text(doc: str, sheet_name: str, row_path: str, col_label: str, new_text: str) -> str:
    parsed = parse_document(doc)
    sheets: list[tuple[str, list[str]]] = []
    for sheet in parsed:
        rows = list(sheet.table.rows) if sheet.table is not None else []
        if sheet.name == sheet_name and sheet.table is not None:
            parsed_rows = [parse_table_row(r) for r in rows]
            sep_idx = None
            for idx, row in enumerate(parsed_rows):
                if row.cells and all(_SEPARATOR_CELL_RE.match(cell) is not None for cell in row.cells):
                    sep_idx = idx
                    break

            logical_rows = [row for idx, row in enumerate(parsed_rows) if idx != sep_idx]
            col_count = max((len(r.cells) for r in logical_rows), default=0)
            header_row_count = _header_row_count(parsed_rows)
            body_start = header_row_count if header_row_count > 0 else 0
            header_labels = logical_rows[header_row_count - 1].cells if header_row_count > 0 else []
            col_labels = [
                header_labels[c] if c < len(header_labels) and header_labels[c] != "" else f"C{c + 1}"
                for c in range(col_count)
            ]
            row_paths, _ = _build_body_rows(logical_rows, body_start, col_count)

            if row_path not in row_paths:
                raise KeyError(f"unknown row path '{row_path}'")
            if col_label not in col_labels:
                raise KeyError(f"unknown column label '{col_label}'")

            row_rel = row_paths.index(row_path)
            r_abs = body_start + row_rel
            parsed_index = r_abs if sep_idx is None or r_abs < sep_idx else r_abs + 1
            col_index = col_labels.index(col_label)

            row = parsed_rows[parsed_index]
            raw_cells = list(row.raw_cells)
            if len(raw_cells) < col_count:
                raw_cells += [""] * (col_count - len(raw_cells))
            raw_cells[col_index] = escape_cell_text(new_text)

            segments = list(raw_cells)
            if row.boundary is not None:
                boundary = row.boundary
                if boundary <= len(segments):
                    segments.insert(boundary, "")

            rows[parsed_index] = "|" + "|".join(segments) + "|"

        sheets.append((sheet.name, rows))

    return _rebuild_doc(sheets)


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


class IncrementalConformanceTests(unittest.TestCase):
    def _doc(self) -> str:
        return """
# Sheet
| Item  || 2024 | 2025 | Sum |
| ----  || ---- | ---- | --- |
| A     || 1    | 2    | = sum(@[A,2024:2025]) |
| B     || 3    | 4    | = sum(@[B,2024:2025]) |
| Total || = sum(@[#2:#3,2024:2025]) |  |  |
""".strip()

    def _doc_current_and_offset(self) -> str:
        return """
# Sheet
| Item || 2024 | 2025 |
| ---- || ---- | ---- |
| A    || 1    | 2 |
| B    || = @[_-1,2024] + 1 | = @[_-1,2025] + @[_,2024] |
| C    || = @[_-1,2025] + 1 | = @[_-1,2025] + 1 |
""".strip()

    def _doc_labels_with_spaces(self) -> str:
        return """
# Sheet
| Item            || 2024 | 2025 | Total |
| ----            || ---- | ---- | ----- |
| Revenue         || 5    | 6    | = sum(@[Revenue,2024:2025]) |
| Cost of Sales   || 2    | 3    | = sum(@["Cost of Sales",2024:2025]) |
| Profit          || = @[Revenue,2024] - @["Cost of Sales",2024] | = @[Revenue,2025] - @["Cost of Sales",2025] | = sum(@[Profit,2024:2025]) |
""".strip()

    def _doc_mixed_types(self) -> str:
        return """
# Sheet
| Item  || 2024 | 2025 | Sum |
| ----  || ---- | ---- | --- |
| A     || 1    |      | = sum(@[A,2024:2025]) |
| B     || true | false | = sum(@[B,2024:2025]) |
| C     || = 1 / 0 | 3 | = sum(@[C,2024:2025]) |
| Total || = sum(@[#2:#4,2024:2025]) |  |  |
""".strip()

    def _doc_sections(self) -> str:
        return """
# Sheet
| Item        || 2024 | 2025 | Total |
| ----        || ---- | ---- | ----- |
| [Revenue]   ||      |      |       |
|  Product A  || 2    | 3    | = sum(@["Revenue"."Product A",2024:2025]) |
| [Cost]      ||      |      |       |
|  Materials  || 1    | 1    | = sum(@["Cost"."Materials",2024:2025]) |
| Profit      || = @["Revenue"."Product A",2024] - @["Cost"."Materials",2024] | = @["Revenue"."Product A",2025] - @["Cost"."Materials",2025] | = sum(@[Profit,2024:2025]) |
""".strip()

    def _doc_range_edges(self) -> str:
        return """
# Sheet
| Item  || 2024 | 2025 | 2026 | Sum |
| ----  || ---- | ---- | ---- | --- |
| A     || 1    | 2    | 3    | = sum(@[A,2024:]) |
| B     || 4    | 5    | 6    | = sum(@[B,:2025]) |
| Total || = sum(@[:,"2025"]) |  |  |
""".strip()

    def _assert_conformance(self, doc: str, updates: list[tuple[str, str, str, str]]) -> None:
        state = DocumentState.from_text(doc)
        updated = doc
        for sheet, row, col, text in updates:
            updated = _update_cell_text(updated, sheet, row, col, text)
            state.set_cell(sheet, row, col, text, kind=ChangeKind.VALUE, eager=False)
        expected = evaluate_document(updated)
        actual = state.evaluate()
        _assert_same_evaluation(self, actual, expected)

    def test_incremental_matches_full_after_value_edit(self) -> None:
        self._assert_conformance(self._doc(), [("Sheet", "A", "2024", "10")])

    def test_incremental_matches_full_after_formula_edit(self) -> None:
        self._assert_conformance(self._doc(), [("Sheet", "A", "Sum", "= sum(@[A,2024:2025]) + 1")])

    def test_batch_edit_matches_full(self) -> None:
        self._assert_conformance(
            self._doc(),
            [
                ("Sheet", "A", "2024", "10"),
                ("Sheet", "B", "2025", "8"),
            ],
        )

    def test_current_and_offset_references(self) -> None:
        self._assert_conformance(
            self._doc_current_and_offset(),
            [
                ("Sheet", "A", "2024", "10"),
                ("Sheet", "A", "2025", "5"),
            ],
        )

    def test_labels_with_spaces(self) -> None:
        self._assert_conformance(
            self._doc_labels_with_spaces(),
            [
                ("Sheet", "Cost of Sales", "2024", "4"),
                ("Sheet", "Revenue", "2025", "8"),
            ],
        )

    def test_mixed_types_and_error_recovery(self) -> None:
        self._assert_conformance(
            self._doc_mixed_types(),
            [
                ("Sheet", "A", "2025", "5"),
                ("Sheet", "C", "2024", "1"),
            ],
        )

    def test_section_row_paths(self) -> None:
        self._assert_conformance(
            self._doc_sections(),
            [
                ("Sheet", "Revenue.Product A", "2025", "4"),
                ("Sheet", "Cost.Materials", "2024", "2"),
            ],
        )

    def test_range_edge_selectors(self) -> None:
        self._assert_conformance(
            self._doc_range_edges(),
            [
                ("Sheet", "A", "2026", "10"),
                ("Sheet", "B", "2024", "8"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
