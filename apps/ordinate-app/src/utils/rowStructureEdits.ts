import type { SheetBodyRowStructure } from "@ordinate/core";
import type { SelectedCell } from "../types/ui";

export type RowInsertSide = "above" | "below";

export type ResolvedRowInsert = {
  rowGapIndex: number;
  depth: number;
  nextRowNumber: number;
  expandParentRowPath: string | null;
};

export function resolvePostRowStructureColumnIndex(
  selectedCell: SelectedCell | null,
  defaultBodyColIndex: number,
): number {
  if (!selectedCell) return defaultBodyColIndex;
  if (selectedCell.area !== "body") return defaultBodyColIndex;
  return selectedCell.logical.cAbs;
}

export function resolveRowInsert(
  rows: SheetBodyRowStructure[],
  rowNumber: number,
  side: RowInsertSide,
): ResolvedRowInsert {
  if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
    throw new Error("row insertion requires a positive absolute row number");
  }
  const currentRow = rows.find((row) => row.absoluteRowNumber === rowNumber) ?? null;
  if (!currentRow) {
    throw new Error(`row insertion requires a body row, got row ${rowNumber}`);
  }

  if (side === "above") {
    return {
      rowGapIndex: currentRow.absoluteRowIndex,
      depth: currentRow.depth,
      nextRowNumber: currentRow.absoluteRowNumber,
      expandParentRowPath: null,
    };
  }

  if (currentRow.hasChildren) {
    return {
      rowGapIndex: currentRow.absoluteRowIndex + 1,
      depth: currentRow.depth + 1,
      nextRowNumber: currentRow.absoluteRowNumber + 1,
      expandParentRowPath: currentRow.rowPath,
    };
  }

  return {
    rowGapIndex: currentRow.absoluteRowIndex + 1,
    depth: currentRow.depth,
    nextRowNumber: currentRow.absoluteRowNumber + 1,
    expandParentRowPath: null,
  };
}
