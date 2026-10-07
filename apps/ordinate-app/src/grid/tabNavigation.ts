import type { CellPosition, TabToNextCellParams } from "ag-grid-community";

// Own the grid's forward Tab boundary before the browser moves focus to
// unrelated controls (such as Add note). The append command owns selection,
// scrolling and focus once the new row has reached the grid model.
export function tabToNextBodyCell(
  params: TabToNextCellParams,
  canAppend: boolean,
  appendRows: (count: number, focusColumnIndex: number) => void,
): CellPosition | boolean {
  if (params.nextCellPosition) return params.nextCellPosition;
  if (params.backwards || params.previousCellPosition.rowPinned != null || params.previousCellPosition.rowIndex < 0) return false;
  if (canAppend) appendRows(1, 0);
  // Stay on the current cell until the append command focuses the new row.
  // Also consume forward Tab on a read-only sheet, without creating a row.
  return true;
}
