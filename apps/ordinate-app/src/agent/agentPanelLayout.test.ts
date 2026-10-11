import { describe, expect, it } from "vitest";
import { assistantWidthLimits, clampAssistantWidth } from "./agentPanelLayout";

describe("assistant panel width", () => {
  it("keeps enough room for the editor while allowing a wide conversation", () => {
    expect(assistantWidthLimits(1100)).toEqual({ min: 320, max: 720 });
    expect(assistantWidthLimits(800)).toEqual({ min: 320, max: 460 });
    expect(clampAssistantWidth(510, 800)).toBe(460);
  });

  it("clamps drags and keyboard steps at both ends", () => {
    expect(clampAssistantWidth(250, 1100)).toBe(320);
    expect(clampAssistantWidth(485.6, 1100)).toBe(486);
    expect(clampAssistantWidth(900, 1100)).toBe(720);
  });

  it("rejects invalid layout measurements", () => {
    expect(() => assistantWidthLimits(0)).toThrow("Assistant workspace width");
    expect(() => clampAssistantWidth(Number.NaN, 1000)).toThrow("Assistant width");
  });
});
