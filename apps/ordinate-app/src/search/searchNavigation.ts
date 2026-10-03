import type { GridApi } from "ag-grid-community";
import type { GridRow } from "../types/ui";
import { toColFieldId } from "../utils/appHelpers";

export type SearchGrid = { scope: string; api: GridApi<GridRow> };

/** A sheet switch is not a grid-ready signal. Never consume a request on an old grid. */
export function revealSearchCell(
  grid: SearchGrid | null, scope: string, col: number, rowIndex: number | undefined, needsBodyRow: boolean,
): boolean {
  if (!grid || grid.scope !== scope || grid.api.isDestroyed()) return false;
  if (needsBodyRow && rowIndex == null) return false;
  const column = grid.api.getColumn(toColFieldId(col));
  if (!column || !column.isVisible() || column.getActualWidth() <= 0) return false;
  if (rowIndex != null) grid.api.ensureIndexVisible(rowIndex, "middle");
  grid.api.ensureColumnVisible(column, "middle");
  return true;
}
