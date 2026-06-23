import type { LogicalCell, Rect, SheetSelection } from "../types/ui";

export function normalizeRect(anchor: LogicalCell, focus: LogicalCell): Rect {
  return {
    rowStart: Math.min(anchor.rAbs, focus.rAbs),
    rowEnd: Math.max(anchor.rAbs, focus.rAbs),
    colStart: Math.min(anchor.cAbs, focus.cAbs),
    colEnd: Math.max(anchor.cAbs, focus.cAbs),
  };
}

export function isSingleCellRect(rect: Rect): boolean {
  return rect.rowStart === rect.rowEnd && rect.colStart === rect.colEnd;
}

export function makeCellSelection(cell: LogicalCell): SheetSelection {
  return {
    kind: "cell",
    focus: cell,
    anchor: cell,
    range: normalizeRect(cell, cell),
  };
}

export function makeRangeSelection(anchor: LogicalCell, focus: LogicalCell): SheetSelection {
  const range = normalizeRect(anchor, focus);
  return {
    kind: isSingleCellRect(range) ? "cell" : "range",
    focus,
    anchor,
    range,
  };
}

export function makeRangeSelectionWithFocus(anchor: LogicalCell, extent: LogicalCell, focus: LogicalCell): SheetSelection {
  const range = normalizeRect(anchor, extent);
  return {
    kind: isSingleCellRect(range) ? "cell" : "range",
    focus,
    anchor,
    range,
  };
}

export function getSelectionFocus(selection: SheetSelection | null): LogicalCell | null {
  if (!selection || (selection.kind !== "cell" && selection.kind !== "range")) return null;
  return selection.focus;
}

export function getSelectionRange(selection: SheetSelection | null): Rect | null {
  if (!selection || (selection.kind !== "cell" && selection.kind !== "range")) return null;
  return selection.range;
}

export function getRectDimensions(rect: Rect): { rows: number; cols: number } {
  return {
    rows: rect.rowEnd - rect.rowStart + 1,
    cols: rect.colEnd - rect.colStart + 1,
  };
}
