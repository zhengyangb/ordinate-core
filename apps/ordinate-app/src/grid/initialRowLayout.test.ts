import { afterEach, describe, expect, it, vi } from "vitest";
import { renderedRowsFitContent, waitForInitialRowLayout } from "./initialRowLayout";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const row = { offsetHeight: 38 };
  const wrapper = { offsetHeight: 40 };
  const cell = { closest: () => row, querySelector: () => wrapper };
  const root = {
    querySelectorAll: () => [cell], isConnected: true,
    ownerDocument: { fonts: { ready: Promise.resolve() } },
  } as unknown as HTMLElement;
  vi.stubGlobal("getComputedStyle", () => ({
    paddingTop: "8px", paddingBottom: "8px", borderTopWidth: "1px", borderBottomWidth: "1px",
  }));
  return { root, row, wrapper };
}

describe("initial wrapped row layout", () => {
  it("waits for the real wrapped content height, including cell insets", () => {
    const { root, row, wrapper } = fixture();
    expect(renderedRowsFitContent(root)).toBe(false);
    row.offsetHeight = 58;
    expect(renderedRowsFitContent(root)).toBe(true);
    wrapper.offsetHeight = 60;
    expect(renderedRowsFitContent(root)).toBe(false);
    row.offsetHeight = 78;
    expect(renderedRowsFitContent(root)).toBe(true);
  });

  it("reveals once after fonts and row measurement, then stops checking", async () => {
    const { root, row } = fixture();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const ready = vi.fn();
    waitForInitialRowLayout(root, ready);
    expect(frames).toHaveLength(0);
    await Promise.resolve();
    frames.shift()!(0);
    expect(ready).not.toHaveBeenCalled();
    row.offsetHeight = 58;
    frames.shift()!(16);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
  });

  it("never reveals a cancelled sheet while font loading finishes", async () => {
    const { root } = fixture();
    const schedule = vi.fn();
    vi.stubGlobal("requestAnimationFrame", schedule);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const ready = vi.fn();
    waitForInitialRowLayout(root, ready)();
    await Promise.resolve();
    expect(schedule).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it("fails early if the grid's auto-height DOM contract changes", () => {
    fixture();
    const root = { querySelectorAll: () => [{ closest: () => null, querySelector: () => null }] } as unknown as HTMLElement;
    expect(() => renderedRowsFitContent(root)).toThrow("missing its row or content wrapper");
  });
});
