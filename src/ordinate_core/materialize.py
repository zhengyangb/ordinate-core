from __future__ import annotations

import re

from .formatter import format_document
from .parser import parse_document, parse_table_row
from .runtime import RuntimeValue, evaluate_document, parse_cell_input

_SEPARATOR_CELL_RE = re.compile(r"^:?-{3,}:?$")


def evaluate_and_format_document(text: str) -> str:
    parsed_sheets = parse_document(text)
    evaluated = evaluate_document(text)

    lines: list[str] = []
    for s_idx, sheet in enumerate(parsed_sheets):
        lines.append(f"# {sheet.name}")
        if sheet.table is not None:
            parsed_rows = [parse_table_row(r) for r in sheet.table.rows]
            body_start = _body_start_index(parsed_rows)
            eval_rows = evaluated.sheets[s_idx].values if s_idx < len(evaluated.sheets) else []

            for r_idx, row in enumerate(parsed_rows):
                if r_idx < body_start:
                    rendered_cells = list(row.raw_cells)
                else:
                    eval_row_idx = r_idx - body_start
                    eval_row = eval_rows[eval_row_idx] if eval_row_idx < len(eval_rows) else []
                    rendered_cells = []
                    for c_idx, raw_cell in enumerate(row.raw_cells):
                        cell_text = row.cells[c_idx] if c_idx < len(row.cells) else ""
                        parsed_cell = parse_cell_input(cell_text)
                        if parsed_cell.kind == "formula":
                            rhs = parsed_cell.expression_text or ""
                            value = eval_row[c_idx] if c_idx < len(eval_row) else RuntimeValue("error", "internal")
                            if value.kind == "blank":
                                rendered_cells.append(f"= {rhs}")
                            else:
                                rendered_cells.append(f"{_serialize_value(value)} = {rhs}")
                        else:
                            rendered_cells.append(raw_cell)

                lines.append(_build_row(rendered_cells, row.boundary))

        if s_idx != len(parsed_sheets) - 1:
            lines.append("")

    intermediate = "\n".join(lines).rstrip() + "\n"
    return format_document(intermediate)


def _body_start_index(parsed_rows: list) -> int:
    sep = _separator_row_index(parsed_rows)
    return sep + 1 if sep is not None else 0


def _separator_row_index(parsed_rows: list) -> int | None:
    for idx, row in enumerate(parsed_rows):
        if row.cells and all(_SEPARATOR_CELL_RE.match(cell) is not None for cell in row.cells):
            return idx
    return None


def _build_row(cells: list[str], boundary: int | None) -> str:
    parts: list[str] = []
    if boundary == 0:
        parts.append("")
    for idx, cell in enumerate(cells):
        parts.append(cell)
        if boundary is not None and idx + 1 == boundary:
            parts.append("")
    return "|" + "|".join(parts) + "|"


def _serialize_value(value: RuntimeValue) -> str:
    if value.kind == "number":
        return _serialize_number(value.value)
    if value.kind == "string":
        return _serialize_string(str(value.value if value.value is not None else ""))
    if value.kind == "boolean":
        return "true" if bool(value.value) else "false"
    if value.kind == "blank":
        return ""
    if value.kind == "null":
        return "null"
    if value.kind == "error":
        return "error"
    return "error"


def _serialize_number(value: object | None) -> str:
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return format(value, ".15g")
    return "error"


def _serialize_string(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'
