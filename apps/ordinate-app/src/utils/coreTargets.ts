import type { CoreRegionTarget } from "@ordinate/core";
import type { LogicalCell } from "../types/ui";

type SheetIdSurface = {
  name: string;
  rowIds: number[];
  colIds: number[];
};

function resolveRowId(sheet: SheetIdSurface, rowNumber: number): number {
  const rowId = sheet.rowIds[rowNumber - 1];
  if (rowId == null) {
    throw new Error(`could not resolve rowId for row ${rowNumber}`);
  }
  return rowId;
}

function resolveColId(sheet: SheetIdSurface, colIndex: number): number {
  const colId = sheet.colIds[colIndex];
  if (colId == null) {
    throw new Error(`could not resolve colId for column ${colIndex}`);
  }
  return colId;
}

export function resolveCoreRegionTarget(
  sheet: SheetIdSurface,
  start: LogicalCell,
  end: LogicalCell,
): CoreRegionTarget {
  return {
    sheet: sheet.name,
    start: {
      rowId: resolveRowId(sheet, start.rAbs),
      colId: resolveColId(sheet, start.cAbs),
    },
    end: {
      rowId: resolveRowId(sheet, end.rAbs),
      colId: resolveColId(sheet, end.cAbs),
    },
  };
}
