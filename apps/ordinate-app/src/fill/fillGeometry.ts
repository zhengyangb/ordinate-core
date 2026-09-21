import type { LogicalCell, Rect } from "../types/ui";

export function fillDirection(source: Rect, target: Rect): "up" | "down" | "left" | "right" {
  if (target.colStart === source.colStart && target.colEnd === source.colEnd) {
    if (target.rowStart === source.rowEnd + 1) return "down";
    if (target.rowEnd === source.rowStart - 1) return "up";
  }
  if (target.rowStart === source.rowStart && target.rowEnd === source.rowEnd) {
    if (target.colStart === source.colEnd + 1) return "right";
    if (target.colEnd === source.colStart - 1) return "left";
  }
  throw new Error("Fill feedback requires an adjacent, single-axis destination");
}

/** Extend in one direction only. Destination excludes the unchanged seed. */
export function fillDestination(source: Rect, point: LogicalCell): Rect | null {
  const dy = point.rAbs < source.rowStart ? point.rAbs - source.rowStart : Math.max(0, point.rAbs - source.rowEnd);
  const dx = point.cAbs < source.colStart ? point.cAbs - source.colStart : Math.max(0, point.cAbs - source.colEnd);
  if (!dx && !dy) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return {
    ...source, rowStart: dy < 0 ? point.rAbs : source.rowEnd + 1, rowEnd: dy < 0 ? source.rowStart - 1 : point.rAbs,
  };
  return { ...source, colStart: dx < 0 ? point.cAbs : source.colEnd + 1, colEnd: dx < 0 ? source.colStart - 1 : point.cAbs };
}

export function unionFill(source: Rect, target: Rect): Rect {
  return { rowStart: Math.min(source.rowStart, target.rowStart), rowEnd: Math.max(source.rowEnd, target.rowEnd),
    colStart: Math.min(source.colStart, target.colStart), colEnd: Math.max(source.colEnd, target.colEnd) };
}

export function isVisibleFillRange(range: Rect, bodyStart: number, headerCols: number, visibleRows: ReadonlySet<number>): boolean {
  if (range.rowStart <= bodyStart || range.colStart < headerCols) return false;
  for (let row = range.rowStart; row <= range.rowEnd; row++) if (!visibleRows.has(row)) return false;
  return true;
}
