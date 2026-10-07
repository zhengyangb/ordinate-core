import type { CellPosition, TabToNextCellParams } from "ag-grid-community";
import { describe, expect, it, vi } from "vitest";
import { tabToNextBodyCell } from "./tabNavigation";

const position = (rowIndex: number, rowPinned: CellPosition["rowPinned"] = null): CellPosition => ({
  rowIndex, rowPinned, column: {} as CellPosition["column"],
});
const params = (overrides: Partial<TabToNextCellParams> = {}): TabToNextCellParams => ({
  backwards: false, editing: false,
  previousCellPosition: position(4), nextCellPosition: null,
  ...overrides,
} as TabToNextCellParams);

describe("spreadsheet Tab navigation", () => {
  it("appends exactly one row at the forward body boundary and consumes Tab", () => {
    const append = vi.fn();
    expect(tabToNextBodyCell(params(), true, append)).toBe(true);
    expect(append).toHaveBeenCalledExactlyOnceWith(1, 0);
  });
  it.each([false, true])("preserves ordinary navigation, backwards=%s", (backwards) => {
    const next = position(3);
    const append = vi.fn();
    expect(tabToNextBodyCell(params({ backwards, nextCellPosition: next }), true, append)).toBe(next);
    expect(append).not.toHaveBeenCalled();
  });
  it("lets Shift+Tab leave the start of the grid without appending", () => {
    const append = vi.fn();
    expect(tabToNextBodyCell(params({ backwards: true, previousCellPosition: position(0) }), true, append)).toBe(false);
    expect(append).not.toHaveBeenCalled();
  });
  it("does not hand forward boundary focus to Add note on a read-only sheet", () => {
    const append = vi.fn();
    expect(tabToNextBodyCell(params(), false, append)).toBe(true);
    expect(append).not.toHaveBeenCalled();
  });
  it.each([position(-1), position(0, "top"), position(0, "bottom")])("never appends from a header or pinned row", (previousCellPosition) => {
    const append = vi.fn();
    expect(tabToNextBodyCell(params({ previousCellPosition }), true, append)).toBe(false);
    expect(append).not.toHaveBeenCalled();
  });
});
