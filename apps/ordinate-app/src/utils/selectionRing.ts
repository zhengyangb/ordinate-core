import type { ColumnMetric, HeaderIndexMetric, Rect, RowIndexMetric } from "../types/ui";

export type SelectionOverlayPlane =
  | "header-pinned"
  | "header-center"
  | "body-pinned"
  | "body-center";

export type SelectionOverlayFragment = {
  plane: SelectionOverlayPlane;
  left: number;
  top: number;
  width: number;
  height: number;
};

type SelectionOverlayProjectionInput = {
  range: Rect;
  headerRowCount: number;
  headerColCount: number;
  pinnedWidth: number;
  columnMetrics: ColumnMetric[];
  headerIndexMetrics: HeaderIndexMetric[];
  rowIndexMetrics: RowIndexMetric[];
};

type AxisSegment = {
  start: number;
  end: number;
  pinned: boolean;
};

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertNormalizedRange(range: Rect): void {
  for (const [name, value] of Object.entries(range)) {
    assertNonNegativeInteger(value, `selection overlay ${name}`);
  }
  if (range.rowStart > range.rowEnd || range.colStart > range.colEnd) {
    throw new Error("selection overlay range must be normalized");
  }
}

function splitAxis(start: number, end: number, boundary: number): AxisSegment[] {
  const segments: AxisSegment[] = [];
  if (start < boundary) {
    segments.push({ start, end: Math.min(end, boundary - 1), pinned: true });
  }
  if (end >= boundary) {
    segments.push({ start: Math.max(start, boundary), end, pinned: false });
  }
  return segments;
}

function resolveColumnRect(
  segment: AxisSegment,
  metricsByIndex: Map<number, ColumnMetric>,
  pinnedWidth: number,
): { left: number; width: number } | null {
  const first = metricsByIndex.get(segment.start);
  const last = metricsByIndex.get(segment.end);
  if (!first || !last) return null;
  const right = last.left + last.width;
  return {
    left: first.left - (segment.pinned ? 0 : pinnedWidth),
    width: right - first.left,
  };
}

function resolveRowRect(
  segment: AxisSegment,
  headerMetricsByNumber: Map<number, HeaderIndexMetric>,
  bodyMetricsByNumber: Map<number, RowIndexMetric>,
): { top: number; height: number } | null {
  const metrics = segment.pinned ? headerMetricsByNumber : bodyMetricsByNumber;
  const first = metrics.get(segment.start);
  const last = metrics.get(segment.end);
  if (!first || !last) return null;
  const bottom = last.top + last.height;
  return {
    top: first.top,
    height: bottom - first.top,
  };
}

export function resolveSelectionOverlayPlane(
  area: "header" | "body",
  colIndex: number,
  headerColCount: number,
): SelectionOverlayPlane {
  assertNonNegativeInteger(colIndex, "selection overlay column index");
  assertNonNegativeInteger(headerColCount, "selection overlay header column count");
  const columnPlane = colIndex < headerColCount ? "pinned" : "center";
  return `${area}-${columnPlane}`;
}

export function projectSelectionOverlayFragments(
  input: SelectionOverlayProjectionInput,
): SelectionOverlayFragment[] {
  assertNormalizedRange(input.range);
  assertNonNegativeInteger(input.headerRowCount, "selection overlay header row count");
  assertNonNegativeInteger(input.headerColCount, "selection overlay header column count");
  if (!Number.isFinite(input.pinnedWidth) || input.pinnedWidth < 0) {
    throw new Error("selection overlay pinned width must be a non-negative finite number");
  }

  const columnsByIndex = new Map<number, ColumnMetric>();
  for (const metric of input.columnMetrics) {
    if (columnsByIndex.has(metric.colIndex)) {
      throw new Error(`duplicate selection overlay column metric: ${metric.colIndex}`);
    }
    columnsByIndex.set(metric.colIndex, metric);
  }
  const headerRowsByNumber = new Map(input.headerIndexMetrics.map((metric) => [metric.number, metric]));
  const bodyRowsByNumber = new Map(input.rowIndexMetrics.map((metric) => [metric.number, metric]));
  const rowSegments = splitAxis(input.range.rowStart, input.range.rowEnd, input.headerRowCount + 1);
  const columnSegments = splitAxis(input.range.colStart, input.range.colEnd, input.headerColCount);
  const fragments: SelectionOverlayFragment[] = [];

  for (const rowSegment of rowSegments) {
    const rowRect = resolveRowRect(rowSegment, headerRowsByNumber, bodyRowsByNumber);
    if (!rowRect) continue;
    for (const columnSegment of columnSegments) {
      const columnRect = resolveColumnRect(columnSegment, columnsByIndex, input.pinnedWidth);
      if (!columnRect) continue;
      fragments.push({
        plane: `${rowSegment.pinned ? "header" : "body"}-${columnSegment.pinned ? "pinned" : "center"}`,
        ...columnRect,
        ...rowRect,
      });
    }
  }

  return fragments;
}
