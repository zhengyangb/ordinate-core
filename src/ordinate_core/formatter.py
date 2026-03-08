from __future__ import annotations

from .parser import ParsedRow, escape_cell_text, parse_document, parse_table_row


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
        cells = row.cells
        for i, cell in enumerate(cells):
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
    chunks: list[str] = ["|"]
    for idx, cell in enumerate(cells):
        escaped = escape_cell_text(cell)
        chunks.append(f" {escaped.ljust(widths[idx])} ")
        if boundary is not None and idx + 1 == boundary:
            chunks.append("|")
        chunks.append("|")
    return "".join(chunks)
