import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readChromeColor } from "./useWindowAppearance";

const context = { fillStyle: "", fillRect: vi.fn(), getImageData: vi.fn() };
beforeEach(() => {
  vi.stubGlobal("document", { documentElement: {}, createElement: () => ({ getContext: () => context }) });
  vi.stubGlobal("CSS", { supports: () => true });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "oklch(23% 0.008 100)" }));
  context.getImageData.mockReturnValue({ data: [31, 30, 26, 255] });
});
afterEach(() => vi.unstubAllGlobals());

it("converts the shared CSS token into native sRGB without a second palette", () => {
  expect(readChromeColor()).toBe("#1f1e1a");
  expect(context.fillStyle).toBe("oklch(23% 0.008 100)");
});
it("rejects translucent chrome instead of silently compositing a different background", () => {
  context.getImageData.mockReturnValue({ data: [31, 30, 26, 234] });
  expect(() => readChromeColor()).toThrow("opaque background token");
});
it("rejects a missing token", () => {
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  expect(() => readChromeColor()).toThrow("Missing or invalid");
});
