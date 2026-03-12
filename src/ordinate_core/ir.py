from __future__ import annotations

import re
from dataclasses import dataclass

from .parser import parse_document, parse_table_row

_SEPARATOR_CELL_RE = re.compile(r"^:?-{3,}:?$")
_SECTION_RE = re.compile(r"^(\[+)([^\[\]]+)(\]+)$")


@dataclass(frozen=True)
class RowIR:
    row_index: int
    cells: list[str]
    label: str
    kind: str
    depth: int
    section_name: str | None
    parent_sections: list[str]


@dataclass(frozen=True)
class SectionIR:
    name: str
    depth: int
    start_row: int


@dataclass(frozen=True)
class TableIR:
    row_count: int
    column_count: int
    header_row_count: int
    header_column_count: int
    section_count: int
    max_section_depth: int
    rows: list[RowIR]
    sections: list[SectionIR]


@dataclass(frozen=True)
class SheetIR:
    name: str
    table: TableIR | None
    has_multiple_tables: bool


@dataclass(frozen=True)
class DocumentIR:
    sheets: list[SheetIR]


def build_document_ir(text: str) -> DocumentIR:
    sheets = parse_document(text)
    ir_sheets: list[SheetIR] = []
    for sheet in sheets:
        if sheet.table is None:
            ir_sheets.append(SheetIR(name=sheet.name, table=None, has_multiple_tables=sheet.has_multiple_tables))
            continue

        parsed_rows = [parse_table_row(row) for row in sheet.table.rows]
        widths = {len(r.cells) for r in parsed_rows}
        column_count = next(iter(widths)) if len(widths) == 1 else 0

        header_row_count = _header_row_count(parsed_rows)
        header_column_count = _header_column_count(parsed_rows, column_count)
        body_start = header_row_count + 1 if header_row_count > 0 else 0

        rows, sections, max_depth = _build_hierarchy(parsed_rows, body_start)
        ir_sheets.append(
            SheetIR(
                name=sheet.name,
                table=TableIR(
                    row_count=len(parsed_rows),
                    column_count=column_count,
                    header_row_count=header_row_count,
                    header_column_count=header_column_count,
                    section_count=len(sections),
                    max_section_depth=max_depth,
                    rows=rows,
                    sections=sections,
                ),
                has_multiple_tables=sheet.has_multiple_tables,
            )
        )
    return DocumentIR(sheets=ir_sheets)


def _header_row_count(rows: list) -> int:
    for idx, row in enumerate(rows):
        if row.cells and all(_SEPARATOR_CELL_RE.match(cell) is not None for cell in row.cells):
            return idx
    return 0


def _header_column_count(rows: list, column_count: int) -> int:
    if not rows:
        return 0
    first_boundary = rows[0].boundary
    if first_boundary is None:
        return 0
    if all(r.boundary == first_boundary for r in rows):
        return min(first_boundary, column_count)
    return 0


def _build_hierarchy(parsed_rows: list, body_start: int) -> tuple[list[RowIR], list[SectionIR], int]:
    rows: list[RowIR] = []
    sections: list[SectionIR] = []
    stack: list[SectionIR] = []
    max_depth = 0

    for row_idx, row in enumerate(parsed_rows[body_start:], start=body_start + 1):
        label_raw = row.raw_cells[0] if row.raw_cells else ""
        marker = _parse_section_marker(label_raw.strip())

        if marker is not None:
            name, depth = marker
            while len(stack) > depth:
                stack.pop()
            if len(stack) < depth:
                depth = len(stack)
            parent_sections = [s.name for s in stack[:depth]]
            section = SectionIR(name=name, depth=depth, start_row=row_idx)
            sections.append(section)
            stack = stack[:depth]
            stack.append(section)
            max_depth = max(max_depth, depth)
            rows.append(
                RowIR(
                    row_index=row_idx,
                    cells=row.cells,
                    label=label_raw.strip(),
                    kind="section",
                    depth=depth,
                    section_name=name,
                    parent_sections=parent_sections,
                )
            )
            continue

        indent_depth = _indent_depth(label_raw)
        if indent_depth > len(stack):
            indent_depth = len(stack)
        while len(stack) > indent_depth:
            stack.pop()
        max_depth = max(max_depth, len(stack))
        rows.append(
            RowIR(
                row_index=row_idx,
                cells=row.cells,
                label=label_raw.strip(),
                kind="row",
                depth=indent_depth,
                section_name=None,
                parent_sections=[s.name for s in stack],
            )
        )

    return rows, sections, max_depth


def _parse_section_marker(label: str) -> tuple[str, int] | None:
    match = _SECTION_RE.match(label)
    if not match:
        return None
    opens, name, closes = match.groups()
    if len(opens) != len(closes):
        return None
    return name.strip(), len(opens) - 1


def _indent_depth(label_raw: str) -> int:
    leading = len(label_raw) - len(label_raw.lstrip(" "))
    return leading // 2
