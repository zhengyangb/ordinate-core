import { resolveSheetRowStructure, type SheetState } from "@ordinate/core";
import type { Rect } from "../types/ui";

export type FillRowOptions = { collapsed: boolean; parents: boolean };
export type FillRowGroups = Record<keyof FillRowOptions, number[]>;
export const defaultFillRowOptions: FillRowOptions = { collapsed: true, parents: true };

/** Snapshot semantic row categories, including parents whose children are outside the fill. */
export function resolveFillRowGroups(sheet: SheetState, range: Rect, visibleRows: ReadonlySet<number>): FillRowGroups {
  const inRange = (row: number) => row >= range.rowStart && row <= range.rowEnd;
  return {
    collapsed: Array.from({ length: range.rowEnd - range.rowStart + 1 }, (_, i) => range.rowStart + i)
      .filter(row => !visibleRows.has(row)),
    parents: resolveSheetRowStructure(sheet).filter(row => row.hasChildren && inRange(row.absoluteRowNumber))
      .map(row => row.absoluteRowNumber),
  };
}

/** Core receives a deduplicated list of zero-based exclusions, not UI policy. */
export function excludedFillRows(groups: FillRowGroups, options: FillRowOptions): number[] {
  return [...new Set((Object.keys(groups) as (keyof FillRowOptions)[])
    .flatMap(key => options[key] ? [] : groups[key]))].sort((a, b) => a - b).map(row => row - 1);
}
