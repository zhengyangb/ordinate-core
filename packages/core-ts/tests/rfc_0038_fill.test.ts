import { describe, expect, it } from "vitest";
import { DocumentState, applyBatchWithUndo, applyCoreEditMemento, getCellTextView, planFillRegion, serializeDocumentState, type CoreFillRect, type CoreRegionTarget } from "../src";

const rect = (r0: number, r1: number, c0 = 0, c1 = c0): CoreFillRect => ({ rowStart: r0, rowEnd: r1, colStart: c0, colEnd: c1 });
const doc = (rows: string[][]) => DocumentState.fromText(`# Sheet\n${rows.map(row => `| ${row.join(" | ")} |`).join("\n")}`);
const plan = (rows: string[][], source: CoreFillRect, target: CoreFillRect, mode: "auto" | "copy" | "series" = "auto") => planFillRegion(doc(rows).sheets[0], source, target, mode);
const region = (document: DocumentState, area: CoreFillRect): CoreRegionTarget => {
  const sheet = document.sheets[0];
  return { sheet: sheet.name, start: { rowId: sheet.rowIds[area.rowStart], colId: sheet.colIds[area.colStart] }, end: { rowId: sheet.rowIds[area.rowEnd], colId: sheet.colIds[area.colEnd] } };
};

describe("RFC-0038: deterministic fill", () => {
  it("skips explicit rows in seeds and destinations while keeping series contiguous", () => {
    const sheet = doc([["1"], ["99"], ["2"], ["88"], ["0"], ["0"]]).sheets[0];
    expect(planFillRegion(sheet, rect(0, 2), rect(3, 5), "auto", [1, 3]).values).toEqual([["88"], ["3"], ["4"]]);
    expect(planFillRegion(sheet, rect(0, 2), rect(3, 5), "copy", [1, 3]).values).toEqual([["88"], ["1"], ["2"]]);
    const reverse = doc([["0"], ["99"], ["0"], ["5"], ["7"]]).sheets[0];
    expect(planFillRegion(reverse, rect(3, 4), rect(0, 2), "auto", [1]).values).toEqual([["1"], ["99"], ["3"]]);
  });
  it("uses physical offsets for formulas and excludes horizontal lanes", () => {
    const sheet = doc([["= A1"], ["99"], ["0"]]).sheets[0];
    expect(planFillRegion(sheet, rect(0, 0), rect(1, 2), "copy", [1]).values).toEqual([["99"], ["= A3"]]);
    const horizontal = doc([["1", "0"], ["8", "99"], ["3", "0"]]).sheets[0];
    expect(planFillRegion(horizontal, rect(0, 2), rect(0, 2, 1), "series", [1]).values).toEqual([["2"], ["99"], ["4"]]);
  });
  it("rejects invalid exclusions and empty effective ranges", () => {
    const sheet = doc([["1"], ["2"], ["3"]]).sheets[0];
    for (const rows of [[-1], [3], [1, 1], [0], [1, 2]]) {
      expect(() => planFillRegion(sheet, rect(0, 0), rect(1, 2), "auto", rows)).toThrow();
    }
  });
  it("extends stepped numbers down, up, right and left", () => {
    expect(plan([["1"], ["3"], [""], [""]], rect(0, 1), rect(2, 3)).values).toEqual([["5"], ["7"]]);
    expect(plan([[""], [""], ["5"], ["7"]], rect(2, 3), rect(0, 1)).values).toEqual([["1"], ["3"]]);
    expect(plan([["1", "3", "", ""]], rect(0, 0, 0, 1), rect(0, 0, 2, 3)).values).toEqual([["5", "7"]]);
    expect(plan([["", "", "5", "7"]], rect(0, 0, 2, 3), rect(0, 0, 0, 1)).values).toEqual([["1", "3"]]);
  });
  it("copies a single number automatically and allows explicit sequence", () => {
    expect(plan([["8"], [""], [""]], rect(0, 0), rect(1, 2)).values).toEqual([["8"], ["8"]]);
    expect(plan([["8"], [""], [""]], rect(0, 0), rect(1, 2), "series").values).toEqual([["9"], ["10"]]);
  });
  it("handles negative and decimal steps without accumulated float noise", () => {
    expect(plan([["0.3"], ["0.2"], [""], [""]], rect(0, 1), rect(2, 3)).values).toEqual([["0.1"], ["0"]]);
  });
  it("repeats unknown and mixed patterns, blanks and booleans; copy mode always repeats", () => {
    expect(plan([["1"], ["3"], [""], [""]], rect(0, 1), rect(2, 3), "copy").values).toEqual([["1"], ["3"]]);
    expect(plan([["red"], [""], ["true"], [""], [""], [""]], rect(0, 2), rect(3, 5)).values).toEqual([["red"], [""], ["true"]]);
    expect(() => plan([["red"], [""]], rect(0, 0), rect(1, 1), "series")).toThrow(/no consistent series/);
    expect(plan([["1"], ["2"], ["4"], [""]], rect(0, 2), rect(3, 3)).values).toEqual([["1"]]);
  });
  it("infers each lane independently and preserves numbered text padding", () => {
    expect(plan([["1", '"Item 01"'], ["3", '"Item 03"'], ["", ""], ["", ""]], rect(0, 1, 0, 1), rect(2, 3, 0, 1)).values).toEqual([["5", '"Item 05"'], ["7", '"Item 07"']]);
    expect(plan([["1", "hello"], ["3", "world"], ["", ""]], rect(0, 1, 0, 1), rect(2, 2, 0, 1)).values).toEqual([["5", "hello"]]);
  });
  it("continues date and temporal intervals using core temporal arithmetic", () => {
    expect(plan([["2024-02-28"], [""], [""]], rect(0, 0), rect(1, 2)).values).toEqual([["2024-02-29"], ["2024-03-01"]]);
    expect(plan([["2024-01-01"], ["2024-01-03"], [""]], rect(0, 1), rect(2, 2)).values).toEqual([["2024-01-05"]]);
    expect(plan([["09:00"], ["09:30"], [""]], rect(0, 1), rect(2, 2)).values[0][0]).toMatch(/^10:00/);
    expect(plan([["P1D"], ["P3D"], [""]], rect(0, 1), rect(2, 2)).values).toEqual([["P5D"]]);
  });
  it("rebases parsed formula references without modifying string literals or fixed axes", () => {
    const result = plan([["= A1 + @[#1!,#1!] + @[#1,#1!]", ""], ["", ""], ["", ""]], rect(0, 0), rect(1, 2), "copy");
    expect(result.values).toEqual([["= A2 + @[#1!,#1!] + @[#2,#1!]"], ["= A3 + @[#1!,#1!] + @[#3,#1!]"]]);
    expect(plan([['= concat("A1", A1)', ""]], rect(0, 0), rect(0, 0, 1)).values[0][0]).toBe('= concat("A1", B1)');
    expect(plan([["= @[_-1,_] + @[#1!,#1!]"], [""]], rect(0, 0), rect(1, 1)).values[0][0]).toBe("= @[_-1,_] + @[#1!,#1!]");
  });
  it("handles ranges, cross-sheet references and nested array formulas", () => {
    expect(plan([["= sum(A1:B2)"], [""]], rect(0, 0), rect(1, 1)).values[0][0]).toBe("= sum(A2:B3)");
    expect(plan([["= @[Other::[#1,#1]]"], [""]], rect(0, 0), rect(1, 1)).values[0][0]).toBe("= @[Other::[#2,#1]]");
    expect(plan([["= [@[#1,#1], @[#1!,#1!]][0]"], [""]], rect(0, 0), rect(1, 1)).values[0][0]).toBe("= [@[#2,#1], @[#1!,#1!]][0]");
  });
  it("rejects diagonal, overlapping, disjoint, out of bounds and structural header targets", () => {
    const document = doc([["1", "2"], ["3", "4"], ["5", "6"]]);
    for (const target of [rect(1, 1, 1), rect(0, 1), rect(2, 2), rect(3, 3)]) {
      expect(() => planFillRegion(document.sheets[0], rect(0, 0), target)).toThrow();
    }
    const headed = DocumentState.fromText("# Sheet\n| Name || A | B |\n| --- || --- | --- |\n| Row || 1 | 2 |");
    expect(() => planFillRegion(headed.sheets[0], rect(1, 1, 1), rect(0, 0, 1))).toThrow(/data area/);
  });
  it("recalculates copied formulas, tracks dependencies and preserves the source", () => {
    const document = doc([["2", "= A1 * 2"], ["3", ""], ["4", ""]]);
    const applied = applyBatchWithUndo(document, [{ op: "fill_region", source: region(document, rect(0, 0, 1)), target: region(document, rect(1, 2, 1)), mode: "auto" }], { recalculate: true });
    if (!applied.ok) throw new Error(applied.error.message);
    expect(applied.nextDocument.evaluate().sheets[0].values.map(row => row[1])).toEqual([
      { kind: "number", value: 4 }, { kind: "number", value: 6 }, { kind: "number", value: 8 },
    ]);
    expect(getCellTextView(document.sheets[0].cells[1][1]).inputText).toBe("");
  });
  it("rolls back the entire edit when any lane rejects an explicit series", () => {
    const document = doc([["1", "hello"], ["3", "world"], ["99", "original"]]);
    const before = serializeDocumentState(document);
    const applied = applyBatchWithUndo(document, [{ op: "fill_region", source: region(document, rect(0, 1, 0, 1)), target: region(document, rect(2, 2, 0, 1)), mode: "series" }]);
    expect(applied.ok).toBe(false);
    expect(serializeDocumentState(document)).toBe(before);
  });
  it("is atomic, preserves target display cascade and undoes/redoes as one edit", () => {
    // A valid target local format remains local: fill is content-only, never a resolved-style flattening.
    const document = doc([["1 {::bold}"], ["3"], ["99 {:.2f}"], ["7"]]);
    const source = region(document, rect(0, 1));
    const target = region(document, rect(2, 3));
    const applied = applyBatchWithUndo(document, [{ op: "fill_region", source, target, mode: "auto" }]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(applied.memento.entryCount).toBe(1);
    expect(getCellTextView(applied.nextDocument.sheets[0].cells[2][0]).cellText).toBe("5 {:.2f}");
    const undone = applyCoreEditMemento(applied.nextDocument, applied.memento, "undo");
    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(serializeDocumentState(undone.nextDocument)).toBe(serializeDocumentState(document));
    const redone = applyCoreEditMemento(undone.nextDocument, applied.memento, "redo");
    expect(redone.ok && serializeDocumentState(redone.nextDocument)).toBe(serializeDocumentState(applied.nextDocument));
    const bad = applyBatchWithUndo(document, [{ op: "fill_region", source, target: { ...target, sheet: "Missing" }, mode: "auto" }]);
    expect(bad.ok).toBe(false);
    expect(getCellTextView(document.sheets[0].cells[2][0]).inputText).toBe("99");
  });
});
