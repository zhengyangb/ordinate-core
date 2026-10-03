import { describe, expect, it } from "vitest";
import type { GridRow } from "../types/ui";
import { EMPTY_COLUMN_WIDTH, resolveColumnLayouts } from "./columnLayout";

function row(cells: Array<[string, string]>, depth = 0): GridRow {
  return Object.assign({ __rowKey: "r1", __rowId: 1, __rowPath: "row", __absoluteRowNumber: 1,
    __depth: depth, __hasChildren: false, __collapsed: false },
  ...cells.map(([text, kind], index) => ({ [`col_${index}`]: text, [`__kind_${index}`]: kind })));
}

describe("content-driven column layout", () => {
  it("sizes appended empty columns exactly like their preview, independent of preceding content", () => {
    for (const [text, kind] of [["A long note. ".repeat(20), "string"], ["123456789", "number"], ["true", "boolean"]]) {
      const columns = resolveColumnLayouts([row([[text, kind], ["", "blank"], ["", "blank"]])], ["B", "C", "D"], 0);
      expect(columns.slice(1)).toEqual(Array.from({ length: 2 }, () => ({
        width: EMPTY_COLUMN_WIDTH, wrapText: false, autoHeight: false,
      })));
    }
  });
  it("uses equal compact widths for comparable numeric columns without wrapping numbers", () => {
    const columns = resolveColumnLayouts([row([["Revenue", "label"], ["12", "number"], ["123456.00", "number"]])], ["Line Item", "H1", "H2"], 1);
    expect(columns[0].width).toBeGreaterThan(columns[1].width);
    expect(columns[1].width).toBe(columns[2].width);
    expect(columns[1].width).toBeLessThanOrEqual(176);
    expect(columns[1].wrapText).toBe(false);
  });
  it("does not give a lone numeric column a 560px text-column width", () => {
    expect(resolveColumnLayouts([row([["12", "number"]])], ["Value"], 0)[0].width).toBe(112);
  });
  it("wraps long prose at a bounded width and lets the grid measure row height", () => {
    expect(resolveColumnLayouts([row([["A long note. ".repeat(100), "string"]])], ["Notes"], 0)[0])
      .toEqual({ width: 320, wrapText: true, autoHeight: true });
  });
  it("does not allow one long outlier to widen a short-text column", () => {
    const rows = Array.from({ length: 9 }, () => row([["Ready", "string"]]));
    const usual = resolveColumnLayouts(rows, ["Status"], 0);
    expect(resolveColumnLayouts([...rows, row([["Long note ".repeat(100), "string"]])], ["Status"], 0)).toEqual(usual);
  });
  it("accounts for wide scripts and hierarchy indentation", () => {
    const text = "预计本季度运营收入同比持续增长";
    expect(resolveColumnLayouts([row([[text, "label"]], 4)], ["项目"], 1)[0].width)
      .toBeGreaterThan(resolveColumnLayouts([row([["Short", "label"]])], ["Item"], 1)[0].width);
  });
  it("wraps mixed text columns, bounds booleans, and handles empty sheets", () => {
    expect(resolveColumnLayouts([row([["12", "number"]]), row([["Long text", "string"]])], ["Mixed"], 0)[0].autoHeight).toBe(true);
    expect(resolveColumnLayouts([row([["true", "boolean"]])], ["Flag"], 0)[0].width).toBe(96);
    expect(resolveColumnLayouts([], [], 0)).toEqual([]);
    expect(() => resolveColumnLayouts([], [], 1)).toThrow("invalid header column count");
  });
});
