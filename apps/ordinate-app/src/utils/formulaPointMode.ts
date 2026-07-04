import type { LogicalCell, Rect } from "../types/ui";
import { toColumnLetters } from "./appHelpers";
import { scanOrdinateReferenceEnd } from "./formulaReferenceScan";
import { normalizeRect } from "./selectionModel";

export type ReferenceStyle = "spreadsheet-a1" | "ordinate-label" | "ordinate-positional" | "ordinate-relative";

export type FormulaReferenceToken = {
  id: string;
  start: number;
  end: number;
  text: string;
  style: ReferenceStyle;
  sheetName: string | null;
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
  sheetsByName?: Map<string, FormulaReferenceSheetContext>;
};

const A1_REFERENCE_RE = /\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g;
const REFERENCE_COLOR_COUNT = 8;

function tokenId(start: number, end: number): string {
  return `ref-${start}-${end}`;
}

function hasReferenceBoundary(text: string, start: number, end: number): boolean {
  const before = start <= 0 ? "" : text[start - 1];
  const after = end >= text.length ? "" : text[end];
  return !/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after);
}

function selectorRangeUsesRelative(text: string): boolean {
  return splitTopLevel(text, ":").some((part) => {
    const trimmed = part.trim();
    return trimmed === "_" || /^_[+-]\d+$/.test(trimmed);
  });
}

function selectorRangeUsesPosition(text: string): boolean {
  return splitTopLevel(text, ":").some((part) => /^#[1-9]\d*!?$/.test(part.trim()));
}

function classifyOrdinateStyle(text: string): ReferenceStyle {
  const parsed = parseOrdinateReferenceTarget(text);
  const targetInner = parsed?.targetInner ?? text.slice(2, -1);
  const selectors = splitTopLevel(targetInner, ",");
  if (selectors.some(selectorRangeUsesRelative)) return "ordinate-relative";
  if (selectors.some(selectorRangeUsesPosition)) return "ordinate-positional";
  return "ordinate-label";
}

export function tokenizeFormulaReferences(draft: string): FormulaReferenceToken[] {
  const tokens: FormulaReferenceToken[] = [];

  let cursor = 0;
  while (cursor < draft.length) {
    const start = draft.indexOf("@[", cursor);
    if (start < 0) break;
    const end = scanOrdinateReferenceEnd(draft, start);
    if (end == null) {
      cursor = start + 2;
      continue;
    }
    const text = draft.slice(start, end);
    const parsed = parseOrdinateReferenceTarget(text);
    tokens.push({
      id: tokenId(start, end),
      start,
      end,
      text,
      style: classifyOrdinateStyle(text),
      sheetName: parsed?.sheetName ?? null,
    });
    cursor = end;
  }

  for (const match of draft.matchAll(A1_REFERENCE_RE)) {
    if (match.index == null) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (!hasReferenceBoundary(draft, start, end)) continue;
    const overlapsOrdinate = tokens.some((token) => start < token.end && end > token.start);
    if (overlapsOrdinate) continue;
    tokens.push({
      id: tokenId(start, end),
      start,
      end,
      text: match[0],
      style: "spreadsheet-a1",
      sheetName: null,
    });
  }

  tokens.sort((a, b) => a.start - b.start || a.end - b.end);
  return tokens;
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

function quoteLabelPart(text: string): string {
  if (/^[A-Za-z0-9_]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function quoteSheetSelector(text: string): string {
  if (/^[A-Za-z0-9]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function formatLabelPath(parts: string[]): string {
  return parts.map(quoteLabelPart).join(".");
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
  return `@[${quoteSheetSelector(sheetName)}::[${inner}]]`;
}

export function buildReferenceOptions(
  rect: Rect,
  context: FormulaReferenceGenerationContext,
  sheetName: string | null = null,
): FormulaReferenceOption[] {
  const specs: Array<{ style: ReferenceStyle; label: string }> = [
    { style: "spreadsheet-a1", label: "A1" },
    { style: "ordinate-label", label: "Label" },
    { style: "ordinate-positional", label: "Position" },
    { style: "ordinate-relative", label: "Relative" },
  ];
  return specs.map((spec) => {
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

function columnLettersToIndex(letters: string): number | null {
  let value = 0;
  for (const ch of letters.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return null;
    value = value * 26 + (code - 64);
  }
  return value - 1;
}

function parseA1Cell(text: string): { row: number; col: number } | null {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/.exec(text.trim());
  if (!match) return null;
  const col = columnLettersToIndex(match[1]);
  if (col == null) return null;
  return { row: Number(match[2]), col };
}

function parseA1Rect(text: string): Rect | null {
  const parts = text.split(":");
  if (parts.length < 1 || parts.length > 2) return null;
  const start = parseA1Cell(parts[0]);
  const end = parseA1Cell(parts[1] ?? parts[0]);
  if (!start || !end) return null;
  return normalizeRect(
    { rAbs: start.row, cAbs: start.col },
    { rAbs: end.row, cAbs: end.col },
  );
}

function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inQuote = false;
  let escaped = false;
  let bracketDepth = 0;
  let parenDepth = 0;
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
    if (ch === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (bracketDepth === 0 && parenDepth === 0 && ch === delimiter) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function findTopLevelDoubleColon(text: string): number | null {
  let inQuote = false;
  let escaped = false;
  let bracketDepth = 0;
  let parenDepth = 0;
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
    if (ch === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (bracketDepth === 0 && parenDepth === 0 && ch === ":" && text[i + 1] === ":") {
      return i;
    }
  }
  return null;
}

function parseSheetNameSelector(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("\"")) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  return /^[A-Za-z0-9]+$/.test(trimmed) ? trimmed : null;
}

function parseOrdinateReferenceTarget(text: string): { sheetName: string | null; targetInner: string } | null {
  if (!text.startsWith("@[") || !text.endsWith("]")) return null;
  const inner = text.slice(2, -1).trim();
  const sheetDelimiter = findTopLevelDoubleColon(inner);
  if (sheetDelimiter === null) return { sheetName: null, targetInner: inner };

  const sheetName = parseSheetNameSelector(inner.slice(0, sheetDelimiter));
  const targetText = inner.slice(sheetDelimiter + 2).trim();
  if (!sheetName || !targetText.startsWith("[") || !targetText.endsWith("]")) return null;
  return {
    sheetName,
    targetInner: targetText.slice(1, -1).trim(),
  };
}

function parseLabelPath(text: string): string[] | null {
  const parts = splitTopLevel(text, ".").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return null;
  try {
    return parts.map((part) => (part.startsWith("\"") ? String(JSON.parse(part)) : part));
  } catch {
    return null;
  }
}

function labelKey(parts: string[]): string {
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
  text: string,
  axis: "row" | "col",
  context: FormulaReferenceGenerationContext,
  rowLabels: Map<string, number[]>,
  colLabels: Map<string, number[]>,
): number | null {
  const trimmed = text.trim();
  if (/^#[1-9]\d*!?$/.test(trimmed)) return Number(trimmed.replace(/[#!]/g, "")) - 1;
  if (trimmed === "_" || /^_[+-]\d+$/.test(trimmed)) {
    if (!context.sourceCell) return null;
    const offset = trimmed === "_" ? 0 : Number(trimmed.slice(1));
    return axis === "row" ? context.sourceCell.rAbs - 1 + offset : context.sourceCell.cAbs + offset;
  }
  const labels = parseLabelPath(trimmed);
  if (!labels) return null;
  if (axis === "row") {
    const matches = rowLabels.get(labelKey(labels)) ?? [];
    return matches.length === 1 ? matches[0] - 1 : null;
  }
  const matches = colLabels.get(labelKey(labels)) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function resolveSelectorRange(
  text: string,
  axis: "row" | "col",
  context: FormulaReferenceGenerationContext,
  rowLabels: Map<string, number[]>,
  colLabels: Map<string, number[]>,
): { start: number; end: number } | null {
  const parts = splitTopLevel(text, ":");
  if (parts.length > 2) return null;
  const start = resolveScalarSelector(parts[0], axis, context, rowLabels, colLabels);
  const end = resolveScalarSelector(parts[1] ?? parts[0], axis, context, rowLabels, colLabels);
  if (start == null || end == null) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function parseOrdinateRect(text: string, context: FormulaReferenceGenerationContext): Rect | null {
  const parsed = parseOrdinateReferenceTarget(text);
  if (!parsed) return null;
  const parts = splitTopLevel(parsed.targetInner, ",");
  if (parts.length !== 2) return null;
  const rowLabels = buildReverseRowLabelMap(context);
  const colLabels = buildReverseColLabelMap(context);
  const rows = resolveSelectorRange(parts[0], "row", context, rowLabels, colLabels);
  const cols = resolveSelectorRange(parts[1], "col", context, rowLabels, colLabels);
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

function resolveTokenContext(
  token: FormulaReferenceToken,
  context: FormulaReferenceContext,
): { context: FormulaReferenceGenerationContext; sheetName: string | null } | null {
  if (!token.sheetName) return { context, sheetName: null };
  const sheetContext = context.sheetsByName?.get(token.sheetName);
  if (!sheetContext) return null;
  return {
    context: {
      ...sheetContext,
      sourceCell: null,
    },
    sheetName: token.sheetName,
  };
}

export function resolveFormulaReferenceViews(draft: string, context: FormulaReferenceContext): FormulaReferenceView[] {
  return tokenizeFormulaReferences(draft).map((token, index) => {
    const target = token.style === "spreadsheet-a1" ? { context, sheetName: null } : resolveTokenContext(token, context);
    const rect = target
      ? token.style === "spreadsheet-a1"
        ? parseA1Rect(token.text)
        : parseOrdinateRect(token.text, target.context)
      : null;
    const validRect = rect && target ? clampRectToSheet(rect, target.context) : null;
    return {
      ...token,
      rect: validRect,
      colorIndex: index % REFERENCE_COLOR_COUNT,
      options: validRect && target ? buildReferenceOptions(validRect, target.context, target.sheetName) : [],
    };
  });
}
