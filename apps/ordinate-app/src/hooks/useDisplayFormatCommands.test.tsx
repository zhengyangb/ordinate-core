import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDisplayFormatCommands } from "./useDisplayFormatCommands";

const actions = vi.hoisted(() => ({
  setCellLocalFormat: vi.fn(), setCellLocalStyle: vi.fn(),
  setColumnDefaultFormat: vi.fn(), clearColumnDefaultFormat: vi.fn(), setColumnDefaultStyle: vi.fn(),
  setRowDefaultFormat: vi.fn(), clearRowDefaultFormat: vi.fn(), setRowDefaultStyle: vi.fn(),
}));
vi.mock("../store/editorStore", () => ({ useEditorStore: (select: (state: typeof actions) => unknown) => select(actions) }));
beforeEach(() => vi.clearAllMocks());

function commands(overrides: Partial<Parameters<typeof useDisplayFormatCommands>[0]> = {}) {
  let result!: ReturnType<typeof useDisplayFormatCommands>;
  function Harness() {
    result = useDisplayFormatCommands({
      activeSheet: "Sheet", headerRowCount: 1, headerColCount: 1,
      selectedCell: { area: "body", logical: { rAbs: 2, cAbs: 1 }, colId: "c1", rowPath: "A" },
      setFormulaInputMode: vi.fn(), ...overrides,
    });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  return result;
}

describe("extracted cascade-aware display commands", () => {
  it("Auto clears each format layer instead of assigning a default format", () => {
    const api = commands();
    api.handleSetCellLocalFormat("auto", null);
    api.handleSetColumnDefaultFormat(12, "auto", null);
    api.handleSetRowDefaultFormat(24, "auto", null);
    expect(actions.setCellLocalFormat).toHaveBeenCalledWith({ kind: "index", sheet: "Sheet", rowIndex: 1, colIndex: 1 }, null);
    expect(actions.clearColumnDefaultFormat).toHaveBeenCalledWith("Sheet", 12);
    expect(actions.clearRowDefaultFormat).toHaveBeenCalledWith("Sheet", 24);
    expect(actions.setColumnDefaultFormat).not.toHaveBeenCalled();
    expect(actions.setRowDefaultFormat).not.toHaveBeenCalled();
  });
  it.each(["align", "weight", "color"] as const)("Auto clears only the %s style axis at all three scopes", axis => {
    const api = commands();
    api.handleSetCellLocalStyle(axis, "auto");
    api.handleSetColumnDefaultStyle(12, axis, "auto");
    api.handleSetRowDefaultStyle(24, axis, "auto");
    expect(actions.setCellLocalStyle).toHaveBeenCalledWith(expect.anything(), { [axis]: null });
    expect(actions.setColumnDefaultStyle).toHaveBeenCalledWith("Sheet", 12, { [axis]: null });
    expect(actions.setRowDefaultStyle).toHaveBeenCalledWith("Sheet", 24, { [axis]: null });
  });
  it("keeps explicit normal distinct from inherited weight", () => {
    commands().handleSetCellLocalStyle("weight", "normal");
    expect(actions.setCellLocalStyle).toHaveBeenCalledWith(expect.anything(), { weight: "normal" });
  });
  it("fails before dispatching when there is no selected data cell", () => {
    expect(() => commands({ selectedCell: null }).handleSetCellLocalFormat("auto", null)).toThrow("selected data cell");
    expect(actions.setCellLocalFormat).not.toHaveBeenCalled();
  });
});
