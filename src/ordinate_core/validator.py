from __future__ import annotations

import re

from .models import (
    SheetSummary,
    ValidationError,
    ValidationResult,
    ValidationSummary,
)
from .parser import Table, parse_document, parse_table_row
from .runtime import RuntimeValue, parse_cell_input

_SEPARATOR_CELL_RE = re.compile(r"^:?-{3,}:?$")
_SECTION_RE = re.compile(r"^(\[+)([^\[\]]+)(\]+)$")


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
                    section_count=0,
                    max_section_level=0,
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
                section_count=sheet_summary.section_count,
                max_section_level=sheet_summary.max_section_level,
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
        section_count, max_section_level = _section_stats(result, sheet, parsed_rows, header_row_count)
        return SheetSummary(
            name=sheet,
            row_count=len(parsed_rows),
            column_count=column_count,
            header_row_count=header_row_count,
            header_column_count=header_column_count,
            section_count=section_count,
            max_section_level=max_section_level,
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
    _semantic_cell_checks(result, sheet, parsed_rows, header_row_count)
    section_count, max_section_level = _section_stats(result, sheet, parsed_rows, header_row_count)
    return SheetSummary(
        name=sheet,
        row_count=len(parsed_rows),
        column_count=column_count,
        header_row_count=header_row_count,
        header_column_count=header_column_count,
        section_count=section_count,
        max_section_level=max_section_level,
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


def _section_stats(result: ValidationResult, sheet: str, parsed_rows: list, header_row_count: int) -> tuple[int, int]:
    body_start = header_row_count + 1 if header_row_count > 0 else 0
    stack_depth = 0
    section_count = 0
    max_level = 0

    for row_idx, row in enumerate(parsed_rows[body_start:], start=body_start + 1):
        label_raw = row.raw_cells[0] if row.raw_cells else ""
        marker = _parse_section_marker(label_raw.strip())

        if marker is not None:
            _, level = marker
            # level is 1-based: [X] => 1, [[X]] => 2
            if level > stack_depth + 1:
                result.errors.append(
                    ValidationError(
                        message=f"Row {row_idx}: section level jumps from {stack_depth} to {level}.",
                        sheet=sheet,
                        row=row_idx,
                    )
                )
                level = stack_depth + 1

            stack_depth = level
            section_count += 1
            max_level = max(max_level, level)
            continue

        indent_level = _indent_depth(label_raw)
        if indent_level > stack_depth:
            result.errors.append(
                ValidationError(
                    message=f"Row {row_idx}: row indentation level {indent_level} exceeds current section level {stack_depth}.",
                    sheet=sheet,
                    row=row_idx,
                )
            )
            indent_level = stack_depth
        stack_depth = indent_level

    return section_count, max_level


def _semantic_cell_checks(result: ValidationResult, sheet: str, parsed_rows: list, header_row_count: int) -> None:
    body_start = header_row_count + 1 if header_row_count > 0 else 0
    for row_idx, row in enumerate(parsed_rows[body_start:], start=body_start + 1):
        for col_idx, text in enumerate(row.cells, start=1):
            parsed = parse_cell_input(text)
            if parsed.kind != "formula":
                continue

            if (
                parsed.cached is not None
                and parsed.cached.kind == "error"
                and parsed.cached.value == "invalid_cached_literal"
            ):
                result.errors.append(
                    ValidationError(
                        message=f"Row {row_idx}, col {col_idx}: invalid cached literal format.",
                        sheet=sheet,
                        row=row_idx,
                    )
                )

            if _is_parse_error_expr(parsed.expression):
                result.errors.append(
                    ValidationError(
                        message=f"Row {row_idx}, col {col_idx}: invalid formula expression.",
                        sheet=sheet,
                        row=row_idx,
                    )
                )
                continue

            if _has_invalid_reference(parsed.expression):
                result.errors.append(
                    ValidationError(
                        message=f"Row {row_idx}, col {col_idx}: invalid reference selector syntax.",
                        sheet=sheet,
                        row=row_idx,
                    )
                )


def _is_parse_error_expr(expr) -> bool:
    if expr is None:
        return False
    if expr.kind == "literal":
        value = expr.value
        return isinstance(value, RuntimeValue) and value.kind == "error" and value.value == "parse_error"
    return _is_parse_error_expr(getattr(expr, "left", None)) or _is_parse_error_expr(getattr(expr, "right", None))


def _has_invalid_reference(expr) -> bool:
    if expr is None:
        return False
    if expr.kind == "reference":
        ref = expr.value
        if ref.row_selector.kind == "invalid" or ref.col_selector.kind == "invalid":
            return True
    return _has_invalid_reference(getattr(expr, "left", None)) or _has_invalid_reference(getattr(expr, "right", None))


def _parse_section_marker(label: str) -> tuple[str, int] | None:
    match = _SECTION_RE.match(label)
    if not match:
        return None
    opens, name, closes = match.groups()
    if len(opens) != len(closes):
        return None
    return name.strip(), len(opens)


def _indent_depth(label_raw: str) -> int:
    leading = len(label_raw) - len(label_raw.lstrip(" "))
    return leading // 2
