import {
  type Diagnostic,
  type ArrayExpr,
  type ExprNode,
  type FormatSpec,
  type FunctionCall,
  type IndexAxisExpr,
  type NumericFormatSpec,
  type ParsedDisplayMetadata,
  type ParsedCell,
  type CellBodyState,
  type ErrorRuntimeValue,
  type RefSelector,
  type ReferenceExpr,
  type RuntimeValue,
  type StyleSpec,
  type TextAlign,
  type TextColor,
  type TextWeight,
} from "./types";
import { validateFormatSpec } from "./displayMetadata";
import { diagnosticFromError, makeError, makeInternalError } from "./errors";
import { parseTemporalLiteral, scanTemporalLiteralPrefix } from "./temporal";
import { parseTemporalFormatSpec } from "./temporalFormat";

const THIS_ROW_RE = /^thisRow\((-?\d+)\)$/;
const THIS_COL_RE = /^thisCol\((-?\d+)\)$/;
const UNDERSCORE_OFFSET_RE = /^_([+-]?\d+)$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const ABSOLUTE_FIXED_RE = /^#([1-9]\d*)!$/;
const ABSOLUTE_RE = /^#([1-9]\d*)$/;
const UNQUOTED_PATH_COMPONENT_RE = /^[A-Za-z0-9_]+$/;
const ERROR_LITERAL_RE = /^error\[([a-z][a-z0-9_]*)\]$/;

// Parse a raw cell into independent body/display segments.
export function parseCellText(text: string): ParsedCell {
  const extracted = extractTrailingDisplayMetadata(text);
  const parsedBody = parseCellBody(extracted.expression);
  return {
    body: parsedBody.body,
    localDisplay: extracted.display,
    initialCachedValue: parsedBody.initialCachedValue,
  };
}

// Backward-compatible name for the current public parser entrypoint.
export function parseCellInput(text: string): ParsedCell {
  return parseCellText(text);
}

function parseCellBody(text: string): { body: CellBodyState; initialCachedValue: RuntimeValue | null } {
  const raw = text.trim();
  if (raw === "") {
    return {
      body: {
        valid: true,
        kind: "literal",
        literal: { kind: "blank", value: null },
        inputText: "",
      },
      initialCachedValue: null,
    };
  }

  if (raw.startsWith("=")) {
    const exprText = raw.slice(1).trim();
    const expression = parseExpression(exprText);
    const parseError = parseExpressionError(expression);
    if (parseError) {
      return {
        body: {
          valid: false,
          unparsedBodyRaw: raw,
          issue: diagnosticFromError(parseError),
        },
        initialCachedValue: null,
      };
    }
    return {
      body: {
        valid: true,
        kind: "formula",
        expression,
        expressionText: exprText,
        inputText: exprText.length > 0 ? `= ${exprText}` : "=",
      },
      initialCachedValue: null,
    };
  }

  const splitIdx = findCacheFormulaSplit(raw);
  if (splitIdx !== null) {
    const cachedText = raw.slice(0, splitIdx).trim();
    const exprText = raw.slice(splitIdx + 1).trim();
    const cached = parseCacheLiteral(cachedText);
    const expression = parseExpression(exprText);
    const parseError = parseExpressionError(expression);
    if (parseError) {
      return {
        body: {
          valid: false,
          unparsedBodyRaw: raw,
          issue: diagnosticFromError(parseError),
        },
        initialCachedValue: cached,
      };
    }
    return {
      body: {
        valid: true,
        kind: "formula",
        expression,
        expressionText: exprText,
        inputText: exprText.length > 0 ? `= ${exprText}` : "=",
      },
      initialCachedValue: cached,
    };
  }

  return {
    body: {
      valid: true,
      kind: "literal",
      literal: parseUserLiteral(raw),
      inputText: raw,
    },
    initialCachedValue: null,
  };
}

function parseExpressionError(expr: ExprNode | null): ErrorRuntimeValue | null {
  if (!expr) return null;
  if (expr.kind === "literal") {
    const value = expr.value as RuntimeValue;
    if (value?.kind === "error" && value.internalKind.startsWith("parse_")) {
      return value;
    }
    return null;
  }
  if (expr.kind === "call") {
    const call = expr.value as FunctionCall;
    for (const arg of call.args) {
      const err = parseExpressionError(arg);
      if (err) return err;
    }
    return null;
  }
  if (expr.kind === "array") {
    const array = expr.value as ArrayExpr;
    for (const row of array.rows) {
      for (const element of row) {
        const err = parseExpressionError(element);
        if (err) return err;
      }
    }
    return null;
  }
  if (expr.kind === "index") {
    const index = expr.value as { target: ExprNode; axes: IndexAxisExpr[] };
    const targetErr = parseExpressionError(index.target);
    if (targetErr) return targetErr;
    for (const axis of index.axes) {
      const err = axis.kind === "scalar"
        ? parseExpressionError(axis.value)
        : parseExpressionError(axis.start ?? null) ?? parseExpressionError(axis.end ?? null);
      if (err) return err;
    }
    return null;
  }
  return parseExpressionError(expr.left ?? null) ?? parseExpressionError(expr.right ?? null);
}

export interface CellInputTextView {
  cellText: string;
  bodyText: string;
  inputText: string;
  displayMetaRaw: string | null;
  parseState?: "parse_ok" | "parse_failed";
}

export interface CellTextViewSource {
  body: CellBodyState;
  localDisplay: ParsedDisplayMetadata | null;
}

export function getCellTextView(cell: CellTextViewSource): CellInputTextView {
  const bodyText = renderCellBodyText(cell.body);
  const displayMetaRaw = renderDisplayMetadataBlock(cell.localDisplay);
  return {
    cellText: displayMetaRaw ? `${bodyText}${bodyText.length > 0 ? " " : ""}${displayMetaRaw}` : bodyText,
    bodyText,
    inputText: cell.body.valid ? cell.body.inputText : cell.body.unparsedBodyRaw,
    displayMetaRaw,
    parseState: cell.body.valid ? "parse_ok" : "parse_failed",
  };
}

function renderCellBodyText(body: CellBodyState): string {
  if (!body.valid) return body.unparsedBodyRaw;
  return body.inputText;
}

function renderDisplayMetadataBlock(display: ParsedDisplayMetadata | null): string | null {
  if (!display) return null;
  if (!display.valid) return display.rawBlock;
  const format = display.format ? serializeFormatSpec(display.format) : "";
  const style = display.style ? serializeStyleSpec(display.style) : "";
  if (format === "" && style === "") return null;
  const blocks: string[] = [];
  if (format !== "") blocks.push(`{:${format}}`);
  if (style !== "") blocks.push(`{::${style}}`);
  return blocks.join(" ");
}

function serializeFormatSpec(spec: FormatSpec): string {
  if (spec.kind === "temporal") return spec.pattern;
  let out = "";
  if (spec.sign === "plus") out += "+";
  else if (spec.sign === "parentheses") out += "()";
  if (spec.padWidth !== null) out += `${spec.padWidth}`;
  if (spec.grouping) out += ",";
  if (spec.precision !== null) out += `.${spec.precision}`;
  if (spec.type !== null) out += spec.type;
  return out;
}

function serializeStyleSpec(spec: StyleSpec): string {
  const parts: string[] = [];
  if (spec.align === "left") parts.push("<");
  if (spec.align === "right") parts.push(">");
  if (spec.align === "center") parts.push("^");
  if (spec.weight === "bold") parts.push("bold");
  if (spec.weight === "normal") parts.push("normal");
  if (spec.color === "red") parts.push("red");
  if (spec.color === "green") parts.push("green");
  if (spec.color === "blue") parts.push("blue");
  return parts.join(",");
}

// Return read/edit-facing input text. Cached formula bodies become formula-marker input.
export function resolveCellInputText(text: string): CellInputTextView {
  const split = splitCellDisplayMetadata(text);
  const parsed = parseCellInput(text);
  let inputText = split.contentText;

  if (parsed.body.valid) {
    inputText = parsed.body.inputText;
  } else if (parsed.initialCachedValue !== null) {
    const splitIdx = findCacheFormulaSplit(parsed.body.unparsedBodyRaw.trim());
    if (splitIdx !== null) {
      const exprText = parsed.body.unparsedBodyRaw.trim().slice(splitIdx + 1).trim();
      inputText = exprText.length > 0 ? `= ${exprText}` : "=";
    }
  }

  return {
    cellText: text,
    bodyText: split.contentText,
    inputText,
    displayMetaRaw: split.displayMetaRaw,
  };
}

export function splitCellDisplayMetadata(text: string): {
  contentText: string;
  displayMetaRaw: string | null;
} {
  const extracted = extractTrailingDisplayMetadata(text);
  return {
    contentText: extracted.expression.trim(),
    displayMetaRaw: extracted.displayRaw,
  };
}

// Return cell text with trailing display metadata block removed.
export function stripCellDisplayMetadata(text: string): string {
  return splitCellDisplayMetadata(text).contentText;
}

// Parse a formula expression into an AST node.
function parseExpression(text: string): ExprNode {
  const parser = new ExprParser(tokenizeExpr(text));
  const node = parser.parseExpression();
  if (!parser.atEnd()) {
    const existingError = parseExpressionError(node);
    if (existingError) return node;
    return { kind: "literal", value: makeInternalError("parse_expression_trailing_tokens") };
  }
  return node;
}

// Tokenize a formula expression string.
function tokenizeExpr(text: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  let indexBracketDepth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "*" && i + 1 < text.length && text[i + 1] === "*") {
      out.push(["**", "**"]);
      i += 2;
      continue;
    }
    if ("()+-*/,:".includes(ch)) {
      out.push([ch, ch]);
      i += 1;
      continue;
    }
    if (ch === "[") {
      out.push(["[", "["]);
      indexBracketDepth += 1;
      i += 1;
      continue;
    }
    if (ch === "]") {
      out.push(["]", "]"]);
      indexBracketDepth = Math.max(0, indexBracketDepth - 1);
      i += 1;
      continue;
    }
    if (ch === "!" && i + 1 < text.length && text[i + 1] === "=") {
      out.push(["!=", "!="]);
      i += 2;
      continue;
    }
    if (ch === "=" && i + 1 < text.length && text[i + 1] === "=") {
      out.push(["==", "=="]);
      i += 2;
      continue;
    }
    if (ch === "<" || ch === ">") {
      if (i + 1 < text.length && text[i + 1] === "=") {
        out.push([`${ch}=`, `${ch}=`]);
        i += 2;
      } else {
        out.push([ch, ch]);
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let escaped = false;
      while (j < text.length) {
        const c = text[j];
        if (escaped) {
          escaped = false;
          j += 1;
          continue;
        }
        if (c === "\\") {
          escaped = true;
          j += 1;
          continue;
        }
        if (c === '"') break;
        j += 1;
      }
      if (j >= text.length) {
        out.push(["ERR", "unterminated_string"]);
        return out;
      }
      out.push(["STRING", text.slice(i, j + 1)]);
      i = j + 1;
      continue;
    }
    if (ch === "@" && i + 1 < text.length && text[i + 1] === "[") {
      const j = scanReferenceEnd(text, i);
      if (j === -1) {
        out.push(["ERR", "bad_reference"]);
        return out;
      }
      out.push(["REF", text.slice(i, j + 1)]);
      i = j + 1;
      continue;
    }
    if (text.startsWith("error[", i)) {
      const match = /^error\[([a-z][a-z0-9_]*)\]/.exec(text.slice(i));
      if (!match) {
        out.push(["ERR", "malformed_error_literal"]);
        return out;
      }
      const token = match[0];
      const nextIndex = i + token.length;
      if (!isExprTokenBoundary(text, nextIndex)) {
        out.push(["ERR", "malformed_error_literal"]);
        return out;
      }
      out.push(["ERROR_LITERAL", match[1]]);
      i = nextIndex;
      continue;
    }
    const temporalToken = scanTemporalLiteralPrefix(text.slice(i));
    if (temporalToken && isExprTokenBoundary(text, i + temporalToken.length)) {
      out.push(["TEMPORAL", temporalToken]);
      i += temporalToken.length;
      continue;
    }
    const spreadsheetToken = indexBracketDepth === 0 ? scanSpreadsheetToken(text, i) : null;
    if (spreadsheetToken) {
      out.push(["SPREF", spreadsheetToken.text]);
      i = spreadsheetToken.next;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[\d.]/.test(text[j])) j += 1;
      out.push(["NUMBER", text.slice(i, j)]);
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1;
      out.push(["IDENT", text.slice(i, j)]);
      i = j;
      continue;
    }
    out.push(["ERR", ch]);
    return out;
  }
  return out;
}

function isExprTokenBoundary(text: string, nextIndex: number): boolean {
  if (nextIndex >= text.length) return true;
  return !/[A-Za-z0-9_\[]/.test(text[nextIndex]);
}

// Scan to the end of a reference token, respecting nesting and quotes.
function scanReferenceEnd(text: string, start: number): number {
  let i = start + 2;
  let depth = 1;
  let inQuote = false;
  let escaped = false;
  while (i < text.length) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      i += 1;
      continue;
    }
    if (inQuote) {
      i += 1;
      continue;
    }
    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

// Recursive-descent parser for formula expressions.
class ExprParser {
  private tokens: [string, string][];
  private pos = 0;

  constructor(tokens: [string, string][]) {
    this.tokens = tokens;
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private peek(): [string, string] | null {
    return this.atEnd() ? null : this.tokens[this.pos];
  }

  private match(...kinds: string[]): [string, string] | null {
    const tk = this.peek();
    if (!tk) return null;
    if (kinds.includes(tk[0])) {
      this.pos += 1;
      return tk;
    }
    return null;
  }

  parseExpression(): ExprNode {
    return this.parseEq();
  }

  private parseEq(): ExprNode {
    let node = this.parseRel();
    while (true) {
      const op = this.match("==", "!=");
      if (!op) break;
      const right = this.parseRel();
      node = { kind: "binary", value: op[0], left: node, right };
    }
    return node;
  }

  private parseRel(): ExprNode {
    let node = this.parseAdd();
    while (true) {
      const op = this.match("<", "<=", ">", ">=");
      if (!op) break;
      const right = this.parseAdd();
      node = { kind: "binary", value: op[0], left: node, right };
    }
    return node;
  }

  private parseAdd(): ExprNode {
    let node = this.parseMul();
    while (true) {
      const op = this.match("+", "-");
      if (!op) break;
      const right = this.parseMul();
      node = { kind: "binary", value: op[0], left: node, right };
    }
    return node;
  }

  private parseMul(): ExprNode {
    let node = this.parseUnary();
    while (true) {
      const op = this.match("*", "/");
      if (!op) break;
      const right = this.parseUnary();
      node = { kind: "binary", value: op[0], left: node, right };
    }
    return node;
  }

  private parseUnary(): ExprNode {
    if (this.match("-")) {
      return { kind: "unary", value: "-", right: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): ExprNode {
    const left = this.parsePostfix();
    if (!this.match("**")) {
      return left;
    }
    return { kind: "binary", value: "**", left, right: this.parseUnary() };
  }

  private parsePostfix(): ExprNode {
    let node = this.parsePrimary();
    while (this.match("[")) {
      const axes = this.parseIndexAxes();
      node = { kind: "index", value: { target: node, axes } };
    }
    return node;
  }

  private parseIndexAxes(): IndexAxisExpr[] {
    if (this.match("]")) {
      return [
        {
          kind: "scalar",
          value: { kind: "literal", value: makeInternalError("parse_index_empty") },
        },
      ];
    }

    const axes: IndexAxisExpr[] = [this.parseIndexAxis()];
    while (this.match(",")) {
      if (this.peek()?.[0] === "]") {
        axes.push({
          kind: "scalar",
          value: { kind: "literal", value: makeInternalError("parse_index_missing_axis") },
        });
        break;
      }
      axes.push(this.parseIndexAxis());
    }

    if (!this.match("]")) {
      axes.push({
        kind: "scalar",
        value: { kind: "literal", value: makeInternalError("parse_index_missing_closing_bracket") },
      });
    }
    return axes;
  }

  private parseIndexAxis(): IndexAxisExpr {
    if (this.match(":")) {
      const end = this.peek()?.[0] === "," || this.peek()?.[0] === "]" ? null : this.parseExpression();
      return { kind: "slice", start: null, end };
    }

    const startOrScalar = this.parseExpression();
    if (!this.match(":")) {
      return { kind: "scalar", value: startOrScalar };
    }

    const end = this.peek()?.[0] === "," || this.peek()?.[0] === "]" ? null : this.parseExpression();
    return { kind: "slice", start: startOrScalar, end };
  }

  private parsePrimary(): ExprNode {
    const tk = this.peek();
    if (!tk) {
      return { kind: "literal", value: makeInternalError("parse_expression_unexpected_eof") };
    }
    if (this.match("(")) {
      const node = this.parseExpression();
      if (!this.match(")")) {
        return { kind: "literal", value: makeInternalError("parse_expression_missing_closing_paren") };
      }
      return node;
    }
    if (this.match("[")) {
      return this.parseArrayLiteral();
    }
    const num = this.match("NUMBER");
    if (num) {
      const val = num[1].includes(".") ? Number.parseFloat(num[1]) : Number.parseInt(num[1], 10);
      return { kind: "literal", value: { kind: "number", value: val } };
    }
    const str = this.match("STRING");
    if (str) {
      return { kind: "literal", value: { kind: "string", value: unescapeQuoted(str[1].slice(1, -1)) } };
    }
    const errLit = this.match("ERROR_LITERAL");
    if (errLit) {
      return { kind: "literal", value: makeError(errLit[1], "literal_error_literal", { source: "formula" }) };
    }
    const temporal = this.match("TEMPORAL");
    if (temporal) {
      return { kind: "literal", value: parseTemporalLiteral(temporal[1]) ?? makeInternalError("parse_temporal_invalid_literal", { literal: temporal[1] }) };
    }
    const spRef = this.match("SPREF");
    if (spRef) {
      return { kind: "reference", value: parseSpreadsheetReference(spRef[1]) };
    }
    const ident = this.match("IDENT");
    if (ident) {
      const next = this.peek();
      if (next && next[0] === "(") {
        return this.parseFunctionCall(ident[1]);
      }
      if (ident[1] === "true") return { kind: "literal", value: { kind: "boolean", value: true } };
      if (ident[1] === "false") return { kind: "literal", value: { kind: "boolean", value: false } };
      if (ident[1] === "null") return { kind: "literal", value: { kind: "null", value: null } };
      return { kind: "literal", value: { kind: "string", value: ident[1] } };
    }
    const ref = this.match("REF");
    if (ref) {
      return parseReferenceNode(ref[1]);
    }
    this.pos += 1;
    return { kind: "literal", value: makeInternalError("parse_expression_unexpected_token", { token: tk[0] }) };
  }

  private parseArrayLiteral(): ExprNode {
    if (this.match("]")) {
      return { kind: "array", value: { rows: [[]], depth: 1 } as ArrayExpr };
    }

    const first = this.parseArrayElement();
    if (parseExpressionError(first) && this.peek()?.[0] !== "," && this.peek()?.[0] !== "]") {
      return first;
    }
    if (this.match("]")) {
      if (first.kind === "array") {
        const nested = first.value as ArrayExpr;
        if (nested.depth !== 1) {
          return { kind: "literal", value: makeInternalError("parse_array_too_deep") };
        }
        return { kind: "array", value: { rows: nested.rows, depth: 2 } as ArrayExpr };
      }
      return { kind: "array", value: { rows: [[first]], depth: 1 } as ArrayExpr };
    }

    if (!this.match(",")) {
      return { kind: "literal", value: makeInternalError("parse_array_missing_closing_bracket") };
    }
    if (this.peek()?.[0] === "]") {
      return { kind: "literal", value: makeInternalError("parse_array_trailing_comma") };
    }
    if (this.peek()?.[0] === ",") {
      return { kind: "literal", value: makeInternalError("parse_array_missing_element") };
    }

    const elements: ExprNode[] = [first, this.parseArrayElement()];
    while (this.match(",")) {
      if (this.peek()?.[0] === "]") {
        return { kind: "literal", value: makeInternalError("parse_array_trailing_comma") };
      }
      if (this.peek()?.[0] === ",") {
        return { kind: "literal", value: makeInternalError("parse_array_missing_element") };
      }
      elements.push(this.parseArrayElement());
    }
    if (!this.match("]")) {
      return { kind: "literal", value: makeInternalError("parse_array_missing_closing_bracket") };
    }

    if (elements.every((element) => element.kind === "array")) {
      const nested = elements.map((element) => element.value as ArrayExpr);
      if (nested.some((array) => array.depth !== 1)) {
        return { kind: "literal", value: makeInternalError("parse_array_too_deep") };
      }
      const rows = nested.map((array) => array.rows[0] ?? []);
      if (!arrayRowsHaveSameLength(rows)) {
        return { kind: "literal", value: makeInternalError("parse_array_ragged_rows") };
      }
      return { kind: "array", value: { rows, depth: 2 } as ArrayExpr };
    }
    if (elements.some((element) => element.kind === "array")) {
      return { kind: "literal", value: makeInternalError("parse_array_mixed_rows_and_scalars") };
    }
    return { kind: "array", value: { rows: [elements], depth: 1 } as ArrayExpr };
  }

  private parseArrayElement(): ExprNode {
    if (this.peek()?.[0] === "," || this.peek()?.[0] === "]") {
      return { kind: "literal", value: makeInternalError("parse_array_missing_element") };
    }
    if (this.peek()?.[0] === "IDENT" && isSpreadsheetLikeReferenceText(this.peek()?.[1] ?? "")) {
      this.pos += 1;
      return { kind: "literal", value: makeInternalError("parse_array_spreadsheet_reference_unsupported") };
    }
    return this.parseExpression();
  }

  private parseFunctionCall(name: string): ExprNode {
    if (!this.match("(")) {
      return { kind: "literal", value: makeInternalError("parse_function_call_missing_open_paren", { name }) };
    }
    const args: ExprNode[] = [];
    if (this.match(")")) {
      return { kind: "call", value: { name, args } as FunctionCall };
    }
    args.push(this.parseExpression());
    while (this.match(",")) {
      args.push(this.parseExpression());
    }
    if (!this.match(")")) {
      return { kind: "literal", value: makeInternalError("parse_function_call_missing_closing_paren", { name }) };
    }
    return { kind: "call", value: { name, args } as FunctionCall };
  }
}

function arrayRowsHaveSameLength(rows: readonly ExprNode[][]): boolean {
  if (rows.length === 0) return true;
  const width = rows[0].length;
  return rows.every((row) => row.length === width);
}

function isSpreadsheetLikeReferenceText(text: string): boolean {
  return /^[A-Za-z]+[1-9]\d*$/.test(text);
}

// Parse a reference expression such as @[Revenue,2025] or @["Inputs"::[Revenue,2025]].
function parseReferenceNode(text: string): ExprNode {
  const parsed = parseReference(text);
  if (!parsed.ok) {
    return { kind: "literal", value: makeInternalError(parsed.internalKind, parsed.context) };
  }
  return { kind: "reference", value: parsed.ref };
}

type ParsedReference =
  | { ok: true; ref: ReferenceExpr }
  | { ok: false; internalKind: string; context: Record<string, unknown> };

function parseReference(text: string): ParsedReference {
  const inner = text.slice(2, -1).trim();
  const sheetDelimiter = findTopLevelDoubleColon(inner);
  if (sheetDelimiter !== null) {
    const sheetText = inner.slice(0, sheetDelimiter).trim();
    const targetText = inner.slice(sheetDelimiter + 2).trim();
    const sheetSelector = parseSheetSelector(sheetText);
    if (!sheetSelector) {
      return { ok: false, internalKind: "parse_cross_sheet_reference_invalid_sheet_selector", context: { source: text } };
    }
    if (!targetText.startsWith("[") || !targetText.endsWith("]")) {
      return { ok: false, internalKind: "parse_cross_sheet_reference_missing_target_brackets", context: { source: text } };
    }
    const targetInner = targetText.slice(1, -1).trim();
    const targetParts = splitTopLevel(targetInner, ",");
    if (targetParts.length !== 2) {
      return { ok: false, internalKind: "parse_cross_sheet_reference_invalid_target", context: { source: text } };
    }
    const rowSelector = parseSelector(targetParts[0].trim(), true);
    const colSelector = parseSelector(targetParts[1].trim(), false);
    if (rowSelector.kind === "invalid" || colSelector.kind === "invalid") {
      return { ok: false, internalKind: "parse_cross_sheet_reference_invalid_target", context: { source: text } };
    }
    if (selectorHasContextualReference(rowSelector) || selectorHasContextualReference(colSelector)) {
      return { ok: false, internalKind: "parse_cross_sheet_reference_contextual_selector", context: { source: text } };
    }
    return {
      ok: true,
      ref: {
        sheetSelector,
        rowSelector,
        colSelector,
        style: "ordinate",
      },
    };
  }

  const parts = splitTopLevel(inner, ",");
  if (parts.length !== 2) {
    return {
      ok: true,
      ref: { rowSelector: { kind: "invalid" }, colSelector: { kind: "invalid" }, style: "ordinate" },
    };
  }
  return {
    ok: true,
    ref: {
      rowSelector: parseSelector(parts[0].trim(), true),
      colSelector: parseSelector(parts[1].trim(), false),
      style: "ordinate",
    },
  };
}

function findTopLevelDoubleColon(text: string): number | null {
  let inQuote = false;
  let escaped = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let i = 0; i < text.length - 1; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (ch === ":" && text[i + 1] === ":" && parenDepth === 0 && bracketDepth === 0) {
      return i;
    }
  }
  return null;
}

function parseSheetSelector(text: string): { kind: "sheet_name"; value: string } | null {
  if (text === "") return null;
  if (isQuoted(text)) {
    return { kind: "sheet_name", value: unescapeQuoted(text.slice(1, -1)) };
  }
  if (!/^[A-Za-z0-9]+$/.test(text)) return null;
  return { kind: "sheet_name", value: text };
}

function selectorHasContextualReference(selector: RefSelector | null): boolean {
  if (!selector) return false;
  if (selector.kind === "current" || selector.kind === "offset") return true;
  if (selector.kind === "range") {
    const [startSel, endSel] = selector.value as [RefSelector | null, RefSelector | null];
    return selectorHasContextualReference(startSel) || selectorHasContextualReference(endSel);
  }
  return false;
}

// Parse a spreadsheet-style reference such as A1, A1:B5, A:A, or 1:1.
function parseSpreadsheetReference(text: string): ReferenceExpr {
  const trimmed = text.trim();
  const parts = trimmed.split(":");
  if (parts.length === 1) {
    const cell = parseCellAddress(parts[0]);
    if (!cell) {
      return { rowSelector: { kind: "invalid" }, colSelector: { kind: "invalid" }, style: "spreadsheet" };
    }
    return {
      rowSelector: { kind: "absolute", value: cell.row },
      colSelector: { kind: "absolute", value: cell.col },
      style: "spreadsheet",
    };
  }
  if (parts.length !== 2) {
    return { rowSelector: { kind: "invalid" }, colSelector: { kind: "invalid" }, style: "spreadsheet" };
  }

  const left = parts[0].trim();
  const right = parts[1].trim();
  const leftCell = parseCellAddress(left);
  const rightCell = parseCellAddress(right);
  if (leftCell && rightCell) {
    return {
      rowSelector: {
        kind: "range",
        value: [
          { kind: "absolute", value: leftCell.row },
          { kind: "absolute", value: rightCell.row },
        ],
      },
      colSelector: {
        kind: "range",
        value: [
          { kind: "absolute", value: leftCell.col },
          { kind: "absolute", value: rightCell.col },
        ],
      },
      style: "spreadsheet",
    };
  }

  const leftCol = columnLabelToIndex(left);
  const rightCol = columnLabelToIndex(right);
  if (leftCol !== null && rightCol !== null) {
    return {
      rowSelector: { kind: "all" },
      colSelector: {
        kind: "range",
        value: [
          { kind: "absolute", value: leftCol },
          { kind: "absolute", value: rightCol },
        ],
      },
      style: "spreadsheet",
    };
  }

  if (/^[1-9]\d*$/.test(left) && /^[1-9]\d*$/.test(right)) {
    return {
      rowSelector: {
        kind: "range",
        value: [
          { kind: "absolute", value: Number(left) - 1 },
          { kind: "absolute", value: Number(right) - 1 },
        ],
      },
      colSelector: { kind: "all" },
      style: "spreadsheet",
    };
  }

  return { rowSelector: { kind: "invalid" }, colSelector: { kind: "invalid" }, style: "spreadsheet" };
}

// Parse a row/column selector, including ranges.
function parseSelector(text: string, isRow: boolean): RefSelector {
  if (text === "") return { kind: "invalid" };
  if (text === ":") return { kind: "all" };
  const parts = splitTopLevel(text, ":");
  if (parts.length > 2) return { kind: "invalid" };
  if (parts.length === 2) {
    const startText = parts[0].trim();
    const endText = parts[1].trim();
    if (startText === "" && endText === "") return { kind: "invalid" };
    const start = startText !== "" ? parseScalarSelector(startText, isRow) : null;
    const end = endText !== "" ? parseScalarSelector(endText, isRow) : null;
    if (start && start.kind === "invalid") return { kind: "invalid" };
    if (end && end.kind === "invalid") return { kind: "invalid" };
    if (start && (start.kind === "all" || start.kind === "range")) return { kind: "invalid" };
    if (end && (end.kind === "all" || end.kind === "range")) return { kind: "invalid" };
    return { kind: "range", value: [start, end] };
  }
  return parseScalarSelector(text, isRow);
}

// Parse a selector that must resolve to a single position.
function parseScalarSelector(text: string, isRow: boolean): RefSelector {
  if (text === "_") return { kind: "current" };
  const offsetMatch = UNDERSCORE_OFFSET_RE.exec(text);
  if (offsetMatch) return { kind: "offset", value: Number(offsetMatch[1]) };

  if (isRow) {
    const m = THIS_ROW_RE.exec(text);
    if (m) return { kind: "offset", value: Number(m[1]) };
  } else {
    const m = THIS_COL_RE.exec(text);
    if (m) return { kind: "offset", value: Number(m[1]) };
  }

  const fixed = ABSOLUTE_FIXED_RE.exec(text);
  if (fixed) return { kind: "absolute_fixed", value: Number(fixed[1]) - 1 };

  const abs = ABSOLUTE_RE.exec(text);
  if (abs) return { kind: "absolute", value: Number(abs[1]) - 1 };

  const path = parsePath(text);
  if (!path || path.length === 0) return { kind: "invalid" };
  return { kind: "label", value: path };
}

// Parse a dotted label path into components.
function parsePath(text: string): string[] | null {
  const parts = splitTopLevel(text, ".");
  const out: string[] = [];
  for (const p of parts) {
    const item = p.trim();
    if (item === "" || item === "_") return null;
    if (isQuoted(item)) {
      out.push(unescapeQuoted(item.slice(1, -1)));
      continue;
    }
    if (!UNQUOTED_PATH_COMPONENT_RE.test(item)) return null;
    out.push(item);
  }
  return out;
}

// Split by delimiter, ignoring quoted or parenthesized content.
function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  let inQuote = false;
  let escaped = false;
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      i += 1;
      continue;
    }
    if (inQuote) {
      i += 1;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (ch === delimiter && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  parts.push(text.slice(start));
  return parts;
}

// Check if a literal is surrounded by quotes.
function isQuoted(text: string): boolean {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"');
}

function extractTrailingDisplayMetadata(text: string): {
  expression: string;
  display: ParsedDisplayMetadata | null;
  displayRaw: string | null;
} {
  const rightTrimmed = text.replace(/\s+$/, "");
  const blocks = findTrailingDisplayBlocks(rightTrimmed);
  if (blocks.length === 0) {
    return { expression: text, display: null, displayRaw: null };
  }
  const rawBlock = rightTrimmed.slice(blocks[0].start, blocks[blocks.length - 1].end + 1);
  const display = parseDisplayMetadataBlocks(
    blocks.map((block) => ({
      rawBlock: rightTrimmed.slice(block.start, block.end + 1),
      content: rightTrimmed.slice(block.start + 2, block.end),
    })),
    rawBlock,
  );
  const expression = rightTrimmed.slice(0, blocks[0].start);
  return { expression, display, displayRaw: rawBlock };
}

function findTrailingDisplayBlocks(text: string): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  let cursor = text.length;
  while (cursor > 0) {
    const candidateText = text.slice(0, cursor).replace(/\s+$/, "");
    const block = findTopLevelTrailingDisplayBlock(candidateText);
    if (!block) break;
    blocks.unshift(block);
    cursor = block.start;
  }
  return blocks;
}

function findTopLevelTrailingDisplayBlock(text: string): { start: number; end: number } | null {
  const end = text.length - 1;
  if (end < 0 || text[end] !== "}") return null;

  let inQuote = false;
  let escaped = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  const braceStack: number[] = [];
  const topLevelBlocks: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;

    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (parenDepth !== 0 || bracketDepth !== 0) continue;

    if (ch === "{") {
      braceStack.push(i);
      continue;
    }
    if (ch === "}") {
      const start = braceStack.pop();
      if (start !== undefined && braceStack.length === 0) {
        topLevelBlocks.push({ start, end: i });
      }
    }
  }

  for (let i = topLevelBlocks.length - 1; i >= 0; i -= 1) {
    const block = topLevelBlocks[i];
    if (block.end !== end) continue;
    if (!text.startsWith("{:", block.start)) continue;
    return block;
  }
  return null;
}

function parseDisplayMetadataBlocks(
  blocks: Array<{ content: string; rawBlock: string }>,
  rawSequence: string,
): ParsedDisplayMetadata {
  let format: FormatSpec | null = null;
  let style: StyleSpec | null = null;

  for (const block of blocks) {
    const parsed = parseDisplayMetadataBlock(block.content, block.rawBlock);
    if (!parsed.valid) {
      return {
        valid: false,
        rawBlock: rawSequence,
        issue: parsed.issue,
      };
    }
    if (parsed.format) {
      if (format !== null) return invalidDisplay(rawSequence, "duplicate_format_metadata");
      format = parsed.format;
    }
    if (parsed.style) {
      if (style !== null) return invalidDisplay(rawSequence, "duplicate_style_metadata");
      style = parsed.style;
    }
  }

  if (format === null && style === null) {
    return invalidDisplay(rawSequence, "empty_display_metadata");
  }

  return {
    valid: true,
    format,
    style,
  };
}

function parseDisplayMetadataBlock(inner: string, rawBlock: string): ParsedDisplayMetadata {
  const content = inner.trim();
  if (content === "") {
    return invalidDisplay(rawBlock, "empty_display_metadata");
  }

  if (inner.startsWith(":")) {
    const style = inner.slice(1).trim();
    if (style === "") {
      return invalidDisplay(rawBlock, "empty_style_spec");
    }
    const styleSpec = parseStyleSpec(style);
    if ("error" in styleSpec) {
      return invalidDisplay(rawBlock, styleSpec.error);
    }
    return {
      valid: true,
      format: null,
      style: styleSpec.value,
    };
  }

  if (inner !== content) {
    return invalidDisplay(rawBlock, "format_spec_contains_whitespace");
  }

  const formatSpec = parseFormatSpec(content);
  if ("issue" in formatSpec) {
    return invalidDisplay(rawBlock, formatSpec.issue);
  }
  return {
    valid: true,
    format: formatSpec.value,
    style: null,
  };
}

function invalidDisplay(rawBlock: string, issue: string | Diagnostic): ParsedDisplayMetadata {
  return {
    valid: false,
    rawBlock,
    issue: typeof issue === "string" ? diagnostic(issue) : issue,
  };
}

function diagnostic(code: string, context: Record<string, unknown> = {}): Diagnostic {
  return { code, context };
}

function parseFormatSpec(spec: string): { value: FormatSpec } | { issue: Diagnostic } {
  const text = spec.trim();
  if (text === "") return { issue: diagnostic("empty_format_spec") };

  const temporalSpec = parseTemporalFormatSpec(text);
  if (temporalSpec) return temporalSpec;

  if (/\s/.test(text)) return { issue: diagnostic("format_spec_contains_whitespace") };

  let i = 0;
  let sign: NumericFormatSpec["sign"] = "default";
  if (text.startsWith("+")) {
    sign = "plus";
    i += 1;
  } else if (text.startsWith("()")) {
    sign = "parentheses";
    i += 2;
  }

  let padWidth: number | null = null;
  const padWidthStart = i;
  while (i < text.length && /[0-9]/.test(text[i])) {
    i += 1;
  }
  if (i > padWidthStart) {
    padWidth = Number(text.slice(padWidthStart, i));
  }

  let grouping = false;
  if (i < text.length && text[i] === ",") {
    grouping = true;
    i += 1;
  }

  let precision: number | null = null;
  if (i < text.length && text[i] === ".") {
    i += 1;
    const pStart = i;
    while (i < text.length && /[0-9]/.test(text[i])) {
      i += 1;
    }
    if (i === pStart) {
      return { issue: diagnostic("precision_requires_digits") };
    }
    precision = Number(text.slice(pStart, i));
  }

  let type: NumericFormatSpec["type"] = null;
  if (i < text.length) {
    const ch = text[i];
    if (ch === "f" || ch === "e" || ch === "%" || ch === "d") {
      type = ch;
      i += 1;
    } else {
      return { issue: diagnostic(`unsupported_format_type:${ch}`) };
    }
  }

  if (i !== text.length) {
    return { issue: diagnostic("invalid_format_spec_trailing_chars") };
  }

  const value = {
    kind: "numeric",
    sign,
    padWidth,
    grouping,
    precision,
    type,
  } satisfies NumericFormatSpec;
  const compatibilityIssue = validateFormatSpec(value);
  if (compatibilityIssue) {
    return { issue: compatibilityIssue };
  }

  return {
    value,
  };
}

function parseStyleSpec(spec: string): { value: StyleSpec } | { error: string } {
  const text = spec.trim();
  if (text === "") return { error: "empty_style_spec" };

  const items = text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (items.length === 0) return { error: "empty_style_spec" };

  let align: TextAlign | null = null;
  let weight: TextWeight | null = null;
  let color: TextColor | null = null;

  for (const item of items) {
    if (item === "<" || item === "align=left") {
      if (align !== null) return { error: "duplicate_align_style" };
      align = "left";
      continue;
    }
    if (item === ">" || item === "align=right") {
      if (align !== null) return { error: "duplicate_align_style" };
      align = "right";
      continue;
    }
    if (item === "^" || item === "align=center") {
      if (align !== null) return { error: "duplicate_align_style" };
      align = "center";
      continue;
    }
    if (item === "bold" || item === "weight=bold") {
      if (weight !== null) return { error: "duplicate_weight_style" };
      weight = "bold";
      continue;
    }
    if (item === "normal" || item === "weight=normal") {
      if (weight !== null) return { error: "duplicate_weight_style" };
      weight = "normal";
      continue;
    }
    if (item === "red" || item === "color=red") {
      if (color !== null) return { error: "duplicate_color_style" };
      color = "red";
      continue;
    }
    if (item === "green" || item === "color=green") {
      if (color !== null) return { error: "duplicate_color_style" };
      color = "green";
      continue;
    }
    if (item === "blue" || item === "color=blue") {
      if (color !== null) return { error: "duplicate_color_style" };
      color = "blue";
      continue;
    }
    return { error: `unsupported_style_item:${item}` };
  }

  return {
    value: {
      align,
      weight,
      color,
    },
  };
}

function scanSpreadsheetToken(text: string, start: number): { text: string; next: number } | null {
  const source = text.slice(start);
  const patterns = [
    /^[A-Za-z]+[1-9]\d*:[A-Za-z]+[1-9]\d*/,
    /^[A-Za-z]+:[A-Za-z]+/,
    /^[1-9]\d*:[1-9]\d*/,
    /^[A-Za-z]+[1-9]\d*/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const token = match[0];
    const nextIndex = start + token.length;
    if (!isSpreadsheetBoundary(text, nextIndex)) continue;
    return { text: token, next: nextIndex };
  }
  return null;
}

function isSpreadsheetBoundary(text: string, nextIndex: number): boolean {
  if (nextIndex >= text.length) return true;
  const next = text[nextIndex];
  return !/[A-Za-z0-9_]/.test(next);
}

function parseCellAddress(text: string): { row: number; col: number } | null {
  const match = /^([A-Za-z]+)([1-9]\d*)$/.exec(text);
  if (!match) return null;
  const col = columnLabelToIndex(match[1]);
  if (col === null) return null;
  const row = Number(match[2]) - 1;
  return { row, col };
}

function columnLabelToIndex(text: string): number | null {
  if (!/^[A-Za-z]+$/.test(text)) return null;
  let value = 0;
  const upper = text.toUpperCase();
  for (let i = 0; i < upper.length; i += 1) {
    const code = upper.charCodeAt(i);
    const digit = code - 64; // A -> 1
    if (digit < 1 || digit > 26) return null;
    value = value * 26 + digit;
  }
  return value - 1;
}

// Unescape a quoted string literal.
function unescapeQuoted(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      out.push(text[i + 1]);
      i += 2;
      continue;
    }
    out.push(text[i]);
    i += 1;
  }
  return out.join("");
}

function parseErrorLiteral(text: string, source: "literal" | "cache"): RuntimeValue | null {
  const match = ERROR_LITERAL_RE.exec(text.trim());
  if (!match) return null;
  return makeError(match[1], "literal_error_literal", { source });
}

// Parse a user-entered literal (string/number/boolean/null/error/blank).
function parseUserLiteral(text: string): RuntimeValue {
  const t = text.trim();
  if (isQuoted(t)) {
    return { kind: "string", value: unescapeQuoted(t.slice(1, -1)) };
  }
  if (t.startsWith("error[")) {
    const parsedError = parseErrorLiteral(t, "literal");
    if (parsedError) return parsedError;
    return makeInternalError("parse_error_literal_invalid_syntax", { literal: t });
  }
  const temporal = parseTemporalLiteral(t);
  if (temporal) return temporal;
  if (t === "null") return { kind: "null", value: null };
  if (t === "true") return { kind: "boolean", value: true };
  if (t === "false") return { kind: "boolean", value: false };
  if (NUMBER_RE.test(t)) {
    return { kind: "number", value: t.includes(".") ? Number.parseFloat(t) : Number.parseInt(t, 10) };
  }
  return { kind: "string", value: t };
}

// Parse a cached value literal in "value = formula" cells.
function parseCacheLiteral(text: string): RuntimeValue {
  const t = text.trim();
  if (isQuoted(t)) {
    return { kind: "string", value: unescapeQuoted(t.slice(1, -1)) };
  }
  if (t.startsWith("error[")) {
    const parsedError = parseErrorLiteral(t, "cache");
    if (parsedError) return parsedError;
    return makeInternalError("parse_error_literal_invalid_syntax", { literal: t });
  }
  const temporal = parseTemporalLiteral(t);
  if (temporal) return temporal;
  if (t === "null") return { kind: "null", value: null };
  if (t === "true") return { kind: "boolean", value: true };
  if (t === "false") return { kind: "boolean", value: false };
  if (NUMBER_RE.test(t)) {
    return { kind: "number", value: t.includes(".") ? Number.parseFloat(t) : Number.parseInt(t, 10) };
  }
  return makeInternalError("invalid_cached_literal", { literal: t });
}

// Find the '=' that splits cached value and expression.
function findCacheFormulaSplit(text: string): number | null {
  let inQuote = false;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === "=" && depth === 0) {
      const prev = i > 0 ? text[i - 1] : "";
      const next = i + 1 < text.length ? text[i + 1] : "";
      if (prev === "=" || next === "=") continue;
      return i;
    }
  }
  return null;
}
