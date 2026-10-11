import { describe, expect, it } from "vitest";
import { DocumentState } from "@ordinate/core";
import { appendPreviewBursts, previewAnchorKeys, previewBurstsAtCell, previewChanges } from "./previewDiff";

const source = `# Plan
| Item || Jan | Feb |
| --- || --- | --- |
| Revenue || 100 | 120 |
| Costs || 40 | 50 |
`;

describe("assistant draft change locations", () => {
  it("keeps an earlier sparkle alive when another workbook change arrives", () => {
    const first = { sheet: "Plan", rowKey: "body:Revenue", columnKey: "Jan", kind: "cell" as const };
    const second = { sheet: "Plan", rowKey: "body:Costs", columnKey: "Jan", kind: "cell" as const };
    const initial = appendPreviewBursts([], [first], 0, 0);
    const updated = appendPreviewBursts(initial, [second], 280, 1);
    expect(updated.map(burst => burst.id)).toEqual([0, 1]);
    expect(updated[0].expiresAt).toBe(960);
    expect(appendPreviewBursts(updated, [], 961, 2).map(burst => burst.id)).toEqual([1]);
  });
  it("marks one edited cell without marking the rest of the table", () => {
    const changes = previewChanges(DocumentState.fromText(source), DocumentState.fromText(source.replace("100", "110")));
    expect(changes).toEqual([{ sheet: "Plan", rowKey: "body:Revenue", columnKey: "Jan", kind: "cell" }]);
  });

  it("marks an inserted row rather than shifted cells beneath it", () => {
    const changed = source.replace("| Costs", "| Margin || 60 | 70 |\n| Costs");
    expect(previewChanges(DocumentState.fromText(source), DocumentState.fromText(changed)))
      .toEqual([{ sheet: "Plan", rowKey: "body:Margin", kind: "row" }]);
  });

  it("anchors ongoing sparkles to rows after an insertion shifts their indexes", () => {
    const old = DocumentState.fromText(source);
    const edited = DocumentState.fromText(source.replace("40", "45"));
    const inserted = DocumentState.fromText(source.replace("| Costs", "| Margin || 60 | 70 |\n| Costs").replace("40", "45"));
    const first = appendPreviewBursts([], previewChanges(old, edited), 0, 0);
    const bursts = appendPreviewBursts(first, previewChanges(edited, inserted), 280, 1);
    const anchors = previewAnchorKeys(inserted.sheets[0]);
    expect(previewBurstsAtCell(bursts, "Plan", anchors, 2, 0).map(burst => burst.kind)).toEqual(["row"]);
    expect(previewBurstsAtCell(bursts, "Plan", anchors, 3, 1).map(burst => burst.kind)).toEqual(["cell"]);
    expect(previewBurstsAtCell(bursts, "Plan", anchors, 2, 1)).toEqual([]);
  });

  it("marks a new column at its header", () => {
    const changed = source.replaceAll(" | Feb |", " | Feb | Mar |").replaceAll(" | --- |\n", " | --- | --- |\n")
      .replace("| 100 | 120 |", "| 100 | 120 | 140 |").replace("| 40 | 50 |", "| 40 | 50 | 60 |");
    expect(previewChanges(DocumentState.fromText(source), DocumentState.fromText(changed)))
      .toEqual([{ sheet: "Plan", columnKey: "Mar", kind: "column" }]);
  });
});
