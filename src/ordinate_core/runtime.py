from __future__ import annotations

import re
from dataclasses import dataclass

from .parser import parse_document, parse_table_row

_SEPARATOR_CELL_RE = re.compile(r"^:?-{3,}:?$")
_SECTION_RE = re.compile(r"^(\[+)([^\[\]]+)(\]+)$")
_THIS_ROW_RE = re.compile(r"^thisRow\((-?\d+)\)$")
_THIS_COL_RE = re.compile(r"^thisCol\((-?\d+)\)$")
_NUMBER_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
_UNQUOTED_PATH_COMPONENT_RE = re.compile(r"^[A-Za-z0-9_]+$")


@dataclass(frozen=True)
class RuntimeValue:
    kind: str
    value: object | None = None


@dataclass(frozen=True)
class RefSelector:
    kind: str
    value: object | None = None


@dataclass(frozen=True)
class ReferenceExpr:
    row_selector: RefSelector
    col_selector: RefSelector


@dataclass(frozen=True)
class ExprNode:
    kind: str
    value: object | None = None
    left: "ExprNode | None" = None
    right: "ExprNode | None" = None


@dataclass(frozen=True)
class ParsedCell:
    kind: str
    literal: RuntimeValue | None
    expression: ExprNode | None
    cached: RuntimeValue | None
    expression_text: str | None = None


@dataclass(frozen=True)
class SheetEvaluation:
    name: str
    row_paths: list[str]
    col_labels: list[str]
    values: list[list[RuntimeValue]]


@dataclass(frozen=True)
class EvaluationResult:
    sheets: list[SheetEvaluation]


def parse_cell_input(text: str) -> ParsedCell:
    raw = text.strip()
    if raw == "":
        return ParsedCell(kind="literal", literal=RuntimeValue("blank", None), expression=None, cached=None, expression_text=None)

    if raw.startswith("="):
        expr_text = raw[1:].strip()
        return ParsedCell(
            kind="formula",
            literal=None,
            expression=_parse_expression(expr_text),
            cached=None,
            expression_text=expr_text,
        )

    split_idx = _find_cache_formula_split(raw)
    if split_idx is not None:
        cached_text = raw[:split_idx].strip()
        expr_text = raw[split_idx + 1 :].strip()
        cached = _parse_cache_literal(cached_text)
        return ParsedCell(
            kind="formula",
            literal=None,
            expression=_parse_expression(expr_text),
            cached=cached,
            expression_text=expr_text,
        )

    return ParsedCell(kind="literal", literal=_parse_user_literal(raw), expression=None, cached=None, expression_text=None)


def evaluate_document(text: str) -> EvaluationResult:
    parsed = parse_document(text)
    sheet_evals: list[SheetEvaluation] = []
    for sheet in parsed:
        if sheet.table is None:
            sheet_evals.append(SheetEvaluation(name=sheet.name, row_paths=[], col_labels=[], values=[]))
            continue
        sheet_evals.append(_evaluate_sheet(sheet.name, sheet.table.rows))
    return EvaluationResult(sheets=sheet_evals)


def evaluate_cell_input(text: str) -> RuntimeValue:
    parsed = parse_cell_input(text)
    if parsed.kind == "literal":
        return parsed.literal or RuntimeValue("blank", None)
    return _eval_expr(parsed.expression, 0, 0, lambda _r, _c: RuntimeValue("error", "no_context"), {}, {}, [], [])


def _evaluate_sheet(name: str, rows: list[str]) -> SheetEvaluation:
    parsed_rows = [parse_table_row(r) for r in rows]
    if not parsed_rows:
        return SheetEvaluation(name=name, row_paths=[], col_labels=[], values=[])

    col_count = max((len(r.cells) for r in parsed_rows), default=0)
    header_row_count = _header_row_count(parsed_rows)
    header_col_count = _header_col_count(parsed_rows)
    body_start = header_row_count + 1 if header_row_count > 0 else 0

    header_labels = parsed_rows[header_row_count - 1].cells if header_row_count > 0 else []
    col_labels: list[str] = []
    for c in range(col_count):
        if c < len(header_labels) and header_labels[c] != "":
            col_labels.append(header_labels[c])
        else:
            col_labels.append(f"C{c + 1}")

    row_paths, body_cells = _build_body_rows(parsed_rows, body_start, col_count)
    row_keys = _build_row_keys(parsed_rows, body_start)
    row_map: dict[tuple[str, ...], list[int]] = {}
    for i, key in enumerate(row_keys):
        row_map.setdefault(key, []).append(i)

    col_map: dict[str, list[int]] = {}
    for i, label in enumerate(col_labels):
        col_map.setdefault(label, []).append(i)

    states: dict[tuple[int, int], str] = {}
    memo: dict[tuple[int, int], RuntimeValue] = {}

    def eval_cell(r: int, c: int) -> RuntimeValue:
        key = (r, c)
        state = states.get(key)
        if state == "visiting":
            return RuntimeValue("error", "cycle")
        if state == "done":
            return memo[key]

        states[key] = "visiting"
        cell_text = body_cells[r][c] if c < len(body_cells[r]) else ""
        parsed_cell = parse_cell_input(cell_text)

        if parsed_cell.kind == "literal":
            value = parsed_cell.literal or RuntimeValue("blank", None)
        else:
            value = _eval_expr(parsed_cell.expression, r, c, eval_cell, row_map, col_map, row_paths, col_labels)

        states[key] = "done"
        memo[key] = value
        return value

    values: list[list[RuntimeValue]] = []
    for r in range(len(body_cells)):
        values.append([eval_cell(r, c) for c in range(col_count)])

    return SheetEvaluation(
        name=name,
        row_paths=row_paths,
        col_labels=col_labels,
        values=values,
    )


def _eval_expr(
    node: ExprNode | None,
    row_idx: int,
    col_idx: int,
    eval_cell,
    row_map,
    col_map,
    row_paths,
    col_labels,
) -> RuntimeValue:
    if node is None:
        return RuntimeValue("error", "empty_expression")

    if node.kind == "literal":
        return node.value

    if node.kind == "reference":
        ref: ReferenceExpr = node.value
        target_row = _resolve_row_selector(ref.row_selector, row_idx, row_map, row_paths)
        target_col = _resolve_col_selector(ref.col_selector, col_idx, col_map, col_labels)
        if target_row is None or target_col is None:
            return RuntimeValue("error", "bad_reference")
        return eval_cell(target_row, target_col)

    if node.kind == "unary":
        op = node.value
        right = _eval_expr(node.right, row_idx, col_idx, eval_cell, row_map, col_map, row_paths, col_labels)
        if _is_error(right):
            return right
        if op == "-":
            if right.kind == "number":
                return RuntimeValue("number", -right.value)
            if right.kind == "blank":
                return RuntimeValue("blank", None)
            return RuntimeValue("error", "invalid_unary")
        if op == "not":
            if right.kind == "boolean":
                return RuntimeValue("boolean", not bool(right.value))
            return RuntimeValue("error", "invalid_unary")
        return RuntimeValue("error", "invalid_unary")

    left = _eval_expr(node.left, row_idx, col_idx, eval_cell, row_map, col_map, row_paths, col_labels)
    right = _eval_expr(node.right, row_idx, col_idx, eval_cell, row_map, col_map, row_paths, col_labels)
    if _is_error(left):
        return left
    if _is_error(right):
        return right

    op = node.value
    if op in {"+", "-", "*", "/"}:
        return _eval_arithmetic(op, left, right)

    if op in {"==", "!="}:
        return _eval_equality(op, left, right)

    if op in {"<", "<=", ">", ">="}:
        return _eval_ordering(op, left, right)

    return RuntimeValue("error", "unknown_operator")


def _is_error(value: RuntimeValue) -> bool:
    return value.kind == "error"


def _eval_arithmetic(op: str, left: RuntimeValue, right: RuntimeValue) -> RuntimeValue:
    if left.kind == "blank" and right.kind == "blank":
        if op in {"+", "-", "*"}:
            return RuntimeValue("blank", None)
        return RuntimeValue("error", "invalid_arithmetic")

    if left.kind == "string" and right.kind == "string":
        if op == "+":
            return RuntimeValue("string", str(left.value) + str(right.value))
        return RuntimeValue("error", "invalid_arithmetic")

    if left.kind == "blank" and right.kind == "string":
        if op == "+":
            return RuntimeValue("string", str(right.value))
        return RuntimeValue("error", "invalid_arithmetic")

    if left.kind == "string" and right.kind == "blank":
        if op == "+":
            return RuntimeValue("string", str(left.value))
        return RuntimeValue("error", "invalid_arithmetic")

    if left.kind == "blank" and right.kind == "number":
        if op == "/":
            return RuntimeValue("number", 0)
        if op in {"+", "-", "*"}:
            return _eval_number_op(op, 0, right.value)
        return RuntimeValue("error", "invalid_arithmetic")

    if left.kind == "number" and right.kind == "blank":
        if op == "/":
            return RuntimeValue("error", "invalid_arithmetic")
        if op in {"+", "-", "*"}:
            return _eval_number_op(op, left.value, 0)
        return RuntimeValue("error", "invalid_arithmetic")

    if left.kind == "boolean" and right.kind == "number":
        return _eval_number_op(op, _bool_to_number(left), right.value)

    if left.kind == "number" and right.kind == "boolean":
        return _eval_number_op(op, left.value, _bool_to_number(right))

    if left.kind == "boolean" and right.kind == "boolean":
        return _eval_number_op(op, _bool_to_number(left), _bool_to_number(right))

    if left.kind == "number" and right.kind == "number":
        return _eval_number_op(op, left.value, right.value)

    return RuntimeValue("error", "invalid_arithmetic")


def _eval_number_op(op: str, left: float, right: float) -> RuntimeValue:
    if op == "+":
        return RuntimeValue("number", left + right)
    if op == "-":
        return RuntimeValue("number", left - right)
    if op == "*":
        return RuntimeValue("number", left * right)
    if right == 0:
        return RuntimeValue("error", "divide_by_zero")
    return RuntimeValue("number", left / right)


def _bool_to_number(value: RuntimeValue) -> int:
    return 1 if bool(value.value) else 0


def _eval_equality(op: str, left: RuntimeValue, right: RuntimeValue) -> RuntimeValue:
    if left.kind == "error" or right.kind == "error":
        return RuntimeValue("error", "error")

    if left.kind == "blank" and right.kind == "blank":
        return RuntimeValue("boolean", op == "==")
    if left.kind == "blank" or right.kind == "blank":
        return RuntimeValue("boolean", op == "!=")

    if left.kind == "null" and right.kind == "null":
        return RuntimeValue("boolean", op == "==")
    if left.kind == "null" or right.kind == "null":
        return RuntimeValue("error", "invalid_comparison")

    if left.kind != right.kind:
        return RuntimeValue("error", "invalid_comparison")

    result = left.value == right.value
    return RuntimeValue("boolean", result if op == "==" else not result)


def _eval_ordering(op: str, left: RuntimeValue, right: RuntimeValue) -> RuntimeValue:
    if left.kind == "error" or right.kind == "error":
        return RuntimeValue("error", "error")
    if left.kind != "number" or right.kind != "number":
        return RuntimeValue("error", "invalid_comparison")

    if op == "<":
        return RuntimeValue("boolean", left.value < right.value)
    if op == "<=":
        return RuntimeValue("boolean", left.value <= right.value)
    if op == ">":
        return RuntimeValue("boolean", left.value > right.value)
    if op == ">=":
        return RuntimeValue("boolean", left.value >= right.value)
    return RuntimeValue("error", "invalid_comparison")


def _resolve_row_selector(selector: RefSelector, current: int, row_map, row_paths: list[str]) -> int | None:
    if selector.kind == "current":
        return current
    if selector.kind == "offset":
        idx = current + int(selector.value)
        return idx if 0 <= idx < len(row_paths) else None
    if selector.kind == "label":
        matches = row_map.get(tuple(selector.value), [])
        if len(matches) == 1:
            return matches[0]
        return None
    return None


def _resolve_col_selector(selector: RefSelector, current: int, col_map, col_labels: list[str]) -> int | None:
    if selector.kind == "current":
        return current
    if selector.kind == "offset":
        idx = current + int(selector.value)
        return idx if 0 <= idx < len(col_labels) else None
    if selector.kind == "label":
        label = ".".join(selector.value)
        matches = col_map.get(label, [])
        if len(matches) == 1:
            return matches[0]
        return None
    return None


def _build_body_rows(parsed_rows, body_start: int, col_count: int) -> tuple[list[str], list[list[str]]]:
    section_stack: list[str] = []
    row_paths: list[str] = []
    body: list[list[str]] = []

    for row in parsed_rows[body_start:]:
        label_raw = row.raw_cells[0] if row.raw_cells else ""
        marker = _parse_section_marker(label_raw.strip())
        if marker is not None:
            name, level = marker
            while len(section_stack) >= level:
                section_stack.pop()
            section_stack.append(name)
            path = ".".join(section_stack)
            row_paths.append(path)
        else:
            indent = _indent_depth(label_raw)
            while len(section_stack) > indent:
                section_stack.pop()
            label = label_raw.strip()
            path_parts = [*section_stack]
            if label:
                path_parts.append(label)
            row_paths.append(".".join(path_parts))

        cells = list(row.cells)
        if len(cells) < col_count:
            cells += [""] * (col_count - len(cells))
        body.append(cells)

    return row_paths, body


def _build_row_keys(parsed_rows, body_start: int) -> list[tuple[str, ...]]:
    section_stack: list[str] = []
    row_keys: list[tuple[str, ...]] = []

    for row in parsed_rows[body_start:]:
        label_raw = row.raw_cells[0] if row.raw_cells else ""
        marker = _parse_section_marker(label_raw.strip())
        if marker is not None:
            name, level = marker
            while len(section_stack) >= level:
                section_stack.pop()
            section_stack.append(name)
            row_keys.append(tuple(section_stack))
            continue

        indent = _indent_depth(label_raw)
        while len(section_stack) > indent:
            section_stack.pop()
        label = label_raw.strip()
        if label:
            row_keys.append(tuple([*section_stack, label]))
        else:
            row_keys.append(tuple(section_stack))

    return row_keys


def _header_row_count(rows) -> int:
    for idx, row in enumerate(rows):
        if row.cells and all(_SEPARATOR_CELL_RE.match(cell) is not None for cell in row.cells):
            return idx
    return 0


def _header_col_count(rows) -> int:
    if not rows:
        return 0
    boundary = rows[0].boundary
    if boundary is None:
        return 0
    if all(r.boundary == boundary for r in rows):
        return boundary
    return 0


def _parse_user_literal(text: str) -> RuntimeValue:
    t = text.strip()
    if _is_quoted(t):
        return RuntimeValue("string", _unescape_quoted(t[1:-1]))
    if t == "null":
        return RuntimeValue("null", None)
    if t == "error":
        return RuntimeValue("error", "error")
    if t == "true":
        return RuntimeValue("boolean", True)
    if t == "false":
        return RuntimeValue("boolean", False)
    if _NUMBER_RE.match(t):
        if "." in t:
            return RuntimeValue("number", float(t))
        return RuntimeValue("number", int(t))
    return RuntimeValue("string", t)


def _parse_cache_literal(text: str) -> RuntimeValue:
    t = text.strip()
    if _is_quoted(t):
        return RuntimeValue("string", _unescape_quoted(t[1:-1]))
    if t == "null":
        return RuntimeValue("null", None)
    if t == "error":
        return RuntimeValue("error", "error")
    if t == "true":
        return RuntimeValue("boolean", True)
    if t == "false":
        return RuntimeValue("boolean", False)
    if _NUMBER_RE.match(t):
        if "." in t:
            return RuntimeValue("number", float(t))
        return RuntimeValue("number", int(t))
    return RuntimeValue("error", "invalid_cached_literal")


def _find_cache_formula_split(text: str) -> int | None:
    in_quote = False
    escaped = False
    depth = 0
    for i, ch in enumerate(text):
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == '"':
            in_quote = not in_quote
            continue
        if in_quote:
            continue
        if ch == "(":
            depth += 1
            continue
        if ch == ")":
            depth = max(0, depth - 1)
            continue
        if ch == "=" and depth == 0:
            prev_ch = text[i - 1] if i > 0 else ""
            next_ch = text[i + 1] if i + 1 < len(text) else ""
            if prev_ch == "=" or next_ch == "=":
                continue
            return i
    return None


def _parse_expression(text: str) -> ExprNode:
    parser = _ExprParser(_tokenize_expr(text))
    node = parser.parse_expression()
    if not parser.at_end():
        return ExprNode(kind="literal", value=RuntimeValue("error", "parse_error"))
    return node


def _tokenize_expr(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.isspace():
            i += 1
            continue
        if ch in "()+-*/":
            out.append((ch, ch))
            i += 1
            continue
        if ch == "!" and i + 1 < len(text) and text[i + 1] == "=":
            out.append(("!=", "!="))
            i += 2
            continue
        if ch == "=" and i + 1 < len(text) and text[i + 1] == "=":
            out.append(("==", "=="))
            i += 2
            continue
        if ch in "<>":
            if i + 1 < len(text) and text[i + 1] == "=":
                out.append((ch + "=", ch + "="))
                i += 2
                continue
            out.append((ch, ch))
            i += 1
            continue
        if ch == '"':
            j = i + 1
            escaped = False
            while j < len(text):
                c = text[j]
                if escaped:
                    escaped = False
                    j += 1
                    continue
                if c == "\\":
                    escaped = True
                    j += 1
                    continue
                if c == '"':
                    break
                j += 1
            if j >= len(text):
                out.append(("ERR", "unterminated_string"))
                return out
            out.append(("STRING", text[i : j + 1]))
            i = j + 1
            continue
        if ch == "@" and i + 1 < len(text) and text[i + 1] == "[":
            j = _scan_reference_end(text, i)
            if j == -1:
                out.append(("ERR", "bad_reference"))
                return out
            out.append(("REF", text[i : j + 1]))
            i = j + 1
            continue
        if ch.isdigit() or (ch == "-" and i + 1 < len(text) and text[i + 1].isdigit()):
            j = i + 1
            while j < len(text) and (text[j].isdigit() or text[j] == "."):
                j += 1
            out.append(("NUMBER", text[i:j]))
            i = j
            continue
        if ch.isalpha() or ch == "_":
            j = i + 1
            while j < len(text) and (text[j].isalnum() or text[j] in "_"):
                j += 1
            out.append(("IDENT", text[i:j]))
            i = j
            continue

        out.append(("ERR", ch))
        return out

    return out


def _scan_reference_end(text: str, start: int) -> int:
    assert text[start:start + 2] == "@["
    i = start + 2
    depth = 1
    in_quote = False
    escaped = False
    while i < len(text):
        ch = text[i]
        if escaped:
            escaped = False
            i += 1
            continue
        if ch == "\\":
            escaped = True
            i += 1
            continue
        if ch == '"':
            in_quote = not in_quote
            i += 1
            continue
        if in_quote:
            i += 1
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


class _ExprParser:
    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self.tokens = tokens
        self.pos = 0

    def at_end(self) -> bool:
        return self.pos >= len(self.tokens)

    def _peek(self) -> tuple[str, str] | None:
        if self.at_end():
            return None
        return self.tokens[self.pos]

    def _peek_next(self) -> tuple[str, str] | None:
        if self.pos + 1 >= len(self.tokens):
            return None
        return self.tokens[self.pos + 1]

    def _match(self, *kinds: str) -> tuple[str, str] | None:
        tk = self._peek()
        if tk is None:
            return None
        if tk[0] in kinds:
            self.pos += 1
            return tk
        return None

    def parse_expression(self) -> ExprNode:
        return self._parse_eq()

    def _parse_eq(self) -> ExprNode:
        node = self._parse_rel()
        while True:
            op = self._match("==", "!=")
            if op is None:
                break
            right = self._parse_rel()
            node = ExprNode(kind="binary", value=op[0], left=node, right=right)
        return node

    def _parse_rel(self) -> ExprNode:
        node = self._parse_add()
        while True:
            op = self._match("<", "<=", ">", ">=")
            if op is None:
                break
            right = self._parse_add()
            node = ExprNode(kind="binary", value=op[0], left=node, right=right)
        return node

    def _parse_add(self) -> ExprNode:
        node = self._parse_mul()
        while True:
            op = self._match("+", "-")
            if op is None:
                break
            right = self._parse_mul()
            node = ExprNode(kind="binary", value=op[0], left=node, right=right)
        return node

    def _parse_mul(self) -> ExprNode:
        node = self._parse_unary()
        while True:
            op = self._match("*", "/")
            if op is None:
                break
            right = self._parse_unary()
            node = ExprNode(kind="binary", value=op[0], left=node, right=right)
        return node

    def _parse_unary(self) -> ExprNode:
        if self._match("-"):
            return ExprNode(kind="unary", value="-", right=self._parse_unary())
        return self._parse_primary()

    def _parse_primary(self) -> ExprNode:
        tk = self._peek()
        if tk is None:
            return ExprNode(kind="literal", value=RuntimeValue("error", "parse_error"))

        if self._match("("):
            node = self.parse_expression()
            if self._match(")") is None:
                return ExprNode(kind="literal", value=RuntimeValue("error", "parse_error"))
            return node

        tk = self._match("NUMBER")
        if tk is not None:
            val = float(tk[1]) if "." in tk[1] else int(tk[1])
            return ExprNode(kind="literal", value=RuntimeValue("number", val))

        tk = self._match("STRING")
        if tk is not None:
            return ExprNode(kind="literal", value=RuntimeValue("string", _unescape_quoted(tk[1][1:-1])))

        tk = self._match("IDENT")
        if tk is not None:
            next_tok = self._peek()
            if next_tok is not None and next_tok[0] == "(":
                return self._parse_function_call(tk[1])
            if tk[1] == "true":
                return ExprNode(kind="literal", value=RuntimeValue("boolean", True))
            if tk[1] == "false":
                return ExprNode(kind="literal", value=RuntimeValue("boolean", False))
            if tk[1] == "null":
                return ExprNode(kind="literal", value=RuntimeValue("null", None))
            if tk[1] == "error":
                return ExprNode(kind="literal", value=RuntimeValue("error", "error"))
            return ExprNode(kind="literal", value=RuntimeValue("string", tk[1]))

        tk = self._match("REF")
        if tk is not None:
            ref = _parse_reference(tk[1])
            return ExprNode(kind="reference", value=ref)

        self.pos += 1
        return ExprNode(kind="literal", value=RuntimeValue("error", "parse_error"))

    def _parse_function_call(self, name: str) -> ExprNode:
        if self._match("(") is None:
            return ExprNode(kind="literal", value=RuntimeValue("error", "parse_error"))
        arg = self.parse_expression()
        if self._match(")") is None:
            return ExprNode(kind="literal", value=RuntimeValue("error", "parse_error"))
        if name != "not":
            return ExprNode(kind="literal", value=RuntimeValue("error", "parse_error"))
        return ExprNode(kind="unary", value="not", right=arg)


def _parse_reference(text: str) -> ReferenceExpr:
    inner = text[2:-1].strip()
    parts = _split_top_level(inner, ",")
    if len(parts) != 2:
        return ReferenceExpr(RefSelector("invalid"), RefSelector("invalid"))
    row = _parse_selector(parts[0].strip(), True)
    col = _parse_selector(parts[1].strip(), False)
    return ReferenceExpr(row, col)


def _parse_selector(text: str, is_row: bool) -> RefSelector:
    if text == "":
        return RefSelector("current")

    if is_row:
        m = _THIS_ROW_RE.match(text)
        if m is not None:
            return RefSelector("offset", int(m.group(1)))
    else:
        m = _THIS_COL_RE.match(text)
        if m is not None:
            return RefSelector("offset", int(m.group(1)))

    path = _parse_path(text)
    if path is None or len(path) == 0:
        return RefSelector("invalid")
    return RefSelector("label", path)


def _parse_path(text: str) -> list[str] | None:
    parts = _split_top_level(text, ".")
    out: list[str] = []
    for p in parts:
        item = p.strip()
        if item == "":
            return None
        if _is_quoted(item):
            out.append(_unescape_quoted(item[1:-1]))
            continue
        if _UNQUOTED_PATH_COMPONENT_RE.match(item) is None:
            return None
        out.append(item)
    return out


def _split_top_level(text: str, delimiter: str) -> list[str]:
    parts: list[str] = []
    start = 0
    i = 0
    in_quote = False
    escaped = False
    depth = 0

    while i < len(text):
        ch = text[i]
        if escaped:
            escaped = False
            i += 1
            continue
        if ch == "\\":
            escaped = True
            i += 1
            continue
        if ch == '"':
            in_quote = not in_quote
            i += 1
            continue
        if in_quote:
            i += 1
            continue
        if ch == "(":
            depth += 1
            i += 1
            continue
        if ch == ")":
            depth = max(0, depth - 1)
            i += 1
            continue
        if ch == delimiter and depth == 0:
            parts.append(text[start:i])
            start = i + 1
        i += 1

    parts.append(text[start:])
    return parts


def _is_quoted(text: str) -> bool:
    return len(text) >= 2 and text[0] == '"' and text[-1] == '"'


def _unescape_quoted(text: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(text):
        if text[i] == "\\" and i + 1 < len(text):
            out.append(text[i + 1])
            i += 2
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


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
