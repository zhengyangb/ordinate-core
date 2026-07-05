import type { GridApi } from "ag-grid-community";
import { describe, expect, it } from "vitest";

import type { GridRow } from "../types/ui";
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

  it("reports center viewport width from the shared horizontal viewport sync", () => {
    const adapter = createAgGridAdapter();
    const originalWindow = (globalThis as unknown as { window?: unknown }).window;
    const fakeWindow = {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
      cancelAnimationFrame: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    const verticalViewport = {
      addEventListener: () => {},
      removeEventListener: () => {},
      scrollTop: 12,
    };
    const horizontalViewport = {
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

      expect(snapshots).toEqual([{
        centerViewportWidth: 456,
        hasHorizontalOverlap: true,
        hasVerticalOverlap: true,
        left: 34,
        top: 12,
      }]);
      cleanup();
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });
});
