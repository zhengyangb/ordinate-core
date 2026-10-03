import { describe, expect, it } from "vitest";
import { tooltipPosition } from "./tooltipPosition";

const viewport = { width: 1000, height: 700 };
describe("measured tooltip placement", () => {
  it("centers a short tooltip over a native toolbar button near the left edge", () => {
    expect(tooltipPosition({ left: 90, width: 30, top: 5, bottom: 35 }, { width: 80, height: 30 }, viewport))
      .toEqual({ left: 105, top: 43, placement: "below" });
  });
  it("only shifts as far as needed at either viewport edge", () => {
    expect(tooltipPosition({ left: 0, width: 30, top: 5, bottom: 35 }, { width: 200, height: 30 }, viewport).left).toBe(110);
    expect(tooltipPosition({ left: 970, width: 30, top: 5, bottom: 35 }, { width: 200, height: 30 }, viewport).left).toBe(890);
  });
  it("uses the actual wrapped height to place a tooltip above a bottom control", () => {
    expect(tooltipPosition({ left: 400, width: 30, top: 620, bottom: 650 }, { width: 200, height: 80 }, viewport))
      .toEqual({ left: 415, top: 612, placement: "above" });
  });
});
