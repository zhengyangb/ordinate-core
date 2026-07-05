import type { ColumnMetric } from "../types/ui";

const COLUMN_EDGE_EPSILON_PX = 1;

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

export type HorizontalWheelInput = {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
};

export type AppendColumnControlVisibilityInput = {
  centerTrackWidth: number;
  centerViewportWidth: number;
  scrollLeft: number;
};

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

export function resolveAppendRowSlot(trackHeight: number, height: number): AppendRowSlot {
  assertNonNegativeFiniteNumber(trackHeight, "appendRow.trackHeight");
  assertPositiveFiniteNumber(height, "appendRow.height");
  return {
    top: trackHeight,
    height,
    bottom: trackHeight + height,
  };
}

export function resolveHorizontalWheelDelta(input: HorizontalWheelInput): number {
  assertFiniteNumber(input.deltaX, "wheel.deltaX");
  assertFiniteNumber(input.deltaY, "wheel.deltaY");
  if (Math.abs(input.deltaX) > 0) return input.deltaX;
  if (input.shiftKey && Math.abs(input.deltaY) > 0) return input.deltaY;
  return 0;
}

export function shouldShowAppendColumnControl(input: AppendColumnControlVisibilityInput): boolean {
  assertNonNegativeFiniteNumber(input.centerTrackWidth, "appendColumn.centerTrackWidth");
  assertNonNegativeFiniteNumber(input.centerViewportWidth, "appendColumn.centerViewportWidth");
  assertNonNegativeFiniteNumber(input.scrollLeft, "appendColumn.scrollLeft");
  if (input.centerTrackWidth <= 0 || input.centerViewportWidth <= 0) return false;
  if (input.centerTrackWidth <= input.centerViewportWidth + COLUMN_EDGE_EPSILON_PX) return true;
  return input.scrollLeft >= input.centerTrackWidth - input.centerViewportWidth - COLUMN_EDGE_EPSILON_PX;
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
