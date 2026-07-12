import {
  getStandardFunctionMetadata,
  inspectFormulaInput,
  type FormulaEditorInspection,
  type FunctionMetadata,
} from "@ordinate/core";

export type FormulaAssistantNameContext = {
  kind: "name";
  query: string;
  start: number;
  end: number;
};

export type FormulaAssistantCallContext = {
  kind: "call";
  name: string;
  argumentIndex: number;
};

export type FormulaAssistantContext = FormulaAssistantNameContext | FormulaAssistantCallContext | null;
export type FormulaAssistantContexts = {
  name: FormulaAssistantNameContext | null;
  call: FormulaAssistantCallContext | null;
};
export type FormulaAssistantParameter = FunctionMetadata["signatures"][number]["parameters"][number];

export type FormulaFunctionSuggestion = {
  key: string;
  metadata: FunctionMetadata;
  displayName: string;
  insertName: string;
  isAlias: boolean;
};

export type FormulaAssistantTextEdit = {
  nextInput: string;
  nextCaret: number;
  nextGuardedCloseParen: number | null;
};

export const MIN_FUNCTION_AUTOCOMPLETE_QUERY_LENGTH = 2;

export function normalizeFunctionSearchText(value: string): string {
  return value.trim().toLowerCase();
}

export function isEscapeKey(key: string): boolean {
  return key === "Escape" || key === "Esc";
}

export function isFormulaAssistantImeEvent(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function resolveFunctionNameContext(draft: string, caret: number): FormulaAssistantNameContext | null {
  return resolveFormulaAssistantContexts(draft, caret).name;
}

export function resolveActiveFunctionCallContext(
  draft: string,
  caret: number,
  hasFunction: (name: string) => boolean = (name) => Boolean(getStandardFunctionMetadata(name)),
): FormulaAssistantCallContext | null {
  const safeCaret = Math.max(0, Math.min(caret, draft.length));
  const inspection = inspectFormulaInput(draft, { caret: safeCaret });
  return resolveCallContextFromInspection(inspection, hasFunction);
}

export function resolveFormulaAssistantContexts(
  draft: string,
  caret: number,
  hasFunction: (name: string) => boolean = (name) => Boolean(getStandardFunctionMetadata(name)),
): FormulaAssistantContexts {
  const safeCaret = Math.max(0, Math.min(caret, draft.length));
  const inspection = inspectFormulaInput(draft, { caret: safeCaret });
  return {
    name: resolveNameContextFromInspection(inspection),
    call: resolveCallContextFromInspection(inspection, hasFunction),
  };
}

export function buildFunctionSuggestions(functions: readonly FunctionMetadata[], query: string): FormulaFunctionSuggestion[] {
  const normalizedQuery = normalizeFunctionSearchText(query);
  const suggestions: FormulaFunctionSuggestion[] = [];
  for (const metadata of functions) {
    const names = normalizedQuery ? [metadata.name, ...(metadata.aliases ?? [])] : [metadata.name];
    for (const name of names) {
      if (normalizedQuery && !name.toLowerCase().startsWith(normalizedQuery)) continue;
      suggestions.push({
        key: `${metadata.name}:${name}`,
        metadata,
        displayName: name,
        insertName: name,
        isAlias: name !== metadata.name,
      });
    }
  }
  return suggestions;
}

export function signatureForFormulaAssistant(metadata: FunctionMetadata) {
  return metadata.signatures[0] ?? null;
}

export function activeParameterIndexForFormulaAssistant(metadata: FunctionMetadata, argumentIndex: number): number {
  const signature = signatureForFormulaAssistant(metadata);
  if (!signature || signature.parameters.length === 0) return -1;
  return Math.min(Math.max(argumentIndex, 0), signature.parameters.length - 1);
}

export function typeLabelForFormulaAssistant(type: string): string {
  if (type.startsWith("view")) return "range";
  if (type === "Scalar[number]") return "number";
  if (type === "Scalar[boolean]") return "boolean";
  return type;
}

export function returnLabelForFormulaAssistant(metadata: FunctionMetadata): string {
  return typeLabelForFormulaAssistant(metadata.signatures[0]?.returns ?? "value");
}

export function iconForFormulaAssistant(category: FunctionMetadata["category"]): string {
  void category;
  return "ƒ";
}

export function parameterLabelForFormulaAssistant(parameter: FormulaAssistantParameter): string {
  return `${parameter.name} ${typeLabelForFormulaAssistant(parameter.type)}`;
}

export function nextFormulaAssistantSelectedIndex(currentIndex: number, suggestionCount: number, key: "ArrowDown" | "ArrowUp"): number {
  if (suggestionCount <= 0) return 0;
  const delta = key === "ArrowDown" ? 1 : -1;
  return Math.max(0, Math.min(suggestionCount - 1, currentIndex + delta));
}

export function buildFunctionCallInsertion(args: {
  draft: string;
  isFormulaDraft: boolean;
  suggestion: Pick<FormulaFunctionSuggestion, "insertName">;
  replacementStart: number;
  replacementEnd: number;
}): FormulaAssistantTextEdit {
  const callText = `${args.suggestion.insertName}()`;
  if (!args.isFormulaDraft) {
    const nextInput = `= ${callText}`;
    const caret = nextInput.length - 1;
    return { nextInput, nextCaret: caret, nextGuardedCloseParen: caret };
  }

  const safeStart = Math.max(0, Math.min(args.replacementStart, args.replacementEnd, args.draft.length));
  const safeEnd = Math.max(0, Math.min(Math.max(args.replacementStart, args.replacementEnd), args.draft.length));
  let callOpen = safeEnd;
  while (callOpen < args.draft.length && /\s/.test(args.draft[callOpen])) callOpen += 1;
  if (args.draft[callOpen] === "(") {
    const nextInput = `${args.draft.slice(0, safeStart)}${args.suggestion.insertName}${args.draft.slice(safeEnd)}`;
    const replacedLength = safeEnd - safeStart;
    const nextCallOpen = callOpen + args.suggestion.insertName.length - replacedLength;
    const caret = nextCallOpen + 1;
    const nextGuardedCloseParen = args.draft[callOpen + 1] === ")" ? caret : null;
    return { nextInput, nextCaret: caret, nextGuardedCloseParen };
  }
  const nextInput = `${args.draft.slice(0, safeStart)}${callText}${args.draft.slice(safeEnd)}`;
  const caret = safeStart + callText.length - 1;
  return { nextInput, nextCaret: caret, nextGuardedCloseParen: caret };
}

export function applyFormulaAssistantTextReplacement(args: {
  draft: string;
  start: number;
  end: number;
  text: string;
  guardedCloseParen: number | null;
}): FormulaAssistantTextEdit {
  const safeStart = Math.max(0, Math.min(args.start, args.end, args.draft.length));
  const safeEnd = Math.max(0, Math.min(Math.max(args.start, args.end), args.draft.length));
  const shouldRedirectBeforeGuardedCloseParen =
    args.text.length > 0 &&
    safeStart === safeEnd &&
    args.guardedCloseParen !== null &&
    safeStart === args.guardedCloseParen + 1 &&
    args.draft[args.guardedCloseParen] === ")";
  let replacementStart = safeStart;
  let replacementEnd = safeEnd;
  if (shouldRedirectBeforeGuardedCloseParen) {
    if (args.guardedCloseParen === null) {
      throw new Error("guarded close paren redirect requires a guarded close paren");
    }
    replacementStart = args.guardedCloseParen;
    replacementEnd = args.guardedCloseParen;
  }
  const nextInput = `${args.draft.slice(0, replacementStart)}${args.text}${args.draft.slice(replacementEnd)}`;
  const nextCaret = replacementStart + args.text.length;
  let nextGuardedCloseParen = args.guardedCloseParen;
  if (args.guardedCloseParen !== null) {
    if (replacementStart <= args.guardedCloseParen && replacementEnd <= args.guardedCloseParen) {
      nextGuardedCloseParen = args.guardedCloseParen + args.text.length - (replacementEnd - replacementStart);
    } else if (replacementStart <= args.guardedCloseParen && replacementEnd > args.guardedCloseParen) {
      nextGuardedCloseParen = null;
    }
  }
  return { nextInput, nextCaret, nextGuardedCloseParen };
}

export function correctFormulaAssistantInputChange(args: {
  draft: string;
  nextInput: string;
  isFormulaDraft: boolean;
  guardedCloseParen: number | null;
  explicitReferenceView: { start: number; end: number } | null;
}): FormulaAssistantTextEdit | null {
  const singleInsertion = getSingleTextInsertion(args.draft, args.nextInput);
  if (singleInsertion && args.isFormulaDraft) {
    if (args.draft[singleInsertion.start] === ")") {
      const nextCaret = singleInsertion.start + singleInsertion.text.length;
      return {
        nextInput: args.nextInput,
        nextCaret,
        nextGuardedCloseParen: nextCaret,
      };
    }
    if (args.draft[singleInsertion.start - 1] === ")" && !/^[+\-*/^&=<>)]/.test(singleInsertion.text)) {
      const closeParenIndex = singleInsertion.start - 1;
      const correctedInput = `${args.draft.slice(0, closeParenIndex)}${singleInsertion.text}${args.draft.slice(closeParenIndex)}`;
      const nextCaret = closeParenIndex + singleInsertion.text.length;
      return {
        nextInput: correctedInput,
        nextCaret,
        nextGuardedCloseParen: nextCaret,
      };
    }
  }

  const guardedCloseParen = args.guardedCloseParen;
  if (guardedCloseParen !== null && args.draft[guardedCloseParen] === ")" && args.nextInput.length > args.draft.length) {
    const insertedLength = args.nextInput.length - args.draft.length;
    const beforeClose = args.draft.slice(0, guardedCloseParen);
    const closeAndAfter = args.draft.slice(guardedCloseParen);
    const throughClose = args.draft.slice(0, guardedCloseParen + 1);
    const afterClose = args.draft.slice(guardedCloseParen + 1);
    const beforeCloseInsertion =
      args.nextInput.startsWith(beforeClose) &&
      args.nextInput.endsWith(closeAndAfter) &&
      args.nextInput.length === beforeClose.length + insertedLength + closeAndAfter.length;
    const afterCloseInsertion =
      args.nextInput.startsWith(throughClose) &&
      args.nextInput.endsWith(afterClose) &&
      args.nextInput.length === throughClose.length + insertedLength + afterClose.length;
    if (beforeCloseInsertion || afterCloseInsertion) {
      const insertedText = beforeCloseInsertion
        ? args.nextInput.slice(guardedCloseParen, guardedCloseParen + insertedLength)
        : args.nextInput.slice(guardedCloseParen + 1, guardedCloseParen + 1 + insertedLength);
      const correctedInput = `${beforeClose}${insertedText}${closeAndAfter}`;
      const nextCaret = guardedCloseParen + insertedText.length;
      return {
        nextInput: correctedInput,
        nextCaret,
        nextGuardedCloseParen: nextCaret,
      };
    }
  }

  const explicitReferenceView = args.explicitReferenceView;
  if (explicitReferenceView && args.draft.length > 0 && args.nextInput.endsWith(args.draft)) {
    const insertedPrefix = args.nextInput.slice(0, args.nextInput.length - args.draft.length);
    if (insertedPrefix.length > 0) {
      const nextCaret = explicitReferenceView.end + insertedPrefix.length;
      const correctedInput = `${args.draft.slice(0, explicitReferenceView.end)}${insertedPrefix}${args.draft.slice(explicitReferenceView.end)}`;
      return {
        nextInput: correctedInput,
        nextCaret,
        nextGuardedCloseParen: args.guardedCloseParen,
      };
    }
  }

  return null;
}

function isFunctionNameBoundary(char: string | undefined): boolean {
  if (char == null) return true;
  return /\s|[=+\-*/^(),<>]/.test(char);
}

function resolveNameContextFromInspection(inspection: FormulaEditorInspection): FormulaAssistantNameContext | null {
  if (inspection.kind !== "formula" || !inspection.caret) return null;
  const caret = inspection.caret.offset;
  const token = inspection.caret.tokenIndex === null ? null : inspection.tokens[inspection.caret.tokenIndex];

  const nameToken = inspection.tokens.find(
    (candidate) =>
      candidate.kind === "identifier"
      && candidate.span.start < caret
      && candidate.span.end === caret,
  );
  if (nameToken) {
    if (!isFunctionNameBoundary(inspection.source[nameToken.span.start - 1])) return null;
    return {
      kind: "name",
      query: inspection.source.slice(nameToken.span.start, caret),
      start: nameToken.span.start,
      end: caret,
    };
  }

  if (token && !["identifier", "whitespace", "formula_marker"].includes(token.kind)) return null;
  if (token && token.kind !== "whitespace" && token.kind !== "formula_marker") return null;
  if (!isFunctionNameBoundary(inspection.source[caret - 1])) return null;
  return { kind: "name", query: "", start: caret, end: caret };
}

function resolveCallContextFromInspection(
  inspection: FormulaEditorInspection,
  hasFunction: (name: string) => boolean,
): FormulaAssistantCallContext | null {
  if (inspection.kind !== "formula" || !inspection.caret || inspection.caret.callStructureIndex === null) return null;
  const structure = inspection.structures[inspection.caret.callStructureIndex];
  if (structure.kind !== "call") {
    throw new Error("formula inspection call context does not reference a call structure");
  }
  if (!hasFunction(structure.name)) return null;
  if (inspection.caret.argumentIndex === null) {
    throw new Error("formula inspection call context is missing an argument index");
  }
  return { kind: "call", name: structure.name, argumentIndex: inspection.caret.argumentIndex };
}

function getSingleTextInsertion(previousText: string, nextText: string): { start: number; text: string } | null {
  if (nextText.length <= previousText.length) return null;
  let prefixLength = 0;
  while (
    prefixLength < previousText.length &&
    prefixLength < nextText.length &&
    previousText[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < previousText.length - prefixLength &&
    suffixLength < nextText.length - prefixLength &&
    previousText[previousText.length - 1 - suffixLength] === nextText[nextText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  if (previousText.length !== prefixLength + suffixLength) return null;
  return {
    start: prefixLength,
    text: nextText.slice(prefixLength, nextText.length - suffixLength),
  };
}
