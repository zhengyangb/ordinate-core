import { describe, expect, it } from "vitest";

import {
  clipColumnTrackSpanToCenterLayer,
  bodyRowTrackYToViewportY,
  columnTrackXToViewportX,
  columnViewportXToTrackX,
  mergeColumnMetricsWithVisualOverrides,
  projectColumnTrackSpanToCenterLayer,
  projectColumnTrackSpanToViewport,
  resolveColumnCenterTrackWidth,
  resolveAppendRowSlot,
  resolveColumnTrackSpan,
  resolveHorizontalWheelDelta,
  shouldShowAppendColumnControl,
} from "./gridGeometry";

describe("grid geometry helpers", () => {
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

  it("shows column append chrome only when the real center track is at its right edge", () => {
    expect(shouldShowAppendColumnControl({
      centerTrackWidth: 660,
      centerViewportWidth: 400,
      scrollLeft: 0,
    })).toBe(false);
    expect(shouldShowAppendColumnControl({
      centerTrackWidth: 660,
      centerViewportWidth: 400,
      scrollLeft: 260,
    })).toBe(true);
    expect(shouldShowAppendColumnControl({
      centerTrackWidth: 300,
      centerViewportWidth: 400,
      scrollLeft: 0,
    })).toBe(true);
  });

  it("places the append row immediately after the body row track", () => {
    expect(resolveAppendRowSlot(684, 38)).toEqual({
      top: 684,
      height: 38,
      bottom: 722,
    });
  });

  it("fails early for invalid append slots", () => {
    expect(() => resolveAppendRowSlot(-1, 38)).toThrow("appendRow.trackHeight must be a non-negative finite number");
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
