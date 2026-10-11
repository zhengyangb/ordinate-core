import { groupHeaderSpans } from "@ordinate/core";
import type { ColumnMetric, HeaderOverlayCell } from "../types/ui";
import { GRID_HEADER_HEIGHT } from "./appHelpers";

/** Build the same visible header geometry for the editor and assistant preview. */
export function buildHeaderOverlayCells(
  columns: ColumnMetric[], matrix: string[][], headerColCount: number,
): HeaderOverlayCell[] {
  const cells: HeaderOverlayCell[] = [];
  for (let rowOffset = 0; rowOffset < matrix.length; rowOffset += 1) {
    for (const { start: startIndex, end, label } of groupHeaderSpans(columns, matrix[rowOffset], headerColCount)) {
      const start = columns[startIndex];
      const finish = columns[end];
      const left = Math.round(start.left);
      const width = Math.max(0, Math.round(finish.left + finish.width) - left);
      if (width <= 0.5) continue;
      const rowNumber = rowOffset + 1;
      cells.push({
        key: `r${rowNumber}-c${start.colIndex + 1}-${finish.colIndex + 1}`,
        rowNumber, label, startCol: start.colIndex, endCol: finish.colIndex,
        left, width, top: rowOffset * GRID_HEADER_HEIGHT, height: GRID_HEADER_HEIGHT,
      });
    }
  }
  return cells;
}
