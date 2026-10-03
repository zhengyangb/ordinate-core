export const QUICK_ADD_DRAG_THRESHOLD_PX = 8;
export const QUICK_ADD_DRAG_SCALE_PX = { row: 72, column: 112 } as const;
const QUICK_ADD_ACCELERATION = 1.7;
export const QUICK_ADD_MAX_BATCH_COUNT = 50;

export type QuickAddAxis = "row" | "column";

export function hasQuickAddDragThreshold(args: {
  axis: QuickAddAxis;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  thresholdPx?: number;
}): boolean {
  const { axis, startX, startY, currentX, currentY, thresholdPx = QUICK_ADD_DRAG_THRESHOLD_PX } = args;
  assertFiniteNumber(startX, "startX");
  assertFiniteNumber(startY, "startY");
  assertFiniteNumber(currentX, "currentX");
  assertFiniteNumber(currentY, "currentY");
  assertPositiveFiniteNumber(thresholdPx, "thresholdPx");
  const distance = axis === "row" ? Math.abs(currentY - startY) : Math.abs(currentX - startX);
  return distance >= thresholdPx;
}

export function computeQuickAddDragCount(args: {
  axis: QuickAddAxis;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  maxCount?: number;
}): number {
  const {
    axis,
    startX,
    startY,
    currentX,
    currentY,
    maxCount = QUICK_ADD_MAX_BATCH_COUNT,
  } = args;
  assertFiniteNumber(startX, "startX");
  assertFiniteNumber(startY, "startY");
  assertFiniteNumber(currentX, "currentX");
  assertFiniteNumber(currentY, "currentY");
  assertPositiveInteger(maxCount, "maxCount");
  const distance = axis === "row" ? currentY - startY : currentX - startX;
  if (distance <= 0) return 0;
  // A generous first step makes one/two additions deliberate. Further travel
  // accelerates smoothly; count depends only on displacement, so reversing is
  // predictable and never keeps adding because of pointer speed or duration.
  const progress = distance / QUICK_ADD_DRAG_SCALE_PX[axis];
  return Math.min(maxCount, Math.floor(progress ** QUICK_ADD_ACCELERATION) + 1);
}

export function resolveAppendAnchorScrollPosition(args: {
  scrollPosition: number;
  insertedExtent: number;
  scrollSize: number;
  viewportSize: number;
}): number {
  const { scrollPosition, insertedExtent, scrollSize, viewportSize } = args;
  assertNonNegativeFiniteNumber(scrollPosition, "scrollPosition");
  assertNonNegativeFiniteNumber(insertedExtent, "insertedExtent");
  assertNonNegativeFiniteNumber(scrollSize, "scrollSize");
  assertNonNegativeFiniteNumber(viewportSize, "viewportSize");
  const maxScrollPosition = Math.max(0, scrollSize - viewportSize);
  return Math.min(maxScrollPosition, scrollPosition + insertedExtent);
}

export function resolveAppendAnchorScrollPositionAfterSizeChange(args: {
  scrollPosition: number;
  previousScrollSize: number;
  nextScrollSize: number;
  viewportSize: number;
}): number | null {
  const { scrollPosition, previousScrollSize, nextScrollSize, viewportSize } = args;
  assertNonNegativeFiniteNumber(scrollPosition, "scrollPosition");
  assertNonNegativeFiniteNumber(previousScrollSize, "previousScrollSize");
  assertNonNegativeFiniteNumber(nextScrollSize, "nextScrollSize");
  assertNonNegativeFiniteNumber(viewportSize, "viewportSize");
  if (nextScrollSize <= previousScrollSize) return null;
  return resolveAppendAnchorScrollPosition({
    scrollPosition,
    insertedExtent: nextScrollSize - previousScrollSize,
    scrollSize: nextScrollSize,
    viewportSize,
  });
}

export function resolveAppendEndScrollPosition(args: {
  scrollSize: number;
  viewportSize: number;
}): number {
  const { scrollSize, viewportSize } = args;
  assertNonNegativeFiniteNumber(scrollSize, "scrollSize");
  assertNonNegativeFiniteNumber(viewportSize, "viewportSize");
  return Math.max(0, scrollSize - viewportSize);
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function assertPositiveFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive`);
  }
}

function assertNonNegativeFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be non-negative`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}
