import { parseDocument, parseTableRow, type ParsedRow } from "./parser";

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;
const SECTION_RE = /^(\[+)([^\[\]]+)(\]+)$/;

export interface RowIR {
  rowIndex: number;
  cells: string[];
  label: string;
  kind: "row" | "section";
  depth: number;
  sectionName: string | null;
  parentSections: string[];
}

export interface SectionIR {
  name: string;
  depth: number;
  startRow: number;
}

export interface TableIR {
  rowCount: number;
  columnCount: number;
  headerRowCount: number;
  headerColumnCount: number;
  sectionCount: number;
  maxSectionDepth: number;
  rows: RowIR[];
  sections: SectionIR[];
}

export interface SheetIR {
  name: string;
  table: TableIR | null;
  hasMultipleTables: boolean;
}

export interface DocumentIR {
  sheets: SheetIR[];
}

export function parseDocumentModel(text: string): DocumentIR {
  const sheets = parseDocument(text);
  const irSheets: SheetIR[] = [];

  for (const sheet of sheets) {
    if (!sheet.table) {
      irSheets.push({ name: sheet.name, table: null, hasMultipleTables: sheet.hasMultipleTables });
      continue;
    }
    const parsedRows: ParsedRow[] = sheet.table.rows.map((row) => parseTableRow(row));
    const widths = new Set(parsedRows.map((r) => r.cells.length));
    const columnCount = widths.size === 1 ? [...widths][0] : 0;

    const headerRowCount = headerRowCountFrom(parsedRows);
    const headerColumnCount = headerColumnCountFrom(parsedRows, columnCount);
    const bodyStart = headerRowCount > 0 ? headerRowCount + 1 : 0;

    const { rows, sections, maxDepth } = buildHierarchy(parsedRows, bodyStart);
    irSheets.push({
      name: sheet.name,
      table: {
        rowCount: parsedRows.length,
        columnCount,
        headerRowCount,
        headerColumnCount,
        sectionCount: sections.length,
        maxSectionDepth: maxDepth,
        rows,
        sections,
      },
      hasMultipleTables: sheet.hasMultipleTables,
    });
  }

  return { sheets: irSheets };
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
): { rows: RowIR[]; sections: SectionIR[]; maxDepth: number } {
  const rows: RowIR[] = [];
  const sections: SectionIR[] = [];
  let stack: SectionIR[] = [];
  let maxDepth = 0;

  parsedRows.slice(bodyStart).forEach((row, offset) => {
    const rowIndex = bodyStart + offset + 1;
    const labelRaw = row.rawCells.length > 0 ? row.rawCells[0] : "";
    const marker = parseSectionMarker(labelRaw.trim());
    if (marker) {
      const [name, depthValue] = marker;
      let depth = depthValue;
      while (stack.length > depth) {
        stack = stack.slice(0, -1);
      }
      if (stack.length < depth) {
        depth = stack.length;
      }
      const parentSections = stack.slice(0, depth).map((s) => s.name);
      const section: SectionIR = { name, depth, startRow: rowIndex };
      sections.push(section);
      stack = stack.slice(0, depth);
      stack.push(section);
      maxDepth = Math.max(maxDepth, depth);
      rows.push({
        rowIndex,
        cells: row.cells,
        label: labelRaw.trim(),
        kind: "section",
        depth,
        sectionName: name,
        parentSections,
      });
      return;
    }

    let indent = indentDepth(labelRaw);
    if (indent > stack.length) indent = stack.length;
    while (stack.length > indent) {
      stack = stack.slice(0, -1);
    }
    maxDepth = Math.max(maxDepth, stack.length);
    rows.push({
      rowIndex,
      cells: row.cells,
      label: labelRaw.trim(),
      kind: "row",
      depth: indent,
      sectionName: null,
      parentSections: stack.map((s) => s.name),
    });
  });

  return { rows, sections, maxDepth };
}

function parseSectionMarker(label: string): [string, number] | null {
  const match = SECTION_RE.exec(label);
  if (!match) return null;
  const [opens, name, closes] = match.slice(1);
  if (opens.length !== closes.length) return null;
  return [name.trim(), opens.length - 1];
}

function indentDepth(labelRaw: string): number {
  const leading = labelRaw.length - labelRaw.trimStart().length;
  return Math.floor(leading / 2);
}
