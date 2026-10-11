import { describe, expect, it } from "vitest";
import { buildHeaderOverlayCells } from "./headerOverlayCells";

describe("shared header overlay geometry", () => {
  it("groups multilevel headers and keeps exact cell positions", () => {
    const columns = [
      { colIndex: 0, left: 0, width: 160 },
      { colIndex: 1, left: 160, width: 80 },
      { colIndex: 2, left: 240, width: 80 },
    ];
    const cells = buildHeaderOverlayCells(columns, [
      ["Item", "2025", "2025"],
      ["Item", "H1", "H2"],
    ], 1);
    expect(cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "2025", startCol: 1, endCol: 2, left: 160, width: 160, top: 0 }),
      expect.objectContaining({ label: "H2", startCol: 2, endCol: 2, left: 240, width: 80, top: 40 }),
    ]));
  });
});
