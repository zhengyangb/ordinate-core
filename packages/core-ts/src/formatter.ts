import { escapeCellText, parseDocument, parseTableRow, ParsedRow } from "./parser";

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

export function formatDocument(text: string): string {
  const sheets = parseDocument(text);
  const parts: string[] = [];

  sheets.forEach((sheet, idx) => {
    parts.push(`# ${sheet.name}`);
    if (sheet.table) {
      const parsed = sheet.table.rows.map((row) => parseTableRow(row));
      const widths = columnWidths(parsed);
      const boundary = commonBoundary(parsed);
      for (const row of parsed) {
        parts.push(renderRow(row, widths, boundary));
      }
    }
    if (idx !== sheets.length - 1) {
      parts.push("");
    }
  });

  return parts.join("\n").replace(/\s+$/, "") + "\n";
}

function columnWidths(rows: ParsedRow[]): number[] {
  const maxCols = rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
  const widths = Array.from({ length: maxCols }, () => 0);
  for (const row of rows) {
    for (let i = 0; i < row.cells.length; i += 1) {
      const cell = displayCell(row, i);
      widths[i] = Math.max(widths[i], escapeCellText(cell).length);
    }
  }
  return widths;
}

function commonBoundary(rows: ParsedRow[]): number | null {
  const boundaries = rows.map((r) => r.boundary).filter((b) => b !== null) as number[];
  if (boundaries.length === 0) return null;
  const first = boundaries[0];
  return boundaries.every((b) => b === first) ? first : null;
}

function renderRow(row: ParsedRow, widths: number[], boundary: number | null): string {
  const cells = row.cells;
  const isSeparator = isSeparatorRow(cells);
  const chunks: string[] = ["|"];
  for (let idx = 0; idx < cells.length; idx += 1) {
    const display = displayCell(row, idx);
    const escaped = isSeparator ? "-".repeat(Math.max(3, widths[idx])) : escapeCellText(display);
    chunks.push(` ${escaped.padEnd(widths[idx], " ")} `);
    if (boundary !== null && idx + 1 === boundary) {
      chunks.push("|");
    }
    chunks.push("|");
  }
  return chunks.join("");
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL_RE.test(cell));
}

function displayCell(row: ParsedRow, idx: number): string {
  if (idx >= row.cells.length) return "";
  if (idx !== 0) return row.cells[idx];

  const raw = idx < row.rawCells.length ? row.rawCells[idx] : row.cells[idx];
  const stripped = raw.trim();
  if (stripped === "") return "";

  const leading = raw.length - raw.trimStart().length;
  const semanticIndent = Math.max(0, leading - 1);
  return " ".repeat(semanticIndent) + stripped;
}
