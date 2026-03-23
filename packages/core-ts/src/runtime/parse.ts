import {
  type ExprNode,
  type FunctionCall,
  type ParsedCell,
  type RefSelector,
  type ReferenceExpr,
  type RuntimeValue,
} from "./types";

const THIS_ROW_RE = /^thisRow\((-?\d+)\)$/;
const THIS_COL_RE = /^thisCol\((-?\d+)\)$/;
const UNDERSCORE_OFFSET_RE = /^_([+-]?\d+)$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const ABSOLUTE_FIXED_RE = /^#([1-9]\d*)!$/;
const ABSOLUTE_RE = /^#([1-9]\d*)$/;
const UNQUOTED_PATH_COMPONENT_RE = /^[A-Za-z0-9_]+$/;

// Parse a raw cell into literal/formula/cached-formula data.
export function parseCellInput(text: string): ParsedCell {
  const raw = text.trim();
  if (raw === "") {
    return { kind: "literal", literal: { kind: "blank", value: null }, expression: null, cached: null };
  }

  if (raw.startsWith("=")) {
    const exprText = raw.slice(1).trim();
    return {
      kind: "formula",
      literal: null,
      expression: parseExpression(exprText),
      cached: null,
      expressionText: exprText,
    };
  }

  const splitIdx = findCacheFormulaSplit(raw);
  if (splitIdx !== null) {
    const cachedText = raw.slice(0, splitIdx).trim();
    const exprText = raw.slice(splitIdx + 1).trim();
    const cached = parseCacheLiteral(cachedText);
    return {
      kind: "formula",
      literal: null,
      expression: parseExpression(exprText),
      cached,
      expressionText: exprText,
    };
  }

  return {
    kind: "literal",
    literal: parseUserLiteral(raw),
    expression: null,
    cached: null,
  };
}

// Parse a formula expression into an AST node.
function parseExpression(text: string): ExprNode {
  const parser = new ExprParser(tokenizeExpr(text));
  const node = parser.parseExpression();
  if (!parser.atEnd()) {
    return { kind: "literal", value: { kind: "error", value: "parse_error" } };
  }
  return node;
}

// Tokenize a formula expression string.
function tokenizeExpr(text: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ("()+-*/,".includes(ch)) {
      out.push([ch, ch]);
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
    const spreadsheetToken = scanSpreadsheetToken(text, i);
    if (spreadsheetToken) {
      out.push(["SPREF", spreadsheetToken.text]);
      i = spreadsheetToken.next;
      continue;
    }
    if (/\d/.test(ch) || (ch === "-" && i + 1 < text.length && /\d/.test(text[i + 1]))) {
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
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const tk = this.peek();
    if (!tk) {
      return { kind: "literal", value: { kind: "error", value: "parse_error" } };
    }
    if (this.match("(")) {
      const node = this.parseExpression();
      if (!this.match(")")) {
        return { kind: "literal", value: { kind: "error", value: "parse_error" } };
      }
      return node;
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
      if (ident[1] === "error") return { kind: "literal", value: { kind: "error", value: "error" } };
      return { kind: "literal", value: { kind: "string", value: ident[1] } };
    }
    const ref = this.match("REF");
    if (ref) {
      return { kind: "reference", value: parseReference(ref[1]) };
    }
    this.pos += 1;
    return { kind: "literal", value: { kind: "error", value: "parse_error" } };
  }

  private parseFunctionCall(name: string): ExprNode {
    if (!this.match("(")) {
      return { kind: "literal", value: { kind: "error", value: "parse_error" } };
    }
    if (this.match(")")) {
      return { kind: "literal", value: { kind: "error", value: "parse_error" } };
    }
    const args: ExprNode[] = [this.parseExpression()];
    while (this.match(",")) {
      args.push(this.parseExpression());
    }
    if (!this.match(")")) {
      return { kind: "literal", value: { kind: "error", value: "parse_error" } };
    }
    return { kind: "call", value: { name, args } as FunctionCall };
  }
}

// Parse a reference expression such as @[Revenue,2025].
function parseReference(text: string): ReferenceExpr {
  const inner = text.slice(2, -1).trim();
  const parts = splitTopLevel(inner, ",");
  if (parts.length !== 2) {
    return { rowSelector: { kind: "invalid" }, colSelector: { kind: "invalid" }, style: "ordinate" };
  }
  return {
    rowSelector: parseSelector(parts[0].trim(), true),
    colSelector: parseSelector(parts[1].trim(), false),
    style: "ordinate",
  };
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

// Parse a user-entered literal (string/number/boolean/null/error/blank).
function parseUserLiteral(text: string): RuntimeValue {
  const t = text.trim();
  if (isQuoted(t)) {
    return { kind: "string", value: unescapeQuoted(t.slice(1, -1)) };
  }
  if (t === "null") return { kind: "null", value: null };
  if (t === "error") return { kind: "error", value: "error" };
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
  if (t === "null") return { kind: "null", value: null };
  if (t === "error") return { kind: "error", value: "error" };
  if (t === "true") return { kind: "boolean", value: true };
  if (t === "false") return { kind: "boolean", value: false };
  if (NUMBER_RE.test(t)) {
    return { kind: "number", value: t.includes(".") ? Number.parseFloat(t) : Number.parseInt(t, 10) };
  }
  return { kind: "error", value: "invalid_cached_literal" };
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
