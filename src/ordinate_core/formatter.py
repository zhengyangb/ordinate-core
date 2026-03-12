from __future__ import annotations

import re

from .parser import ParsedRow, escape_cell_text, parse_document, parse_table_row

_SEPARATOR_CELL_RE = re.compile(r"^:?-{3,}:?$")


def format_document(text: str) -> str:
    sheets = parse_document(text)
    parts: list[str] = []

    for s_idx, sheet in enumerate(sheets):
        parts.append(f"# {sheet.name}")
        if sheet.table is not None:
            parsed = [parse_table_row(row) for row in sheet.table.rows]
            widths = _column_widths(parsed)
            boundary = _common_boundary(parsed)

            for row in parsed:
                parts.append(_render_row(row, widths, boundary))

        if s_idx != len(sheets) - 1:
            parts.append("")

    return "\n".join(parts).rstrip() + "\n"


def _column_widths(rows: list[ParsedRow]) -> list[int]:
    max_cols = max((len(r.cells) for r in rows), default=0)
    widths = [0] * max_cols
    for row in rows:
        for i in range(len(row.cells)):
            cell = _display_cell(row, i)
            widths[i] = max(widths[i], len(escape_cell_text(cell)))
    return widths


def _common_boundary(rows: list[ParsedRow]) -> int | None:
    boundaries = [r.boundary for r in rows if r.boundary is not None]
    if not boundaries:
        return None
    first = boundaries[0]
    if all(b == first for b in boundaries):
        return first
    return None


def _render_row(row: ParsedRow, widths: list[int], boundary: int | None) -> str:
    cells = row.cells
    is_separator = _is_separator_row(cells)
    chunks: list[str] = ["|"]
    for idx, cell in enumerate(cells):
        display = _display_cell(row, idx)
        escaped = "-" * max(3, widths[idx]) if is_separator else escape_cell_text(display)
        chunks.append(f" {escaped.ljust(widths[idx])} ")
        if boundary is not None and idx + 1 == boundary:
            chunks.append("|")
        chunks.append("|")
    return "".join(chunks)


def _is_separator_row(cells: list[str]) -> bool:
    if not cells:
        return False
    return all(_SEPARATOR_CELL_RE.match(cell) is not None for cell in cells)


def _display_cell(row: ParsedRow, idx: int) -> str:
    if idx >= len(row.cells):
        return ""
    if idx != 0:
        return row.cells[idx]

    raw = row.raw_cells[idx] if idx < len(row.raw_cells) else row.cells[idx]
    stripped = raw.strip()
    if stripped == "":
        return ""

    # Keep semantic indentation for first-column labels while dropping layout padding.
    leading = len(raw) - len(raw.lstrip(" "))
    semantic_indent = max(0, leading - 1)
    return (" " * semantic_indent) + stripped
