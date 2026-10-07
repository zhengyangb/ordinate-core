import { scanTemporalLiteralPrefixAt } from "./temporal";
import { SPREADSHEET_REFERENCE_PATTERNS } from "./spreadsheetAddress";
import { MAX_TEXT_LENGTH } from "./textLimits";

export interface TextSpan { start: number; end: number }
export type FStringPart = { kind: "text"; span: TextSpan; text: string }
  | { kind: "field"; span: TextSpan; expression: TextSpan; spec?: string; incomplete?: true };
export interface FStringSyntax { end: number; parts: FStringPart[]; error?: { code: string; span: TextSpan } }
export const FSTRING_LIMITS = { source: MAX_TEXT_LENGTH, parts: 128, depth: 64, expressionTokens: 256 } as const;

/** Boundary scanner only: fields are parsed by the ordinary expression parser. */
export function scanFString(source: string, start: number): FStringSyntax {
  const parts: FStringPart[] = [];
  const fail = (code: string, at: number, end = source.length): FStringSyntax =>
    ({ parts, end, error: { code, span: { start: at, end } } });
  let i = start + 2, literalStart = i, literal = "";
  const addText = (end: number) => {
    if (end > literalStart) parts.push({ kind: "text", span: { start: literalStart, end }, text: JSON.parse('"' + literal + '"') as string });
    literal = "";
  };
  try {
    while (i < source.length) {
      if (i - start > FSTRING_LIMITS.source || parts.length > FSTRING_LIMITS.parts) return fail("parse_f_string_limit", i);
      const c = source[i];
      if (c === '"') {
        addText(i);
        if (i + 1 - start > FSTRING_LIMITS.source || parts.length > FSTRING_LIMITS.parts) return fail("parse_f_string_limit", i);
        return { end: i + 1, parts };
      }
      if (c === "\\") {
        if (i + 1 >= source.length) return fail("parse_f_string_invalid_escape", i);
        literal += source.slice(i, i + 2); i += 2; continue;
      }
      if ((c === "{" || c === "}") && source[i + 1] === c) { literal += c; i += 2; continue; }
      if (c === "}") return fail("parse_f_string_unmatched_brace", i);
      if (c !== "{") { literal += c; i++; continue; }
      addText(i);
      const open = i++, expressionStart = i;
      const stack: string[] = [];
      let expressionEnd: number | undefined, spec: string | undefined;
      while (i < source.length) {
        if (i - start > FSTRING_LIMITS.source || stack.length > FSTRING_LIMITS.depth) return fail("parse_f_string_limit", i);
        if (source.startsWith('f"', i)) return fail("parse_f_string_nested", i);
        if (source[i] === '"') {
          const end = quotedEnd(source, i);
          if (end === null) {
            parts.push({ kind: "field", span: { start: open, end: source.length }, expression: { start: expressionStart, end: source.length }, incomplete: true });
            return fail("parse_f_string_unterminated", i);
          }
          i = end; continue;
        }
        const temporal = scanTemporalLiteralPrefixAt(source, i);
        if (temporal) { i += temporal.length; continue; }
        // Consume the same A1 tokens as the ordinary scanner; their colons are not specs.
        if (stack.length === 0 && (i === expressionStart || !/[\w]/.test(source[i - 1]))) {
          const ref = spreadsheetToken(source, i);
          if (ref) { i = ref.next; continue; }
        }
        const ch = source[i];
        if (ch === "(" || ch === "[") { stack.push(ch); i++; continue; }
        if (ch === ")" || ch === "]") {
          if (stack.pop() !== (ch === ")" ? "(" : "[")) return fail("parse_f_string_delimiter", i);
          i++; continue;
        }
        if (ch === "{") return fail("parse_f_string_nested", i);
        if (ch === "}" && stack.length === 0) { expressionEnd ??= i; break; }
        if (ch === ":" && stack.length === 0) {
          expressionEnd = i++;
          let raw = "";
          while (i < source.length && source[i] !== "}") {
            if (source[i] === "{") return fail("parse_f_string_nested", i);
            if (source[i] === "\\") {
              if (i + 1 >= source.length) return fail("parse_f_string_invalid_escape", i);
              raw += source.slice(i, i + 2); i += 2;
            }
            else raw += source[i++];
            if (i - start > FSTRING_LIMITS.source) return fail("parse_f_string_limit", i);
          }
          spec = JSON.parse('"' + raw + '"') as string;
          break;
        }
        i++;
      }
      if (source[i] !== "}" || expressionEnd === undefined) {
        parts.push({ kind: "field", span: { start: open, end: source.length }, expression: { start: expressionStart, end: expressionEnd ?? source.length }, incomplete: true });
        return fail("parse_f_string_unterminated", open);
      }
      parts.push({ kind: "field", span: { start: open, end: i + 1 }, expression: { start: expressionStart, end: expressionEnd }, ...(spec === undefined ? {} : { spec }) });
      if (!source.slice(expressionStart, expressionEnd).trim()) return fail("parse_f_string_empty_field", open);
      literalStart = ++i;
    }
    return fail("parse_f_string_unterminated", start);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return fail("parse_f_string_invalid_escape", i);
  }
}

export function quotedEnd(source: string, start: number): number | null {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === '"') return i + 1;
  }
  return null;
}

export function spreadsheetToken(source: string, start: number): { text: string; next: number } | null {
  for (const pattern of SPREADSHEET_REFERENCE_PATTERNS) {
    pattern.lastIndex = start;
    const match = pattern.exec(source);
    if (!match) continue;
    const next = start + match[0].length;
    if (next < source.length && /[A-Za-z0-9_]/.test(source[next])) continue;
    return { text: match[0], next };
  }
  return null;
}
