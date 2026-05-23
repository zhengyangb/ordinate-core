import type { LogicalCell, Rect } from "../types/ui";
import { normalizeRect } from "./selectionModel";
import { toColumnLetters } from "./appHelpers";

export type FormulaReferenceToken = {
  start: number;
  end: number;
  text: string;
  kind: "a1" | "ordinate";
};

export type FormulaReferenceEdit = {
  nextDraft: string;
  selectionStart: number;
  selectionEnd: number;
};

function hasReferenceBoundary(text: string, start: number, end: number): boolean {
  const before = start <= 0 ? "" : text[start - 1];
  const after = end >= text.length ? "" : text[end];
  return !/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after);
}

export function tokenizeFormulaReferences(draft: string): FormulaReferenceToken[] {
  const tokens: FormulaReferenceToken[] = [];
  const ordinatePattern = /@\[([^\]\r\n]+)\]/g;
  for (const match of draft.matchAll(ordinatePattern)) {
    if (match.index == null) continue;
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      kind: "ordinate",
    });
  }

  const a1Pattern = /\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g;
  for (const match of draft.matchAll(a1Pattern)) {
    if (match.index == null) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (!hasReferenceBoundary(draft, start, end)) continue;
    const overlapsOrdinate = tokens.some((token) => start < token.end && end > token.start);
    if (overlapsOrdinate) continue;
    tokens.push({
      start,
      end,
      text: match[0],
      kind: "a1",
    });
  }

  tokens.sort((a, b) => a.start - b.start || a.end - b.end);
  return tokens;
}

function resolveReplacementRange(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, draft.length));
  const end = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), draft.length));
  const tokens = tokenizeFormulaReferences(draft);

  const overlapping = tokens.filter((token) => start < token.end && end > token.start);
  if (overlapping.length === 1) {
    return { start: overlapping[0].start, end: overlapping[0].end };
  }
  if (overlapping.length > 1) {
    throw new Error("reference pick cannot replace multiple formula references");
  }

  if (start === end) {
    const containing = tokens.find((token) => start > token.start && start < token.end);
    if (containing) {
      return { start: containing.start, end: containing.end };
    }
  }

  return { start, end };
}

export function applyFormulaReferencePick(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  referenceText: string,
): FormulaReferenceEdit {
  const replacement = resolveReplacementRange(draft, selectionStart, selectionEnd);
  const nextDraft = `${draft.slice(0, replacement.start)}${referenceText}${draft.slice(replacement.end)}`;
  const nextSelection = replacement.start + referenceText.length;
  return {
    nextDraft,
    selectionStart: nextSelection,
    selectionEnd: nextSelection,
  };
}

export function formatA1ReferenceForRect(rect: Rect): string {
  const start = `${toColumnLetters(rect.colStart + 1)}${rect.rowStart}`;
  const end = `${toColumnLetters(rect.colEnd + 1)}${rect.rowEnd}`;
  return start === end ? start : `${start}:${end}`;
}

export function makeFormulaPointRect(anchor: LogicalCell, focus: LogicalCell): Rect {
  return normalizeRect(anchor, focus);
}

