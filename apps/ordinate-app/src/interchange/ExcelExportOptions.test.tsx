import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExcelExportOptions, ExportSummary } from "./ExcelExportOptions";
import { describeExcelExport, convertExport } from "./conversion";
import ExcelJS from "../../../../packages/core-ts/node_modules/exceljs";

const noop = () => {};
describe("Excel export confirmation", () => {
  it("still shows the filename and sheet summary when there are no headers or warnings", () => {
    const summary = describeExcelExport('# Data\n| 12 |', 'Report.ord');
    const html = renderToStaticMarkup(<><ExportSummary summary={summary} /><ExcelExportOptions summary={summary} freezeHeaders={false} keepResults disabled={false} onToggle={noop} onKeepResultsToggle={noop} /></>);
    expect(html).toContain("Report.xlsx");
    expect(html).toContain("1 sheet");
    expect(html).not.toContain("Freeze headers");
    expect(html).not.toContain("Export a copy");
    expect(html).toContain("Keep unsupported formula results");
  });
  it("shows the option once when any of six independent sheets has either header axis", () => {
    const summary = describeExcelExport(Array.from({ length: 6 }, (_, i) => `# Sheet${i}\n${i === 4 ? '| Label || 12 |' : '| 12 |'}`).join('\n'), 'Report');
    expect(summary).toMatchObject({ sheetCount: 6, headerSheetCount: 1 });
    const html = renderToStaticMarkup(<ExcelExportOptions summary={summary} freezeHeaders={false} keepResults disabled={false} onToggle={noop} onKeepResultsToggle={noop} />);
    expect(html).toContain('aria-pressed="false"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(renderToStaticMarkup(<ExportSummary summary={summary} />)).toContain('6 sheets');
  });
  it("includes header-row-only sheets and renders selected state", () => {
    const summary = describeExcelExport('# Data\n| Item | Amount |\n| --- | --- |\n| "A" | 12 |', 'Report');
    expect(summary.headerSheetCount).toBe(1);
    expect(renderToStaticMarkup(<ExcelExportOptions summary={summary} freezeHeaders keepResults={false} disabled={false} onToggle={noop} onKeepResultsToggle={noop} />)).toContain('aria-pressed="true"');
  });
  it("passes the selected option through the shared browser/desktop converter", async () => {
    const source = '# Data\n| Item || Amount |\n| --- || --- |\n| Revenue || 12 |';
    for (const freezeHeaders of [false, true]) {
      const result = await convertExport(source, 'xlsx', 'Report', null, false, { freezeHeaders });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(result.value.bytes.slice().buffer);
      if (freezeHeaders) expect(book.worksheets[0].views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 1 });
      else expect(book.worksheets[0].views).toBeNull();
    }
  });
  it("uses the same selected/disabled choice component for retaining calculated results", () => {
    const summary=describeExcelExport('# Data\n| 1 |','Report');
    const html=renderToStaticMarkup(<ExcelExportOptions summary={summary} freezeHeaders={false} keepResults disabled onToggle={noop} onKeepResultsToggle={noop} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('disabled');
    expect(html).not.toContain('type="checkbox"');
  });
  it("projects fresh results only when the selected result option reaches the converter", async () => {
    for (const unsupportedFormulas of ["value","reject"] as const) {
      const result=await convertExport('# Data\n| = len(trim(" hi ")) |','xlsx','Report',null,false,{unsupportedFormulas});
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const book=new ExcelJS.Workbook();
      await book.xlsx.load(result.value.bytes.slice().buffer);
      expect(book.worksheets[0].getCell("A1").value).toBe(unsupportedFormulas === "value" ? 2 : null);
      expect(result.diagnostics.some(item=>item.code === "formula_exported_as_value")).toBe(unsupportedFormulas === "value");
    }
  });
});
