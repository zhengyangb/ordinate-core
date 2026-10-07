import type { Cell, Color, Font, Worksheet } from "exceljs";
import { groupHeaderSpans } from "../presentation";

/** Display-only input. Evaluated text sizes formulas without exporting result caches. */
export interface ExcelDisplayCell { text: string; numeric: boolean }
export interface ExcelSheetPresentation {
  headerRows: number;
  headerColumns: number;
  cells: readonly (readonly ExcelDisplayCell[])[];
  freezeHeaders: boolean;
}
export interface ExcelSheetLayout { widths: number[]; heights: number[] }

// XLSX has no CSS generic sans-serif family. Use the workbook's minor/body theme
// with the standard Office fallback, also on bold/color overrides. A font record
// containing only <b/> otherwise leaves the face/size up to the reader.
const BODY_FONT: Partial<Font> = { name: "Calibri", size: 11, family: 2, scheme: "minor", color: { theme: 1 } };
const TEXT_LIMIT = 44;

/** Approximate normal-font digit units; deterministic in Node and browsers. */
function lineWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    width += /[\p{Extended_Pictographic}\u2e80-\uffef]/u.test(character) ? 2
      : /[ilI.,'`:;!|]/.test(character) ? 0.5
      : /[MW@%]/.test(character) ? 1.5 : 1;
  }
  return width;
}
function textWidth(text: string): number {
  return Math.max(0, ...text.split(/\r\n|\r|\n/).map(lineWidth));
}
function wrappedLines(text: string, available: number): number {
  let lines = 0;
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let used = 0;
    lines += 1;
    for (const token of paragraph.split(/(\s+)/u)) {
      const width = lineWidth(token);
      if (/^\s+$/.test(token)) {
        if (used > 0) used = Math.min(available, used + width);
      } else if (width > 0) {
        if (used > 0 && used + width > available) { lines += 1; used = 0; }
        const extra = Math.max(0, Math.ceil(width / available) - 1);
        lines += extra;
        used += width - extra * available;
      }
    }
  }
  return lines;
}

/** Bounded histogram keeps the representative-text calculation linear, not a
 * full sort per column. Long outliers wrap; all numeric results contribute. */
export function resolveExcelSheetLayout(presentation: Omit<ExcelSheetPresentation, "freezeHeaders">, rows: number, columns: number): ExcelSheetLayout {
  const { cells, headerRows, headerColumns } = presentation;
  if (!Number.isInteger(headerRows) || headerRows < 0 || headerRows > rows
    || !Number.isInteger(headerColumns) || headerColumns < 0 || headerColumns > columns
    || cells.length !== rows || cells.some(row => row.length !== columns)) {
    throw new Error("Excel export presentation must match worksheet dimensions and header bands.");
  }
  const widths = Array.from({ length: columns }, (_, c) => {
    const histogram = new Array<number>(TEXT_LIMIT + 1).fill(0);
    let textCount = 0, numericWidth = 0, headerWidth = 0;
    for (let r = 0; r < rows; r += 1) {
      const cell = cells[r][c];
      if (!cell.text) continue;
      const width = textWidth(cell.text);
      if (r < headerRows) headerWidth = Math.max(headerWidth, width * 1.05);
      else if (cell.numeric) numericWidth = Math.max(numericWidth, width);
      else { histogram[Math.min(TEXT_LIMIT, Math.ceil(width))] += 1; textCount += 1; }
    }
    let representative = 0, seen = 0;
    for (let bucket = 0; bucket <= TEXT_LIMIT; bucket += 1) {
      seen += histogram[bucket];
      if (seen >= Math.ceil(textCount * 0.8)) { representative = bucket; break; }
    }
    const minimum = c < headerColumns ? 20 : textCount ? 14 : numericWidth ? 12 : 8;
    const textMaximum = c < headerColumns ? 36 : TEXT_LIMIT;
    const desired = Math.max(minimum, Math.min(textMaximum, Math.max(headerWidth, representative) + 2), numericWidth + 2);
    // Excel's width limit, not a truncation rule. Numbers aren't text-wrapped.
    return Math.min(255, Math.ceil(desired * 2) / 2);
  });
  const heights = cells.map((row, r) => {
    let height = r < headerRows ? 24 : 20;
    const fit = (cell: ExcelDisplayCell, width: number, bold: boolean) => {
      if (!cell.text || cell.numeric) return;
      const available = Math.max(1, (width - 2) / (bold ? 1.05 : 1));
      height = Math.max(height, wrappedLines(cell.text, available) * 15 + 5);
    };
    if (r < headerRows) {
      const columns = row.map((_, colIndex) => ({ colIndex }));
      for (const { start, end } of groupHeaderSpans(columns, row.map(cell => cell.text), headerColumns)) {
        fit(row[start], widths.slice(start, end + 1).reduce((sum, width) => sum + width, 0), true);
      }
    } else row.forEach((cell, c) => {
      fit(cell, widths[c], c < headerColumns);
    });
    return Math.min(409, height); // XLSX row-height limit; contents remain intact.
  });
  return { widths, heights };
}

/** Merge only after writing values: writing to an Excel merged slave would
 * overwrite its master. Grouping is exactly the screen/print policy. */
export function applyExcelHeaderMerges(sheet: Worksheet, presentation: ExcelSheetPresentation): void {
  const columns = Array.from({ length: sheet.columnCount }, (_, colIndex) => ({ colIndex }));
  for (let r = 0; r < presentation.headerRows; r++) {
    for (const { start, end } of groupHeaderSpans(columns, presentation.cells[r].map(cell => cell.text), presentation.headerColumns)) {
      if (end > start) sheet.mergeCells(r + 1, start + 1, r + 1, end + 1);
    }
  }
}

export function applyExcelSheetLayout(sheet: Worksheet, presentation: ExcelSheetPresentation, layout: ExcelSheetLayout): void {
  layout.widths.forEach((width, c) => { sheet.getColumn(c + 1).width = width; });
  layout.heights.forEach((height, r) => { sheet.getRow(r + 1).height = height; });
  if (presentation.freezeHeaders && (presentation.headerRows || presentation.headerColumns)) {
    sheet.views = [{ state: "frozen", xSplit: presentation.headerColumns, ySplit: presentation.headerRows }];
  }
}

/** User style axes have already been resolved; defaults never replace them. */
export function applyExcelCellPresentation(cell: Cell, presentation: ExcelSheetPresentation, r: number, c: number): void {
  const headerRow = r < presentation.headerRows;
  const headerColumn = c < presentation.headerColumns;
  cell.font = { ...BODY_FONT, ...(headerRow || headerColumn ? { bold: true } : {}), ...cell.font };
  cell.alignment = { vertical: "top", ...(headerRow ? { horizontal: "center" } : {}), ...(!presentation.cells[r][c].numeric ? { wrapText: true } : {}), ...cell.alignment };
  if (headerRow || headerColumn) {
    // ExcelJS serializes tint but omits it from its public Color declaration.
    const neutral: Partial<Color> & { tint: number } = { theme: 0, tint: headerRow ? -0.08 : -0.04 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: neutral };
  }
}
