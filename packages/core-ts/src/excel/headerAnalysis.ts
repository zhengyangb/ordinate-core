import type { WorkbookCell } from "./workbookCodec";
import { parseCellInput } from "../runtime/parse";

export interface ExcelTableHeader { range: string; headerRow: boolean }
export interface HeaderAnalysis { headerRows: number }

/** Table metadata is authoritative only when it describes the whole sheet's table.
 * Other layouts are chosen explicitly in the import preview. */
export function analyzeHeaders(rows: WorkbookCell[][], tables: ExcelTableHeader[]): HeaderAnalysis {
  let lastRow = 0, lastColumn = 0;
  rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.value !== null || cell.formula) { lastRow = Math.max(lastRow, r + 1); lastColumn = Math.max(lastColumn, c + 1); }
  }));
  const headers = tables.filter(table => table.headerRow);
  if (tables.length === 1 && headers.length === 1) {
    const range = /^A1:([A-Z]+)([1-9]\d*)$/.exec(headers[0].range);
    const endColumn = range?.[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    if (range && endColumn === lastColumn && Number(range[2]) >= lastRow && lastRow > 1
      && rows[0].slice(0, lastColumn).every(cell => typeof cell.value === "string" && !cell.formula
        && cell.value.trim() !== "" && !/[\r\n]/.test(cell.value)
        && !/^\s*(?:=|@display|[-:]+\s*$)/.test(cell.value) && !cell.value.includes("{:")
        && isLiteralHeader(cell.value))) {
      return { headerRows: 1 };
    }
  }
  return { headerRows: 0 };
}

function isLiteralHeader(text: string): boolean {
  const parsed = parseCellInput(text);
  return parsed.body.valid && parsed.body.kind === "literal" && !parsed.localDisplay;
}
