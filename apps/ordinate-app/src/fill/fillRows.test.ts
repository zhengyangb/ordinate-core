import { describe, expect, it } from "vitest";
import { DocumentState } from "@ordinate/core";
import { defaultFillRowOptions, excludedFillRows, resolveFillRowGroups } from "./fillRows";

describe("fill row policy", () => {
  const sheet = DocumentState.fromText("# Sheet\n| Name || Value |\n| --- || --- |\n| Group || 90 |\n| * Nested || 80 |\n| ** Leaf || 1 |\n| * Sibling || 2 |\n| Total || 3 |").sheets[0];
  const range = { rowStart: 2, rowEnd: 6, colStart: 1, colEnd: 1 };
  it("classifies nested parents from full structure independently of visibility", () => {
    const groups = resolveFillRowGroups(sheet, range, new Set([2, 6]));
    expect(groups).toEqual({ parents: [2, 3], collapsed: [3, 4, 5] });
    expect(resolveFillRowGroups(sheet, range, new Set([2, 3, 4, 5, 6])).parents).toEqual(groups.parents);
    expect(resolveFillRowGroups(sheet, { ...range, rowEnd: 2 }, new Set([2])).parents).toEqual([2]);
    expect(excludedFillRows(groups, defaultFillRowOptions)).toEqual([]);
    expect(excludedFillRows(groups, { collapsed: true, parents: false })).toEqual([1, 2]);
    expect(excludedFillRows(groups, { collapsed: false, parents: true })).toEqual([2, 3, 4]);
    expect(excludedFillRows(groups, { collapsed: false, parents: false })).toEqual([1, 2, 3, 4]);
  });
});
