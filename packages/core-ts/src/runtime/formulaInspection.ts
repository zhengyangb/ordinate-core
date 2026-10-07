import { scanTemporalLiteralPrefixAt } from "./temporal";
import { scanFString, quotedEnd as scanQuotedEnd, spreadsheetToken as scanSpreadsheetToken, type FStringSyntax } from "./fStringSyntax";

export type FormulaSourceSpan = Readonly<{
  start: number;
  end: number;
}>;

export type FormulaInspectionOptions = Readonly<{
  caret?: number;
}>;

export type FormulaEditorSimpleTokenKind =
  | "formula_marker"
  | "whitespace"
  | "identifier"
  | "keyword"
  | "number"
  | "temporal_literal"
  | "spreadsheet_reference"
  | "operator"
  | "punctuation"
  | "unknown";

export type FormulaEditorSimpleToken = Readonly<{
  kind: FormulaEditorSimpleTokenKind;
  span: FormulaSourceSpan;
}>;

export type FormulaEditorCompletableToken = Readonly<{
  kind: "string" | "error_literal" | "ordinate_reference";
  span: FormulaSourceSpan;
  complete: boolean;
}>;

export type FormulaEditorToken = FormulaEditorSimpleToken | FormulaEditorCompletableToken;

export type FormulaEditorStructureBase = Readonly<{
  open: FormulaSourceSpan;
  close: FormulaSourceSpan | null;
  contentSpan: FormulaSourceSpan;
  parent: number | null;
}>;

export type FormulaEditorGroup = FormulaEditorStructureBase & Readonly<{
  kind: "group";
}>;

export type FormulaEditorArray = FormulaEditorStructureBase & Readonly<{
  kind: "array";
}>;

export type FormulaEditorIndex = FormulaEditorStructureBase & Readonly<{
  kind: "index";
}>;

export type FormulaEditorCall = FormulaEditorStructureBase & Readonly<{
  kind: "call";
  name: string;
  nameSpan: FormulaSourceSpan;
  separatorSpans: readonly FormulaSourceSpan[];
}>;

export type FormulaEditorStructure = FormulaEditorGroup | FormulaEditorArray | FormulaEditorIndex | FormulaEditorCall
  | Readonly<FormulaEditorStructureBase & { kind: "interpolation" }>;

export type FormulaEditorDiagnosticKind =
  | "invalid_f_string"
  | "unterminated_string"
  | "unterminated_reference"
  | "unterminated_error_literal"
  | "malformed_error_literal"
  | "unclosed_delimiter"
  | "unexpected_closing_delimiter"
  | "unknown_character";

export type FormulaEditorDiagnostic = Readonly<{
  kind: FormulaEditorDiagnosticKind;
  span: FormulaSourceSpan;
}>;

export type FormulaEditorCaretContext = Readonly<{
  offset: number;
  tokenIndex: number | null;
  referenceTokenIndex: number | null;
  callStructureIndex: number | null;
  argumentIndex: number | null;
}>;

export type FormulaEditorInspection =
  | Readonly<{
      kind: "not_formula";
      source: string;
      tokens: readonly [];
      structures: readonly [];
      diagnostics: readonly [];
      caret: null;
    }>
  | Readonly<{
      kind: "formula";
      source: string;
      tokens: readonly FormulaEditorToken[];
      structures: readonly FormulaEditorStructure[];
      diagnostics: readonly FormulaEditorDiagnostic[];
      caret: FormulaEditorCaretContext | null;
    }>;

export type FormulaParserToken = [kind: string, value: string];

type MutableLexToken = {
  fString?: FStringSyntax;
  publicToken: FormulaEditorToken;
  parserKind: string | null;
  parserValue: string;
};

type MutableStructure = {
  kind: FormulaEditorStructure["kind"];
  open: FormulaSourceSpan;
  close: FormulaSourceSpan | null;
  contentSpan: FormulaSourceSpan;
  parent: number | null;
  name?: string;
  nameSpan?: FormulaSourceSpan;
  separatorSpans: FormulaSourceSpan[];
};

type RecoveryState = "expect_operand" | "expect_operator";

type StructureScope = {
  structureIndex: number;
  state: RecoveryState;
};

export type FormulaConcreteSyntax = {
  tokens: FormulaEditorToken[];
  structures: FormulaEditorStructure[];
  diagnostics: FormulaEditorDiagnostic[];
  parserTokens: FormulaParserToken[];
};

const KEYWORDS = new Set(["true", "false", "null"]);
export function inspectFormulaInput(input: string, options: FormulaInspectionOptions = {}): FormulaEditorInspection {
  const caret = options.caret;
  if (caret !== undefined && (!Number.isInteger(caret) || caret < 0 || caret > input.length)) {
    throw new Error("formula inspection caret must be an integer inside the source");
  }

  const markerIndex = input.search(/\S/);
  if (markerIndex < 0 || input[markerIndex] !== "=") {
    return {
      kind: "not_formula",
      source: input,
      tokens: [],
      structures: [],
      diagnostics: [],
      caret: null,
    };
  }

  const leadingTokens: FormulaEditorToken[] = [];
  if (markerIndex > 0) {
    leadingTokens.push({ kind: "whitespace", span: { start: 0, end: markerIndex } });
  }
  leadingTokens.push({ kind: "formula_marker", span: { start: markerIndex, end: markerIndex + 1 } });

  const concrete = buildFormulaConcreteSyntax(input.slice(markerIndex + 1), markerIndex + 1);
  const tokens = [...leadingTokens, ...concrete.tokens];
  const caretContext = caret === undefined ? null : resolveCaretContext(input, tokens, concrete.structures, caret);
  if (caretContext) validateCaretContext(tokens, concrete.structures, caretContext);
  return {
    kind: "formula",
    source: input,
    tokens,
    structures: concrete.structures,
    diagnostics: concrete.diagnostics,
    caret: caretContext,
  };
}

export function buildFormulaConcreteSyntax(source: string, baseOffset = 0): FormulaConcreteSyntax {
  if (!Number.isInteger(baseOffset) || baseOffset < 0) {
    throw new Error("formula concrete syntax base offset must be a non-negative integer");
  }
  const diagnostics: FormulaEditorDiagnostic[] = [];
  const lexTokens = scanLosslessTokens(source, baseOffset, diagnostics);
  const structures = classifyStructures(source, baseOffset, lexTokens, diagnostics);
  orderDiagnostics(diagnostics, baseOffset, source.length);
  validateConcreteSyntax(source, baseOffset, lexTokens, structures, diagnostics);
  const result: FormulaConcreteSyntax = {
    tokens: lexTokens.map((token) => token.publicToken),
    structures,
    diagnostics,
    parserTokens: lexTokens
      .filter((token) => token.parserKind !== null)
      .map((token) => [token.parserKind as string, token.parserValue]),
  };
  // Keep parser tokens atomic, but expose field expressions to every editor consumer.
  const expanded: FormulaEditorToken[] = [];
  const records = structures.map((structure) => ({ structure, parent: structure.parent === null ? null : structures[structure.parent] }));
  for (const token of lexTokens) {
    if (!token.fString) { expanded.push(token.publicToken); continue; }
    const start = token.publicToken.span.start - baseOffset;
    const syntax = token.fString;
    let cursor = start;
    const opaque = (end: number) => {
      if (end > cursor) expanded.push({ kind: "string", span: absoluteSpan(cursor, end, baseOffset), complete: true });
      cursor = end;
    };
    for (const part of syntax.parts) {
      if (part.kind !== "field") continue;
      opaque(part.span.start);
      expanded.push({ kind: "punctuation", span: absoluteSpan(part.span.start, part.expression.start, baseOffset) });
      const inner = buildFormulaConcreteSyntax(source.slice(part.expression.start, part.expression.end), baseOffset + part.expression.start);
      expanded.push(...inner.tokens);
      diagnostics.push(...inner.diagnostics);
      const parent = [...structures].reverse().find(s => s.contentSpan.start <= baseOffset + part.span.start && s.contentSpan.end >= baseOffset + part.span.end) ?? null;
      const field: FormulaEditorStructure = { kind: "interpolation", open: absoluteSpan(part.span.start, part.expression.start, baseOffset),
        close: part.incomplete ? null : absoluteSpan(part.span.end - 1, part.span.end, baseOffset),
        contentSpan: absoluteSpan(part.expression.start, part.incomplete ? part.span.end : part.span.end - 1, baseOffset), parent: null };
      records.push({ structure: field, parent });
      for (const structure of inner.structures) records.push({ structure, parent: structure.parent === null ? field : inner.structures[structure.parent] });
      cursor = part.expression.end;
      if (!part.incomplete) {
        opaque(part.span.end - 1);
        expanded.push({ kind: "punctuation", span: absoluteSpan(part.span.end - 1, part.span.end, baseOffset) });
        cursor = part.span.end;
      }
    }
    opaque(syntax.end);
  }
  records.sort((a, b) => a.structure.open.start - b.structure.open.start);
  result.structures = records.map(({ structure, parent }) => ({ ...structure, parent: parent === null ? null : records.findIndex(r => r.structure === parent) }));
  result.tokens = expanded;
  orderDiagnostics(diagnostics, baseOffset, source.length);
  return result;
}

function scanLosslessTokens(
  source: string,
  baseOffset: number,
  diagnostics: FormulaEditorDiagnostic[],
): MutableLexToken[] {
  const tokens: MutableLexToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (source.startsWith('f"', index)) {
      const syntax = scanFString(source, index);
      tokens.push(completableToken("string", index, syntax.end, baseOffset, !syntax.error, syntax.error ? "ERR" : "FSTRING", syntax.error ? syntax.error.code : source.slice(index, syntax.end)));
      tokens[tokens.length - 1].fString = syntax;
      if (syntax.error) diagnostics.push({ kind: "invalid_f_string", span: absoluteSpan(syntax.error.span.start, syntax.error.span.end, baseOffset) });
      index = syntax.end;
      continue;
    }
    if (/\s/.test(char)) {
      let end = index + 1;
      while (end < source.length && /\s/.test(source[end])) end += 1;
      tokens.push(simpleToken("whitespace", index, end, baseOffset, null, source.slice(index, end)));
      index = end;
      continue;
    }

    if (char === "\"") {
      const end = scanQuotedEnd(source, index);
      if (end === null) {
        const span = absoluteSpan(index, source.length, baseOffset);
        tokens.push(completableToken("string", index, source.length, baseOffset, false, "ERR", "unterminated_string"));
        diagnostics.push({ kind: "unterminated_string", span });
        break;
      }
      tokens.push(completableToken("string", index, end, baseOffset, true, "STRING", source.slice(index, end)));
      index = end;
      continue;
    }

    if (char === "@" && source[index + 1] === "[") {
      const end = scanOrdinateReferenceEnd(source, index);
      if (end === null) {
        const span = absoluteSpan(index, source.length, baseOffset);
        tokens.push(completableToken("ordinate_reference", index, source.length, baseOffset, false, "ERR", "bad_reference"));
        diagnostics.push({ kind: "unterminated_reference", span });
        break;
      }
      tokens.push(completableToken("ordinate_reference", index, end, baseOffset, true, "REF", source.slice(index, end)));
      index = end;
      continue;
    }

    if (source.startsWith("error[", index)) {
      const close = source.indexOf("]", index + 6);
      if (close < 0) {
        const span = absoluteSpan(index, source.length, baseOffset);
        tokens.push(completableToken("error_literal", index, source.length, baseOffset, false, "ERR", "malformed_error_literal"));
        diagnostics.push({ kind: "unterminated_error_literal", span });
        break;
      }
      const end = close + 1;
      const text = source.slice(index, end);
      const match = /^error\[([a-z][a-z0-9_]*)\]$/.exec(text);
      const boundaryValid = isExpressionTokenBoundary(source, end);
      if (!match || !boundaryValid) {
        const span = absoluteSpan(index, end, baseOffset);
        tokens.push(completableToken("error_literal", index, end, baseOffset, true, "ERR", "malformed_error_literal"));
        diagnostics.push({ kind: "malformed_error_literal", span });
      } else {
        tokens.push(completableToken("error_literal", index, end, baseOffset, true, "ERROR_LITERAL", match[1]));
      }
      index = end;
      continue;
    }

    const twoChar = source.slice(index, index + 2);
    if (["**", "==", "!=", "<=", ">="].includes(twoChar)) {
      tokens.push(simpleToken("operator", index, index + 2, baseOffset, twoChar, twoChar));
      index += 2;
      continue;
    }

    if ("+-*/<>".includes(char)) {
      tokens.push(simpleToken("operator", index, index + 1, baseOffset, char, char));
      index += 1;
      continue;
    }

    if ("()[],:$".includes(char)) {
      tokens.push(simpleToken("punctuation", index, index + 1, baseOffset, char, char));
      index += 1;
      continue;
    }

    const temporal = scanTemporalLiteralPrefixAt(source, index);
    if (temporal && isExpressionTokenBoundary(source, index + temporal.length)) {
      tokens.push(simpleToken("temporal_literal", index, index + temporal.length, baseOffset, "TEMPORAL", temporal));
      index += temporal.length;
      continue;
    }

    if (/\d/.test(char)) {
      let end = index + 1;
      while (end < source.length && /[\d.]/.test(source[end])) end += 1;
      const text = source.slice(index, end);
      tokens.push(simpleToken("number", index, end, baseOffset, "NUMBER", text));
      index = end;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end += 1;
      const text = source.slice(index, end);
      tokens.push(simpleToken(KEYWORDS.has(text) ? "keyword" : "identifier", index, end, baseOffset, "IDENT", text));
      index = end;
      continue;
    }

    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) throw new Error("formula scanner failed to read source code point");
    const width = codePoint > 0xffff ? 2 : 1;
    const span = absoluteSpan(index, index + width, baseOffset);
    tokens.push(simpleToken("unknown", index, index + width, baseOffset, "ERR", source.slice(index, index + width)));
    diagnostics.push({ kind: "unknown_character", span });
    index += width;
  }
  return tokens;
}

function classifyStructures(
  source: string,
  baseOffset: number,
  tokens: MutableLexToken[],
  diagnostics: FormulaEditorDiagnostic[],
): FormulaEditorStructure[] {
  const structures: MutableStructure[] = [];
  const scopes: StructureScope[] = [];
  const classifiedTokens: MutableLexToken[] = [];
  let rootState: RecoveryState = "expect_operand";
  let indexStructureDepth = 0;
  const pendingCalls = new Map<number, number>();

  const currentState = () => scopes.length > 0 ? scopes[scopes.length - 1].state : rootState;
  const setCurrentState = (state: RecoveryState) => {
    if (scopes.length > 0) scopes[scopes.length - 1].state = state;
    else rootState = state;
  };

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    let token = tokens[tokenIndex];
    if (token.publicToken.kind === "whitespace") {
      classifiedTokens.push(token);
      continue;
    }
    const next = nextSignificantTokenIndex(tokens, tokenIndex + 1);
    // Call syntax disambiguates digit-bearing names (log10, atan2, ...)
    // from A1 coordinates. This is grammar, not a function-name allowlist.
    const isCallName = token.publicToken.kind === "identifier" && next !== null
      && sourceSlice(tokens[next].publicToken.span, source, baseOffset) === "(";
    if (
      (indexStructureDepth === 0 || ["call", "group"].includes(structures[scopes[scopes.length - 1]?.structureIndex]?.kind))
      && (token.publicToken.kind === "identifier" || token.publicToken.kind === "number" || token.parserKind === "$")
      && !isCallName
    ) {
      const localStart = token.publicToken.span.start - baseOffset;
      const spreadsheet = scanSpreadsheetToken(source, localStart);
      if (spreadsheet) {
        const absoluteEnd = baseOffset + spreadsheet.next;
        let finalTokenIndex = tokenIndex;
        while (finalTokenIndex < tokens.length && tokens[finalTokenIndex].publicToken.span.end < absoluteEnd) {
          finalTokenIndex += 1;
        }
        if (
          finalTokenIndex >= tokens.length
          || tokens[finalTokenIndex].publicToken.span.end !== absoluteEnd
        ) {
          throw new Error("spreadsheet reference does not align to lossless token boundaries");
        }
        token = simpleToken(
          "spreadsheet_reference",
          localStart,
          spreadsheet.next,
          baseOffset,
          "SPREF",
          spreadsheet.text,
        );
        tokenIndex = finalTokenIndex;
      }
    }
    classifiedTokens.push(token);
    const text = source.slice(token.publicToken.span.start - baseOffset, token.publicToken.span.end - baseOffset);

    if (token.publicToken.kind === "identifier" || token.publicToken.kind === "keyword") {
      if (currentState() === "expect_operator") setCurrentState("expect_operand");
      const next = nextSignificantTokenIndex(tokens, tokenIndex + 1);
      if (next !== null && sourceSlice(tokens[next].publicToken.span, source, baseOffset) === "(") {
        pendingCalls.set(next, tokenIndex);
      } else {
        setCurrentState("expect_operator");
      }
      continue;
    }

    if (text === "(") {
      if (currentState() === "expect_operator") setCurrentState("expect_operand");
      const callNameTokenIndex = pendingCalls.get(tokenIndex);
      const structureIndex = structures.length;
      const parent = scopes.length > 0 ? scopes[scopes.length - 1].structureIndex : null;
      if (callNameTokenIndex !== undefined) {
        const nameToken = tokens[callNameTokenIndex];
        structures.push({
          kind: "call",
          open: token.publicToken.span,
          close: null,
          contentSpan: { start: token.publicToken.span.end, end: baseOffset + source.length },
          parent,
          name: sourceSlice(nameToken.publicToken.span, source, baseOffset),
          nameSpan: nameToken.publicToken.span,
          separatorSpans: [],
        });
        token.parserKind = "CALL_OPEN";
      } else {
        structures.push({
          kind: "group",
          open: token.publicToken.span,
          close: null,
          contentSpan: { start: token.publicToken.span.end, end: baseOffset + source.length },
          parent,
          separatorSpans: [],
        });
        token.parserKind = "GROUP_OPEN";
      }
      scopes.push({ structureIndex, state: "expect_operand" });
      continue;
    }

    if (text === "[") {
      const kind: "array" | "index" = currentState() === "expect_operator" ? "index" : "array";
      const structureIndex = structures.length;
      const parent = scopes.length > 0 ? scopes[scopes.length - 1].structureIndex : null;
      structures.push({
        kind,
        open: token.publicToken.span,
        close: null,
        contentSpan: { start: token.publicToken.span.end, end: baseOffset + source.length },
        parent,
        separatorSpans: [],
      });
      token.parserKind = kind === "array" ? "ARRAY_OPEN" : "INDEX_OPEN";
      scopes.push({ structureIndex, state: "expect_operand" });
      if (kind === "index") indexStructureDepth += 1;
      continue;
    }

    if (text === ")" || text === "]") {
      const scope = scopes[scopes.length - 1];
      const structure = scope ? structures[scope.structureIndex] : null;
      const matches = structure
        ? text === ")"
          ? structure.kind === "group" || structure.kind === "call"
          : structure.kind === "array" || structure.kind === "index"
        : false;
      if (!matches || !structure) {
        token.parserKind = text === ")" ? "UNEXPECTED_PAREN_CLOSE" : "UNEXPECTED_BRACKET_CLOSE";
        token.parserValue = text;
        diagnostics.push({ kind: "unexpected_closing_delimiter", span: token.publicToken.span });
        continue;
      }
      token.parserKind = structure.kind === "call"
        ? "CALL_CLOSE"
        : structure.kind === "group"
          ? "GROUP_CLOSE"
          : structure.kind === "array"
            ? "ARRAY_CLOSE"
            : "INDEX_CLOSE";
      structure.close = token.publicToken.span;
      structure.contentSpan = { start: structure.open.end, end: token.publicToken.span.start };
      scopes.pop();
      if (structure.kind === "index") indexStructureDepth -= 1;
      setCurrentState("expect_operator");
      continue;
    }

    if (text === ",") {
      const scope = scopes[scopes.length - 1];
      if (scope) {
        const owner = structures[scope.structureIndex];
        if (owner.kind === "call") {
          owner.separatorSpans.push(token.publicToken.span);
          token.parserKind = "CALL_SEPARATOR";
        } else if (owner.kind === "array") {
          token.parserKind = "ARRAY_SEPARATOR";
        } else if (owner.kind === "index") {
          token.parserKind = "INDEX_SEPARATOR";
        } else {
          token.parserKind = "UNOWNED_SEPARATOR";
        }
      } else {
        token.parserKind = "UNOWNED_SEPARATOR";
      }
      setCurrentState("expect_operand");
      continue;
    }

    if (text === ":") {
      const scope = scopes[scopes.length - 1];
      const owner = scope ? structures[scope.structureIndex] : null;
      token.parserKind = owner?.kind === "index" ? "INDEX_COLON" : "UNOWNED_COLON";
      setCurrentState("expect_operand");
      continue;
    }

    if (token.publicToken.kind === "operator") {
      if (currentState() === "expect_operator") setCurrentState("expect_operand");
      continue;
    }

    if (token.publicToken.kind === "unknown" || token.parserKind === "ERR") {
      setCurrentState("expect_operand");
      continue;
    }

    if (currentState() === "expect_operator") setCurrentState("expect_operand");
    setCurrentState("expect_operator");
  }

  for (const scope of scopes) {
    const structure = structures[scope.structureIndex];
    diagnostics.push({ kind: "unclosed_delimiter", span: structure.open });
  }
  tokens.length = 0;
  for (const classifiedToken of classifiedTokens) tokens.push(classifiedToken);

  return structures.map((structure): FormulaEditorStructure => {
    const base = {
      open: structure.open,
      close: structure.close,
      contentSpan: structure.contentSpan,
      parent: structure.parent,
    };
    if (structure.kind === "call") {
      if (structure.name === undefined || structure.nameSpan === undefined) {
        throw new Error("formula call structure is missing its name");
      }
      return {
        ...base,
        kind: "call",
        name: structure.name,
        nameSpan: structure.nameSpan,
        separatorSpans: [...structure.separatorSpans],
      };
    }
    return { ...base, kind: structure.kind };
  });
}

function orderDiagnostics(
  diagnostics: FormulaEditorDiagnostic[],
  baseOffset: number,
  sourceLength: number,
): void {
  const buckets: FormulaEditorDiagnostic[][] = Array.from(
    { length: sourceLength + 1 },
    () => [],
  );
  for (const diagnostic of diagnostics) {
    const offset = diagnostic.span.start - baseOffset;
    if (offset < 0 || offset > sourceLength) {
      throw new Error("formula diagnostic starts outside the source");
    }
    buckets[offset].push(diagnostic);
  }
  diagnostics.length = 0;
  for (const bucket of buckets) {
    for (const diagnostic of bucket) diagnostics.push(diagnostic);
  }
}

function resolveCaretContext(
  source: string,
  tokens: readonly FormulaEditorToken[],
  structures: readonly FormulaEditorStructure[],
  caret: number,
): FormulaEditorCaretContext {
  let tokenIndex: number | null = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const ownsNormally = token.span.start <= caret && caret < token.span.end;
    const ownsIncompleteEof =
      caret === source.length
      && "complete" in token
      && !token.complete
      && token.span.end === caret;
    if (ownsNormally || ownsIncompleteEof) {
      tokenIndex = index;
      break;
    }
  }

  const referenceTokenIndex = tokenIndex !== null
    && ["ordinate_reference", "spreadsheet_reference"].includes(tokens[tokenIndex].kind)
    ? tokenIndex
    : null;

  let callStructureIndex: number | null = null;
  for (let index = 0; index < structures.length; index += 1) {
    const structure = structures[index];
    if (structure.kind !== "call") continue;
    const inCall = caret >= structure.open.end
      && (structure.close ? caret < structure.close.end : caret <= source.length);
    if (inCall) callStructureIndex = index;
  }
  const call = callStructureIndex === null ? null : structures[callStructureIndex];
  const argumentIndex = call?.kind === "call"
    ? call.separatorSpans.filter((span) => span.end <= caret).length
    : null;

  return { offset: caret, tokenIndex, referenceTokenIndex, callStructureIndex, argumentIndex };
}

function simpleToken(
  kind: FormulaEditorSimpleTokenKind,
  start: number,
  end: number,
  baseOffset: number,
  parserKind: string | null,
  parserValue: string,
): MutableLexToken {
  return {
    publicToken: { kind, span: absoluteSpan(start, end, baseOffset) },
    parserKind,
    parserValue,
  };
}

function completableToken(
  kind: FormulaEditorCompletableToken["kind"],
  start: number,
  end: number,
  baseOffset: number,
  complete: boolean,
  parserKind: string,
  parserValue: string,
): MutableLexToken {
  return {
    publicToken: { kind, span: absoluteSpan(start, end, baseOffset), complete },
    parserKind,
    parserValue,
  };
}

function absoluteSpan(start: number, end: number, baseOffset: number): FormulaSourceSpan {
  return { start: baseOffset + start, end: baseOffset + end };
}

function sourceSlice(span: FormulaSourceSpan, source: string, baseOffset: number): string {
  return source.slice(span.start - baseOffset, span.end - baseOffset);
}

function nextSignificantTokenIndex(tokens: readonly MutableLexToken[], start: number): number | null {
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].publicToken.kind !== "whitespace") return index;
  }
  return null;
}

function scanOrdinateReferenceEnd(source: string, start: number): number | null {
  let depth = 1;
  let inQuote = false;
  let escaped = false;
  for (let index = start + 2; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

function isExpressionTokenBoundary(source: string, nextIndex: number): boolean {
  if (nextIndex >= source.length) return true;
  return !/[A-Za-z0-9_\[]/.test(source[nextIndex]);
}

function validateConcreteSyntax(
  source: string,
  baseOffset: number,
  tokens: readonly MutableLexToken[],
  structures: readonly FormulaEditorStructure[],
  diagnostics: readonly FormulaEditorDiagnostic[],
): void {
  const sourceEnd = baseOffset + source.length;
  let expectedStart = baseOffset;
  for (const token of tokens) {
    const { start, end } = token.publicToken.span;
    if (start !== expectedStart || end <= start || end > sourceEnd) {
      throw new Error("formula concrete syntax tokens do not cover the source exactly");
    }
    expectedStart = end;
  }
  if (expectedStart !== sourceEnd) {
    throw new Error("formula concrete syntax tokens do not reach source end");
  }

  const previousSiblingEnd = new Map<number | null, number>();
  for (let index = 0; index < structures.length; index += 1) {
    const structure = structures[index];
    if (index > 0 && structures[index - 1].open.start > structure.open.start) {
      throw new Error("formula structures are not ordered by opening span");
    }
    if (structure.open.end !== structure.open.start + 1) {
      throw new Error("formula structure opening span must cover one code unit");
    }
    if (structure.contentSpan.start !== structure.open.end) {
      throw new Error("formula structure content does not start after its opening delimiter");
    }
    const expectedContentEnd = structure.close?.start ?? sourceEnd;
    if (structure.contentSpan.end !== expectedContentEnd) {
      throw new Error("formula structure content has an invalid ending span");
    }
    if (structure.close && structure.close.end !== structure.close.start + 1) {
      throw new Error("formula structure closing span must cover one code unit");
    }
    if (structure.parent !== null) {
      if (structure.parent < 0 || structure.parent >= index) {
        throw new Error("formula structure parent must reference an earlier structure");
      }
      const parent = structures[structure.parent];
      const structureEnd = structure.close?.end ?? sourceEnd;
      if (structure.open.start < parent.contentSpan.start || structureEnd > parent.contentSpan.end) {
        throw new Error("formula structure is not contained by its parent");
      }
    }
    const previousEnd = previousSiblingEnd.get(structure.parent);
    if (previousEnd !== undefined && structure.open.start < previousEnd) {
      throw new Error("formula sibling structures overlap");
    }
    previousSiblingEnd.set(structure.parent, structure.close?.end ?? sourceEnd);

    if (structure.kind === "call") {
      if (structure.nameSpan.end > structure.open.start || structure.nameSpan.start < baseOffset) {
        throw new Error("formula call name span is outside its call");
      }
      let separatorEnd = structure.contentSpan.start;
      for (const separator of structure.separatorSpans) {
        if (
          separator.end !== separator.start + 1
          || separator.start < structure.contentSpan.start
          || separator.end > structure.contentSpan.end
          || separator.start < separatorEnd
        ) {
          throw new Error("formula call separator span is invalid");
        }
        separatorEnd = separator.end;
      }
    }
  }

  let previousDiagnosticStart = baseOffset;
  for (const diagnostic of diagnostics) {
    if (
      diagnostic.span.start < baseOffset
      || diagnostic.span.end < diagnostic.span.start
      || diagnostic.span.end > sourceEnd
      || diagnostic.span.start < previousDiagnosticStart
    ) {
      throw new Error("formula diagnostic span or ordering is invalid");
    }
    previousDiagnosticStart = diagnostic.span.start;
  }
}

function validateCaretContext(
  tokens: readonly FormulaEditorToken[],
  structures: readonly FormulaEditorStructure[],
  caret: FormulaEditorCaretContext,
): void {
  if (caret.tokenIndex !== null && (caret.tokenIndex < 0 || caret.tokenIndex >= tokens.length)) {
    throw new Error("formula caret token index is invalid");
  }
  if (caret.referenceTokenIndex !== null) {
    const token = tokens[caret.referenceTokenIndex];
    if (!token || (token.kind !== "ordinate_reference" && token.kind !== "spreadsheet_reference")) {
      throw new Error("formula caret reference index is invalid");
    }
  }
  if (caret.callStructureIndex !== null) {
    const structure = structures[caret.callStructureIndex];
    if (!structure || structure.kind !== "call" || caret.argumentIndex === null || caret.argumentIndex < 0) {
      throw new Error("formula caret call index is invalid");
    }
  } else if (caret.argumentIndex !== null) {
    throw new Error("formula caret argument index requires an active call");
  }
}
