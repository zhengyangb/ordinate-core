import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormulaCellAddress } from "./FormulaCellAddress";
import { buildFormulaBarData } from "../utils/formulaBarData";
import { useEditorStore } from "../store/editorStore";

function cell() {
  useEditorStore.getState().replaceDocumentText(`# Sheet
| Item || 2025 |
| Name || H2 |
| --- || --- |
| Cost of Sales || |
| * Fulfillment || 35 |`);
  const state = useEditorStore.getState();
  return buildFormulaBarData({
    currentSheet: state.evaluation!.sheets[0], currentSheetState: state.docState!.sheets[0],
    currentSheetPresentation: state.presentation!.sheets[0],
    selectedCell: { area: "body", logical: { cAbs: 1, rAbs: 4 }, colId: "col_1", rowPath: "Cost of Sales.Fulfillment" },
    isActiveSheetBlocked: false, sheetColCount: 2, headerColCount: 1,
    headerSemanticLabelPaths: [["Item", "Name"], ["2025", "H2"]],
  })!;
}

describe("compact formula location", () => {
  it("retains complete hierarchy separately from the short address", () => {
    expect(cell()).toMatchObject({ primaryAddress: "B4", columnNumber: 2, rowNumber: 4,
      columnPath: ["2025", "H2"], rowPath: ["Cost of Sales", "Fulfillment"] });
  });
  it("shows a column subscript without permanent path labels", () => {
    const markup = renderToStaticMarkup(<FormulaCellAddress cell={cell()} selection={null} />);
    expect(markup).toContain("B<sub>2</sub>");
    expect(markup).toContain('aria-label="B4, cell location"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('role="tooltip"');
    expect(markup).not.toContain("Fulfillment");
    expect(markup).not.toContain("cells</span>");
  });
  it("shows only the selected count when multiple cells are selected", () => {
    const markup = renderToStaticMarkup(<FormulaCellAddress cell={cell()}
      selection={{ rowStart: 3, rowEnd: 4, colStart: 0, colEnd: 1 }} />);
    expect(markup).toContain('aria-label="4 cells selected, selection details"');
    expect(markup).toContain("4 cells");
    expect(markup).not.toContain("B<sub>");
    expect(markup).not.toContain("Number");
    expect(markup).toContain('aria-expanded="false"');
  });
  it("uses the single-cell address for a one-cell range", () => {
    const markup = renderToStaticMarkup(<FormulaCellAddress cell={cell()}
      selection={{ rowStart: 4, rowEnd: 4, colStart: 1, colEnd: 1 }} />);
    expect(markup).toContain('aria-label="B4, cell location"');
    expect(markup).toContain("B<sub>2</sub>");
    expect(markup).not.toContain("cells selected");
  });
  it.each([
    [{ rowStart: 4, rowEnd: 4, colStart: 0, colEnd: 2 }, 3],
    [{ rowStart: 3, rowEnd: 6, colStart: 1, colEnd: 1 }, 4],
    [{ rowStart: 1, rowEnd: 1000, colStart: 0, colEnd: 99 }, 100000],
  ])("counts all cells in %j", (selection, count) => {
    const markup = renderToStaticMarkup(<FormulaCellAddress cell={cell()} selection={selection} />);
    expect(markup).toContain(`>${count} cells</button>`);
  });
});
