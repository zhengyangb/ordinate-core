import { describe, expect, it } from "vitest";
import { makeCellSelection, makeRangeSelection, makeRowSelection, rowSelectionRegion, selectionContainsCell } from "./selectionModel";
import type { SheetSelection } from "../types/ui";

describe("context selection containment", () => {
  it("preserves a whole-row selection when right-clicking any of its columns", () => {
    const selection = makeRowSelection(1, 2);
    expect(selectionContainsCell(selection,{rAbs:1,cAbs:0})).toBe(true);
    expect(selectionContainsCell(selection,{rAbs:2,cAbs:8})).toBe(true);
    expect(selectionContainsCell(selection,{rAbs:3,cAbs:0})).toBe(false);
  });
  it("preserves whole columns across rows, but not neighboring columns", () => {
    const selection: SheetSelection = {kind:"column",colIndex:2,anchorColIndex:1,colStart:1,colEnd:2};
    expect(selectionContainsCell(selection,{rAbs:12,cAbs:1})).toBe(true);
    expect(selectionContainsCell(selection,{rAbs:1,cAbs:0})).toBe(false);
  });
  it("uses both bounds for cells and rectangular selections", () => {
    const range = makeRangeSelection({rAbs:1,cAbs:0},{rAbs:2,cAbs:1});
    expect(selectionContainsCell(range,{rAbs:2,cAbs:1})).toBe(true);
    expect(selectionContainsCell(range,{rAbs:2,cAbs:2})).toBe(false);
    expect(selectionContainsCell(range,{rAbs:3,cAbs:1})).toBe(false);
    expect(selectionContainsCell(makeCellSelection({rAbs:1,cAbs:0}),{rAbs:1,cAbs:0})).toBe(true);
    expect(selectionContainsCell(null,{rAbs:1,cAbs:0})).toBe(false);
  });
});

describe("row selection geometry", () => {
  it("selects across the header/body boundary in either direction", () => {
    for (const [anchor, focus] of [[1, 5], [5, 1]]) {
      const selection = makeRowSelection(anchor, focus);
      expect(selection).toEqual({kind:"row",rowNumber:focus,anchorRowNumber:anchor,rowStart:1,rowEnd:5});
      expect(rowSelectionRegion(selection, 2)).toBe("mixed");
      expect(selectionContainsCell(selection, {rAbs:2,cAbs:0})).toBe(true);
      expect(selectionContainsCell(selection, {rAbs:3,cAbs:4})).toBe(true);
    }
  });
  it("derives command regions from the complete bounds, not the focused row", () => {
    expect(rowSelectionRegion(makeRowSelection(1, 2), 2)).toBe("header");
    expect(rowSelectionRegion(makeRowSelection(5, 3), 2)).toBe("body");
    expect(rowSelectionRegion(makeRowSelection(1, 3), 0)).toBe("body");
    expect(() => makeRowSelection(0, 3)).toThrow("valid consecutive rows");
  });
});
