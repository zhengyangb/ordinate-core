import type { GridRow, HeaderOverlayCell } from "../types/ui";
import type { UiLocale } from "../i18n/messages";
import { gridCellText } from "../utils/gridCellText";

export type SearchCell = {
  id: string;
  row: number;
  col: number;
  text: string;
  rowPath?: string;
};
export type TextRange = { start: number; end: number };
export type SearchMatch = SearchCell & { ranges: TextRange[] };
export const cellAddress = (row: number, col: number) => `${row}:${col}`;

/** Uses the same display projection as the grid, including merged header labels. */
export function buildSearchCells(
  rows: GridRow[], headers: HeaderOverlayCell[], colIds: number[], rowIds: number[], locale: UiLocale,
): SearchCell[] {
  return [
    ...headers.map(cell => ({
      id: `${rowIds[cell.rowNumber - 1]}:${colIds[cell.startCol]}`,
      row: cell.rowNumber, col: cell.startCol, text: cell.label,
    })),
    ...rows.flatMap(row => colIds.map((colId, col) => ({
      id: `${row.__rowId}:${colId}`, row: row.__absoluteRowNumber, col,
      text: gridCellText(row, col, locale), rowPath: row.__rowPath,
    }))),
  ];
}

/** Literal Unicode matching. RegExp indices preserve original UTF-16 text offsets. */
export function findMatches(cells: SearchCell[], query: string, matchCase: boolean): SearchMatch[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu");
  return cells.flatMap(cell => {
    const ranges = Array.from(cell.text.matchAll(pattern), match => ({ start: match.index!, end: match.index! + match[0].length }));
    return ranges.length ? [{ ...cell, ranges }] : [];
  });
}

export function resolveActiveMatch(matches: SearchMatch[], activeId: string | null): number {
  if (!matches.length) return -1;
  const index = matches.findIndex(match => match.id === activeId);
  return index < 0 ? 0 : index;
}

export function stepMatch(index: number, count: number, direction: number): number {
  return count ? (index + direction + count) % count : -1;
}
