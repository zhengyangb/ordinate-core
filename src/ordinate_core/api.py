from __future__ import annotations

from pathlib import Path

from .formatter import format_document as _format_document
from .models import ValidationResult
from .validator import validate_document as _validate_document


def validate_document(text: str) -> ValidationResult:
    return _validate_document(text)


def validate_file(path: str | Path) -> ValidationResult:
    return validate_document(Path(path).read_text(encoding="utf-8"))


def format_document(text: str) -> str:
    return _format_document(text)


def format_file(path: str | Path) -> str:
    return format_document(Path(path).read_text(encoding="utf-8"))
