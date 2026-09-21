import { describe, expect, it } from "vitest";
import { fillDestination, fillDirection, isVisibleFillRange, unionFill } from "./fillGeometry";
const source = { rowStart: 3, rowEnd: 4, colStart: 1, colEnd: 2 };
describe("fill gesture geometry", () => {
  it("propagates feedback from the source edge in all four directions", () => {
    expect(fillDirection(source, { ...source, rowStart: 5, rowEnd: 6 })).toBe("down");
    expect(fillDirection(source, { ...source, rowStart: 1, rowEnd: 2 })).toBe("up");
    expect(fillDirection(source, { ...source, colStart: 3, colEnd: 4 })).toBe("right");
    expect(fillDirection(source, { ...source, colStart: 0, colEnd: 0 })).toBe("left");
    expect(() => fillDirection(source, source)).toThrow("adjacent");
  });
  it("keeps the seed unchanged and locks to one axis", () => {
    expect(fillDestination(source, { rAbs: 4, cAbs: 1 })).toBeNull();
    expect(fillDestination(source, { rAbs: 7, cAbs: 3 })).toEqual({ ...source, rowStart: 5, rowEnd: 7 });
    expect(fillDestination(source, { rAbs: 2, cAbs: 6 })).toEqual({ ...source, colStart: 3, colEnd: 6 });
    expect(fillDestination(source, { rAbs: 1, cAbs: 1 })).toEqual({ ...source, rowStart: 1, rowEnd: 2 });
    expect(fillDestination(source, { rAbs: 3, cAbs: 0 })).toEqual({ ...source, colStart: 0, colEnd: 0 });
  });
  it("rejects hidden rows and header labels", () => {
    expect(isVisibleFillRange(source, 2, 1, new Set([3, 4]))).toBe(true);
    expect(isVisibleFillRange(source, 2, 1, new Set([3, 5]))).toBe(false);
    expect(isVisibleFillRange(source, 3, 1, new Set([3, 4]))).toBe(false);
    expect(isVisibleFillRange(source, 2, 2, new Set([3, 4]))).toBe(false);
  });
  it("selects the union after a reverse fill", () => {
    expect(unionFill(source, { ...source, rowStart: 1, rowEnd: 2 })).toEqual({ ...source, rowStart: 1 });
  });
});
