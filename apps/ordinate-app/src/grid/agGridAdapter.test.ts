import type { GridApi } from "ag-grid-community";
import { describe, expect, it } from "vitest";

import type { GridRow } from "../types/ui";
import type { GridScrollSnapshot } from "../utils/gridGeometry";
import { createAgGridAdapter } from "./agGridAdapter";

type MockDisplayedColumn = {
  getActualWidth(): number;
  getColId(): string;
  getLeft(): number | null;
  getPinned(): boolean | "left" | "right" | null;
};

function mockColumn(args: {
  colId: string;
  left: number;
  pinned?: boolean | "left" | "right" | null;
  width: number;
}): MockDisplayedColumn {
  return {
    getActualWidth: () => args.width,
    getColId: () => args.colId,
    getLeft: () => args.left,
    getPinned: () => args.pinned ?? null,
  };
}

describe("agGridAdapter", () => {
  it("uses displayed column metrics as the column geometry source of truth", () => {
    const adapter = createAgGridAdapter();
    const api = {
      getAllDisplayedColumns: () => [
        mockColumn({ colId: "col_0", left: 0, pinned: "left", width: 280 }),
        mockColumn({ colId: "col_1", left: 0, width: 178 }),
        mockColumn({ colId: "col_2", left: 178, width: 177 }),
      ],
    } as unknown as GridApi<GridRow>;
    const root = {
      querySelectorAll: () => {
        throw new Error("collectColumnMetrics must not derive geometry from header DOM");
      },
    } as unknown as HTMLElement;

    expect(adapter.collectColumnMetrics(root, api, new Map([
      ["col_0", 1],
      ["col_1", 2],
      ["col_2", 3],
    ]), 3)).toEqual([
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 178 },
      { colIndex: 2, left: 458, width: 177 },
    ]);
  });

  it("fails when non-data chrome columns enter displayed column metrics", () => {
    const adapter = createAgGridAdapter();
    const api = {
      getAllDisplayedColumns: () => [
        mockColumn({ colId: "col_0", left: 0, pinned: "left", width: 280 }),
        mockColumn({ colId: "col_1", left: 0, width: 178 }),
        mockColumn({ colId: "__fake_append__", left: 178, width: 34 }),
      ],
    } as unknown as GridApi<GridRow>;

    expect(() => adapter.collectColumnMetrics({} as HTMLElement, api, new Map([
      ["col_0", 1],
      ["col_1", 2],
    ]), 2)).toThrow("displayed column count mismatch: expected 2, got 3");
  });

  it("scrolls the shared horizontal viewport with clamping", () => {
    const adapter = createAgGridAdapter();
    const horizontalViewport = {
      clientWidth: 100,
      scrollLeft: 0,
      scrollWidth: 260,
    };
    const root = {
      querySelector: (selector: string) =>
        selector === ".ag-body-horizontal-scroll-viewport" ? horizontalViewport : null,
    } as unknown as HTMLElement;

    expect(adapter.scrollHorizontalViewport(root, 70)).toBe(true);
    expect(horizontalViewport.scrollLeft).toBe(70);
    expect(adapter.scrollHorizontalViewport(root, 500)).toBe(true);
    expect(horizontalViewport.scrollLeft).toBe(160);
    expect(adapter.scrollHorizontalViewport(root, 500)).toBe(false);
  });

  it("reports scroll and viewport size changes from one shared sync", () => {
    const adapter = createAgGridAdapter();
    const originalWindow = (globalThis as unknown as { window?: unknown }).window;
    const originalResizeObserver = (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    const originalMutationObserver = (globalThis as unknown as { MutationObserver?: unknown }).MutationObserver;
    let nextFrameId = 1;
    let frameCallbacks: FrameRequestCallback[] = [];
    const flushFrames = () => {
      const callbacks = frameCallbacks;
      frameCallbacks = [];
      callbacks.forEach((callback) => callback(0));
    };
    const fakeWindow = {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return nextFrameId++;
      },
      cancelAnimationFrame: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });
    const resizeNotifications: Array<() => void> = [];
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeNotifications.push(() => callback([], this as unknown as ResizeObserver));
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: FakeResizeObserver,
    });
    const mutationNotifications: Array<() => void> = [];
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        mutationNotifications.push(() => callback([], this as unknown as MutationObserver));
      }
      observe() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: FakeMutationObserver,
    });

    let verticalViewport = {
      addEventListener: () => {},
      clientHeight: 654,
      removeEventListener: () => {},
      scrollTop: 12,
    };
    let horizontalViewport = {
      addEventListener: () => {},
      clientWidth: 456,
      removeEventListener: () => {},
      scrollLeft: 34,
    };
    const root = {
      querySelector: (selector: string) => {
        if (selector === ".ag-body-viewport.ag-layout-normal") return verticalViewport;
        if (selector === ".ag-body-horizontal-scroll-viewport") return horizontalViewport;
        return null;
      },
    } as unknown as HTMLElement;

    try {
      const snapshots: Array<Parameters<Parameters<typeof adapter.attachViewportSync>[1]>[0]> = [];
      const cleanup = adapter.attachViewportSync(root, (snapshot) => snapshots.push(snapshot));
      flushFrames();

      expect(snapshots).toEqual([{
        bodyViewportHeight: 654,
        centerViewportWidth: 456,
        hasHorizontalOverlap: true,
        hasVerticalOverlap: true,
        left: 34,
        top: 12,
      }]);
      verticalViewport.clientHeight = 612;
      horizontalViewport.clientWidth = 420;
      if (resizeNotifications.length !== 1) throw new Error("viewport sync did not create one resize observer");
      resizeNotifications[0]();
      flushFrames();
      expect(snapshots.at(-1)).toMatchObject({
        bodyViewportHeight: 612,
        centerViewportWidth: 420,
      });
      verticalViewport = {
        addEventListener: () => {},
        clientHeight: 500,
        removeEventListener: () => {},
        scrollTop: 44,
      };
      horizontalViewport = {
        addEventListener: () => {},
        clientWidth: 390,
        removeEventListener: () => {},
        scrollLeft: 72,
      };
      if (mutationNotifications.length !== 1) throw new Error("viewport sync did not create one mutation observer");
      mutationNotifications[0]();
      flushFrames();
      expect(snapshots.at(-1)).toMatchObject({
        bodyViewportHeight: 500,
        centerViewportWidth: 390,
        left: 72,
        top: 44,
      });
      cleanup();
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: originalResizeObserver,
      });
      Object.defineProperty(globalThis, "MutationObserver", {
        configurable: true,
        value: originalMutationObserver,
      });
    }
  });

  it("synchronizes visual scroll state before the next React frame", () => {
    const adapter = createAgGridAdapter();
    const originalWindow = (globalThis as unknown as { window?: unknown }).window;
    const originalResizeObserver = (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    const originalMutationObserver = (globalThis as unknown as { MutationObserver?: unknown }).MutationObserver;
    const horizontalScrollListeners: Array<() => void> = [];
    const frameCallbacks: FrameRequestCallback[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        requestAnimationFrame: (callback: FrameRequestCallback) => {
          frameCallbacks.push(callback);
          return 1;
        },
        cancelAnimationFrame: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    class FakeMutationObserver {
      observe() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: FakeResizeObserver });
    Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: FakeMutationObserver });
    const verticalViewport = {
      addEventListener: () => {},
      removeEventListener: () => {},
      clientHeight: 500,
      scrollTop: 0,
    };
    const horizontalViewport = {
      addEventListener: (type: string, listener: () => void) => {
        if (type === "scroll") horizontalScrollListeners.push(listener);
      },
      removeEventListener: () => {},
      clientWidth: 420,
      scrollLeft: 0,
    };
    const root = {
      querySelector: (selector: string) => {
        if (selector === ".ag-body-viewport.ag-layout-normal") return verticalViewport;
        if (selector === ".ag-body-horizontal-scroll-viewport") return horizontalViewport;
        return null;
      },
    } as unknown as HTMLElement;

    try {
      const frames: GridScrollSnapshot[] = [];
      const immediate: Array<Pick<GridScrollSnapshot, "top" | "left">> = [];
      const cleanup = adapter.attachViewportSync(
        root,
        (snapshot) => frames.push(snapshot),
        (position) => immediate.push(position),
      );
      const initialFrame = frameCallbacks.shift();
      if (!initialFrame) throw new Error("initial viewport frame was not scheduled");
      initialFrame(0);

      horizontalViewport.scrollLeft = 180;
      const horizontalScrollListener = horizontalScrollListeners[0];
      if (!horizontalScrollListener) throw new Error("horizontal scroll listener was not attached");
      horizontalScrollListener();

      expect(immediate).toEqual([{ top: 0, left: 180 }]);
      expect(frames).toHaveLength(1);
      expect(frameCallbacks).toHaveLength(1);
      cleanup();
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: originalResizeObserver });
      Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: originalMutationObserver });
    }
  });
});
