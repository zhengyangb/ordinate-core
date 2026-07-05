import { describe, expect, it } from "vitest";

import { computeQuickAddDragCount, hasQuickAddDragThreshold } from "./quickAddControls";

describe("quick add controls", () => {
  it("uses one insert for clicks and short drags", () => {
    expect(computeQuickAddDragCount({ axis: "row", startX: 0, startY: 0, currentX: 0, currentY: 0 })).toBe(1);
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

  it("lets edge controls count drags in either axis direction", () => {
    expect(computeQuickAddDragCount({ axis: "row", startX: 0, startY: 54, currentX: 0, currentY: 10, stepPx: 22 })).toBe(3);
    expect(computeQuickAddDragCount({ axis: "column", startX: 54, startY: 0, currentX: 10, currentY: 0, stepPx: 22 })).toBe(3);
  });

  it("clamps large drags", () => {
    expect(computeQuickAddDragCount({ axis: "row", startX: 0, startY: 100, currentX: 0, currentY: -1000, stepPx: 10, maxCount: 5 })).toBe(5);
    expect(computeQuickAddDragCount({ axis: "column", startX: 0, startY: 0, currentX: 1000, currentY: 0, stepPx: 10, maxCount: 5 })).toBe(5);
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
  });
});
