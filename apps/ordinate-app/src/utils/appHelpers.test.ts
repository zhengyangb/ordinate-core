import { describe, expect, it } from "vitest";

import {
  buildRowRailMenu,
  resolveColumnDeleteTargets,
  resolveGridInstanceKey,
  resolveRowDeleteTargets,
} from "./appHelpers";

describe("app rail menu helpers", () => {
  it("keys grid instances by stable sheet identity and sizing mode", () => {
    expect(resolveGridInstanceKey(1, 5, 1, 2)).not.toBe(
      resolveGridInstanceKey(2, 2, 0, 0),
    );
    expect(resolveGridInstanceKey(2, 2, 0, 0)).toContain("plain-data-columns");
    expect(resolveGridInstanceKey(1, 5, 1, 2)).toContain("multi-data-column");
    expect(resolveGridInstanceKey(1, 5, 1, 2)).toBe(
      resolveGridInstanceKey(1, 8, 1, 2),
    );
    expect(resolveGridInstanceKey(3, 2, 1, 2)).not.toBe(
      resolveGridInstanceKey(3, 3, 1, 2),
    );
  });

  it("fails early when a grid instance key cannot describe a valid sheet layout", () => {
    expect(() => resolveGridInstanceKey(0, 2, 1, 1)).toThrow("grid instance key requires a positive sheet id");
    expect(() => resolveGridInstanceKey(1, 1, 2, 1)).toThrow(
      "headerColCount must be a non-negative integer within sheetColCount",
    );
  });

  it("builds row display-edit metadata from presentation row defaults", () => {
    const menu = buildRowRailMenu(
      { rowNumber: 2, area: "body", hasChildren: false },
      {
        colCount: 3,
        rowIds: [100, 101, 102],
        colLabels: ["Item", "Price", "Qty"],
        headerRowCount: 1,
        bodyStart: 1,
        cells: [],
      },
      {
        colLabels: ["Item", "Price", "Qty"],
        rowPaths: ["A", "B"],
        values: [
          [{ kind: "string", value: "A" }, { kind: "number", value: 12.34 }, { kind: "number", value: 2 }],
          [{ kind: "string", value: "B" }, { kind: "number", value: 56.78 }, { kind: "number", value: 3 }],
        ],
      },
      {
        columnDefaults: [],
        rowDefaults: [
          undefined,
          {
            formatLayer: {
              local: {
                kind: "numeric",
                type: "f",
                precision: 1,
                grouping: true,
                sign: "default",
                padWidth: null,
              },
            },
            styleLayer: {
              local: { align: "right", weight: null, color: "blue" },
            },
            valid: true,
            errors: [],
          },
        ],
      },
      1,
    );

    expect(menu).toMatchObject({
      kind: "row",
      rowId: 101,
      rowPath: "A",
      canDisplayEdit: true,
      hasLocalConfig: true,
      formatLocalKey: "decimal",
      formatLocalOptions: {
        kind: "numeric",
        grouping: true,
        precision: 1,
      },
      formatPreviewContext: {
        value: { kind: "number", value: 12.34 },
        scope: "row",
      },
      styleLocal: {
        align: "right",
        weight: "auto",
        color: "blue",
      },
    });
  });

  it("does not offer row display editing for header rows", () => {
    const menu = buildRowRailMenu(
      { rowNumber: 1, area: "header", hasChildren: false },
      {
        colCount: 3,
        rowIds: [100, 101],
        colLabels: ["Item", "Price", "Qty"],
        headerRowCount: 1,
        bodyStart: 1,
        cells: [],
      },
      {
        colLabels: ["Item", "Price", "Qty"],
        rowPaths: ["A"],
        values: [[{ kind: "string", value: "A" }, { kind: "number", value: 12.34 }, { kind: "number", value: 2 }]],
      },
      { columnDefaults: [], rowDefaults: [] },
      1,
    );

    expect(menu).toMatchObject({
      kind: "row",
      rowId: 100,
      canDisplayEdit: false,
      hasLocalConfig: false,
      formatLocalKey: "auto",
      formatLocalOptions: null,
      formatPreviewContext: { value: null, scope: "sample" },
      styleLocal: { align: "auto", weight: "auto", color: "auto" },
    });
  });

  it("deletes every selected data column when the menu target is inside the selection", () => {
    expect(resolveColumnDeleteTargets(
      3,
      { kind: "column", colIndex: 3, anchorColIndex: 2, colStart: 2, colEnd: 4 },
      1,
      6,
    )).toEqual([2, 3, 4]);
  });

  it("deletes only the menu target when a data column selection does not contain it", () => {
    expect(resolveColumnDeleteTargets(
      5,
      { kind: "column", colIndex: 3, anchorColIndex: 2, colStart: 2, colEnd: 4 },
      1,
      7,
    )).toEqual([5]);
  });

  it("resolves selected header rows to node deletes", () => {
    const targets = resolveRowDeleteTargets(
      2,
      "header",
      102,
      { kind: "row", rowNumber: 2, area: "header", anchorRowNumber: 1, rowStart: 1, rowEnd: 2 },
      {
        colCount: 3,
        rowIds: [101, 102, 103, 104],
        colLabels: ["A", "B", "C"],
        headerRowCount: 2,
        bodyStart: 2,
        cells: [],
      },
      [],
    );

    expect(targets).toEqual([
      { rowNumber: 1, rowId: 101, mode: "node", deletedRowCount: 1 },
      { rowNumber: 2, rowId: 102, mode: "node", deletedRowCount: 1 },
    ]);
  });

  it("collapses selected child rows under a selected subtree delete", () => {
    const targets = resolveRowDeleteTargets(
      3,
      "body",
      201,
      { kind: "row", rowNumber: 4, area: "body", anchorRowNumber: 3, rowStart: 3, rowEnd: 5 },
      {
        colCount: 3,
        rowIds: [101, 102, 201, 202, 203, 204],
        colLabels: ["A", "B", "C"],
        headerRowCount: 2,
        bodyStart: 2,
        cells: [],
      },
      [
        {
          rowId: 201,
          bodyRowIndex: 0,
          absoluteRowIndex: 2,
          absoluteRowNumber: 3,
          rowPath: "Revenue",
          label: "Revenue",
          depth: 0,
          hasChildren: true,
          subtreeRowCount: 3,
        },
        {
          rowId: 202,
          bodyRowIndex: 1,
          absoluteRowIndex: 3,
          absoluteRowNumber: 4,
          rowPath: "Revenue.Product A",
          label: "Product A",
          depth: 1,
          hasChildren: false,
          subtreeRowCount: 1,
        },
        {
          rowId: 203,
          bodyRowIndex: 2,
          absoluteRowIndex: 4,
          absoluteRowNumber: 5,
          rowPath: "Revenue.Product B",
          label: "Product B",
          depth: 1,
          hasChildren: false,
          subtreeRowCount: 1,
        },
        {
          rowId: 204,
          bodyRowIndex: 3,
          absoluteRowIndex: 5,
          absoluteRowNumber: 6,
          rowPath: "Gross Profit",
          label: "Gross Profit",
          depth: 0,
          hasChildren: false,
          subtreeRowCount: 1,
        },
      ],
    );

    expect(targets).toEqual([
      { rowNumber: 3, rowId: 201, mode: "subtree", deletedRowCount: 3 },
    ]);
  });
});
