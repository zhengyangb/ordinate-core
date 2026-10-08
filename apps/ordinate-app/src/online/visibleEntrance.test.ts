import { afterEach, describe, expect, it, vi } from "vitest";
import { afterVisiblePause } from "./visibleEntrance";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture(visible = true) {
  vi.useFakeTimers();
  const document = Object.assign(new EventTarget(), { visibilityState: visible ? "visible" : "hidden" });
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; },
    cancelAnimationFrame: (frame: number) => callbacks.delete(frame),
    setTimeout, clearTimeout,
  });
  return {
    callbacks,
    frame: () => {
      const pending = [...callbacks.values()]; callbacks.clear();
      pending.forEach(callback => callback(0));
    },
    visible: (next: boolean) => {
      document.visibilityState = next ? "visible" : "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

describe("visible invitation entrance", () => {
  it("allows a visible paint, then a 400ms pause before entering once", () => {
    const page = fixture(); const enter = vi.fn();
    afterVisiblePause(enter);
    page.frame(); expect(enter).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); expect(enter).not.toHaveBeenCalled();
    page.frame(); vi.advanceTimersByTime(399); expect(enter).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(enter).toHaveBeenCalledOnce();
    page.visible(false); page.visible(true); page.frame(); page.frame();
    vi.advanceTimersByTime(1000);
    expect(enter).toHaveBeenCalledOnce();
  });
  it("does not schedule in a background tab; activation starts a fresh entrance", () => {
    const page = fixture(false); const enter = vi.fn();
    afterVisiblePause(enter);
    expect(page.callbacks.size).toBe(0);
    page.frame(); page.frame(); vi.advanceTimersByTime(10000); expect(enter).not.toHaveBeenCalled();
    page.visible(true); page.frame(); expect(enter).not.toHaveBeenCalled();
    page.frame(); vi.advanceTimersByTime(399); expect(enter).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(enter).toHaveBeenCalledOnce();
  });
  it("cancels a pending entrance on hide and waits for a new visible paint", () => {
    const page = fixture(); const enter = vi.fn();
    afterVisiblePause(enter); page.frame(); page.visible(false);
    expect(page.callbacks.size).toBe(0);
    page.frame(); expect(enter).not.toHaveBeenCalled();
    page.visible(true); page.frame(); expect(enter).not.toHaveBeenCalled();
    page.frame(); vi.advanceTimersByTime(400); expect(enter).toHaveBeenCalledOnce();
  });
  it("hiding during the pause cancels its timer and activation starts a full new pause", () => {
    const page = fixture(); const enter = vi.fn();
    afterVisiblePause(enter); page.frame(); page.frame();
    vi.advanceTimersByTime(300); page.visible(false);
    vi.advanceTimersByTime(10000); expect(enter).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    page.visible(true); page.frame(); page.frame();
    vi.advanceTimersByTime(399); expect(enter).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(enter).toHaveBeenCalledOnce();
  });
  it.each([1,2])("cleanup after %i frames cancels callbacks/timers and removes the visibility listener", frames => {
    const page = fixture(); const enter = vi.fn();
    const dispose = afterVisiblePause(enter);
    for (let i=0;i<frames;i++) page.frame();
    dispose();
    page.visible(false); page.visible(true); page.frame(); page.frame();
    expect(page.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(enter).not.toHaveBeenCalled();
  });
});
