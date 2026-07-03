export const SHEET_DRAG_START_THRESHOLD_PX = 6;
export const SHEET_TAB_AUTO_SCROLL_EDGE_PX = 36;
export const SHEET_TAB_AUTO_SCROLL_MAX_PX = 18;

export type SheetTabRect = {
  sheetName: string;
  left: number;
  right: number;
};

export type SheetDropIndicator = {
  targetGapIndex: number;
  left: number;
};

export function nextSheetName(existingNames: readonly string[]): string {
  const used = new Set(existingNames);
  for (let index = 1; ; index += 1) {
    const candidate = `Sheet ${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function computeSheetMoveTargetGapIndex(sourceIndex: number, rawGapIndex: number): number {
  assertNonNegativeInteger(sourceIndex, "sourceIndex");
  assertNonNegativeInteger(rawGapIndex, "rawGapIndex");
  if (rawGapIndex === sourceIndex || rawGapIndex === sourceIndex + 1) return sourceIndex;
  return rawGapIndex > sourceIndex ? rawGapIndex - 1 : rawGapIndex;
}

export function computeSheetDropIndicator(
  pointerX: number,
  sourceIndex: number,
  rects: readonly SheetTabRect[],
): SheetDropIndicator {
  assertNonNegativeInteger(sourceIndex, "sourceIndex");
  if (rects.length === 0) {
    throw new Error("sheet drop indicator requires at least one tab rect");
  }
  if (sourceIndex >= rects.length) {
    throw new Error(`sourceIndex ${sourceIndex} out of bounds for ${rects.length} tab rects`);
  }

  let rawGapIndex = rects.length;
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    const center = rect.left + (rect.right - rect.left) / 2;
    if (pointerX < center) {
      rawGapIndex = index;
      break;
    }
  }

  const targetGapIndex = computeSheetMoveTargetGapIndex(sourceIndex, rawGapIndex);
  let indicatorLeft: number;
  if (rawGapIndex === 0) {
    indicatorLeft = rects[0].left;
  } else if (rawGapIndex >= rects.length) {
    indicatorLeft = rects[rects.length - 1].right;
  } else {
    indicatorLeft = (rects[rawGapIndex - 1].right + rects[rawGapIndex].left) / 2;
  }
  return { targetGapIndex, left: indicatorLeft };
}

export function computeSheetTabAutoScrollDelta(args: {
  pointerX: number;
  viewportLeft: number;
  viewportRight: number;
  scrollLeft: number;
  maxScrollLeft: number;
}): number {
  const { pointerX, viewportLeft, viewportRight, scrollLeft, maxScrollLeft } = args;
  assertFiniteNumber(pointerX, "pointerX");
  assertFiniteNumber(viewportLeft, "viewportLeft");
  assertFiniteNumber(viewportRight, "viewportRight");
  assertFiniteNumber(scrollLeft, "scrollLeft");
  assertFiniteNumber(maxScrollLeft, "maxScrollLeft");
  if (viewportRight <= viewportLeft) {
    throw new Error("sheet tab auto-scroll requires a positive viewport width");
  }
  if (scrollLeft < 0 || maxScrollLeft < 0) {
    throw new Error("sheet tab auto-scroll positions must be non-negative");
  }

  const leftDistance = pointerX - viewportLeft;
  const rightDistance = viewportRight - pointerX;
  let rawDelta = 0;
  if (leftDistance < SHEET_TAB_AUTO_SCROLL_EDGE_PX) {
    const ratio = Math.min(1, Math.max(0, (SHEET_TAB_AUTO_SCROLL_EDGE_PX - leftDistance) / SHEET_TAB_AUTO_SCROLL_EDGE_PX));
    rawDelta = -Math.ceil(SHEET_TAB_AUTO_SCROLL_MAX_PX * ratio);
  } else if (rightDistance < SHEET_TAB_AUTO_SCROLL_EDGE_PX) {
    const ratio = Math.min(1, Math.max(0, (SHEET_TAB_AUTO_SCROLL_EDGE_PX - rightDistance) / SHEET_TAB_AUTO_SCROLL_EDGE_PX));
    rawDelta = Math.ceil(SHEET_TAB_AUTO_SCROLL_MAX_PX * ratio);
  }

  if (rawDelta === 0) return 0;
  const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, scrollLeft + rawDelta));
  return nextScrollLeft - scrollLeft;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}
