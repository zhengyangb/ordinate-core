import { describe, expect, it } from "vitest";

import {
  computeQuickAddDragCount,
  hasQuickAddDragThreshold,
  resolveAppendAnchorScrollPosition,
  resolveAppendAnchorScrollPositionAfterSizeChange,
  resolveAppendEndScrollPosition,
} from "./quickAddControls";

describe("quick add controls", () => {
  it("cancels a drag at the origin and adds one for short forward drags", () => {
    expect(computeQuickAddDragCount({ axis: "row", startX: 0, startY: 0, currentX: 0, currentY: 0 })).toBe(0);
    expect(computeQuickAddDragCount({ axis: "column", startX: 0, startY: 0, currentX: 7, currentY: 0 })).toBe(1);
  });

  it("keeps click and drag intent separated by a movement threshold", () => {
    expect(hasQuickAddDragThreshold({ axis: "row", startX: 0, startY: 0, currentX: 20, currentY: 7 })).toBe(false);
    expect(hasQuickAddDragThreshold({ axis: "row", startX: 0, startY: 0, currentX: 0, currentY: 8 })).toBe(true);
    expect(hasQuickAddDragThreshold({ axis: "column", startX: 0, startY: 0, currentX: -7, currentY: 20 })).toBe(false);
    expect(hasQuickAddDragThreshold({ axis: "column", startX: 0, startY: 0, currentX: -8, currentY: 0 })).toBe(true);
  });

  it("maps row and column drag distance to an insert count", () => {
    expect(computeQuickAddDragCount({ axis: "row", startX: 0, startY: 10, currentX: 0, currentY: 54, stepPx: 22 })).toBe(3);
    expect(computeQuickAddDragCount({ axis: "column", startX: 10, startY: 0, currentX: 54, currentY: 0, stepPx: 22 })).toBe(3);
  });

  it("does not insert when dragging backwards on either axis", () => {
    expect(computeQuickAddDragCount({ axis: "row", startX: 0, startY: 54, currentX: 0, currentY: 10, stepPx: 22 })).toBe(0);
    expect(computeQuickAddDragCount({ axis: "column", startX: 54, startY: 0, currentX: 10, currentY: 0, stepPx: 22 })).toBe(0);
  });

  it.each(["row", "column"] as const)("shrinks the %s preview back to zero at the origin", axis => {
    const counts = [88, 44, 1, 0, -44].map(distance => computeQuickAddDragCount({
      axis, startX: 0, startY: 0,
      currentX: axis === "column" ? distance : 0,
      currentY: axis === "row" ? distance : 0,
    }));
    expect(counts).toEqual([3, 2, 1, 0, 0]);
  });

  it("clamps large drags", () => {
    expect(computeQuickAddDragCount({ axis: "row", startX: 0, startY: 100, currentX: 0, currentY: 1000, stepPx: 10, maxCount: 5 })).toBe(5);
    expect(computeQuickAddDragCount({ axis: "column", startX: 0, startY: 0, currentX: 1000, currentY: 0, stepPx: 10, maxCount: 5 })).toBe(5);
  });

  it("preserves append-control screen position by advancing scroll after row inserts", () => {
    expect(resolveAppendAnchorScrollPosition({
      scrollPosition: 240,
      insertedExtent: 38,
      scrollSize: 900,
      viewportSize: 420,
    })).toBe(278);
  });

  it("clamps append-control scroll anchoring at the viewport limit", () => {
    expect(resolveAppendAnchorScrollPosition({
      scrollPosition: 460,
      insertedExtent: 76,
      scrollSize: 900,
      viewportSize: 420,
    })).toBe(480);
  });

  it("waits for row append scroll size growth before consuming an anchor", () => {
    expect(resolveAppendAnchorScrollPositionAfterSizeChange({
      scrollPosition: 460,
      previousScrollSize: 900,
      nextScrollSize: 900,
      viewportSize: 420,
    })).toBeNull();
  });

  it("anchors repeated row appends using the actual scroll size delta", () => {
    expect(resolveAppendAnchorScrollPositionAfterSizeChange({
      scrollPosition: 480,
      previousScrollSize: 900,
      nextScrollSize: 938,
      viewportSize: 420,
    })).toBe(518);
    expect(resolveAppendAnchorScrollPositionAfterSizeChange({
      scrollPosition: 518,
      previousScrollSize: 938,
      nextScrollSize: 976,
      viewportSize: 420,
    })).toBe(556);
  });

  it("resolves the end scroll position for append columns", () => {
    expect(resolveAppendEndScrollPosition({ scrollSize: 1140, viewportSize: 420 })).toBe(720);
    expect(resolveAppendEndScrollPosition({ scrollSize: 320, viewportSize: 420 })).toBe(0);
  });

  it("fails early for invalid geometry", () => {
    expect(() =>
      computeQuickAddDragCount({ axis: "row", startX: 0, startY: 0, currentX: 0, currentY: Number.NaN }),
    ).toThrow("currentY must be finite");
    expect(() =>
      computeQuickAddDragCount({ axis: "column", startX: 0, startY: 0, currentX: 0, currentY: 0, stepPx: 0 }),
    ).toThrow("stepPx must be positive");
    expect(() =>
      hasQuickAddDragThreshold({ axis: "row", startX: 0, startY: 0, currentX: 0, currentY: 0, thresholdPx: 0 }),
    ).toThrow("thresholdPx must be positive");
    expect(() =>
      resolveAppendAnchorScrollPosition({ scrollPosition: -1, insertedExtent: 0, scrollSize: 100, viewportSize: 50 }),
    ).toThrow("scrollPosition must be non-negative");
    expect(() =>
      resolveAppendAnchorScrollPositionAfterSizeChange({ scrollPosition: 0, previousScrollSize: -1, nextScrollSize: 100, viewportSize: 50 }),
    ).toThrow("previousScrollSize must be non-negative");
    expect(() =>
      resolveAppendEndScrollPosition({ scrollSize: Number.NaN, viewportSize: 50 }),
    ).toThrow("scrollSize must be non-negative");
  });
});
