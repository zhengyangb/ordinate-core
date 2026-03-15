from __future__ import annotations

from pathlib import Path

from .formatter import format_document as _format_document
from .incremental import ChangeKind, DocumentState
from .ir import DocumentIR, build_document_ir
from .materialize import evaluate_and_format_document as _evaluate_and_format_document
from .runtime import (
    EvaluationResult,
    ParsedCell,
    RuntimeValue,
    evaluate_cell_input as _evaluate_cell_input,
    evaluate_document as _evaluate_document,
    parse_cell_input as _parse_cell_input,
)
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


def parse_document_model(text: str) -> DocumentIR:
    return build_document_ir(text)


def parse_file_model(path: str | Path) -> DocumentIR:
    return parse_document_model(Path(path).read_text(encoding="utf-8"))


def parse_cell(text: str) -> ParsedCell:
    return _parse_cell_input(text)


def evaluate_document(text: str) -> EvaluationResult:
    return _evaluate_document(text)


def evaluate_file(path: str | Path) -> EvaluationResult:
    return evaluate_document(Path(path).read_text(encoding="utf-8"))


def evaluate_cell(text: str) -> RuntimeValue:
    return _evaluate_cell_input(text)


def evaluate_and_format_document(text: str) -> str:
    return _evaluate_and_format_document(text)


def evaluate_and_format_file(path: str | Path) -> str:
    return evaluate_and_format_document(Path(path).read_text(encoding="utf-8"))


def create_document_state(text: str) -> DocumentState:
    return DocumentState.from_text(text)
