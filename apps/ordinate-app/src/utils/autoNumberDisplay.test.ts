import { describe, expect, it } from "vitest";
import { autoNumberDisplay } from "./autoNumberDisplay";
import { buildDocumentSearchCells } from "../search/searchModel";
import { useEditorStore } from "../store/editorStore";

describe("compact Auto number display", () => {
  it("limits decimals without adding trailing zeros", () => {
    expect(autoNumberDisplay(0.8153846153846)).toBe("0.8154");
    expect(autoNumberDisplay(0.825)).toBe("0.825");
    expect(autoNumberDisplay(58)).toBe("58");
    expect(autoNumberDisplay(-1.234567)).toBe("-1.2346");
    expect(autoNumberDisplay(-0)).toBe("0");
  });
  it("keeps very small nonzero values visible and large magnitudes compact", () => {
    expect(autoNumberDisplay(0.0000001234567)).toBe("1.2346e-7");
    expect(autoNumberDisplay(1e12)).toBe("1e+12");
    expect(() => autoNumberDisplay(Infinity)).toThrow("finite");
  });
  it("uses compact text in search without rewriting formulas or their results", () => {
    useEditorStore.getState().replaceDocumentText(`# Sheet\n| Value |\n| ----- |\n| = 53 / 65 |`);
    const state = useEditorStore.getState();
    const before = state.sourceText;
    const cells = buildDocumentSearchCells(state, "en-US");
    expect(cells.some(cell => cell.text === "0.8154")).toBe(true);
    expect(useEditorStore.getState().sourceText).toBe(before);
    const value = state.evaluation!.sheets[0].values[0][0];
    if (value.kind !== "number") throw new Error("Expected numeric formula result");
    expect(Number(value.value)).toBeCloseTo(53 / 65, 12);
  });
  it("preserves explicitly requested precision", () => {
    useEditorStore.getState().replaceDocumentText(`# Sheet\n| Value |\n| ----- |\n| 0.123456789 {:.6f} |`);
    const cells = buildDocumentSearchCells(useEditorStore.getState(), "en-US");
    expect(cells.some(cell => cell.text === "0.123457")).toBe(true);
  });
});
