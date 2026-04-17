import type { GridApi } from "ag-grid-community";

import type { GridRow } from "../types/ui";
import type { RingRect } from "./appHelpers";

type SelectionRingCellLookup = {
  root: HTMLElement;
  displayedRowIndex: number;
  colId: string;
  rowKey: string;
  cachedCell: HTMLElement | null;
  cachedKey: string | null;
};

type SelectionRingRectParams = {
  root: HTMLElement;
  gridShell: HTMLElement;
  targetCell: HTMLElement;
  displayedRowIndex: number;
  gridApi: GridApi<GridRow> | null;
  gridRowHeight: number;
};

export function buildSelectionRingTargetKey(displayedRowIndex: number, colId: string, rowKey: string): string {
  return `${displayedRowIndex}:${colId}:${rowKey}`;
}

export function resolveSelectionRingCell({
  root,
  displayedRowIndex,
  colId,
  rowKey,
  cachedCell,
  cachedKey,
}: SelectionRingCellLookup): { cell: HTMLElement | null; key: string | null } {
  const nextKey = buildSelectionRingTargetKey(displayedRowIndex, colId, rowKey);

  if (cachedCell && cachedKey === nextKey && cachedCell.isConnected) {
    return { cell: cachedCell, key: nextKey };
  }

  const byRowIndexSelector = `.ag-row[row-index="${displayedRowIndex}"] .ag-cell[col-id="${colId}"]`;
  const targetCellFromRowIndex = root.querySelector<HTMLElement>(byRowIndexSelector);
  const byRowKeySelector = `.ag-row[row-id="${CSS.escape(rowKey)}"] .ag-cell[col-id="${colId}"]`;
  const targetCellFromRowKey = root.querySelector<HTMLElement>(byRowKeySelector);
  const cell = targetCellFromRowIndex ?? targetCellFromRowKey;

  return {
    cell,
    key: cell ? nextKey : null,
  };
}

export function resolveSelectionRingRect({
  root,
  gridShell,
  targetCell,
  displayedRowIndex,
  gridApi,
  gridRowHeight,
}: SelectionRingRectParams): RingRect {
  const cellRect = targetCell.getBoundingClientRect();
  const shellRect = gridShell.getBoundingClientRect();
  const verticalViewport = root.querySelector<HTMLElement>(".ag-body-viewport");
  const rowNode = gridApi?.getDisplayedRowAtIndex(displayedRowIndex) ?? null;

  let top = cellRect.top - shellRect.top;
  let height = cellRect.height;
  if (verticalViewport && rowNode?.rowTop != null) {
    const viewportRect = verticalViewport.getBoundingClientRect();
    top = viewportRect.top - shellRect.top + rowNode.rowTop - verticalViewport.scrollTop;
    height = rowNode.rowHeight ?? gridRowHeight;
  }

  return {
    left: Math.round((cellRect.left - shellRect.left) * 10) / 10,
    top: Math.round(top * 10) / 10,
    width: Math.round(cellRect.width * 10) / 10,
    height: Math.round(height * 10) / 10,
  };
}
