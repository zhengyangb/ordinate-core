import { parseHierarchyLabel } from "@ordinate/core";
import type { SelectedCell } from "../types/ui";

export type RowInsertSide = "above" | "below";

type LogicalRowLike = {
  rawCells: string[];
};

type RowInsertSheetState = {
  bodyStart: number;
  rowCount: number;
  logicalRows: LogicalRowLike[];
};

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

function rowDepthAt(sheet: RowInsertSheetState, rowIndex: number): number {
  const rawLabel = sheet.logicalRows[rowIndex]?.rawCells[0] ?? "";
  return parseHierarchyLabel(rawLabel).depth;
}

export function resolveRowInsert(
  sheet: RowInsertSheetState,
  rowPaths: string[],
  rowNumber: number,
  side: RowInsertSide,
): ResolvedRowInsert {
  if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
    throw new Error("row insertion requires a positive absolute row number");
  }
  if (rowNumber <= sheet.bodyStart || rowNumber > sheet.rowCount) {
    throw new Error(`row insertion requires a body row, got row ${rowNumber}`);
  }

  const rowIndex = rowNumber - 1;
  const currentDepth = rowDepthAt(sheet, rowIndex);

  if (side === "above") {
    return {
      rowGapIndex: rowNumber - 1,
      depth: currentDepth,
      nextRowNumber: rowNumber,
      expandParentRowPath: null,
    };
  }

  const nextRowIndex = rowIndex + 1;
  const hasChildren = nextRowIndex < sheet.rowCount && rowDepthAt(sheet, nextRowIndex) > currentDepth;
  const bodyRowIndex = rowNumber - sheet.bodyStart - 1;
  const currentRowPath = rowPaths[bodyRowIndex] ?? null;

  if (hasChildren) {
    return {
      rowGapIndex: rowNumber,
      depth: currentDepth + 1,
      nextRowNumber: rowNumber + 1,
      expandParentRowPath: currentRowPath,
    };
  }

  return {
    rowGapIndex: rowNumber,
    depth: currentDepth,
    nextRowNumber: rowNumber + 1,
    expandParentRowPath: null,
  };
}
