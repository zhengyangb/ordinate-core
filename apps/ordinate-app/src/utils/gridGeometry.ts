import type { ColumnMetric } from "../types/ui";

const COLUMN_EDGE_EPSILON_PX = 1;

// Keep useful space for data; narrow tables scroll their headers with the body.
const MIN_SCROLLABLE_BODY_WIDTH = 120;

export function resolveFrozenHeaderGeometry(viewportWidth: number, headerWidths: number[]) {
  if (!Number.isFinite(viewportWidth) || viewportWidth < 0 ||
      headerWidths.some((width) => !Number.isFinite(width) || width <= 0)) {
    throw new Error("invalid frozen header geometry");
  }
  const width = headerWidths.reduce((sum, value) => sum + value, 0);
  return viewportWidth >= width + MIN_SCROLLABLE_BODY_WIDTH
    ? { columnCount: headerWidths.length, width }
    : { columnCount: 0, width: 0 };
}

export type ColumnAxisViewport = {
  pinnedWidth: number;
  scrollLeft: number;
};

export type ColumnTrackSpan = {
  left: number;
  right: number;
  width: number;
  center: number;
};

export type ColumnViewportSpan = {
  left: number;
  width: number;
  center: number;
};

export type AppendRowSlot = {
  top: number;
  height: number;
  bottom: number;
};

export type AxisAppendSlot = {
  start: number;
  size: number;
  end: number;
};

export type AppendColumnSlotProjectionInput = {
  centerTrackWidth: number;
  centerViewportWidth: number;
  scrollLeft: number;
  slotSize: number;
  gap: number;
};

export type AppendColumnScrollInput = AppendColumnSlotProjectionInput;

export type AppendColumnSlotProjection = {
  left: number;
  width: number;
  naturalLeft: number;
};

export type TableViewportFootprintInput = {
  pinnedWidth: number;
  centerTrackWidth: number;
  centerViewportWidth: number;
  scrollLeft: number;
  headerTrackHeight: number;
  bodyTrackHeight: number;
  bodyViewportHeight: number;
  bodyScrollTop: number;
};

export type GridScrollSnapshot = {
  top: number;
  left: number;
  centerViewportWidth: number;
  bodyViewportHeight: number;
  hasVerticalOverlap: boolean;
  hasHorizontalOverlap: boolean;
};

export type SheetGridScrollSnapshot = GridScrollSnapshot & {
  sheetName: string | null;
};

export const EMPTY_GRID_SCROLL_SNAPSHOT: SheetGridScrollSnapshot = {
  sheetName: null,
  top: 0,
  left: 0,
  centerViewportWidth: 0,
  bodyViewportHeight: 0,
  hasVerticalOverlap: false,
  hasHorizontalOverlap: false,
};

export type TableViewportFootprintProjection = {
  right: number;
  width: number;
  height: number;
  columnEndVisible: boolean;
  rowEndVisible: boolean;
  trailingCanvas: {
    left: number;
    width: number;
  } | null;
};

export type TableLayerGeometryProjection = {
  centerViewport: {
    left: number;
    width: number;
    right: number;
  };
  centerTrackOffsetX: number;
  bodyTrackOffsetY: number;
  footprint: TableViewportFootprintProjection;
};

export type HorizontalWheelInput = {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
};

export type RailTrackEdgeState = {
  isOrigin: boolean;
  isTerminal: boolean;
};

export function resolveRailTrackEdgeState(itemIndex: number, itemCount: number): RailTrackEdgeState {
  assertNonNegativeInteger(itemIndex, "rail item index");
  if (!Number.isInteger(itemCount) || itemCount <= 0) {
    throw new Error("rail item count must be a positive integer");
  }
  if (itemIndex >= itemCount) {
    throw new Error("rail item index must be inside the track");
  }
  return {
    isOrigin: itemIndex === 0,
    isTerminal: itemIndex === itemCount - 1,
  };
}

export function mergeColumnMetricsWithVisualOverrides(
  baseMetrics: ColumnMetric[],
  visualMetrics: ColumnMetric[],
): ColumnMetric[] {
  const baseByCol = new Set<number>();
  for (const metric of baseMetrics) {
    assertColumnMetric(metric);
    if (baseByCol.has(metric.colIndex)) {
      throw new Error(`duplicate base column metric: ${metric.colIndex}`);
    }
    baseByCol.add(metric.colIndex);
  }

  const visualByCol = new Map<number, ColumnMetric>();
  for (const metric of visualMetrics) {
    assertColumnMetric(metric);
    if (!baseByCol.has(metric.colIndex)) {
      throw new Error(`visual column metric has no base metric: ${metric.colIndex}`);
    }
    if (visualByCol.has(metric.colIndex)) {
      throw new Error(`duplicate visual column metric: ${metric.colIndex}`);
    }
    visualByCol.set(metric.colIndex, metric);
  }

  return baseMetrics.map((metric) => visualByCol.get(metric.colIndex) ?? metric);
}

export function columnViewportXToTrackX(localX: number, viewport: ColumnAxisViewport): number {
  assertFiniteNumber(localX, "localX");
  assertNonNegativeFiniteNumber(viewport.pinnedWidth, "pinnedWidth");
  assertNonNegativeFiniteNumber(viewport.scrollLeft, "scrollLeft");
  if (localX < viewport.pinnedWidth) return localX;
  return localX + viewport.scrollLeft;
}

export function columnTrackXToViewportX(trackX: number, viewport: ColumnAxisViewport): number {
  assertFiniteNumber(trackX, "trackX");
  assertNonNegativeFiniteNumber(viewport.pinnedWidth, "pinnedWidth");
  assertNonNegativeFiniteNumber(viewport.scrollLeft, "scrollLeft");
  if (trackX <= viewport.pinnedWidth) return trackX;
  return Math.max(viewport.pinnedWidth, trackX - viewport.scrollLeft);
}

export function resolveColumnTrackSpan(
  metrics: ColumnMetric[],
  colStart: number,
  colEnd: number,
): ColumnTrackSpan | null {
  assertNonNegativeInteger(colStart, "colStart");
  assertNonNegativeInteger(colEnd, "colEnd");
  const start = Math.min(colStart, colEnd);
  const end = Math.max(colStart, colEnd);
  const selectedColumns = metrics.filter((column) => {
    assertColumnMetric(column);
    return column.colIndex >= start && column.colIndex <= end;
  });
  if (selectedColumns.length !== end - start + 1) return null;
  const left = Math.min(...selectedColumns.map((column) => column.left));
  const right = Math.max(...selectedColumns.map((column) => column.left + column.width));
  return {
    left,
    right,
    width: right - left,
    center: left + (right - left) / 2,
  };
}

export function projectColumnTrackSpanToViewport(
  span: ColumnTrackSpan,
  viewport: ColumnAxisViewport,
): ColumnViewportSpan {
  assertNonNegativeFiniteNumber(span.left, "span.left");
  assertNonNegativeFiniteNumber(span.right, "span.right");
  assertNonNegativeFiniteNumber(span.width, "span.width");
  assertNonNegativeFiniteNumber(span.center, "span.center");
  if (span.right < span.left) {
    throw new Error("span.right must be greater than or equal to span.left");
  }
  const left = columnTrackXToViewportX(span.left, viewport);
  const right = columnTrackXToViewportX(span.right, viewport);
  return {
    left,
    width: Math.max(0, right - left),
    center: columnTrackXToViewportX(span.center, viewport),
  };
}

export function projectColumnTrackSpanToCenterLayer(
  span: ColumnTrackSpan,
  pinnedWidth: number,
): ColumnViewportSpan {
  assertNonNegativeFiniteNumber(span.left, "span.left");
  assertNonNegativeFiniteNumber(span.right, "span.right");
  assertNonNegativeFiniteNumber(span.width, "span.width");
  assertNonNegativeFiniteNumber(span.center, "span.center");
  assertNonNegativeFiniteNumber(pinnedWidth, "pinnedWidth");
  if (span.right < span.left) {
    throw new Error("span.right must be greater than or equal to span.left");
  }
  if (span.left < pinnedWidth - COLUMN_EDGE_EPSILON_PX) {
    throw new Error("center layer column span cannot include pinned columns");
  }
  const left = Math.max(0, span.left - pinnedWidth);
  return {
    left,
    width: span.width,
    center: left + span.width / 2,
  };
}

export function clipColumnTrackSpanToCenterLayer(
  span: ColumnTrackSpan,
  pinnedWidth: number,
): ColumnViewportSpan | null {
  assertNonNegativeFiniteNumber(span.left, "span.left");
  assertNonNegativeFiniteNumber(span.right, "span.right");
  assertNonNegativeFiniteNumber(span.width, "span.width");
  assertNonNegativeFiniteNumber(span.center, "span.center");
  assertNonNegativeFiniteNumber(pinnedWidth, "pinnedWidth");
  if (span.right < span.left) {
    throw new Error("span.right must be greater than or equal to span.left");
  }
  if (span.right <= pinnedWidth) return null;
  const clippedLeft = Math.max(pinnedWidth, span.left);
  const width = span.right - clippedLeft;
  if (width <= 0) return null;
  return {
    left: clippedLeft - pinnedWidth,
    width,
    center: clippedLeft - pinnedWidth + width / 2,
  };
}

export function resolveColumnCenterTrackWidth(metrics: ColumnMetric[], pinnedWidth: number): number {
  assertNonNegativeFiniteNumber(pinnedWidth, "pinnedWidth");
  if (metrics.length === 0) return 0;
  let right = 0;
  const seen = new Set<number>();
  for (const metric of metrics) {
    assertColumnMetric(metric);
    if (seen.has(metric.colIndex)) {
      throw new Error(`duplicate column metric: ${metric.colIndex}`);
    }
    seen.add(metric.colIndex);
    right = Math.max(right, metric.left + metric.width);
  }
  return Math.max(0, right - pinnedWidth);
}

export function resolveAxisAppendSlot(trackExtent: number, size: number, gap: number): AxisAppendSlot {
  assertNonNegativeFiniteNumber(trackExtent, "appendAxis.trackExtent");
  assertPositiveFiniteNumber(size, "appendAxis.size");
  assertNonNegativeFiniteNumber(gap, "appendAxis.gap");
  const start = trackExtent + gap;
  return {
    start,
    size,
    end: start + size,
  };
}

export function resolveAppendRowSlot(trackHeight: number, height: number, gap: number): AppendRowSlot {
  assertNonNegativeFiniteNumber(trackHeight, "appendRow.trackHeight");
  assertPositiveFiniteNumber(height, "appendRow.height");
  assertNonNegativeFiniteNumber(gap, "appendRow.gap");
  const slot = resolveAxisAppendSlot(trackHeight, height, gap);
  return {
    top: slot.start,
    height: slot.size,
    bottom: slot.end,
  };
}

export function resolveAppendColumnProjectionScrollLeft(input: AppendColumnScrollInput): number {
  assertNonNegativeFiniteNumber(input.centerTrackWidth, "appendColumn.centerTrackWidth");
  assertNonNegativeFiniteNumber(input.centerViewportWidth, "appendColumn.centerViewportWidth");
  assertNonNegativeFiniteNumber(input.scrollLeft, "appendColumn.scrollLeft");
  assertPositiveFiniteNumber(input.slotSize, "appendColumn.slotSize");
  assertNonNegativeFiniteNumber(input.gap, "appendColumn.gap");
  if (input.centerViewportWidth <= 0) return 0;
  const slot = resolveAxisAppendSlot(input.centerTrackWidth, input.slotSize, input.gap);
  const maxScrollLeft = Math.max(0, slot.end - input.centerViewportWidth);
  return Math.min(input.scrollLeft, maxScrollLeft);
}

export function projectAppendColumnSlotToViewport(
  input: AppendColumnSlotProjectionInput,
): AppendColumnSlotProjection | null {
  assertNonNegativeFiniteNumber(input.centerTrackWidth, "appendColumn.centerTrackWidth");
  assertNonNegativeFiniteNumber(input.centerViewportWidth, "appendColumn.centerViewportWidth");
  assertNonNegativeFiniteNumber(input.scrollLeft, "appendColumn.scrollLeft");
  assertPositiveFiniteNumber(input.slotSize, "appendColumn.slotSize");
  assertNonNegativeFiniteNumber(input.gap, "appendColumn.gap");
  if (input.centerViewportWidth <= 0) return null;

  const slot = resolveAxisAppendSlot(input.centerTrackWidth, input.slotSize, input.gap);
  const realTrackMaxScrollLeft = Math.max(0, input.centerTrackWidth - input.centerViewportWidth);
  const maxScrollLeft = Math.max(0, slot.end - input.centerViewportWidth);
  if (input.scrollLeft > maxScrollLeft + COLUMN_EDGE_EPSILON_PX) {
    throw new Error("appendColumn.scrollLeft exceeds the append chrome scroll range");
  }
  const realTrackEdgeIsVisible = input.scrollLeft >= realTrackMaxScrollLeft - COLUMN_EDGE_EPSILON_PX;
  if (input.centerTrackWidth > input.centerViewportWidth + COLUMN_EDGE_EPSILON_PX && !realTrackEdgeIsVisible) {
    return null;
  }

  const naturalLeft = slot.start - input.scrollLeft;
  if (naturalLeft + slot.size > input.centerViewportWidth + COLUMN_EDGE_EPSILON_PX) {
    return null;
  }
  return {
    left: naturalLeft,
    width: input.slotSize,
    naturalLeft,
  };
}

export function projectTableViewportFootprint(
  input: TableViewportFootprintInput,
): TableViewportFootprintProjection {
  assertNonNegativeFiniteNumber(input.pinnedWidth, "tableFootprint.pinnedWidth");
  assertNonNegativeFiniteNumber(input.centerTrackWidth, "tableFootprint.centerTrackWidth");
  assertNonNegativeFiniteNumber(input.centerViewportWidth, "tableFootprint.centerViewportWidth");
  assertNonNegativeFiniteNumber(input.scrollLeft, "tableFootprint.scrollLeft");
  assertNonNegativeFiniteNumber(input.headerTrackHeight, "tableFootprint.headerTrackHeight");
  assertNonNegativeFiniteNumber(input.bodyTrackHeight, "tableFootprint.bodyTrackHeight");
  assertNonNegativeFiniteNumber(input.bodyViewportHeight, "tableFootprint.bodyViewportHeight");
  assertNonNegativeFiniteNumber(input.bodyScrollTop, "tableFootprint.bodyScrollTop");
  const viewportWidth = input.pinnedWidth + input.centerViewportWidth;
  const visibleCenterTrackWidth = Math.max(
    0,
    Math.min(input.centerViewportWidth, input.centerTrackWidth - input.scrollLeft),
  );
  const right = Math.min(viewportWidth, input.pinnedWidth + visibleCenterTrackWidth);
  const trailingWidth = Math.max(0, viewportWidth - right);
  const visibleBodyTrackHeight = Math.max(
    0,
    Math.min(input.bodyViewportHeight, input.bodyTrackHeight - input.bodyScrollTop),
  );
  const trackHeight = input.headerTrackHeight + visibleBodyTrackHeight;
  const height = trackHeight > 0 ? trackHeight + 1 : 0;
  const columnEndVisible =
    input.scrollLeft + input.centerViewportWidth >= input.centerTrackWidth - COLUMN_EDGE_EPSILON_PX;
  const rowEndVisible =
    input.bodyScrollTop + input.bodyViewportHeight >= input.bodyTrackHeight - COLUMN_EDGE_EPSILON_PX;
  return {
    right,
    width: right,
    height,
    columnEndVisible,
    rowEndVisible,
    trailingCanvas:
      trailingWidth > COLUMN_EDGE_EPSILON_PX
        ? {
            left: right,
            width: trailingWidth,
          }
        : null,
  };
}

export function projectTableLayerGeometry(
  input: TableViewportFootprintInput,
): TableLayerGeometryProjection {
  const footprint = projectTableViewportFootprint(input);
  return {
    centerViewport: {
      left: input.pinnedWidth,
      width: input.centerViewportWidth,
      right: input.pinnedWidth + input.centerViewportWidth,
    },
    centerTrackOffsetX: -input.scrollLeft,
    bodyTrackOffsetY: -input.bodyScrollTop,
    footprint,
  };
}

export function gridScrollSnapshotEqual(
  a: SheetGridScrollSnapshot,
  b: SheetGridScrollSnapshot,
): boolean {
  return (
    a.sheetName === b.sheetName &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.centerViewportWidth - b.centerViewportWidth) < 0.5 &&
    Math.abs(a.bodyViewportHeight - b.bodyViewportHeight) < 0.5 &&
    a.hasVerticalOverlap === b.hasVerticalOverlap &&
    a.hasHorizontalOverlap === b.hasHorizontalOverlap
  );
}

export function projectActiveSheetGridScrollSnapshot(input: {
  activeSheet: string | null;
  snapshot: SheetGridScrollSnapshot;
  centerTrackWidth: number;
  appendSlotSize: number;
  appendGap: number;
}): GridScrollSnapshot {
  const snapshot = input.snapshot.sheetName === input.activeSheet
    ? input.snapshot
    : EMPTY_GRID_SCROLL_SNAPSHOT;
  const left = resolveAppendColumnProjectionScrollLeft({
    centerTrackWidth: input.centerTrackWidth,
    centerViewportWidth: snapshot.centerViewportWidth,
    scrollLeft: snapshot.left,
    slotSize: input.appendSlotSize,
    gap: input.appendGap,
  });
  return {
    top: snapshot.top,
    left,
    centerViewportWidth: snapshot.centerViewportWidth,
    bodyViewportHeight: snapshot.bodyViewportHeight,
    hasVerticalOverlap: snapshot.hasVerticalOverlap,
    hasHorizontalOverlap: left > 0.5,
  };
}

export function resolveHorizontalWheelDelta(input: HorizontalWheelInput): number {
  assertFiniteNumber(input.deltaX, "wheel.deltaX");
  assertFiniteNumber(input.deltaY, "wheel.deltaY");
  if (Math.abs(input.deltaX) > 0) return input.deltaX;
  if (input.shiftKey && Math.abs(input.deltaY) > 0) return input.deltaY;
  return 0;
}

export function bodyRowTrackYToViewportY(trackY: number, headerOverlayHeight: number, scrollTop: number): number {
  assertFiniteNumber(trackY, "trackY");
  assertNonNegativeFiniteNumber(headerOverlayHeight, "headerOverlayHeight");
  assertNonNegativeFiniteNumber(scrollTop, "scrollTop");
  return headerOverlayHeight + trackY - scrollTop;
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertNonNegativeFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function assertPositiveFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertColumnMetric(metric: ColumnMetric): void {
  assertNonNegativeInteger(metric.colIndex, "column.colIndex");
  assertNonNegativeFiniteNumber(metric.left, "column.left");
  assertPositiveFiniteNumber(metric.width, "column.width");
}
