import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../store/editorStore";
import { useSheetViewModel } from "./useSheetViewModel";

const source = `# Sheet
| Item || Amount | Description |
| ---- || ------ | ----------- |
| Group || | |
| * A || 12.34 | Long text |
| * B || 56 | Another value |`;

beforeEach(() => {
  useEditorStore.getState().setSourceText(source);
  useEditorStore.getState().exitSourceMode();
});

function view() {
  let result!: ReturnType<typeof useSheetViewModel>;
  function Harness() {
    result = useSheetViewModel(useEditorStore.getState());
    return null;
  }
  renderToStaticMarkup(<Harness />);
  return result;
}

describe("sheet projection after extraction", () => {
  it("preserves header counts, semantic labels and row hierarchy", () => {
    const model = view();
    expect(model.headerColCount).toBe(1);
    expect(model.headerRowCount).toBe(1);
    expect(model.headerLeafLabels).toEqual(["Item", "Amount", "Description"]);
    expect(model.rowData.map(row => row.__absoluteRowNumber)).toEqual([2, 3, 4]);
    expect(model.rowData[0].__hasChildren).toBe(true);
    expect(model.rowData[1]).toMatchObject({ __rowPath: "Group.A", __depth: 1, __kind_1: "number", __kind_2: "string" });
  });
  it("projects effective cascade styles, including an explicit normal override", () => {
    const sheet = useEditorStore.getState().docState!.sheets[0];
    useEditorStore.getState().setColumnDefaultStyle("Sheet", sheet.colIds[1], { weight: "bold" });
    useEditorStore.getState().setCellLocalStyle({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, { weight: "normal" });
    const model = view();
    expect(model.rowData[1].__weight_1).toBe("normal");
    expect(model.rowData[2].__weight_1).toBe("bold");
  });
});
