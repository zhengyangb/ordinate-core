import { deriveHierarchyRows, parseDocument, parseTableRow, stripDisplayControlFrame, type ParsedRow } from "./parser";

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

export interface RowIR {
  rowIndex: number;
  cells: string[];
  label: string;
  depth: number;
  path: string[];
}

export interface TableIR {
  rowCount: number;
  columnCount: number;
  headerRowCount: number;
  headerColumnCount: number;
  maxHierarchyDepth: number;
  rows: RowIR[];
}

export interface SheetIR {
  name: string;
  table: TableIR | null;
  hasMultipleTables: boolean;
}

export interface DocumentIR {
  frontMatter: string | null;
  sheets: SheetIR[];
}

export function parseDocumentModel(text: string): DocumentIR {
  const { frontMatter, sheets } = parseDocument(text);
  const irSheets: SheetIR[] = [];

  for (const sheet of sheets) {
    if (!sheet.table) {
      irSheets.push({ name: sheet.name, table: null, hasMultipleTables: sheet.hasMultipleTables });
      continue;
    }
    const parsedRows: ParsedRow[] = stripDisplayControlFrame(
      sheet.table.rows.map((row) => parseTableRow(row)),
    ).rows;
    const widths = new Set(parsedRows.map((r) => r.cells.length));
    const columnCount = widths.size === 1 ? [...widths][0] : 0;

    const headerRowCount = headerRowCountFrom(parsedRows);
    const headerColumnCount = headerColumnCountFrom(parsedRows, columnCount);
    const bodyStart = headerRowCount > 0 ? headerRowCount + 1 : 0;

    const { rows, maxDepth } = buildHierarchy(parsedRows, bodyStart);
    irSheets.push({
      name: sheet.name,
      table: {
        rowCount: parsedRows.length,
        columnCount,
        headerRowCount,
        headerColumnCount,
        maxHierarchyDepth: maxDepth,
        rows,
      },
      hasMultipleTables: sheet.hasMultipleTables,
    });
  }

  return { frontMatter, sheets: irSheets };
}

function headerRowCountFrom(rows: ParsedRow[]): number {
  for (let idx = 0; idx < rows.length; idx += 1) {
    if (rows[idx].cells.length > 0 && rows[idx].cells.every((c) => SEPARATOR_CELL_RE.test(c))) {
      return idx;
    }
  }
  return 0;
}

function headerColumnCountFrom(rows: ParsedRow[], columnCount: number): number {
  if (rows.length === 0) return 0;
  const firstBoundary = rows[0].boundary;
  if (firstBoundary === null || firstBoundary === undefined) return 0;
  if (rows.every((r) => r.boundary === firstBoundary)) {
    return Math.min(firstBoundary, columnCount);
  }
  return 0;
}

function buildHierarchy(
  parsedRows: ParsedRow[],
  bodyStart: number,
): { rows: RowIR[]; maxDepth: number } {
  const derivedRows = deriveHierarchyRows(parsedRows, bodyStart);
  const rows: RowIR[] = derivedRows.map((derived, offset) => ({
    rowIndex: bodyStart + offset + 1,
    cells: parsedRows[bodyStart + offset]?.cells ?? [],
    label: derived.content,
    depth: derived.depth,
    path: [...derived.path],
  }));
  const maxDepth = rows.reduce((acc, row) => Math.max(acc, row.depth), 0);
  return { rows, maxDepth };
}
