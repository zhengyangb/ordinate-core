import { describe, expect, it } from "vitest";

import { projectSelectionOverlayFragments, resolveSelectionOverlayPlane } from "./selectionRing";

const columns = [
  { colIndex: 0, left: 0, width: 120 },
  { colIndex: 1, left: 120, width: 80 },
  { colIndex: 2, left: 200, width: 100 },
];
const headerRows = [
  { number: 1, top: 0, height: 30 },
  { number: 2, top: 30, height: 30 },
];
const bodyRows = [
  { rowKey: "r3", number: 3, top: 0, height: 28 },
  { rowKey: "r4", number: 4, top: 28, height: 28 },
  { rowKey: "r5", number: 5, top: 56, height: 28 },
];

describe("selection overlay planes", () => {
  it("resolves all four frozen table planes", () => {
    expect(resolveSelectionOverlayPlane("header", 0, 1)).toBe("header-pinned");
    expect(resolveSelectionOverlayPlane("header", 2, 1)).toBe("header-center");
    expect(resolveSelectionOverlayPlane("body", 0, 1)).toBe("body-pinned");
    expect(resolveSelectionOverlayPlane("body", 2, 1)).toBe("body-center");
  });

  it("treats every column as center when no columns are frozen", () => {
    expect(resolveSelectionOverlayPlane("body", 0, 0)).toBe("body-center");
  });

  it("fails early for invalid plane geometry", () => {
    expect(() => resolveSelectionOverlayPlane("body", -1, 1)).toThrow(
      "selection overlay column index must be a non-negative integer",
    );
    expect(() => resolveSelectionOverlayPlane("body", 1, -1)).toThrow(
      "selection overlay header column count must be a non-negative integer",
    );
  });
});

describe("selection overlay projection", () => {
  const base = {
    headerRowCount: 2,
    headerColCount: 1,
    pinnedWidth: 120,
    columnMetrics: columns,
    headerIndexMetrics: headerRows,
    rowIndexMetrics: bodyRows,
  };

  it("projects a body cell in center-track coordinates", () => {
    expect(projectSelectionOverlayFragments({
      ...base,
      range: { rowStart: 4, rowEnd: 4, colStart: 2, colEnd: 2 },
    })).toEqual([
      { plane: "body-center", left: 80, top: 28, width: 100, height: 28 },
    ]);
  });

  it("splits a range across frozen rows and columns into four fragments", () => {
    expect(projectSelectionOverlayFragments({
      ...base,
      range: { rowStart: 2, rowEnd: 4, colStart: 0, colEnd: 2 },
    })).toEqual([
      { plane: "header-pinned", left: 0, top: 30, width: 120, height: 30 },
      { plane: "header-center", left: 0, top: 30, width: 180, height: 30 },
      { plane: "body-pinned", left: 0, top: 0, width: 120, height: 56 },
      { plane: "body-center", left: 0, top: 0, width: 180, height: 56 },
    ]);
  });

  it("returns no visible fragment when a collapsed endpoint has no row metric", () => {
    expect(projectSelectionOverlayFragments({
      ...base,
      range: { rowStart: 4, rowEnd: 6, colStart: 1, colEnd: 1 },
    })).toEqual([]);
  });

  it("preserves two frozen columns and two header rows when a selection crosses both boundaries", () => {
    expect(projectSelectionOverlayFragments({
      ...base,
      headerColCount: 2,
      pinnedWidth: 200,
      range: { rowStart: 1, rowEnd: 4, colStart: 0, colEnd: 2 },
    })).toEqual([
      { plane: "header-pinned", left: 0, top: 0, width: 200, height: 60 },
      { plane: "header-center", left: 0, top: 0, width: 100, height: 60 },
      { plane: "body-pinned", left: 0, top: 0, width: 200, height: 56 },
      { plane: "body-center", left: 0, top: 0, width: 100, height: 56 },
    ]);
  });

  it("fails early for malformed geometry instead of guessing", () => {
    expect(() => projectSelectionOverlayFragments({
      ...base,
      range: { rowStart: 4, rowEnd: 3, colStart: 0, colEnd: 0 },
    })).toThrow("selection overlay range must be normalized");
    expect(() => projectSelectionOverlayFragments({
      ...base,
      columnMetrics: [...columns, columns[0]],
      range: { rowStart: 3, rowEnd: 3, colStart: 0, colEnd: 0 },
    })).toThrow("duplicate selection overlay column metric: 0");
  });
});
