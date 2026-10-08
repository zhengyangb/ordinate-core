import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createCellDisplayFormatter } from "./temporalDisplay";
import { useSheetViewModel } from "../hooks/useSheetViewModel";
import { useEditorStore } from "../store/editorStore";
import { buildDocumentSearchCells } from "../search/searchModel";
import { preparePrintDocument, DEFAULT_PRINT_OPTIONS } from "../printing/printDocumentModel";

const us = createCellDisplayFormatter("locale", "en-US"), gb = createCellDisplayFormatter("locale", "en-GB");
const date = { kind: "date", value: "2026-06-07", isOffsetQualified: false } as const;
describe("regional temporal display", () => {
  it("uses region ordering without changing the date", () => {
    expect(us(date, null)).toBe("6/7/2026");
    expect(gb(date, null)).toBe("07/06/2026");
    expect(createCellDisplayFormatter("locale", "zh-CN")(date, null)).toBe("2026/6/7");
    expect(us({ ...date, value: "0007-06-07" }, null)).toBe("6/7/7");
  });
  it("keeps wall-clock components and original offsets, including milliseconds", () => {
    expect(gb({ kind: "datetime", value: "2026-03-08T00:30:01.125-05:00", isOffsetQualified: true }, null)).toBe("08/03/2026, 0:30:01.125 -05:00");
    expect(gb({ kind: "time", value: "23:59:59.005+08:00", isOffsetQualified: true }, null)).toBe("23:59:59.005 +08:00");
    expect(gb({ kind: "datetime", value: "2026-06-07T00:00", isOffsetQualified: false }, null)).toBe("07/06/2026, 0:00:00");
  });
  it("does not wrap long durations, discard calendar units or lose negative signs and milliseconds", () => {
    expect(us({ kind: "duration", value: "PT27H2M3.045S" }, null)).toBe("27 hr, 2 min, 3 sec, 45 ms");
    expect(us({ kind: "duration", value: "-PT27H2M3.045S" }, null)).toBe("-27 hr, 2 min, 3 sec, 45 ms");
    expect(us({ kind: "duration", value: "P1Y2M3D" }, null)).toBe("1 yr, 2 mths, 3 days");
    expect(us({ kind: "duration", value: "PT0S" }, null)).toBe("0 sec");
  });
  it("ISO mode and non-temporal values keep their existing display", () => {
    const iso = createCellDisplayFormatter("iso", "en-US");
    expect(iso(date, null)).toBe(date.value);
    expect(iso({ kind: "duration", value: "-PT27H" }, null)).toBe("-PT27H");
    expect(us({ kind: "string", value: "2026-06-07" }, null)).toBe("2026-06-07");
    expect(us({ kind: "number", value: 1.234567 }, null)).toBe("1.2346");
    expect(us(null, null)).toBe("");
  });
  it("fails early on invalid runtime values rather than inventing dates", () => {
    expect(() => us({ ...date, value: "invalid" }, null)).toThrow("Invalid temporal");
    expect(() => us({ kind: "duration", value: "invalid" }, null)).toThrow("Invalid duration");
  });
  it("shares one projection for grid, search and print; explicit cascade formats win", () => {
    const source = '# Dates\n| @display | | {:%F} |\n| | 2026-06-07 | 2026-06-07 |\n| {:%Y} | 2026-06-07 | 2026-06-07 |\n| | 2026-06-07 {:%d/%m/%Y} | 2026-06-07 {:%d/%m/%Y} |';
    useEditorStore.getState().replaceDocumentText(source);
    const state = useEditorStore.getState(), before = state.sourceText;
    let projection!: ReturnType<typeof useSheetViewModel>;
    function Harness() { projection = useSheetViewModel({ ...state, displayCell: us }); return null; }
    renderToStaticMarkup(<Harness />);
    const rows = projection.allRowData;
    expect(rows.map(row => [row.col_0, row.col_1])).toEqual([
      ["6/7/2026", "2026-06-07"], ["2026", "2026"], ["07/06/2026", "07/06/2026"],
    ]);
    const cells = buildDocumentSearchCells(state, "en-US", us);
    expect(cells.map(cell => cell.text)).toEqual(rows.flatMap(row => [row.col_0, row.col_1]));
    expect(preparePrintDocument(state, us).build(DEFAULT_PRINT_OPTIONS)[0].rows).toEqual(rows);
    expect(useEditorStore.getState().sourceText).toBe(before);
    expect(state.evaluation!.sheets[0].values[0][0]).toEqual(date);
  });
});
