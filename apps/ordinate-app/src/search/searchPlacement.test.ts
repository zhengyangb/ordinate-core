import { describe, expect, it } from "vitest";
import { searchPanelOffset } from "./searchPlacement";

const panel = { left: 400, right: 840, top: 108, bottom: 146 };
describe("floating search placement", () => {
  it("keeps the corner when there is no result or a result lies outside the panel", () => {
    expect(searchPanelOffset(panel, [], 800)).toBe(0);
    expect(searchPanelOffset(panel, [{ left: 10, right: 200, top: 120, bottom: 160 }], 800)).toBe(0);
    expect(searchPanelOffset(panel, [{ left: 500, right: 600, top: 300, bottom: 340 }], 800)).toBe(0);
  });
  it("moves below a frozen header that cannot be scrolled away", () => {
    expect(searchPanelOffset(panel, [{ left: 500, right: 600, top: 130, bottom: 170 }], 800)).toBe(70);
  });
  it("clears all fragments of a merged frozen header", () => {
    expect(searchPanelOffset(panel, [
      { left: 100, right: 410, top: 120, bottom: 160 },
      { left: 410, right: 650, top: 120, bottom: 180 },
    ], 800)).toBe(80);
  });
  it("keeps controls inside short windows", () => {
    expect(searchPanelOffset(panel, [{ left: 500, right: 600, top: 130, bottom: 170 }], 200)).toBe(46);
  });
});
