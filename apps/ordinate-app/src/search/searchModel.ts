import type { GridRow, HeaderOverlayCell } from "../types/ui";
import type { UiLocale } from "../i18n/messages";
import { gridCellText } from "../utils/gridCellText";
import type { EditorState } from "../store/editorStore";
import { projectSheetRows } from "../hooks/useSheetViewModel";
import { buildHeaderMatrix, buildSheetIssueBuckets, trimSheetColCount } from "../utils/appHelpers";

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
  rows: GridRow[], headers: Pick<HeaderOverlayCell, "rowNumber" | "startCol" | "label">[], colIds: number[], rowIds: number[], locale: UiLocale,
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

export type DocumentSearchCell = SearchCell & { sheet: string };
export type SearchScope = "all" | "current";

export function findDocumentMatches(cells: DocumentSearchCell[], query: string, matchCase: boolean, scope: SearchScope, currentSheet: string) {
  return findMatches(scope === "current" ? cells.filter(cell => cell.sheet === currentSheet) : cells, query, matchCase);
}

/** Index the same display projection as the grid, without mounting inactive sheets. */
export function buildDocumentSearchCells(
  { docState, evaluation, presentation, sheetIssuesByName }: Pick<EditorState, "docState" | "evaluation" | "presentation" | "sheetIssuesByName">,
  locale: UiLocale,
): DocumentSearchCell[] {
  if (!docState || !evaluation) return [];
  const issues = buildSheetIssueBuckets(docState.sheets.map(sheet => sheet.name), sheetIssuesByName);
  return docState.sheets.flatMap(state => {
    if (issues[state.name]?.blocking.length) return [];
    const evaluated = evaluation.sheets.find(sheet => sheet.name === state.name);
    if (!evaluated) return [];
    const presented = presentation?.sheets.find(sheet => sheet.name === state.name) ?? null;
    const columns = trimSheetColCount(state, evaluated);
    const frozen = Math.min(state.headerColCount, columns);
    const rows = projectSheetRows(evaluated, state, presented, columns, frozen, new Set());
    const matrix = buildHeaderMatrix(state, evaluated, presented, columns, state.headerRowCount);
    const headers = matrix.flatMap((row, index) => row.flatMap((label, col) =>
      col > 0 && col !== frozen && row[col - 1] === label ? [] : [{ rowNumber: index + 1, startCol: col, label }],
    ));
    return buildSearchCells(rows, headers, state.colIds.slice(0, columns), state.rowIds, locale)
      .map(cell => ({ ...cell, sheet: state.name, id: `${state.sheetId}:${cell.id}` }));
  });
}

/** Literal Unicode matching. RegExp indices preserve original UTF-16 text offsets. */
export function findMatches<T extends SearchCell>(cells: T[], query: string, matchCase: boolean): (T & { ranges: TextRange[] })[] {
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
