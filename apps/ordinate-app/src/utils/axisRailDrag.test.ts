import { describe, expect, it } from "vitest";

import type { SheetBodyRowStructure } from "@ordinate/core";

import {
  canStartColumnRailMoveDrag,
  canStartColumnRailSelectionDrag,
  canStartRowRailMoveDrag,
  canStartRowRailSelectionDrag,
  computeAxisAutoPanDelta,
  mapMoveDropGapToCoreTargetGap,
  resolveBodyRowDropGap,
  resolveBodyRowNumberAtTrackY,
  resolveColumnDragSource,
  resolveColumnDropBoundaryInViewport,
  resolveColumnDropGap,
  resolveColumnIndexInViewport,
  resolveHeaderRowDropGap,
  resolveHeaderRowNumberAtTrackY,
  resolveRowDragSource,
  validateColumnMoveDrop,
  validateRowMoveDrop,
} from "./axisRailDrag";
import {
  columnTrackXToViewportX,
  columnViewportXToTrackX,
} from "./gridGeometry";
import type { GridRow } from "../types/ui";

const BODY_ROWS: SheetBodyRowStructure[] = [
  {
    rowId: 101,
    bodyRowIndex: 0,
    absoluteRowIndex: 2,
    absoluteRowNumber: 3,
    rowPath: "Group",
    label: "Group",
    depth: 0,
    hasChildren: true,
    subtreeRowCount: 3,
  },
  {
    rowId: 102,
    bodyRowIndex: 1,
    absoluteRowIndex: 3,
    absoluteRowNumber: 4,
    rowPath: "Group.A",
    label: "A",
    depth: 1,
    hasChildren: false,
    subtreeRowCount: 1,
  },
  {
    rowId: 103,
    bodyRowIndex: 2,
    absoluteRowIndex: 4,
    absoluteRowNumber: 5,
    rowPath: "Group.B",
    label: "B",
    depth: 1,
    hasChildren: false,
    subtreeRowCount: 1,
  },
  {
    rowId: 104,
    bodyRowIndex: 3,
    absoluteRowIndex: 5,
    absoluteRowNumber: 6,
    rowPath: "Standalone",
    label: "Standalone",
    depth: 0,
    hasChildren: false,
    subtreeRowCount: 1,
  },
  {
    rowId: 105,
    bodyRowIndex: 4,
    absoluteRowIndex: 6,
    absoluteRowNumber: 7,
    rowPath: "Nested",
    label: "Nested",
    depth: 1,
    hasChildren: false,
    subtreeRowCount: 1,
  },
];

const ROW_IDS = [11, 12, ...BODY_ROWS.map((row) => row.rowId)];

function gridRow(row: SheetBodyRowStructure, collapsed = false): GridRow {
  return {
    __rowKey: `r${row.absoluteRowNumber}`,
    __rowId: row.rowId,
    __rowPath: row.rowPath,
    __absoluteRowNumber: row.absoluteRowNumber,
    __depth: row.depth,
    __hasChildren: row.hasChildren,
    __collapsed: collapsed,
    __displayLabel: row.label,
  };
}

describe("axis rail drag helpers", () => {
  it("maps current-axis move drop gaps to core post-removal target gaps", () => {
    expect(mapMoveDropGapToCoreTargetGap(2, 2, 0)).toEqual({ kind: "target", targetGapIndex: 0 });
    expect(mapMoveDropGapToCoreTargetGap(2, 2, 2)).toEqual({ kind: "noop" });
    expect(mapMoveDropGapToCoreTargetGap(2, 2, 3)).toEqual({ kind: "noop" });
    expect(mapMoveDropGapToCoreTargetGap(2, 2, 4)).toEqual({ kind: "noop" });
    expect(mapMoveDropGapToCoreTargetGap(2, 2, 5)).toEqual({ kind: "target", targetGapIndex: 3 });
  });

  it("resolves and validates data column drag sources", () => {
    const source = resolveColumnDragSource(2, 1, [1, 2, 3, 4]);
    expect(source).toMatchObject({ ok: true, colIds: [3], sourceStartIndex: 2, sourceCount: 1 });
    expect(resolveColumnDragSource(0, 1, [1, 2, 3, 4])).toMatchObject({ ok: false });

    expect(validateColumnMoveDrop(source, 1, 1, 4)).toEqual({ ok: true, mapping: { kind: "target", targetGapIndex: 1 } });
    expect(validateColumnMoveDrop(source, 0, 1, 4)).toMatchObject({ ok: false });
    expect(validateColumnMoveDrop(source, 3, 1, 4)).toEqual({ ok: true, mapping: { kind: "noop" } });
    expect(validateColumnMoveDrop(source, 4, 1, 4)).toEqual({ ok: true, mapping: { kind: "target", targetGapIndex: 3 } });
  });

  it("starts column move drag only from the selected rail without selection modifiers", () => {
    const selection = { axis: "column" as const, colStart: 2, colEnd: 4 };
    expect(canStartColumnRailMoveDrag(2, null, {})).toBe(false);
    expect(canStartColumnRailMoveDrag(1, selection, {})).toBe(false);
    expect(canStartColumnRailMoveDrag(2, selection, {})).toBe(true);
    expect(canStartColumnRailMoveDrag(3, selection, {})).toBe(true);
    expect(canStartColumnRailMoveDrag(4, selection, {})).toBe(true);
    expect(canStartColumnRailMoveDrag(2, selection, { shiftKey: true })).toBe(false);
    expect(canStartColumnRailMoveDrag(2, selection, { metaKey: true })).toBe(false);
  });

  it("starts column selection drag only from an unselected data-column rail", () => {
    const selection = { axis: "column" as const, colStart: 2, colEnd: 4 };
    expect(canStartColumnRailSelectionDrag(0, 1, 6, selection, {})).toBe(false);
    expect(canStartColumnRailSelectionDrag(3, 1, 6, selection, {})).toBe(false);
    expect(canStartColumnRailSelectionDrag(5, 1, 6, selection, {})).toBe(true);
    expect(canStartColumnRailSelectionDrag(5, 1, 6, selection, { shiftKey: true })).toBe(false);
  });

  it("resolves multi-column drag sources from a selected contiguous segment", () => {
    expect(resolveColumnDragSource(3, 1, [1, 2, 3, 4, 5], { axis: "column", colStart: 2, colEnd: 4 })).toMatchObject({
      ok: true,
      colIds: [3, 4, 5],
      sourceStartIndex: 2,
      sourceCount: 3,
    });
    expect(resolveColumnDragSource(1, 2, [1, 2, 3], { axis: "column", colStart: 1, colEnd: 2 })).toMatchObject({
      ok: false,
      reason: "Header columns cannot be moved.",
    });
  });

  it("resolves header rows and body subtree drag sources", () => {
    expect(resolveRowDragSource(1, "header", 2, ROW_IDS, BODY_ROWS)).toMatchObject({
      ok: true,
      area: "header",
      rowIds: [11],
      sourceStartIndex: 0,
      sourceCount: 1,
    });
    expect(resolveRowDragSource(3, "body", 2, ROW_IDS, BODY_ROWS)).toMatchObject({
      ok: true,
      area: "body",
      rowIds: [101, 102, 103],
      sourceStartIndex: 2,
      sourceCount: 3,
    });
    expect(resolveRowDragSource(3, "body", 2, ROW_IDS, BODY_ROWS, { axis: "row", area: "body", rowStart: 3, rowEnd: 3 })).toMatchObject({
      ok: true,
      area: "body",
      rowIds: [101, 102, 103],
      sourceStartIndex: 2,
      sourceCount: 3,
    });
  });

  it("starts row move drag only from the selected full row without selection modifiers", () => {
    const selection = { axis: "row" as const, area: "body" as const, rowStart: 6, rowEnd: 8 };
    expect(canStartRowRailMoveDrag(6, "body", null, {})).toBe(false);
    expect(canStartRowRailMoveDrag(5, "body", selection, {})).toBe(false);
    expect(canStartRowRailMoveDrag(6, "body", selection, {})).toBe(true);
    expect(canStartRowRailMoveDrag(7, "body", selection, {})).toBe(true);
    expect(canStartRowRailMoveDrag(8, "header", selection, {})).toBe(false);
    expect(canStartRowRailMoveDrag(6, "body", selection, { shiftKey: true })).toBe(false);
  });

  it("starts row selection drag only from an unselected valid row rail", () => {
    const selection = { axis: "row" as const, area: "body" as const, rowStart: 6, rowEnd: 8 };
    expect(canStartRowRailSelectionDrag(1, "header", 2, 9, selection, {})).toBe(true);
    expect(canStartRowRailSelectionDrag(6, "body", 2, 9, selection, {})).toBe(false);
    expect(canStartRowRailSelectionDrag(9, "body", 2, 9, selection, {})).toBe(true);
    expect(canStartRowRailSelectionDrag(9, "body", 2, 9, selection, { metaKey: true })).toBe(false);
  });

  it("resolves multi-row drag sources and rejects partial selected subtrees", () => {
    expect(resolveRowDragSource(4, "body", 2, ROW_IDS, BODY_ROWS, { axis: "row", area: "body", rowStart: 4, rowEnd: 5 })).toMatchObject({
      ok: true,
      area: "body",
      rowIds: [102, 103],
      sourceStartIndex: 3,
      sourceCount: 2,
      firstDepth: 1,
      lastDepth: 1,
    });
    expect(resolveRowDragSource(3, "body", 2, ROW_IDS, BODY_ROWS, { axis: "row", area: "body", rowStart: 3, rowEnd: 4 })).toMatchObject({
      ok: false,
      reason: "Selected row segment does not include the complete subtree.",
    });
    expect(resolveRowDragSource(1, "header", 2, ROW_IDS, BODY_ROWS, { axis: "row", area: "header", rowStart: 1, rowEnd: 2 })).toMatchObject({
      ok: true,
      area: "header",
      rowIds: [11, 12],
      sourceStartIndex: 0,
      sourceCount: 2,
    });
  });

  it("validates body row hierarchy drops before core mutation", () => {
    const leaf = resolveRowDragSource(6, "body", 2, ROW_IDS, BODY_ROWS);
    expect(leaf.ok).toBe(true);
    expect(validateRowMoveDrop(leaf, 2, 2, ROW_IDS.length, BODY_ROWS)).toEqual({
      ok: true,
      mapping: { kind: "target", targetGapIndex: 2 },
    });
    expect(validateRowMoveDrop(leaf, 4, 2, ROW_IDS.length, BODY_ROWS)).toMatchObject({
      ok: false,
      reason: "Drop would implicitly adopt following rows.",
    });

    const nested = resolveRowDragSource(7, "body", 2, ROW_IDS, BODY_ROWS);
    expect(nested.ok).toBe(true);
    expect(validateRowMoveDrop(nested, 2, 2, ROW_IDS.length, BODY_ROWS)).toMatchObject({
      ok: false,
      reason: "Nested rows cannot become the first body row.",
    });
  });

  it("resolves nearest rail drop gaps from visible metrics", () => {
    expect(resolveColumnDropGap(7, [
      { colIndex: 0, left: 0, width: 40 },
      { colIndex: 1, left: 40, width: 80 },
      { colIndex: 2, left: 120, width: 80 },
    ])).toBe(0);
    expect(resolveColumnDropGap(116, [
      { colIndex: 0, left: 0, width: 40 },
      { colIndex: 1, left: 40, width: 80 },
      { colIndex: 2, left: 120, width: 80 },
    ])).toBe(2);
    expect(resolveHeaderRowDropGap(38, [
      { number: 1, top: 0, height: 24 },
      { number: 2, top: 24, height: 24 },
    ])).toBe(2);
  });

  it("maps scrolled column viewport coordinates back to the logical column track", () => {
    const metrics = [
      { colIndex: 0, left: 0, width: 280 },
      { colIndex: 1, left: 280, width: 132 },
      { colIndex: 2, left: 412, width: 132 },
      { colIndex: 3, left: 544, width: 132 },
    ];
    const viewport = { pinnedWidth: 280, scrollLeft: 53 };

    expect(columnViewportXToTrackX(120, viewport)).toBe(120);
    expect(columnViewportXToTrackX(280, viewport)).toBe(333);

    const hiddenStartBoundary = resolveColumnDropBoundaryInViewport(280, metrics, viewport);
    expect(hiddenStartBoundary).toEqual({ gapIndex: 1, position: 280 });
    expect(columnTrackXToViewportX(hiddenStartBoundary?.position ?? -1, viewport)).toBe(280);

    const visibleBoundary = resolveColumnDropBoundaryInViewport(360, metrics, viewport);
    expect(visibleBoundary).toEqual({ gapIndex: 2, position: 412 });
    expect(columnTrackXToViewportX(visibleBoundary?.position ?? -1, viewport)).toBe(359);

    expect(resolveColumnIndexInViewport(360, metrics, viewport)).toBe(2);
    expect(resolveColumnIndexInViewport(120, metrics, viewport)).toBe(0);
  });

  it("computes axis rail auto pan deltas near viewport edges", () => {
    const request = {
      pointerPosition: 395,
      viewportStart: 100,
      viewportEnd: 400,
      scrollPosition: 120,
      scrollSize: 900,
      viewportSize: 300,
      edgeSize: 48,
      maxDelta: 24,
    };

    expect(computeAxisAutoPanDelta(request)).toBe(22);
    expect(computeAxisAutoPanDelta({ ...request, pointerPosition: 105 })).toBe(-22);
    expect(computeAxisAutoPanDelta({ ...request, pointerPosition: 250 })).toBe(0);
  });

  it("clamps axis rail auto pan deltas to available scroll range", () => {
    const request = {
      pointerPosition: 395,
      viewportStart: 100,
      viewportEnd: 400,
      scrollPosition: 590,
      scrollSize: 900,
      viewportSize: 300,
      edgeSize: 48,
      maxDelta: 24,
    };

    expect(computeAxisAutoPanDelta(request)).toBe(10);
    expect(computeAxisAutoPanDelta({ ...request, pointerPosition: 105, scrollPosition: 8 })).toBe(-8);
    expect(computeAxisAutoPanDelta({ ...request, scrollSize: 300 })).toBe(0);
  });

  it("keeps active drag auto pan inside scroll boundaries by an inset", () => {
    const request = {
      pointerPosition: 105,
      viewportStart: 100,
      viewportEnd: 400,
      scrollPosition: 5,
      scrollSize: 900,
      viewportSize: 300,
      edgeSize: 48,
      maxDelta: 24,
      scrollBoundaryInset: 1,
    };

    expect(computeAxisAutoPanDelta(request)).toBe(-4);
    expect(computeAxisAutoPanDelta({ ...request, scrollPosition: 0 })).toBe(0);
    expect(computeAxisAutoPanDelta({ ...request, pointerPosition: 395, scrollPosition: 596 })).toBe(3);
    expect(computeAxisAutoPanDelta({ ...request, pointerPosition: 395, scrollPosition: 600 })).toBe(0);
  });

  it("fails early for invalid axis rail auto pan geometry", () => {
    expect(() => computeAxisAutoPanDelta({
      pointerPosition: 120,
      viewportStart: 200,
      viewportEnd: 200,
      scrollPosition: 0,
      scrollSize: 900,
      viewportSize: 300,
      edgeSize: 48,
      maxDelta: 24,
    })).toThrow("viewportEnd must be greater than viewportStart");
    expect(() => computeAxisAutoPanDelta({
      pointerPosition: 120,
      viewportStart: 100,
      viewportEnd: 400,
      scrollPosition: 0,
      scrollSize: 900,
      viewportSize: 300,
      edgeSize: 0,
      maxDelta: 24,
    })).toThrow("edgeSize must be a positive finite number");
  });

  it("resolves rail row numbers from visible track positions", () => {
    expect(resolveHeaderRowNumberAtTrackY(38, [
      { number: 1, top: 0, height: 24 },
      { number: 2, top: 24, height: 24 },
    ])).toBe(2);
    expect(resolveBodyRowNumberAtTrackY(62, [
      { rowKey: "r3", number: 3, top: 0, height: 28 },
      { rowKey: "r4", number: 4, top: 28, height: 28 },
      { rowKey: "r5", number: 5, top: 56, height: 28 },
    ])).toBe(5);
  });

  it("maps collapsed subtree row boundaries to the visible subtree edge", () => {
    const visibleRows = [
      gridRow(BODY_ROWS[0], true),
      gridRow(BODY_ROWS[3]),
      gridRow(BODY_ROWS[4]),
    ];
    expect(resolveBodyRowDropGap(19, [
      { rowKey: "r3", number: 3, top: 0, height: 28 },
      { rowKey: "r6", number: 6, top: 28, height: 28 },
      { rowKey: "r7", number: 7, top: 56, height: 28 },
    ], visibleRows, BODY_ROWS)).toBe(5);
  });
});
