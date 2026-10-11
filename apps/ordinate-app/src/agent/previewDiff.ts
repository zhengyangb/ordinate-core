import { getCellTextView, resolveSheetRowStructure, type DocumentState, type SheetState } from "@ordinate/core";

export type PreviewChange = { sheet: string; kind: "cell" | "row" | "column" | "sheet"; rowKey?: string; columnKey?: string };
export type PreviewBurst = PreviewChange & { id: number; expiresAt: number };
export const PREVIEW_BURST_DURATION_MS = 960;

/** New workbook versions add bursts without cancelling ones still in flight. */
export function appendPreviewBursts(active: PreviewBurst[], changes: PreviewChange[], now: number, firstId: number): PreviewBurst[] {
  return [
    ...active.filter(burst => burst.expiresAt > now),
    ...changes.map((change, index) => ({ ...change, id: firstId + index, expiresAt: now + PREVIEW_BURST_DURATION_MS })),
  ];
}

function uniqueKeys(values: string[]): Array<string | null> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return values.map(value => counts.get(value) === 1 ? value : null);
}

function rowKeys(sheet: SheetState): Array<string | null> {
  const body = resolveSheetRowStructure(sheet);
  const keys = sheet.cells.map((_, index) => index < sheet.bodyStart ? `header:${index}` : `body:${body[index - sheet.bodyStart]?.rowPath ?? index}`);
  return uniqueKeys(keys);
}

function columnKeys(sheet: SheetState): Array<string | null> {
  const columns = sheet.cells[0]?.length ?? 0;
  const keys = Array.from({ length: columns }, (_, column) => {
    const labels = sheet.cells.slice(0, sheet.bodyStart).map(row => getCellTextView(row[column]).inputText.trim());
    return labels.some(Boolean) ? labels.join("\u001f") : `column:${column}`;
  });
  return uniqueKeys(keys);
}

export function previewAnchorKeys(sheet: SheetState): { rows: Array<string | null>; columns: Array<string | null> } {
  return { rows: rowKeys(sheet), columns: columnKeys(sheet) };
}

/** A burst follows authored row/column identity when an edit shifts their positions. */
export function previewBurstsAtCell(
  bursts: PreviewBurst[], sheet: string, anchors: ReturnType<typeof previewAnchorKeys>, row: number, column: number,
): PreviewBurst[] {
  const rowKey = anchors.rows[row];
  const columnKey = anchors.columns[column];
  return bursts.filter(burst => burst.sheet === sheet && (
    (burst.kind === "cell" && rowKey != null && columnKey != null && burst.rowKey === rowKey && burst.columnKey === columnKey)
    || (burst.kind === "row" && column === 0 && rowKey != null && burst.rowKey === rowKey)
    || (burst.kind === "column" && row === 0 && columnKey != null && burst.columnKey === columnKey)
    || (burst.kind === "sheet" && row === 0 && column === 0)
  ));
}

/** Locate authored changes by semantic row/column keys; never animate ambiguous matches. */
export function previewChanges(previous: DocumentState, current: DocumentState, limit = 18): PreviewChange[] {
  const changes: PreviewChange[] = [];
  const add = (change: PreviewChange) => { if (changes.length < limit) changes.push(change); };
  for (const sheet of current.sheets) {
    const before = previous.sheets.find(item => item.name === sheet.name);
    if (!before) { add({ sheet: sheet.name, kind: "sheet" }); continue; }
    const oldAnchors = previewAnchorKeys(before), newAnchors = previewAnchorKeys(sheet);
    const oldRows = oldAnchors.rows, newRows = newAnchors.rows;
    const oldColumns = oldAnchors.columns, newColumns = newAnchors.columns;
    const oldRowIndex = new Map(oldRows.flatMap((key, index): Array<[string, number]> => key === null ? [] : [[key, index]]));
    const oldColumnIndex = new Map(oldColumns.flatMap((key, index): Array<[string, number]> => key === null ? [] : [[key, index]]));
    for (const key of newColumns)
      if (key !== null && !oldColumnIndex.has(key)) add({ sheet: sheet.name, columnKey: key, kind: "column" });
    for (const [row, key] of newRows.entries()) {
      if (key === null) continue;
      const beforeRow = oldRowIndex.get(key);
      if (beforeRow === undefined) { add({ sheet: sheet.name, rowKey: key, kind: "row" }); continue; }
      for (const [column, columnKey] of newColumns.entries()) {
        if (columnKey === null) continue;
        const beforeColumn = oldColumnIndex.get(columnKey);
        if (beforeColumn === undefined) continue;
        if (getCellTextView(sheet.cells[row][column]).inputText !== getCellTextView(before.cells[beforeRow][beforeColumn]).inputText)
          add({ sheet: sheet.name, rowKey: key, columnKey, kind: "cell" });
      }
    }
  }
  return changes;
}
