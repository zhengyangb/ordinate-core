import { describe, expect, it } from "vitest";
import type { GridRow } from "../types/ui";
import { EMPTY_COLUMN_WIDTH, resolveColumnLayouts } from "./columnLayout";

function wideLayouts(rows: GridRow[], headers: string[], headerColCount: number) {
  // These pre-existing layout assertions cover the original standard behavior, now named Wide.
  return resolveColumnLayouts(rows, headers, headerColCount, "wide");
}

function row(cells: Array<[string, string]>, depth = 0): GridRow {
  return Object.assign({ __rowKey: "r1", __rowId: 1, __rowPath: "row", __absoluteRowNumber: 1,
    __depth: depth, __hasChildren: false, __collapsed: false },
  ...cells.map(([text, kind], index) => ({ [`col_${index}`]: text, [`__kind_${index}`]: kind })));
}

describe("content-driven column layout", () => {
  it("keeps dense numeric reports compact despite a text heading and errors", () => {
    const rows = [row(Array.from({ length: 8 }, () => ["Quarter", "string"]))];
    for (let i = 0; i < 12; i++) rows.push(row(Array.from({ length: 8 }, () => ["1,234.5", "number"])));
    rows.push(row(Array.from({ length: 8 }, () => ["Very long error description", "error"])));
    const columns = wideLayouts(rows, Array.from({ length: 8 }, (_, i) => `${i}`), 0);
    expect(columns.every(c => c.width <= 112 && c.wrapText)).toBe(true);
  });
  it("fits date displays and narrows only internal empty spacers", () => {
    const cells: Array<[string,string]> = [["2026-01-02","date"],["","blank"],["123.4","number"],["5","number"],["6","number"],["7","number"],["","blank"]];
    const columns = wideLayouts([row(cells)], ["A","B","C","D","E","F","G"],0);
    expect(columns[0].width).toBeGreaterThanOrEqual(112);
    expect(columns[1].width).toBe(32);
    expect(columns[6].width).toBe(EMPTY_COLUMN_WIDTH);
  });
  it.each([
    ["1/1/2026", "date"],
    ["01.01.2026", "date"],
    ["2026-01-01", "date"],
    ["1/1/2026, 11:59:59 PM", "datetime"],
    ["2026-01-01T23:59:59+05:30", "datetime"],
    ["11:59:59 PM", "time"],
    ["100 hr, 30 min, 12 sec", "duration"],
  ])("fits a lone %s display in a dense numeric report without widening its peers", (text, kind) => {
    const rows = Array.from({ length: 20 }, () => row(Array.from({ length: 4 }, () => ["120", "number"])));
    const baseline = wideLayouts(rows, ["A", "B", "C", "D"], 0);
    const columns = wideLayouts([...rows, row([[text, kind], ["", "blank"], ["", "blank"], ["", "blank"]])], ["A", "B", "C", "D"], 0);
    expect(columns[0].width).toBeGreaterThanOrEqual(text.length * 8 + 32);
    expect(columns[0].wrapText).toBe(false);
    expect(columns.slice(1)).toEqual(baseline.slice(1));
  });
  it("sizes temporal-only columns using their actual display, not a boolean or numeric cap", () => {
    const text = "1/1/2026, 11:59:59 PM";
    const column = wideLayouts([row([[text, "datetime"]]), row([["true", "boolean"]])], ["When"], 0)[0];
    expect(column.width).toBeGreaterThanOrEqual(text.length * 8 + 32);
    expect(column.autoHeight).toBe(false);
  });
  it("sizes appended empty columns exactly like their preview, independent of preceding content", () => {
    for (const [text, kind] of [["A long note. ".repeat(20), "string"], ["123456789", "number"], ["true", "boolean"]]) {
      const columns = wideLayouts([row([[text, kind], ["", "blank"], ["", "blank"]])], ["B", "C", "D"], 0);
      expect(columns.slice(1)).toEqual(Array.from({ length: 2 }, () => ({
        width: EMPTY_COLUMN_WIDTH, wrapText: false, autoHeight: false,
      })));
    }
  });
  it("uses equal compact widths for comparable numeric columns without wrapping numbers", () => {
    const columns = wideLayouts([row([["Revenue", "label"], ["12", "number"], ["123456.00", "number"]])], ["Line Item", "H1", "H2"], 1);
    expect(columns[0].width).toBeGreaterThan(columns[1].width);
    expect(columns[1].width).toBe(columns[2].width);
    expect(columns[1].width).toBeLessThanOrEqual(176);
    expect(columns[1].wrapText).toBe(false);
  });
  it("uses the compact floor for short numbers even without four numeric peers", () => {
    for (const count of [1, 2, 3, 4, 8]) {
      const columns = wideLayouts([row(Array.from({ length: count }, () => ["12", "number"]))], Array.from({ length: count }, () => "Value"), 0);
      expect(columns.every(column => column.width === 80 && !column.wrapText)).toBe(true);
    }
  });
  it("keeps Hours and Fee compact beside timestamps, durations and Boolean controls", () => {
    const columns = wideLayouts([row([
      ["6/1/2026, 9:00:00 AM Z", "datetime"], ["2 hr", "duration"],
      ["2", "number"], ["false", "boolean"], ["250", "number"],
    ])], ["Start", "Elapsed", "Hours", "Billable", "Fee"], 0);
    expect(columns[2].width).toBe(80);
    expect(columns[4].width).toBe(80);
    expect(columns[0].width).toBeGreaterThan(160);
    expect(columns[3].width).toBeGreaterThanOrEqual(96);
  });
  it("still grows numeric columns for formatted values and longer headers", () => {
    expect(wideLayouts([row([["12,000,000", "number"]])], ["Value"], 0)[0].width).toBeGreaterThanOrEqual(112);
    expect(wideLayouts([row([["12", "number"]])], ["Monthly payment"], 0)[0].width).toBeGreaterThan(80);
  });
  it("wraps long prose at a bounded width and lets the grid measure row height", () => {
    expect(wideLayouts([row([["A long note. ".repeat(100), "string"]])], ["Notes"], 0)[0])
      .toEqual({ width: 320, wrapText: true, autoHeight: true });
  });
  it("does not allow one long outlier to widen a short-text column", () => {
    const rows = Array.from({ length: 9 }, () => row([["Ready", "string"]]));
    const usual = wideLayouts(rows, ["Status"], 0);
    expect(wideLayouts([...rows, row([["Long note ".repeat(100), "string"]])], ["Status"], 0)).toEqual(usual);
  });
  it("accounts for wide scripts and hierarchy indentation", () => {
    const text = "预计本季度运营收入同比持续增长";
    expect(wideLayouts([row([[text, "label"]], 4)], ["项目"], 1)[0].width)
      .toBeGreaterThan(wideLayouts([row([["Short", "label"]])], ["Item"], 1)[0].width);
  });
  it("wraps mixed text columns, bounds booleans, and handles empty sheets", () => {
    expect(wideLayouts([row([["12", "number"]]), row([["Long text", "string"]])], ["Mixed"], 0)[0].autoHeight).toBe(true);
    expect(wideLayouts([row([["true", "boolean"]])], ["Flag"], 0)[0].width).toBe(96);
    expect(wideLayouts([], [], 0)).toEqual([]);
    expect(() => wideLayouts([], [], 1)).toThrow("invalid header column count");
  });
  it("keeps uniformly short values compact despite long headings", () => {
    const rows = Array.from({ length: 8 }, () => row([["12", "number"], ["true", "boolean"]]));
    const headers = ["Projected operating cash flow", "Eligible for reimbursement"];
    const wide = resolveColumnLayouts(rows, headers, 0, "wide");
    const standard = resolveColumnLayouts(rows, headers, 0, "standard");
    expect(standard[0].width).toBeLessThan(wide[0].width);
    expect(standard[1].width).toBeLessThan(wide[1].width);
    expect(standard[0].width).toBe(112);
    expect(standard[1].width).toBe(112);
  });
  it("preserves full value width for long numeric and temporal displays in standard mode", () => {
    const rows = [row([["12,000,000", "number"], ["2026-01-01T23:59:59+05:30", "datetime"]])];
    const columns = resolveColumnLayouts(rows, ["Amount", "Timestamp"], 0, "standard");
    expect(columns[0].width).toBeGreaterThanOrEqual(10 * 8 + 24);
    expect(columns[1].width).toBeGreaterThanOrEqual(25 * 8 + 24);
  });
});
