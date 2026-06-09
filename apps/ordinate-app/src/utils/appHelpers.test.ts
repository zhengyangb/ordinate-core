import { describe, expect, it } from "vitest";

import { buildRowRailMenu } from "./appHelpers";

describe("app rail menu helpers", () => {
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
});
