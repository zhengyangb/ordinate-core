from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .parser import parse_document, parse_table_row
from .runtime import (
    EvaluationResult,
    ExprNode,
    ParsedCell,
    RuntimeValue,
    SheetEvaluation,
    ViewSelection,
    _SEPARATOR_CELL_RE,
    _build_body_rows,
    _build_row_keys,
    _data_row_indices,
    _eval_expr,
    _header_col_count,
    _header_row_count,
    _select_view,
    parse_cell_input,
)


class ChangeKind(str, Enum):
    VALUE = "value"
    LABEL = "label"
    STRUCTURAL = "structural"
    SHEET = "sheet"


@dataclass
class CellState:
    text: str
    parsed: ParsedCell
    value: RuntimeValue | None
    dirty: bool


@dataclass
class SheetState:
    name: str
    row_count: int
    col_count: int
    header_row_count: int
    header_col_count: int
    body_start: int
    body_row_count: int
    row_paths: list[str]
    col_labels: list[str]
    row_map: dict[tuple[str, ...], list[int]]
    col_map: dict[str, list[int]]
    data_row_indices: list[int]
    data_col_indices: list[int]
    logical_rows: list
    cells: list[list[CellState]]
    view_dependencies: dict[int, "ViewSelection"]
    view_formulas: dict[int, tuple[int, int]]
    view_row_index: dict[int, set[int]]
    view_col_index: dict[int, set[int]]
    formula_view_ids: dict[tuple[int, int], set[int]]
    next_view_id: int

    @classmethod
    def from_table_rows(cls, name: str, rows: list[str]) -> "SheetState":
        parsed_rows = [parse_table_row(r) for r in rows]
        separator_index = _separator_row_index(parsed_rows)
        logical_rows = [row for idx, row in enumerate(parsed_rows) if idx != separator_index]

        if not logical_rows:
            return cls(
                name=name,
                row_count=0,
                col_count=0,
                header_row_count=0,
                header_col_count=0,
                body_start=0,
                body_row_count=0,
                row_paths=[],
                col_labels=[],
                row_map={},
                col_map={},
                data_row_indices=[],
                data_col_indices=[],
                logical_rows=[],
                cells=[],
                view_dependencies={},
                view_formulas={},
                view_row_index={},
                view_col_index={},
                formula_view_ids={},
                next_view_id=1,
            )

        col_count = max((len(r.cells) for r in logical_rows), default=0)
        header_row_count = _header_row_count(parsed_rows)
        header_col_count = _header_col_count(logical_rows)
        body_start = header_row_count if header_row_count > 0 else 0

        header_labels = logical_rows[header_row_count - 1].cells if header_row_count > 0 else []
        col_labels: list[str] = []
        for c in range(col_count):
            if c < len(header_labels) and header_labels[c] != "":
                col_labels.append(header_labels[c])
            else:
                col_labels.append(f"C{c + 1}")

        row_paths, _body_cells = _build_body_rows(logical_rows, body_start, col_count)
        row_keys = _build_row_keys(logical_rows, body_start)
        row_map: dict[tuple[str, ...], list[int]] = {}
        for offset, key in enumerate(row_keys):
            abs_idx = body_start + offset
            row_map.setdefault(key, []).append(abs_idx)

        col_map: dict[str, list[int]] = {}
        for i, label in enumerate(col_labels):
            col_map.setdefault(label, []).append(i)

        body_row_count = len(logical_rows) - body_start
        data_row_indices = _data_row_indices(logical_rows, body_start)
        data_col_indices = list(range(header_col_count, col_count))

        cells: list[list[CellState]] = []
        for row in logical_rows:
            row_cells: list[CellState] = []
            trimmed = list(row.cells)
            if len(trimmed) < col_count:
                trimmed += [""] * (col_count - len(trimmed))
            for value in trimmed:
                parsed = parse_cell_input(value)
                row_cells.append(CellState(text=value, parsed=parsed, value=None, dirty=True))
            cells.append(row_cells)

        sheet = cls(
            name=name,
            row_count=len(logical_rows),
            col_count=col_count,
            header_row_count=header_row_count,
            header_col_count=header_col_count,
            body_start=body_start,
            body_row_count=body_row_count,
            row_paths=row_paths,
            col_labels=col_labels,
            row_map=row_map,
            col_map=col_map,
            data_row_indices=data_row_indices,
            data_col_indices=data_col_indices,
            logical_rows=logical_rows,
            cells=cells,
            view_dependencies={},
            view_formulas={},
            view_row_index={},
            view_col_index={},
            formula_view_ids={},
            next_view_id=1,
        )
        sheet._rebuild_dependencies()
        return sheet

    def to_evaluation(self) -> SheetEvaluation:
        self.recalculate()
        values: list[list[RuntimeValue]] = []
        for r_abs in range(self.body_start, self.row_count):
            row_values = [self._eval_cell(r_abs, c, {}) for c in range(self.col_count)]
            values.append(row_values)
        return SheetEvaluation(
            name=self.name,
            row_paths=self.row_paths,
            col_labels=self.col_labels,
            values=values,
        )

    def set_cell_by_label(
        self,
        row_path: str,
        col_label: str,
        text: str,
        kind: ChangeKind = ChangeKind.VALUE,
        eager: bool = True,
    ) -> None:
        if row_path not in self.row_paths:
            raise KeyError(f"unknown row path '{row_path}'")
        if col_label not in self.col_labels:
            raise KeyError(f"unknown column label '{col_label}'")
        row_rel = self.row_paths.index(row_path)
        r_abs = self.body_start + row_rel
        c = self.col_labels.index(col_label)
        self.set_cell_by_index(r_abs, c, text, kind=kind, eager=eager)

    def set_cell_by_index(
        self,
        r_abs: int,
        c: int,
        text: str,
        kind: ChangeKind = ChangeKind.VALUE,
        eager: bool = True,
    ) -> None:
        if r_abs < 0 or r_abs >= self.row_count or c < 0 or c >= self.col_count:
            raise IndexError("cell index out of range")

        cell = self.cells[r_abs][c]
        cell.text = text
        cell.parsed = parse_cell_input(text)
        cell.dirty = True
        cell.value = None

        self._update_row_text(r_abs, c, text)

        if kind == ChangeKind.VALUE:
            self._update_dependencies_for_cell(r_abs, c)
            self._mark_dirty_from((r_abs, c))
        elif kind in {ChangeKind.LABEL, ChangeKind.STRUCTURAL, ChangeKind.SHEET}:
            self._rebuild_metadata()
            self._mark_all_dirty()
        else:
            self._mark_all_dirty()

        if eager:
            self.recalculate()

    def recalculate(self) -> None:
        for r_abs in range(self.row_count):
            for c in range(self.col_count):
                if self.cells[r_abs][c].dirty:
                    self._eval_cell(r_abs, c, {})

    def _eval_cell(self, r_abs: int, c: int, states: dict[tuple[int, int], str]) -> RuntimeValue:
        key = (r_abs, c)
        state = states.get(key)
        if state == "visiting":
            return RuntimeValue("error", "cycle")
        cell = self.cells[r_abs][c]
        if state == "done":
            return cell.value or RuntimeValue("blank", None)
        if not cell.dirty and cell.value is not None:
            return cell.value

        states[key] = "visiting"
        parsed_cell = cell.parsed

        if parsed_cell.kind == "literal":
            value = parsed_cell.literal or RuntimeValue("blank", None)
        else:
            value = _eval_expr(
                parsed_cell.expression,
                r_abs,
                c,
                lambda r_dep, c_dep: self._eval_cell(r_dep, c_dep, states),
                self.row_map,
                self.col_map,
                self.row_count,
                self.col_count,
                self.body_start,
                self.body_row_count,
                self.data_row_indices,
                self.data_col_indices,
            )

        cell.value = value
        cell.dirty = False
        states[key] = "done"
        return value

    def _update_row_text(self, r_abs: int, c: int, text: str) -> None:
        row = self.logical_rows[r_abs]
        if c >= len(row.raw_cells):
            row.raw_cells += [""] * (c - len(row.raw_cells) + 1)
        if c >= len(row.cells):
            row.cells += [""] * (c - len(row.cells) + 1)
        row.raw_cells[c] = text
        row.cells[c] = text.strip()

    def _update_dependencies_for_cell(self, r_abs: int, c: int) -> None:
        key = (r_abs, c)
        for view_id in self.formula_view_ids.pop(key, set()):
            view = self.view_dependencies.pop(view_id, None)
            self.view_formulas.pop(view_id, None)
            if view is None:
                continue
            for r_dep in view.row_indices:
                row_set = self.view_row_index.get(r_dep)
                if row_set is not None:
                    row_set.discard(view_id)
                    if not row_set:
                        self.view_row_index.pop(r_dep, None)
            for c_dep in view.col_indices:
                col_set = self.view_col_index.get(c_dep)
                if col_set is not None:
                    col_set.discard(view_id)
                    if not col_set:
                        self.view_col_index.pop(c_dep, None)

        views = self._collect_view_dependencies(r_abs, c)
        if not views:
            return
        new_ids: set[int] = set()
        for view in views:
            if not view.row_indices or not view.col_indices:
                continue
            view_id = self.next_view_id
            self.next_view_id += 1
            self.view_dependencies[view_id] = view
            self.view_formulas[view_id] = key
            for r_dep in view.row_indices:
                self.view_row_index.setdefault(r_dep, set()).add(view_id)
            for c_dep in view.col_indices:
                self.view_col_index.setdefault(c_dep, set()).add(view_id)
            new_ids.add(view_id)
        if new_ids:
            self.formula_view_ids[key] = new_ids

    def _collect_view_dependencies(self, r_abs: int, c: int) -> list["ViewSelection"]:
        cell = self.cells[r_abs][c]
        if cell.parsed.kind != "formula":
            return []
        expr = cell.parsed.expression
        if expr is None:
            return []
        views: list["ViewSelection"] = []

        def walk(node: ExprNode | None) -> None:
            if node is None:
                return
            if node.kind == "reference":
                view = _select_view(
                    node.value,
                    r_abs,
                    c,
                    self.row_map,
                    self.col_map,
                    self.row_count,
                    self.col_count,
                    self.body_start,
                    self.body_row_count,
                    self.data_row_indices,
                    self.data_col_indices,
                )
                if view is None:
                    return
                views.append(view)
                return
            if node.kind == "call":
                for arg in node.value.args:
                    walk(arg)
                return
            if node.kind == "unary":
                walk(node.right)
                return
            if node.kind == "binary":
                walk(node.left)
                walk(node.right)
                return

        walk(expr)
        return views

    def _rebuild_metadata(self) -> None:
        col_count = max((len(r.cells) for r in self.logical_rows), default=0)
        self.col_count = col_count
        header_labels = self.logical_rows[self.header_row_count - 1].cells if self.header_row_count > 0 else []
        col_labels: list[str] = []
        for c in range(col_count):
            if c < len(header_labels) and header_labels[c] != "":
                col_labels.append(header_labels[c])
            else:
                col_labels.append(f"C{c + 1}")
        self.col_labels = col_labels

        row_paths, _body_cells = _build_body_rows(self.logical_rows, self.body_start, col_count)
        self.row_paths = row_paths

        row_keys = _build_row_keys(self.logical_rows, self.body_start)
        row_map: dict[tuple[str, ...], list[int]] = {}
        for offset, key in enumerate(row_keys):
            abs_idx = self.body_start + offset
            row_map.setdefault(key, []).append(abs_idx)
        self.row_map = row_map

        col_map: dict[str, list[int]] = {}
        for i, label in enumerate(col_labels):
            col_map.setdefault(label, []).append(i)
        self.col_map = col_map

        self.data_row_indices = _data_row_indices(self.logical_rows, self.body_start)
        self.data_col_indices = list(range(self.header_col_count, col_count))
        self.row_count = len(self.logical_rows)
        self.body_row_count = self.row_count - self.body_start

        self._rebuild_dependencies()

    def _rebuild_dependencies(self) -> None:
        self.view_dependencies = {}
        self.view_formulas = {}
        self.view_row_index = {}
        self.view_col_index = {}
        self.formula_view_ids = {}
        self.next_view_id = 1
        for r_abs in range(self.row_count):
            for c in range(self.col_count):
                self._update_dependencies_for_cell(r_abs, c)

    def _mark_dirty_from(self, origin: tuple[int, int]) -> None:
        queue = [origin]
        seen: set[tuple[int, int]] = set()
        while queue:
            key = queue.pop()
            if key in seen:
                continue
            seen.add(key)
            r_abs, c = key
            self.cells[r_abs][c].dirty = True
            row_views = self.view_row_index.get(r_abs, set())
            col_views = self.view_col_index.get(c, set())
            if not row_views or not col_views:
                continue
            if len(row_views) <= len(col_views):
                view_ids = row_views & col_views
            else:
                view_ids = col_views & row_views
            for view_id in view_ids:
                formula = self.view_formulas.get(view_id)
                if formula is not None:
                    queue.append(formula)

    def _mark_all_dirty(self) -> None:
        for r_abs in range(self.row_count):
            for c in range(self.col_count):
                self.cells[r_abs][c].dirty = True
                self.cells[r_abs][c].value = None


@dataclass
class DocumentState:
    sheets: list[SheetState]

    @classmethod
    def from_text(cls, text: str) -> "DocumentState":
        parsed = parse_document(text)
        sheets: list[SheetState] = []
        for sheet in parsed:
            if sheet.table is None:
                sheets.append(SheetState.from_table_rows(sheet.name, []))
            else:
                sheets.append(SheetState.from_table_rows(sheet.name, sheet.table.rows))
        return cls(sheets=sheets)

    def evaluate(self) -> EvaluationResult:
        sheet_evals: list[SheetEvaluation] = []
        for sheet_state in self.sheets:
            sheet_evals.append(sheet_state.to_evaluation())
        return EvaluationResult(sheets=sheet_evals)

    def set_cell(
        self,
        sheet_name: str,
        row_path: str,
        col_label: str,
        text: str,
        kind: ChangeKind = ChangeKind.VALUE,
        eager: bool = True,
    ) -> None:
        sheet = self._find_sheet(sheet_name)
        sheet.set_cell_by_label(row_path, col_label, text, kind=kind, eager=eager)

    def set_cell_by_index(
        self,
        sheet_name: str,
        row_index: int,
        col_index: int,
        text: str,
        kind: ChangeKind = ChangeKind.VALUE,
        eager: bool = True,
    ) -> None:
        sheet = self._find_sheet(sheet_name)
        sheet.set_cell_by_index(row_index, col_index, text, kind=kind, eager=eager)

    def _find_sheet(self, name: str) -> SheetState:
        for sheet_state in self.sheets:
            if sheet_state.name == name:
                return sheet_state
        raise KeyError(f"unknown sheet '{name}'")


def _separator_row_index(rows) -> int | None:
    for idx, row in enumerate(rows):
        if row.cells and all(_SEPARATOR_CELL_RE.match(cell) is not None for cell in row.cells):
            return idx
    return None
