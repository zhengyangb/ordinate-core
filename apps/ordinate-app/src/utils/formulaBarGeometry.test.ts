import { describe, expect, it } from "vitest";
import { formulaBarSurfaceFrames } from "./formulaBarGeometry";

describe("formula bar surface geometry", () => {
  it.each([[56, 90], [56, 180], [180, 56]])("keeps circular 28px corners from %i to %i", (from, to) => {
    const frames = formulaBarSurfaceFrames(from, to, 28);
    expect(frames[0].transform).toBe(`scaleY(${from / to})`);
    expect(frames[frames.length - 1].transform).toBe("scaleY(1)");
    for (const frame of frames) {
      const scale = Number(String(frame.transform).slice(7, -1));
      const [horizontal, vertical] = String(frame.borderRadius).split(" / ").map(Number.parseFloat);
      expect(horizontal).toBe(28);
      expect(vertical * scale).toBeCloseTo(28);
    }
  });
  it("rejects invalid measurements", () => {
    expect(() => formulaBarSurfaceFrames(0, 56, 28)).toThrow();
  });
});
