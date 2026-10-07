import { parseSpreadsheetAddress, SPREADSHEET_REFERENCE_PATTERNS } from "../runtime/spreadsheetAddress";
import type { RefSelector } from "../runtime/types";
import { DEFAULT_EXCEL_LIMITS, EXCEL_GRID_LIMITS, ExcelFailure, type ExcelLimits } from "./contracts";
import type { ExcelExpression } from "./formulaAst";

type Token = { kind: "number" | "text" | "sheet" | "reference" | "name" | "error" | "symbol" | "end"; text: string; offset: number };
const ERRORS = /^(?:#DIV\/0!|#VALUE!|#REF!|#NAME\?|#NUM!|#N\/A|#NULL!|#SPILL!|#CALC!)/i;
const PRECEDENCE: Readonly<Record<string, number>> = { "=": 10, "<>": 10, "<": 10, ">": 10, "<=": 10, ">=": 10, "&": 20, "+": 30, "-": 30, "*": 40, "/": 40, "^": 50 };

export function parseExcelFormula(source: string, limits: Readonly<ExcelLimits> = DEFAULT_EXCEL_LIMITS): ExcelExpression {
  if (typeof source !== "string" || source.length === 0) throw new ExcelFailure("formula_syntax", "Formula source is empty.");
  if (source.length > limits.maxFormulaLength) throw new ExcelFailure("limit_exceeded", "Excel formula length exceeds the configured limit.");
  return new ExcelFormulaParser(source, limits).parse();
}

class ExcelFormulaParser {
  private cursor = 0;
  private token: Token;
  constructor(private readonly source: string, private readonly limits: Readonly<ExcelLimits>) {
    if (source.startsWith("=")) this.cursor = 1;
    this.token = this.scan();
  }
  parse(): ExcelExpression {
    const node = this.expression(0, 0);
    if (this.token.kind !== "end") this.fail("Unexpected trailing formula input.");
    const pending: Array<[ExcelExpression, number]> = [[node, 1]];
    while (pending.length) {
      const [current, depth] = pending.pop()!;
      if (depth > this.limits.maxFormulaDepth) throw new ExcelFailure("limit_exceeded", "Excel expression tree exceeds the configured depth limit.");
      if (current.kind === "unary") pending.push([current.operand, depth + 1]);
      if (current.kind === "binary") pending.push([current.left, depth + 1], [current.right, depth + 1]);
      if (current.kind === "call") for (const arg of current.args) pending.push([arg, depth + 1]);
      if (current.kind === "array") for (const row of current.rows) for (const item of row) pending.push([item, depth + 1]);
    }
    return node;
  }
  private fail(message: string): never {
    throw new ExcelFailure("formula_syntax", message, { formula: this.source, offset: this.token?.offset ?? this.cursor });
  }
  private next(): Token {
    const old = this.token;
    this.token = this.scan();
    return old;
  }
  private take(symbol: string): boolean {
    if (this.token.kind !== "symbol" || this.token.text !== symbol) return false;
    this.next();
    return true;
  }
  private require(symbol: string): void {
    if (!this.take(symbol)) this.fail(`Expected '${symbol}'.`);
  }
  private scan(): Token {
    while (/\s/.test(this.source[this.cursor] ?? "") && this.cursor < this.source.length) this.cursor += 1;
    const offset = this.cursor;
    if (offset >= this.source.length) return { kind: "end", text: "", offset };
    const rest = this.source.slice(offset);
    const char = rest[0];
    if (char === '"' || char === "'") {
      this.cursor += 1;
      let text = "";
      while (this.cursor < this.source.length) {
        const current = this.source[this.cursor++];
        if (current === char) {
          if (this.source[this.cursor] === char) { text += char; this.cursor += 1; }
          else return { kind: char === '"' ? "text" : "sheet", text, offset };
        } else text += current;
      }
      throw new ExcelFailure("formula_syntax", "Unterminated quoted text or sheet name.", { formula: this.source, offset });
    }
    const error = ERRORS.exec(rest);
    if (error) { this.cursor += error[0].length; return { kind: "error", text: error[0].toUpperCase(), offset }; }
    for (const pattern of SPREADSHEET_REFERENCE_PATTERNS) {
      pattern.lastIndex = offset;
      const match = pattern.exec(this.source);
      if (!match) continue;
      const end = offset + match[0].length;
      if (/[\p{L}\p{N}_.$!(]/u.test(this.source[end] ?? "")) continue;
      this.cursor = end;
      return { kind: "reference", text: match[0], offset };
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) { this.cursor += number[0].length; return { kind: "number", text: number[0], offset }; }
    const name = /^[\p{L}_\\][\p{L}\p{N}_.\\]*/u.exec(rest);
    if (name) { this.cursor += name[0].length; return { kind: "name", text: name[0], offset }; }
    const operator = /^(?:<>|<=|>=|[+\-*/^&%=<>(){},;!])/.exec(rest);
    if (operator) { this.cursor += operator[0].length; return { kind: "symbol", text: operator[0], offset }; }
    throw new ExcelFailure("unsupported_formula", `Unsupported Excel formula token '${char}'.`, { formula: this.source, offset });
  }
  private expression(minimum: number, depth: number): ExcelExpression {
    if (depth > this.limits.maxFormulaDepth) throw new ExcelFailure("limit_exceeded", "Excel formula nesting exceeds the configured limit.", { formula: this.source });
    let left = this.primary(depth + 1);
    while (this.token.kind === "symbol") {
      if (this.token.text === "%") {
        this.next(); left = { kind: "unary", op: "%", operand: left }; continue;
      }
      const op = this.token.text;
      const precedence = PRECEDENCE[op];
      if (precedence === undefined || precedence < minimum) break;
      this.next();
      // Excel exponentiation is left associative; unary negation binds more tightly.
      left = { kind: "binary", op, left, right: this.expression(precedence + 1, depth + 1) };
    }
    return left;
  }
  private primary(depth: number): ExcelExpression {
    if (this.take("+")) return { kind: "unary", op: "+", operand: this.expression(60, depth) };
    if (this.take("-")) return { kind: "unary", op: "-", operand: this.expression(60, depth) };
    if (this.take("(")) {
      const value = this.expression(0, depth); this.require(")"); return value;
    }
    if (this.take("{")) return this.array(depth);
    const token = this.next();
    if (["sheet", "name", "number"].includes(token.kind) && this.take("!")) {
      if (token.text.includes("[") || token.text.includes("]")) this.fail("External workbook references are unsupported.");
      if (this.token.kind !== "reference") this.fail("Expected an A1 reference after the sheet name.");
      return this.reference(this.next().text, token.text);
    }
    switch (token.kind) {
      case "number": {
        const value = Number(token.text);
        if (!Number.isFinite(value)) this.fail("Non-finite formula number.");
        return { kind: "number", value };
      }
      case "text": return { kind: "text", value: token.text };
      case "error": return { kind: "error", value: token.text };
      case "reference": return this.reference(token.text);
      case "name": {
        const name = token.text.toUpperCase();
        if (this.take("(")) {
          const args: ExcelExpression[] = [];
          if (this.take(")")) return { kind: "call", name, args };
          do {
            const omitted = this.token.kind === "symbol" && (this.token.text === "," || this.token.text === ")");
            args.push(omitted ? { kind: "missing" } : this.expression(0, depth));
          } while (this.take(","));
          this.require(")");
          return { kind: "call", name, args };
        }
        if (name === "TRUE" || name === "FALSE") return { kind: "boolean", value: name === "TRUE" };
        return { kind: "name", value: token.text };
      }
      default: this.fail("Expected an Excel expression.");
    }
  }
  private reference(text: string, sheet?: string): ExcelExpression {
    const reference = parseSpreadsheetAddress(text);
    if (!reference) this.fail("Invalid A1 reference.");
    const check = (selector: RefSelector, maximum: number): void => {
      if (selector.kind === "range") {
        const [a, b] = selector.value as [RefSelector, RefSelector];
        check(a, maximum); check(b, maximum);
        if (Number(a.value) > Number(b.value)) this.fail("Reversed Excel ranges are unsupported.");
      } else if (selector.kind === "absolute" && Number(selector.value) >= maximum) this.fail("Reference exceeds Excel worksheet dimensions.");
    };
    check(reference.rowSelector, EXCEL_GRID_LIMITS.rows); check(reference.colSelector, EXCEL_GRID_LIMITS.columns);
    return { kind: "reference", reference, ...(sheet === undefined ? {} : { sheet }) };
  }
  private array(depth: number): ExcelExpression {
    const rows: ExcelExpression[][] = [[]];
    do {
      rows[rows.length - 1].push(this.expression(0, depth));
      if (this.take(",")) continue;
      if (this.take(";")) { rows.push([]); continue; }
      this.require("}"); break;
    } while (true);
    if (rows.some(row => row.length !== rows[0].length)) this.fail("Array constants must be rectangular.");
    const constant = (node: ExcelExpression): boolean =>
      ["number", "text", "boolean", "error"].includes(node.kind) ||
      (node.kind === "unary" && node.op !== "%" && node.operand.kind === "number");
    if (rows.some(row => row.some(item => !constant(item)))) this.fail("Excel array constants cannot contain formulas or references.");
    return { kind: "array", rows };
  }
}
