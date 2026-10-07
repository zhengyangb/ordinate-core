import type { LogicalCell, Rect, SheetSelection } from "../types/ui";

export type RowSelectionBounds = { rowStart: number; rowEnd: number };

/** Selection is geometric; header/body membership constrains commands, not selection. */
export function rowSelectionRegion(bounds: RowSelectionBounds, headerRowCount: number): "header" | "body" | "mixed" {
  if (!Number.isInteger(headerRowCount) || headerRowCount < 0 ||
      !Number.isInteger(bounds.rowStart) || !Number.isInteger(bounds.rowEnd) ||
      bounds.rowStart < 1 || bounds.rowEnd < bounds.rowStart) {
    throw new Error("Row selection requires valid consecutive rows and a header count.");
  }
  if (bounds.rowEnd <= headerRowCount) return "header";
  if (bounds.rowStart > headerRowCount) return "body";
  return "mixed";
}

export function makeRowSelection(anchorRowNumber: number, rowNumber: number): Extract<SheetSelection, { kind: "row" }> {
  const bounds = { rowStart: Math.min(anchorRowNumber, rowNumber), rowEnd: Math.max(anchorRowNumber, rowNumber) };
  rowSelectionRegion(bounds, 0);
  return { kind: "row", rowNumber, anchorRowNumber, ...bounds };
}

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

export function selectionContainsCell(selection: SheetSelection | null, cell: LogicalCell): boolean {
  if (!selection) return false;
  if (selection.kind === "row") return cell.rAbs >= selection.rowStart && cell.rAbs <= selection.rowEnd;
  if (selection.kind === "column") return cell.cAbs >= selection.colStart && cell.cAbs <= selection.colEnd;
  const range = selection.range;
  return cell.rAbs >= range.rowStart && cell.rAbs <= range.rowEnd &&
    cell.cAbs >= range.colStart && cell.cAbs <= range.colEnd;
}

export function getRectDimensions(rect: Rect): { rows: number; cols: number } {
  return {
    rows: rect.rowEnd - rect.rowStart + 1,
    cols: rect.colEnd - rect.colStart + 1,
  };
}
