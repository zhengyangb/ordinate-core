from __future__ import annotations

import re

from .models import (
    SheetSummary,
    ValidationError,
    ValidationResult,
    ValidationSummary,
)
from .parser import Table, parse_document, parse_table_row

_SEPARATOR_CELL_RE = re.compile(r"^:?-{3,}:?$")


def validate_document(text: str) -> ValidationResult:
    result = ValidationResult()
    sheets = parse_document(text)
    sheet_summaries: list[SheetSummary] = []

    if not sheets:
        result.errors.append(ValidationError(message="Document must contain at least one sheet heading (# Name)."))
        result.summary = ValidationSummary(sheet_count=0, sheets=[])
        return result

    for sheet in sheets:
        if sheet.table is None:
            result.errors.append(ValidationError(message="Sheet has no table.", sheet=sheet.name))
            sheet_summaries.append(
                SheetSummary(
                    name=sheet.name,
                    row_count=0,
                    column_count=None,
                    header_row_count=0,
                    header_column_count=0,
                )
            )
            continue

        if sheet.has_multiple_tables:
            result.errors.append(
                ValidationError(
                    message="Sheet contains multiple tables; exactly one table per sheet is required.",
                    sheet=sheet.name,
                )
            )

        sheet_summary = _validate_table(result, sheet.name, sheet.table)
        sheet_summaries.append(
            SheetSummary(
                name=sheet.name,
                row_count=sheet_summary.row_count,
                column_count=sheet_summary.column_count,
                header_row_count=sheet_summary.header_row_count,
                header_column_count=sheet_summary.header_column_count,
            )
        )

    result.summary = ValidationSummary(sheet_count=len(sheets), sheets=sheet_summaries)

    return result


def _validate_table(result: ValidationResult, sheet: str, table: Table) -> SheetSummary:
    parsed_rows = [parse_table_row(r) for r in table.rows]
    for row_index, row in enumerate(parsed_rows, start=1):
        for err in row.errors:
            result.errors.append(
                ValidationError(
                    message=f"Row {row_index}: {err}.",
                    sheet=sheet,
                    row=row_index,
                )
            )

    widths = {len(r.cells) for r in parsed_rows}
    column_count = next(iter(widths)) if len(widths) == 1 else None

    if len(widths) != 1:
        result.errors.append(
            ValidationError(
                message="Table is not rectangular.",
                sheet=sheet,
            )
        )
        header_row_count, header_column_count = _header_counts(parsed_rows, None)
        return SheetSummary(
            name=sheet,
            row_count=len(parsed_rows),
            column_count=column_count,
            header_row_count=header_row_count,
            header_column_count=header_column_count,
        )

    boundary_positions = {r.boundary for r in parsed_rows}
    if len(boundary_positions) > 1:
        result.errors.append(
            ValidationError(
                message="Table has inconsistent || boundary position.",
                sheet=sheet,
            )
        )

    # Find markdown-style separator row and ensure it matches structure.
    separator_indexes = [i for i, row in enumerate(parsed_rows) if _is_separator_row(row.cells)]
    if len(separator_indexes) > 1:
        result.errors.append(
            ValidationError(
                message="Table has multiple separator rows.",
                sheet=sheet,
            )
        )

    if separator_indexes:
        sep_idx = separator_indexes[0]
        if sep_idx == 0:
            result.errors.append(
                ValidationError(
                    message="Table separator row cannot be first row.",
                    sheet=sheet,
                )
            )

    header_row_count, header_column_count = _header_counts(parsed_rows, column_count)
    return SheetSummary(
        name=sheet,
        row_count=len(parsed_rows),
        column_count=column_count,
        header_row_count=header_row_count,
        header_column_count=header_column_count,
    )


def _is_separator_row(cells: list[str]) -> bool:
    if not cells:
        return False
    return all(_SEPARATOR_CELL_RE.match(cell) is not None for cell in cells)


def _header_counts(parsed_rows: list, column_count: int | None) -> tuple[int, int]:
    separator_indexes = [i for i, row in enumerate(parsed_rows) if _is_separator_row(row.cells)]
    header_row_count = separator_indexes[0] if separator_indexes else 0
    if parsed_rows:
        first_boundary = parsed_rows[0].boundary
        if all(r.boundary == first_boundary for r in parsed_rows) and first_boundary is not None:
            header_column_count = first_boundary
        else:
            header_column_count = 0
    else:
        header_column_count = 0

    if column_count is not None:
        header_column_count = min(header_column_count, column_count)

    return header_row_count, header_column_count
