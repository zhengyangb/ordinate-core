import { describe, expect, it } from "vitest";

import {
  clipColumnTrackSpanToCenterLayer,
  bodyRowTrackYToViewportY,
  columnTrackXToViewportX,
  columnViewportXToTrackX,
  mergeColumnMetricsWithVisualOverrides,
  gridScrollSnapshotEqual,
  projectAppendColumnSlotToViewport,
  projectColumnTrackSpanToCenterLayer,
  projectColumnTrackSpanToViewport,
  projectTableLayerGeometry,
  projectActiveSheetGridScrollSnapshot,
  projectTableViewportFootprint,
  resolveAppendColumnProjectionScrollLeft,
  resolveColumnCenterTrackWidth,
  resolveAxisAppendSlot,
  resolveAppendRowSlot,
  resolveColumnTrackSpan,
  resolveHorizontalWheelDelta,
  resolveRailTrackEdgeState,
  resolveFrozenHeaderGeometry,
} from "./gridGeometry";

describe("grid geometry helpers", () => {
  it("unfreezes the entire header block when the data viewport would be too narrow", () => {
    expect(resolveFrozenHeaderGeometry(322, [280])).toEqual({ columnCount: 0, width: 0 });
    expect(resolveFrozenHeaderGeometry(399, [280])).toEqual({ columnCount: 0, width: 0 });
    expect(resolveFrozenHeaderGeometry(400, [280])).toEqual({ columnCount: 1, width: 280 });
    expect(resolveFrozenHeaderGeometry(600, [280, 280])).toEqual({ columnCount: 0, width: 0 });
    expect(resolveFrozenHeaderGeometry(680, [280, 280])).toEqual({ columnCount: 2, width: 560 });
    expect(resolveFrozenHeaderGeometry(0, [280])).toEqual({ columnCount: 0, width: 0 });
    expect(resolveFrozenHeaderGeometry(390, [])).toEqual({ columnCount: 0, width: 0 });
    expect(() => resolveFrozenHeaderGeometry(-1, [280])).toThrow("invalid frozen header geometry");
  });
  it("assigns both rail edge roles from one ordered-track model", () => {
    expect(resolveRailTrackEdgeState(0, 5)).toEqual({ isOrigin: true, isTerminal: false });
    expect(resolveRailTrackEdgeState(2, 5)).toEqual({ isOrigin: false, isTerminal: false });
    expect(resolveRailTrackEdgeState(4, 5)).toEqual({ isOrigin: false, isTerminal: true });
    expect(resolveRailTrackEdgeState(0, 1)).toEqual({ isOrigin: true, isTerminal: true });
  });

  it("fails early for invalid rail edge geometry", () => {
    expect(() => resolveRailTrackEdgeState(-1, 5)).toThrow("rail item index must be a non-negative integer");
    expect(() => resolveRailTrackEdgeState(0, 0)).toThrow("rail item count must be a positive integer");
    expect(() => resolveRailTrackEdgeState(5, 5)).toThrow("rail item index must be inside the track");
  });

  it("keeps the full logical column track while applying visual overrides", () => {
    const baseMetrics = [
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 160 },
      { colIndex: 2, left: 440, width: 160 },
    ];
    const visualMetrics = [
      { colIndex: 1, left: 281, width: 158 },
      { colIndex: 2, left: 439, width: 162 },
    ];

    expect(mergeColumnMetricsWithVisualOverrides(baseMetrics, visualMetrics)).toEqual([
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 281, width: 158 },
      { colIndex: 2, left: 439, width: 162 },
    ]);
  });

  it("fails early when a visual column metric is not part of the logical track", () => {
    expect(() => mergeColumnMetricsWithVisualOverrides(
      [{ colIndex: 0, left: 0, width: 280 }],
      [{ colIndex: 1, left: 280, width: 160 }],
    )).toThrow("visual column metric has no base metric: 1");
  });

  it("maps scrolled column viewport coordinates back to the logical column track", () => {
    const viewport = { pinnedWidth: 280, scrollLeft: 53 };

    expect(columnViewportXToTrackX(120, viewport)).toBe(120);
    expect(columnViewportXToTrackX(280, viewport)).toBe(333);
    expect(columnTrackXToViewportX(280, viewport)).toBe(280);
    expect(columnTrackXToViewportX(412, viewport)).toBe(359);
  });

  it("projects selected column spans from logical track metrics into viewport coordinates", () => {
    const metrics = [
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 160 },
      { colIndex: 2, left: 440, width: 180 },
      { colIndex: 3, left: 620, width: 200 },
    ];

    const span = resolveColumnTrackSpan(metrics, 1, 3);

    expect(span).toEqual({ left: 280, right: 820, width: 540, center: 550 });
    expect(projectColumnTrackSpanToViewport(span!, { pinnedWidth: 280, scrollLeft: 0 })).toEqual({
      left: 280,
      width: 540,
      center: 550,
    });
  });

  it("normalizes reversed selected column endpoints before projection", () => {
    const metrics = [
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 132 },
      { colIndex: 2, left: 412, width: 132 },
      { colIndex: 3, left: 544, width: 132 },
    ];

    expect(resolveColumnTrackSpan(metrics, 3, 1)).toEqual(resolveColumnTrackSpan(metrics, 1, 3));
  });

  it("recomputes selected column spans from resized metrics", () => {
    const beforeResize = [
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 132 },
      { colIndex: 2, left: 412, width: 132 },
      { colIndex: 3, left: 544, width: 132 },
      { colIndex: 4, left: 676, width: 132 },
    ];
    const afterResize = [
      { colIndex: 0, left: 0, width: 480 },
      { colIndex: 1, left: 480, width: 210 },
      { colIndex: 2, left: 690, width: 210 },
      { colIndex: 3, left: 900, width: 210 },
      { colIndex: 4, left: 1110, width: 210 },
    ];

    const before = projectColumnTrackSpanToViewport(resolveColumnTrackSpan(beforeResize, 3, 3)!, {
      pinnedWidth: 280,
      scrollLeft: 0,
    });
    const after = projectColumnTrackSpanToViewport(resolveColumnTrackSpan(afterResize, 3, 3)!, {
      pinnedWidth: 480,
      scrollLeft: 0,
    });

    expect(before).toEqual({ left: 544, width: 132, center: 610 });
    expect(after).toEqual({ left: 900, width: 210, center: 1005 });
  });

  it("keeps selected column spans aligned with the scrolled center viewport", () => {
    const metrics = [
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 132 },
      { colIndex: 2, left: 412, width: 132 },
      { colIndex: 3, left: 544, width: 132 },
    ];
    const span = resolveColumnTrackSpan(metrics, 1, 2);

    expect(projectColumnTrackSpanToViewport(span!, { pinnedWidth: 280, scrollLeft: 53 })).toEqual({
      left: 280,
      width: 211,
      center: 359,
    });
  });

  it("projects selected column spans into the center scroll layer without scroll state", () => {
    const span = resolveColumnTrackSpan([
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 132 },
      { colIndex: 2, left: 412, width: 132 },
    ], 1, 2);

    expect(projectColumnTrackSpanToCenterLayer(span!, 280)).toEqual({
      left: 0,
      width: 264,
      center: 132,
    });
    expect(projectColumnTrackSpanToViewport(span!, { pinnedWidth: 280, scrollLeft: 53 })).toEqual({
      left: 280,
      width: 211,
      center: 359,
    });
  });

  it("clamps subpixel center-layer boundary drift during horizontal auto-pan", () => {
    const span = resolveColumnTrackSpan([
      { colIndex: 1, left: 279.4, width: 132 },
      { colIndex: 2, left: 411.4, width: 132 },
    ], 1, 2);

    expect(projectColumnTrackSpanToCenterLayer(span!, 280)).toEqual({
      left: 0,
      width: 264,
      center: 132,
    });
  });

  it("clips column selection spans to the center scroll layer for overlay rendering", () => {
    const span = resolveColumnTrackSpan([
      { colIndex: 0, left: 0, width: 140 },
      { colIndex: 1, left: 140, width: 140 },
      { colIndex: 2, left: 280, width: 132 },
      { colIndex: 3, left: 412, width: 132 },
    ], 1, 3);

    expect(clipColumnTrackSpanToCenterLayer(span!, 280)).toEqual({
      left: 0,
      width: 264,
      center: 132,
    });
  });

  it("omits center-layer column overlays that are fully inside pinned columns", () => {
    const span = resolveColumnTrackSpan([
      { colIndex: 0, left: 0, width: 140 },
      { colIndex: 1, left: 140, width: 140 },
    ], 0, 1);

    expect(clipColumnTrackSpanToCenterLayer(span!, 280)).toBeNull();
  });

  it("fails early when a center-layer span includes pinned columns", () => {
    const span = resolveColumnTrackSpan([
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 132 },
    ], 0, 1);

    expect(() => projectColumnTrackSpanToCenterLayer(span!, 280)).toThrow(
      "center layer column span cannot include pinned columns",
    );
  });

  it("does not project a column selection until every selected column has metrics", () => {
    const metrics = [
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 132 },
      { colIndex: 3, left: 544, width: 132 },
    ];

    expect(resolveColumnTrackSpan(metrics, 1, 3)).toBeNull();
  });

  it("fails early for invalid column metrics", () => {
    expect(() => resolveColumnTrackSpan([{ colIndex: 1, left: 280, width: 0 }], 1, 1)).toThrow(
      "column.width must be a positive finite number",
    );
  });

  it("keeps the center track width scoped to real columns", () => {
    expect(resolveColumnCenterTrackWidth([
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 132 },
      { colIndex: 2, left: 412, width: 168 },
    ], 280)).toBe(300);
  });

  it("keeps append axis slots outside the real table track", () => {
    expect(resolveAxisAppendSlot(660, 32, 8)).toEqual({
      start: 668,
      size: 32,
      end: 700,
    });
  });

  it("hides column append chrome before the real center track reaches its right edge", () => {
    expect(projectAppendColumnSlotToViewport({
      centerTrackWidth: 660,
      centerViewportWidth: 400,
      scrollLeft: 0,
      slotSize: 32,
      gap: 8,
    })).toBeNull();
  });

  it("keeps column append chrome hidden until the slot fully enters the viewport", () => {
    expect(projectAppendColumnSlotToViewport({
      centerTrackWidth: 660,
      centerViewportWidth: 400,
      scrollLeft: 260,
      slotSize: 32,
      gap: 8,
    })).toBeNull();
  });

  it("projects column append chrome into view at the append-scroll extent", () => {
    expect(projectAppendColumnSlotToViewport({
      centerTrackWidth: 660,
      centerViewportWidth: 400,
      scrollLeft: 300,
      slotSize: 32,
      gap: 8,
    })).toEqual({
      left: 368,
      width: 32,
      naturalLeft: 368,
    });
  });

  it("normalizes stale append column scroll before render-time projection", () => {
    expect(resolveAppendColumnProjectionScrollLeft({
      centerTrackWidth: 660,
      centerViewportWidth: 400,
      scrollLeft: 999,
      slotSize: 32,
      gap: 8,
    })).toBe(300);
  });

  it("keeps valid append column scroll unchanged", () => {
    expect(resolveAppendColumnProjectionScrollLeft({
      centerTrackWidth: 660,
      centerViewportWidth: 400,
      scrollLeft: 260,
      slotSize: 32,
      gap: 8,
    })).toBe(260);
  });

  it("projects one table footprint for boundaries and trailing canvas", () => {
    expect(projectTableViewportFootprint({
      pinnedWidth: 280,
      centerTrackWidth: 300,
      centerViewportWidth: 520,
      scrollLeft: 0,
      headerTrackHeight: 80,
      bodyTrackHeight: 114,
      bodyViewportHeight: 720,
      bodyScrollTop: 0,
    })).toEqual({
      right: 580,
      width: 580,
      height: 195,
      columnEndVisible: true,
      rowEndVisible: true,
      trailingCanvas: { left: 580, width: 220 },
    });
  });

  it("projects one declarative geometry for every table layer", () => {
    expect(projectTableLayerGeometry({
      pinnedWidth: 280,
      centerTrackWidth: 840,
      centerViewportWidth: 520,
      scrollLeft: 400,
      headerTrackHeight: 80,
      bodyTrackHeight: 900,
      bodyViewportHeight: 600,
      bodyScrollTop: 236,
    })).toEqual({
      centerViewport: {
        left: 280,
        width: 520,
        right: 800,
      },
      centerTrackOffsetX: -400,
      bodyTrackOffsetY: -236,
      footprint: {
        right: 720,
        width: 720,
        height: 681,
        columnEndVisible: true,
        rowEndVisible: false,
        trailingCanvas: { left: 720, width: 80 },
      },
    });
  });

  it("keeps layer origin stable while a window resize changes only the viewport", () => {
    const base = {
      pinnedWidth: 280,
      centerTrackWidth: 840,
      scrollLeft: 180,
      headerTrackHeight: 80,
      bodyTrackHeight: 900,
      bodyViewportHeight: 600,
      bodyScrollTop: 120,
    };

    const wide = projectTableLayerGeometry({ ...base, centerViewportWidth: 520 });
    const narrow = projectTableLayerGeometry({ ...base, centerViewportWidth: 360 });

    expect(wide.centerViewport).toEqual({ left: 280, width: 520, right: 800 });
    expect(narrow.centerViewport).toEqual({ left: 280, width: 360, right: 640 });
    expect(wide.centerTrackOffsetX).toBe(-180);
    expect(narrow.centerTrackOffsetX).toBe(-180);
    expect(wide.bodyTrackOffsetY).toBe(-120);
    expect(narrow.bodyTrackOffsetY).toBe(-120);
  });

  it("drops a previous sheet's viewport before projecting the active sheet", () => {
    expect(projectActiveSheetGridScrollSnapshot({
      activeSheet: "Planning",
      snapshot: {
        sheetName: "Management",
        top: 240,
        left: 520,
        centerViewportWidth: 640,
        bodyViewportHeight: 480,
        hasVerticalOverlap: true,
        hasHorizontalOverlap: true,
      },
      centerTrackWidth: 1200,
      appendSlotSize: 32,
      appendGap: 8,
    })).toEqual({
      top: 0,
      left: 0,
      centerViewportWidth: 0,
      bodyViewportHeight: 0,
      hasVerticalOverlap: false,
      hasHorizontalOverlap: false,
    });
  });

  it("clamps one active-sheet snapshot when the column track shrinks", () => {
    expect(projectActiveSheetGridScrollSnapshot({
      activeSheet: "Management",
      snapshot: {
        sheetName: "Management",
        top: 120,
        left: 900,
        centerViewportWidth: 520,
        bodyViewportHeight: 600,
        hasVerticalOverlap: true,
        hasHorizontalOverlap: true,
      },
      centerTrackWidth: 840,
      appendSlotSize: 32,
      appendGap: 8,
    })).toEqual({
      top: 120,
      left: 360,
      centerViewportWidth: 520,
      bodyViewportHeight: 600,
      hasVerticalOverlap: true,
      hasHorizontalOverlap: true,
    });
  });

  it("compares sheet viewport snapshots with subpixel tolerance", () => {
    const snapshot = {
      sheetName: "Management",
      top: 120,
      left: 360,
      centerViewportWidth: 520,
      bodyViewportHeight: 600,
      hasVerticalOverlap: true,
      hasHorizontalOverlap: true,
    };

    expect(gridScrollSnapshotEqual(snapshot, {
      ...snapshot,
      top: 120.25,
      left: 360.25,
    })).toBe(true);
    expect(gridScrollSnapshotEqual(snapshot, {
      ...snapshot,
      sheetName: "Planning",
    })).toBe(false);
  });

  it("projects a full-width footprint while real columns fill the viewport", () => {
    expect(projectTableViewportFootprint({
      pinnedWidth: 280,
      centerTrackWidth: 840,
      centerViewportWidth: 520,
      scrollLeft: 180,
      headerTrackHeight: 80,
      bodyTrackHeight: 900,
      bodyViewportHeight: 600,
      bodyScrollTop: 180,
    })).toEqual({
      right: 800,
      width: 800,
      height: 681,
      columnEndVisible: false,
      rowEndVisible: false,
      trailingCanvas: null,
    });
  });

  it("tracks horizontal and vertical table ends independently", () => {
    expect(projectTableViewportFootprint({
      pinnedWidth: 280,
      centerTrackWidth: 520,
      centerViewportWidth: 520,
      scrollLeft: 0,
      headerTrackHeight: 80,
      bodyTrackHeight: 900,
      bodyViewportHeight: 600,
      bodyScrollTop: 0,
    })).toMatchObject({
      columnEndVisible: true,
      rowEndVisible: false,
    });

    expect(projectTableViewportFootprint({
      pinnedWidth: 280,
      centerTrackWidth: 840,
      centerViewportWidth: 520,
      scrollLeft: 0,
      headerTrackHeight: 80,
      bodyTrackHeight: 600,
      bodyViewportHeight: 600,
      bodyScrollTop: 0,
    })).toMatchObject({
      columnEndVisible: false,
      rowEndVisible: true,
    });
  });

  it("projects the append-scroll extent outside the real table footprint", () => {
    expect(projectTableViewportFootprint({
      pinnedWidth: 280,
      centerTrackWidth: 660,
      centerViewportWidth: 400,
      scrollLeft: 300,
      headerTrackHeight: 40,
      bodyTrackHeight: 114,
      bodyViewportHeight: 720,
      bodyScrollTop: 0,
    })).toEqual({
      right: 640,
      width: 640,
      height: 155,
      columnEndVisible: true,
      rowEndVisible: true,
      trailingCanvas: { left: 640, width: 40 },
    });
  });

  it("shrinks the visible footprint when the last body row scrolls into view", () => {
    expect(projectTableViewportFootprint({
      pinnedWidth: 280,
      centerTrackWidth: 300,
      centerViewportWidth: 520,
      scrollLeft: 0,
      headerTrackHeight: 40,
      bodyTrackHeight: 900,
      bodyViewportHeight: 600,
      bodyScrollTop: 500,
    }).height).toBe(441);
  });

  it("fails early for invalid table footprint geometry", () => {
    expect(() =>
      projectTableViewportFootprint({
        pinnedWidth: 280,
        centerTrackWidth: 660,
        centerViewportWidth: 400,
        scrollLeft: -1,
        headerTrackHeight: 40,
        bodyTrackHeight: 114,
        bodyViewportHeight: 720,
        bodyScrollTop: 0,
      }),
    ).toThrow("tableFootprint.scrollLeft must be a non-negative finite number");
  });

  it("places column append chrome immediately after short real tracks when space is available", () => {
    expect(projectAppendColumnSlotToViewport({
      centerTrackWidth: 300,
      centerViewportWidth: 400,
      scrollLeft: 0,
      slotSize: 32,
      gap: 8,
    })).toEqual({
      left: 308,
      width: 32,
      naturalLeft: 308,
    });
  });

  it("places column append chrome after an empty real track without creating a permanent viewport column", () => {
    expect(projectAppendColumnSlotToViewport({
      centerTrackWidth: 0,
      centerViewportWidth: 400,
      scrollLeft: 0,
      slotSize: 32,
      gap: 8,
    })).toEqual({
      left: 8,
      width: 32,
      naturalLeft: 8,
    });
  });

  it("normalizes append column scroll for empty real tracks", () => {
    expect(resolveAppendColumnProjectionScrollLeft({
      centerTrackWidth: 0,
      centerViewportWidth: 400,
      scrollLeft: 100,
      slotSize: 32,
      gap: 8,
    })).toBe(0);
  });

  it("fails early when column append projection receives stale scroll beyond the append scroll range", () => {
    expect(() =>
      projectAppendColumnSlotToViewport({
        centerTrackWidth: 660,
        centerViewportWidth: 400,
        scrollLeft: 320,
        slotSize: 32,
        gap: 8,
      }),
    ).toThrow("appendColumn.scrollLeft exceeds the append chrome scroll range");
  });

  it("places the append row chrome immediately after the body row track", () => {
    expect(resolveAppendRowSlot(684, 32, 8)).toEqual({
      top: 692,
      height: 32,
      bottom: 724,
    });
  });

  it("fails early for invalid append slots", () => {
    expect(() => resolveAppendRowSlot(-1, 32, 8)).toThrow("appendRow.trackHeight must be a non-negative finite number");
    expect(() =>
      projectAppendColumnSlotToViewport({
        centerTrackWidth: 300,
        centerViewportWidth: 400,
        scrollLeft: 0,
        slotSize: 0,
        gap: 8,
      }),
    ).toThrow("appendColumn.slotSize must be a positive finite number");
  });

  it("projects body row track positions into the visible grid viewport", () => {
    expect(bodyRowTrackYToViewportY(240, 80, 0)).toBe(320);
    expect(bodyRowTrackYToViewportY(240, 80, 120)).toBe(200);
  });

  it("recognizes horizontal wheel intent without hijacking vertical scrolling", () => {
    expect(resolveHorizontalWheelDelta({ deltaX: 42, deltaY: 0, shiftKey: false })).toBe(42);
    expect(resolveHorizontalWheelDelta({ deltaX: 0, deltaY: 42, shiftKey: true })).toBe(42);
    expect(resolveHorizontalWheelDelta({ deltaX: 0, deltaY: 42, shiftKey: false })).toBe(0);
  });
});
