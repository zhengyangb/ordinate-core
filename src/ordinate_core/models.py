from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ValidationError:
    message: str
    sheet: str | None = None
    row: int | None = None


@dataclass(frozen=True)
class SheetSummary:
    name: str
    row_count: int
    column_count: int | None
    header_row_count: int
    header_column_count: int


@dataclass(frozen=True)
class ValidationSummary:
    sheet_count: int
    sheets: list[SheetSummary]


@dataclass
class ValidationResult:
    errors: list[ValidationError] = field(default_factory=list)
    summary: ValidationSummary = field(default_factory=lambda: ValidationSummary(sheet_count=0, sheets=[]))

    @property
    def ok(self) -> bool:
        return not self.errors
