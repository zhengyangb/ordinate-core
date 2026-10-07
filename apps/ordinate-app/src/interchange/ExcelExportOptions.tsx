import { SelectionRow } from "../components/SelectionRow";
import type { describeExcelExport } from "./conversion";

type ExcelExportSummary = ReturnType<typeof describeExcelExport>;

export function ExportSummary({ summary }: { summary: { name: string; sheetCount: number } }) {
  return <div className="excel-export-summary">
    <span className="excel-export-filename" title={summary.name}>{summary.name}</span>
    <span className="excel-export-sheet-count">{summary.sheetCount === 1 ? "1 sheet" : `${summary.sheetCount} sheets`}</span>
  </div>;
}

export function ExcelExportOptions({ summary, freezeHeaders, keepResults, disabled, onToggle, onKeepResultsToggle }: {
  summary: ExcelExportSummary; freezeHeaders: boolean; keepResults: boolean; disabled: boolean; onToggle: () => void; onKeepResultsToggle: () => void;
}) {
  return <section className="excel-export-options" aria-label="Excel export settings">
    {summary.headerSheetCount > 0 && <SelectionRow label="Freeze headers" selected={freezeHeaders} disabled={disabled} onToggle={onToggle}
      description="Keep header rows and columns visible while scrolling." />}
    <SelectionRow label="Keep unsupported formula results" selected={keepResults} disabled={disabled} onToggle={onKeepResultsToggle}
      description="Save calculated values when formulas cannot be translated." />
  </section>;
}
