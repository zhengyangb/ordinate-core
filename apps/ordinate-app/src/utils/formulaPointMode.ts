import type { LogicalCell, Rect } from "../types/ui";
import {
  formatFormulaReferencePathComponent,
  formatFormulaSheetSelector,
  inspectFormulaInput,
  parseFormulaReferenceSyntax,
  type FormulaReferenceExpressionSyntax,
  type FormulaReferenceSelectorSyntax,
  type FormulaReferenceSyntax,
} from "@ordinate/core";
import { toColumnLetters } from "./appHelpers";
import { normalizeRect } from "./selectionModel";

export type ReferenceStyle = "spreadsheet-a1" | "ordinate-label" | "ordinate-positional" | "ordinate-relative";

export type FormulaReferenceToken = {
  id: string;
  start: number;
  end: number;
  text: string;
  style: ReferenceStyle;
  sheetName: string | null;
  syntax: FormulaReferenceSyntax;
};

export type FormulaReferenceEdit = {
  nextDraft: string;
  selectionStart: number;
  selectionEnd: number;
  tokenStart: number;
  tokenEnd: number;
};

export type FormulaPointReplacementTarget = {
  tokenId: string;
  start: number;
  end: number;
};

export type FormulaPointGestureReplacement = {
  gestureId: number;
  tokenStart: number;
  tokenEnd: number;
};

export type FormulaPointEditorState = {
  draft: string;
  selectionStart: number;
  selectionEnd: number;
  activeTokenId: string | null;
  armedToken: FormulaPointReplacementTarget | null;
  gestureReplacement: FormulaPointGestureReplacement | null;
};

export type FormulaPointSelectionState = {
  activeTokenId: string | null;
  armedToken: FormulaPointReplacementTarget | null;
};

export type FormulaPointPickApplication = {
  edit: FormulaReferenceEdit;
  nextState: FormulaPointEditorState;
};

export type FormulaReferenceOption = {
  style: ReferenceStyle;
  label: string;
  text: string | null;
  disabledReason: string | null;
};

export type FormulaReferenceView = FormulaReferenceToken & {
  rect: Rect | null;
  colorIndex: number;
  options: FormulaReferenceOption[];
};

export type FormulaReferenceSheetContext = {
  rowCount: number;
  colCount: number;
  headerRowCount: number;
  rowLabelsByAbsoluteIndex: Map<number, string[]>;
  colLabelPathsByIndex: string[][];
};

type FormulaReferenceGenerationContext = FormulaReferenceSheetContext & {
  sourceCell: LogicalCell | null;
};

export type FormulaReferenceContext = FormulaReferenceGenerationContext & {
  currentSheetName?: string | null;
  sheetsByName?: Map<string, FormulaReferenceSheetContext | null>;
};

const REFERENCE_COLOR_COUNT = 8;
const REFERENCE_OPTION_SPECS: Array<{ style: ReferenceStyle; label: string }> = [
  { style: "spreadsheet-a1", label: "A1" },
  { style: "ordinate-label", label: "Label" },
  { style: "ordinate-positional", label: "Position" },
  { style: "ordinate-relative", label: "Relative" },
];

function tokenId(start: number, end: number): string {
  return `ref-${start}-${end}`;
}

function selectorUsesKind(selector: FormulaReferenceSelectorSyntax | null, kinds: readonly string[]): boolean {
  if (!selector) return false;
  if (kinds.includes(selector.kind)) return true;
  if (selector.kind !== "range") return false;
  const [start, end] = selector.value;
  return selectorUsesKind(start, kinds) || selectorUsesKind(end, kinds);
}

function classifyOrdinateStyle(reference: FormulaReferenceExpressionSyntax | null): ReferenceStyle {
  if (!reference) return "ordinate-label";
  if (
    selectorUsesKind(reference.rowSelector, ["current", "offset"])
    || selectorUsesKind(reference.colSelector, ["current", "offset"])
  ) return "ordinate-relative";
  if (
    selectorUsesKind(reference.rowSelector, ["absolute", "absolute_fixed"])
    || selectorUsesKind(reference.colSelector, ["absolute", "absolute_fixed"])
  ) return "ordinate-positional";
  return "ordinate-label";
}

export function tokenizeFormulaReferences(draft: string): FormulaReferenceToken[] {
  const inspection = inspectFormulaInput(draft);
  if (inspection.kind !== "formula") return [];
  return inspection.tokens.flatMap((token): FormulaReferenceToken[] => {
    if (token.kind === "ordinate_reference") {
      if (!token.complete) return [];
      const text = draft.slice(token.span.start, token.span.end);
      const syntax = parseFormulaReferenceSyntax(text);
      if (!syntax || syntax.style !== "ordinate") {
        throw new Error("core returned an Ordinate reference token without Ordinate reference syntax");
      }
      return [{
        id: tokenId(token.span.start, token.span.end),
        start: token.span.start,
        end: token.span.end,
        text,
        style: classifyOrdinateStyle(syntax.reference),
        sheetName: syntax.sheetName,
        syntax,
      }];
    }
    if (token.kind !== "spreadsheet_reference") return [];
    const text = draft.slice(token.span.start, token.span.end);
    const syntax = parseFormulaReferenceSyntax(text);
    if (!syntax || syntax.style !== "spreadsheet" || !syntax.reference) {
      throw new Error("core returned a spreadsheet reference token without spreadsheet reference syntax");
    }
    return [{
      id: tokenId(token.span.start, token.span.end),
      start: token.span.start,
      end: token.span.end,
      text,
      style: "spreadsheet-a1",
      sheetName: null,
      syntax,
    }];
  });
}

export function findReferenceTokenForSelection(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
): FormulaReferenceToken | null {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, draft.length));
  const end = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), draft.length));
  const tokens = tokenizeFormulaReferences(draft);
  const overlapping = tokens.filter((token) => start < token.end && end > token.start);
  if (overlapping.length === 1) return overlapping[0];
  if (start === end) {
    return tokens.find((token) => start > token.start && start < token.end) ?? null;
  }
  return null;
}

function resolveReplacementRange(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  activeTokenId: string | null,
): { start: number; end: number } {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, draft.length));
  const end = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), draft.length));
  const tokens = tokenizeFormulaReferences(draft);
  const activeToken = activeTokenId ? tokens.find((token) => token.id === activeTokenId) ?? null : null;
  if (activeToken) return { start: activeToken.start, end: activeToken.end };

  const overlapping = tokens.filter((token) => start < token.end && end > token.start);
  if (overlapping.length === 1) {
    return { start: overlapping[0].start, end: overlapping[0].end };
  }
  if (overlapping.length > 1) {
    throw new Error("Selection overlaps multiple formula references. Narrow the selection before picking a range.");
  }

  if (start === end) {
    const containing = tokens.find((token) => start > token.start && start < token.end);
    if (containing) {
      return { start: containing.start, end: containing.end };
    }
    const adjacent = tokens.find((token) => start === token.start || start === token.end);
    if (adjacent) {
      return { start: adjacent.start, end: adjacent.end };
    }
    if (draft[start - 1] === "@" && draft[start] !== "[") {
      return { start: start - 1, end };
    }
  }

  return { start, end };
}

export function applyFormulaReferencePick(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  referenceText: string,
  activeTokenId: string | null = null,
): FormulaReferenceEdit {
  const replacement = resolveReplacementRange(draft, selectionStart, selectionEnd, activeTokenId);
  const nextDraft = `${draft.slice(0, replacement.start)}${referenceText}${draft.slice(replacement.end)}`;
  const nextSelection = replacement.start + referenceText.length;
  return {
    nextDraft,
    selectionStart: nextSelection,
    selectionEnd: nextSelection,
    tokenStart: replacement.start,
    tokenEnd: nextSelection,
  };
}

export function armFormulaPointToken(draft: string, tokenIdToArm: string): FormulaPointSelectionState {
  const token = tokenizeFormulaReferences(draft).find((candidate) => candidate.id === tokenIdToArm);
  if (!token) {
    throw new Error(`Cannot arm missing formula reference token: ${tokenIdToArm}`);
  }
  return {
    activeTokenId: token.id,
    armedToken: {
      tokenId: token.id,
      start: token.start,
      end: token.end,
    },
  };
}

export function syncFormulaPointSelectionState(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  activeTokenId: string | null,
  armedToken: FormulaPointReplacementTarget | null,
): FormulaPointSelectionState {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, draft.length));
  const end = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), draft.length));
  if (
    activeTokenId &&
    armedToken?.tokenId === activeTokenId &&
    start === end &&
    (start === armedToken.start || start === armedToken.end)
  ) {
    return { activeTokenId, armedToken };
  }

  const token = findReferenceTokenForSelection(draft, start, end);
  if (!token) {
    return { activeTokenId: null, armedToken: null };
  }

  return {
    activeTokenId: token.id,
    armedToken: {
      tokenId: token.id,
      start: token.start,
      end: token.end,
    },
  };
}

export function applyFormulaPointPickToState(
  state: FormulaPointEditorState,
  referenceText: string,
  gestureId: number,
): FormulaPointPickApplication {
  const gestureReplacement =
    state.gestureReplacement?.gestureId === gestureId
      ? state.gestureReplacement
      : null;
  const tokenReplacement = gestureReplacement ? null : state.armedToken;
  const replacementSelection = gestureReplacement
    ? { start: gestureReplacement.tokenStart, end: gestureReplacement.tokenEnd }
    : tokenReplacement
      ? { start: tokenReplacement.start, end: tokenReplacement.end }
    : { start: state.selectionStart, end: state.selectionEnd };
  const edit = applyFormulaReferencePick(
    state.draft,
    replacementSelection.start,
    replacementSelection.end,
    referenceText,
    gestureReplacement ? null : tokenReplacement?.tokenId ?? state.activeTokenId,
  );
  const nextTokenId = tokenId(edit.tokenStart, edit.tokenEnd);
  return {
    edit,
    nextState: {
      draft: edit.nextDraft,
      selectionStart: edit.selectionStart,
      selectionEnd: edit.selectionEnd,
      activeTokenId: nextTokenId,
      armedToken: {
        tokenId: nextTokenId,
        start: edit.tokenStart,
        end: edit.tokenEnd,
      },
      gestureReplacement: {
        gestureId,
        tokenStart: edit.tokenStart,
        tokenEnd: edit.tokenEnd,
      },
    },
  };
}

export function makeFormulaPointRect(anchor: LogicalCell, focus: LogicalCell): Rect {
  return normalizeRect(anchor, focus);
}

export function formatA1ReferenceForRect(rect: Rect): string {
  const start = `${toColumnLetters(rect.colStart + 1)}${rect.rowStart}`;
  const end = `${toColumnLetters(rect.colEnd + 1)}${rect.rowEnd}`;
  return start === end ? start : `${start}:${end}`;
}

function formatSelectorRange(start: string, end: string): string {
  return start === end ? start : `${start}:${end}`;
}

function formatLabelPath(parts: string[]): string {
  return parts.map(formatFormulaReferencePathComponent).join(".");
}

function formatAbsoluteIndex(index: number): string {
  return `#${index + 1}`;
}

function formatRelativeIndex(target: number, source: number): string {
  const offset = target - source;
  if (offset === 0) return "_";
  return offset > 0 ? `_+${offset}` : `_${offset}`;
}

function formatLabelAxisSelector(
  startIndex: number,
  endIndex: number,
  sourceIndex: number | null,
  labelsByIndex: Map<number, string[]> | string[][],
): { text: string | null; disabledReason: string | null } {
  if (sourceIndex != null && startIndex === sourceIndex && endIndex === sourceIndex) {
    return { text: "_", disabledReason: null };
  }
  const startLabels = labelsByIndex instanceof Map ? labelsByIndex.get(startIndex) : labelsByIndex[startIndex];
  const endLabels = labelsByIndex instanceof Map ? labelsByIndex.get(endIndex) : labelsByIndex[endIndex];
  if (!startLabels || !endLabels) {
    return { text: null, disabledReason: "Labels are unavailable for this target." };
  }
  return {
    text: formatSelectorRange(formatLabelPath(startLabels), formatLabelPath(endLabels)),
    disabledReason: null,
  };
}

function referenceTextForRect(
  rect: Rect,
  style: ReferenceStyle,
  context: FormulaReferenceGenerationContext,
  sheetName: string | null = null,
): { text: string | null; disabledReason: string | null } {
  if (sheetName && style === "spreadsheet-a1") {
    return { text: null, disabledReason: "Cross-sheet A1 references are not supported." };
  }
  if (sheetName && style === "ordinate-relative") {
    return { text: null, disabledReason: "Cross-sheet references cannot use relative selectors." };
  }

  let text: string | null = null;
  let disabledReason: string | null = null;
  if (style === "spreadsheet-a1") {
    text = formatA1ReferenceForRect(rect);
    return { text, disabledReason };
  }

  if (style === "ordinate-positional") {
    const rows = formatSelectorRange(formatAbsoluteIndex(rect.rowStart - 1), formatAbsoluteIndex(rect.rowEnd - 1));
    const cols = formatSelectorRange(formatAbsoluteIndex(rect.colStart), formatAbsoluteIndex(rect.colEnd));
    text = `@[${rows},${cols}]`;
    return { text: sheetName ? wrapCrossSheetReference(text, sheetName) : text, disabledReason };
  }

  if (style === "ordinate-relative") {
    if (!context.sourceCell) {
      return { text: null, disabledReason: "No source cell for relative reference." };
    }
    const rows = formatSelectorRange(
      formatRelativeIndex(rect.rowStart - 1, context.sourceCell.rAbs - 1),
      formatRelativeIndex(rect.rowEnd - 1, context.sourceCell.rAbs - 1),
    );
    const cols = formatSelectorRange(
      formatRelativeIndex(rect.colStart, context.sourceCell.cAbs),
      formatRelativeIndex(rect.colEnd, context.sourceCell.cAbs),
    );
    text = `@[${rows},${cols}]`;
    return { text, disabledReason };
  }

  const rowLabelMap = buildReverseRowLabelMap(context);
  const colLabelMap = buildReverseColLabelMap(context);
  const startRowLabels = context.rowLabelsByAbsoluteIndex.get(rect.rowStart);
  const endRowLabels = context.rowLabelsByAbsoluteIndex.get(rect.rowEnd);
  const startColLabels = context.colLabelPathsByIndex[rect.colStart];
  const endColLabels = context.colLabelPathsByIndex[rect.colEnd];
  if (!startRowLabels || !endRowLabels || !startColLabels || !endColLabels) {
    return { text: null, disabledReason: "Labels are unavailable for this target." };
  }
  const rowKeys = [labelKey(startRowLabels), labelKey(endRowLabels)];
  const colKeys = [labelKey(startColLabels), labelKey(endColLabels)];
  if (rowKeys.some((key) => (rowLabelMap.get(key)?.length ?? 0) !== 1) || colKeys.some((key) => (colLabelMap.get(key)?.length ?? 0) !== 1)) {
    return { text: null, disabledReason: "Label reference would be ambiguous." };
  }
  const rowSelector = formatLabelAxisSelector(
    rect.rowStart,
    rect.rowEnd,
    context.sourceCell?.rAbs ?? null,
    context.rowLabelsByAbsoluteIndex,
  );
  const colSelector = formatLabelAxisSelector(
    rect.colStart,
    rect.colEnd,
    context.sourceCell?.cAbs ?? null,
    context.colLabelPathsByIndex,
  );
  if (!rowSelector.text || !colSelector.text) {
    return { text: null, disabledReason: rowSelector.disabledReason ?? colSelector.disabledReason ?? "Labels are unavailable for this target." };
  }
  text = `@[${rowSelector.text},${colSelector.text}]`;
  return { text: sheetName ? wrapCrossSheetReference(text, sheetName) : text, disabledReason };
}

function wrapCrossSheetReference(localReferenceText: string, sheetName: string): string {
  if (!localReferenceText.startsWith("@[") || !localReferenceText.endsWith("]")) {
    throw new Error(`Cannot qualify non-ordinate reference text: ${localReferenceText}`);
  }
  const inner = localReferenceText.slice(2, -1);
  return `@[${formatFormulaSheetSelector(sheetName)}::[${inner}]]`;
}

export function buildReferenceOptions(
  rect: Rect,
  context: FormulaReferenceGenerationContext,
  sheetName: string | null = null,
): FormulaReferenceOption[] {
  return REFERENCE_OPTION_SPECS.map((spec) => {
    const result = referenceTextForRect(rect, spec.style, context, sheetName);
    return { ...spec, ...result };
  });
}

export function referenceTextForPreferredStyle(
  rect: Rect,
  preferredStyle: ReferenceStyle,
  context: FormulaReferenceContext,
): string {
  const preferred = referenceTextForRect(rect, preferredStyle, context);
  if (preferred.text) return preferred.text;
  const fallback = referenceTextForRect(rect, "spreadsheet-a1", context);
  if (!fallback.text) {
    throw new Error(fallback.disabledReason ?? "Reference target cannot be represented.");
  }
  return fallback.text;
}

function labelKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

function buildReverseRowLabelMap(context: FormulaReferenceSheetContext): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const [index, labels] of context.rowLabelsByAbsoluteIndex) {
    const key = labelKey(labels);
    const existing = map.get(key) ?? [];
    existing.push(index);
    map.set(key, existing);
  }
  return map;
}

function buildReverseColLabelMap(context: FormulaReferenceSheetContext): Map<string, number[]> {
  const map = new Map<string, number[]>();
  context.colLabelPathsByIndex.forEach((path, index) => {
    const key = labelKey(path);
    const existing = map.get(key) ?? [];
    existing.push(index);
    map.set(key, existing);
  });
  return map;
}

function resolveScalarSelector(
  selector: FormulaReferenceSelectorSyntax,
  axis: "row" | "col",
  context: FormulaReferenceGenerationContext,
  rowLabels: Map<string, number[]>,
  colLabels: Map<string, number[]>,
): number | null {
  if (selector.kind === "absolute" || selector.kind === "absolute_fixed") {
    return typeof selector.value === "number" ? selector.value : null;
  }
  if (selector.kind === "current" || selector.kind === "offset") {
    if (!context.sourceCell) return null;
    const offset = selector.kind === "current" ? 0 : selector.value;
    if (!Number.isFinite(offset)) return null;
    return axis === "row" ? context.sourceCell.rAbs - 1 + offset : context.sourceCell.cAbs + offset;
  }
  if (selector.kind !== "label") return null;
  const labels = selector.value;
  if (axis === "row") {
    const matches = rowLabels.get(labelKey(labels)) ?? [];
    return matches.length === 1 ? matches[0] - 1 : null;
  }
  const matches = colLabels.get(labelKey(labels)) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function resolveSelectorRange(
  selector: FormulaReferenceSelectorSyntax,
  axis: "row" | "col",
  context: FormulaReferenceGenerationContext,
  rowLabels: Map<string, number[]>,
  colLabels: Map<string, number[]>,
): { start: number; end: number } | null {
  const maximum = axis === "row" ? context.rowCount - 1 : context.colCount - 1;
  if (selector.kind === "all") return { start: 0, end: maximum };
  if (selector.kind !== "range") {
    const scalar = resolveScalarSelector(selector, axis, context, rowLabels, colLabels);
    return scalar === null ? null : { start: scalar, end: scalar };
  }
  if (!Array.isArray(selector.value) || selector.value.length !== 2) return null;
  const [startSelector, endSelector] = selector.value;
  const start = startSelector ? resolveScalarSelector(startSelector, axis, context, rowLabels, colLabels) : 0;
  const end = endSelector ? resolveScalarSelector(endSelector, axis, context, rowLabels, colLabels) : maximum;
  if (start == null || end == null) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function resolveReferenceRect(reference: FormulaReferenceExpressionSyntax, context: FormulaReferenceGenerationContext): Rect | null {
  const rowLabels = buildReverseRowLabelMap(context);
  const colLabels = buildReverseColLabelMap(context);
  const rows = resolveSelectorRange(reference.rowSelector, "row", context, rowLabels, colLabels);
  const cols = resolveSelectorRange(reference.colSelector, "col", context, rowLabels, colLabels);
  if (!rows || !cols) return null;
  return {
    rowStart: rows.start + 1,
    rowEnd: rows.end + 1,
    colStart: cols.start,
    colEnd: cols.end,
  };
}

function clampRectToSheet(rect: Rect, context: FormulaReferenceSheetContext): Rect | null {
  if (rect.rowStart < 1 || rect.rowEnd > context.rowCount || rect.colStart < 0 || rect.colEnd >= context.colCount) return null;
  return rect;
}

type FormulaReferenceTargetResolution =
  | { ok: true; context: FormulaReferenceGenerationContext; sheetName: string | null }
  | { ok: false; reason: string };

function resolveTokenContext(
  token: FormulaReferenceToken,
  context: FormulaReferenceContext,
): FormulaReferenceTargetResolution {
  if (!token.syntax.crossSheet) return { ok: true, context, sheetName: null };
  if (!token.sheetName) return { ok: false, reason: "Sheet selector is invalid." };
  if (!context.sheetsByName?.has(token.sheetName)) {
    return { ok: false, reason: `Sheet \"${token.sheetName}\" is unavailable.` };
  }
  const sheetContext = context.sheetsByName.get(token.sheetName);
  if (sheetContext === null) {
    return { ok: false, reason: `Sheet \"${token.sheetName}\" is ambiguous.` };
  }
  if (!sheetContext) {
    throw new Error(`Sheet lookup is missing a value for \"${token.sheetName}\".`);
  }
  return {
    ok: true,
    context: {
      ...sheetContext,
      sourceCell: null,
    },
    sheetName: token.sheetName,
  };
}

function disabledReferenceOptions(reason: string): FormulaReferenceOption[] {
  return REFERENCE_OPTION_SPECS.map((spec) => ({ ...spec, text: null, disabledReason: reason }));
}

export function resolveFormulaReferenceViews(draft: string, context: FormulaReferenceContext): FormulaReferenceView[] {
  return tokenizeFormulaReferences(draft).map((token, index) => {
    const target = token.syntax.style === "spreadsheet"
      ? { ok: true as const, context, sheetName: null }
      : resolveTokenContext(token, context);
    const reference = token.syntax.reference;
    const rect = target.ok && reference ? resolveReferenceRect(reference, target.context) : null;
    const validRect = rect && target.ok ? clampRectToSheet(rect, target.context) : null;
    let options: FormulaReferenceOption[];
    if (!reference) {
      options = disabledReferenceOptions("Reference syntax cannot be resolved.");
    } else if (!target.ok) {
      options = disabledReferenceOptions(target.reason);
    } else if (!validRect) {
      options = disabledReferenceOptions("Reference labels are missing or ambiguous.");
    } else {
      options = buildReferenceOptions(validRect, target.context, target.sheetName);
    }
    return {
      ...token,
      rect: validRect,
      colorIndex: index % REFERENCE_COLOR_COUNT,
      options,
    };
  });
}
