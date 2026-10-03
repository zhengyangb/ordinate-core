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
  it("keeps the active address distinct from multi-cell selection size", () => {
    const markup = renderToStaticMarkup(<FormulaCellAddress cell={cell()}
      selection={{ rowStart: 3, rowEnd: 4, colStart: 0, colEnd: 1 }} />);
    expect(markup).toContain('aria-label="B4, cell location"');
    expect(markup).toContain("4 cells");
  });
});
