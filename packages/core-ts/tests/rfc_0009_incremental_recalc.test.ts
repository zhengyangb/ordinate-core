import { describe, expect, it } from "vitest";

import { ChangeKind, DocumentState } from "../src";

describe("RFC-0009 incremental recalculation", () => {
  const buildState = () => {
    const doc = `
# Sheet
| Item  || 2024 | 2025 | Sum |
| ----  || ---- | ---- | --- |
| A     || 1    | 2    | = sum(@[A,2024:2025]) |
| B     || 3    | 4    | = sum(@[B,2024:2025]) |
| Total || = sum(@[#2:#3,2024:2025]) |  |  |
`.trim();
    return DocumentState.fromText(doc);
  };

  it("value edit updates dependents", () => {
    const state = buildState();
    const before = state.evaluate().sheets[0];
    const rowA = before.rowPaths.indexOf("A");
    const rowB = before.rowPaths.indexOf("B");
    const colSum = before.colLabels.indexOf("Sum");
    expect(before.values[rowA][colSum].value).toBe(3);
    expect(before.values[rowB][colSum].value).toBe(7);

    state.setCell("Sheet", "A", "2024", "10", ChangeKind.VALUE);
    const after = state.evaluate().sheets[0];
    expect(after.values[rowA][colSum].value).toBe(12);
    expect(after.values[rowB][colSum].value).toBe(7);
  });

  it("range dependency updates totals", () => {
    const state = buildState();
    const before = state.evaluate().sheets[0];
    const rowTotal = before.rowPaths.indexOf("Total");
    const col2024 = before.colLabels.indexOf("2024");
    expect(before.values[rowTotal][col2024].value).toBe(10);

    state.setCell("Sheet", "A", "2024", "10", ChangeKind.VALUE);
    const after = state.evaluate().sheets[0];
    expect(after.values[rowTotal][col2024].value).toBe(19);
  });
});
