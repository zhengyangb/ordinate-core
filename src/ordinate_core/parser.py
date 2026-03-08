from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Table:
    rows: list[str]


@dataclass
class Sheet:
    name: str
    table: Table | None
    has_multiple_tables: bool


@dataclass
class ParsedRow:
    cells: list[str]
    boundary: int | None
    errors: list[str]


def parse_document(text: str) -> list[Sheet]:
    sheets: list[Sheet] = []
    current_name: str | None = None
    current_rows: list[str] = []

    def flush_sheet() -> None:
        nonlocal current_rows, current_name
        if current_name is None:
            return
        tables = _split_tables(current_rows)
        table = tables[0] if tables else None
        sheets.append(
            Sheet(
                name=current_name,
                table=table,
                has_multiple_tables=len(tables) > 1,
            )
        )
        current_rows = []

    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("# "):
            flush_sheet()
            current_name = line[2:].strip()
            continue

        if current_name is not None:
            current_rows.append(line)

    flush_sheet()
    return sheets


def _split_tables(lines: list[str]) -> list[Table]:
    tables: list[Table] = []
    current: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            current.append(stripped)
        elif current:
            tables.append(Table(rows=current))
            current = []

    if current:
        tables.append(Table(rows=current))
    return tables


def parse_table_row(row: str) -> ParsedRow:
    content = row.strip()
    errors: list[str] = []
    if not (content.startswith("|") and content.endswith("|")):
        return ParsedRow(cells=[], boundary=None, errors=["row must start and end with '|'"])

    inner = content[1:-1]
    segments, split_errors = _split_unescaped_pipes(inner)
    errors.extend(split_errors)

    cells: list[str] = []
    boundary: int | None = None
    for segment in segments:
        # RFC-0002 uses `||` as a structural boundary marker.
        if segment == "":
            if boundary is None:
                boundary = len(cells)
            else:
                errors.append("multiple || boundary markers in one row")
            continue
        cells.append(segment.strip())

    return ParsedRow(cells=cells, boundary=boundary, errors=errors)


def escape_cell_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("|", "\\|")


def _split_unescaped_pipes(inner: str) -> tuple[list[str], list[str]]:
    parts: list[str] = [""]
    errors: list[str] = []
    i = 0
    while i < len(inner):
        ch = inner[i]
        if ch == "\\":
            if i + 1 >= len(inner):
                errors.append("dangling escape at end of row")
                i += 1
                continue
            parts[-1] += inner[i + 1]
            i += 2
            continue
        if ch == "|":
            parts.append("")
            i += 1
            continue
        parts[-1] += ch
        i += 1
    return parts, errors
