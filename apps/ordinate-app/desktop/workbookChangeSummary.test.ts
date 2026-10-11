import { describe, expect, it } from "vitest";
import { workbookChangeSummary } from "./workbookChangeSummary";

describe("content-free workbook change summary", () => {
  it("counts replacements, insertions and deletions without keeping source lines", () => {
    expect(workbookChangeSummary("# A\n| Old |\n", "# A\n| New |\n| Extra |\n")).toEqual({
      beforeLines: 2, afterLines: 3, changedLines: 1, addedLines: 1, removedLines: 0,
      sameLineContents: false, beforeBytes: 12, afterBytes: 22,
    });
    expect(workbookChangeSummary("a\nb\n", "a\n").removedLines).toBe(1);
  });

  it("identifies unchanged line contents even when order or final newline differs", () => {
    expect(workbookChangeSummary("a\nb\n", "b\na\n")).toMatchObject({ changedLines: 0, addedLines: 0, removedLines: 0, sameLineContents: true });
    expect(workbookChangeSummary("a\nb\n", "a\nb")).toMatchObject({ sameLineContents: true });
    expect(() => workbookChangeSummary("a", "a")).toThrow("different source");
  });
});
