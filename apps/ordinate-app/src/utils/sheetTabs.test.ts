import { describe, expect, it } from "vitest";

import {
  computeSheetDropIndicator,
  computeSheetMoveTargetGapIndex,
  computeSheetTabAutoScrollDelta,
  nextSheetName,
  type SheetTabRect,
} from "./sheetTabs";

const RECTS: SheetTabRect[] = [
  { sheetName: "A", left: 0, right: 100 },
  { sheetName: "B", left: 108, right: 208 },
  { sheetName: "C", left: 216, right: 316 },
  { sheetName: "D", left: 324, right: 424 },
];

describe("sheet tab helpers", () => {
  it("returns the smallest unused default sheet name", () => {
    expect(nextSheetName([])).toBe("Sheet 1");
    expect(nextSheetName(["Sheet 1", "Sheet 3", "Budget"])).toBe("Sheet 2");
    expect(nextSheetName(["Sheet", "Sheet 1", "Sheet 2"])).toBe("Sheet 3");
  });

  it("maps raw tab gaps to RFC-0035 post-removal target gaps", () => {
    expect(computeSheetMoveTargetGapIndex(1, 0)).toBe(0);
    expect(computeSheetMoveTargetGapIndex(1, 1)).toBe(1);
    expect(computeSheetMoveTargetGapIndex(1, 2)).toBe(1);
    expect(computeSheetMoveTargetGapIndex(1, 4)).toBe(3);
    expect(computeSheetMoveTargetGapIndex(3, 1)).toBe(1);
  });

  it("computes drop indicators for left, right, and edge gaps", () => {
    expect(computeSheetDropIndicator(20, 2, RECTS)).toMatchObject({ targetGapIndex: 0, left: 0 });
    expect(computeSheetDropIndicator(260, 0, RECTS)).toMatchObject({ targetGapIndex: 1, left: 212 });
    expect(computeSheetDropIndicator(500, 1, RECTS)).toMatchObject({ targetGapIndex: 3, left: 424 });
  });

  it("clamps tab drag auto-scroll at strip edges", () => {
    expect(
      computeSheetTabAutoScrollDelta({
        pointerX: 105,
        viewportLeft: 100,
        viewportRight: 400,
        scrollLeft: 80,
        maxScrollLeft: 200,
      }),
    ).toBeLessThan(0);
    expect(
      computeSheetTabAutoScrollDelta({
        pointerX: 395,
        viewportLeft: 100,
        viewportRight: 400,
        scrollLeft: 80,
        maxScrollLeft: 200,
      }),
    ).toBeGreaterThan(0);
    expect(
      computeSheetTabAutoScrollDelta({
        pointerX: 395,
        viewportLeft: 100,
        viewportRight: 400,
        scrollLeft: 200,
        maxScrollLeft: 200,
      }),
    ).toBe(0);
  });
});
