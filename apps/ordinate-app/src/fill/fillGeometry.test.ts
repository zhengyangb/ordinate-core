import { describe, expect, it } from "vitest";
import { fillDestination, fillDirection, isFillRange, unionFill } from "./fillGeometry";
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
  it("uses document bounds regardless of visibility, but rejects headers and overflow", () => {
    expect(isFillRange(source, 2, 1, 5, 3)).toBe(true);
    expect(isFillRange(source, 3, 1, 5, 3)).toBe(false);
    expect(isFillRange(source, 2, 2, 5, 3)).toBe(false);
    expect(isFillRange(source, 2, 1, 3, 3)).toBe(false);
    expect(isFillRange(source, 2, 1, 5, 2)).toBe(false);
  });
  it("selects the union after a reverse fill", () => {
    expect(unionFill(source, { ...source, rowStart: 1, rowEnd: 2 })).toEqual({ ...source, rowStart: 1 });
  });
});
