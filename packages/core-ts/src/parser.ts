export interface Table {
  rows: string[];
}

export interface TableBlock {
  kind: "table";
  table: Table;
}

export interface UnparsedBlock {
  kind: "unparsed";
  lines: string[];
}

export type SheetBlock = TableBlock | UnparsedBlock;

export interface Sheet {
  name: string;
  blocks: SheetBlock[];
  table: Table | null;
  hasMultipleTables: boolean;
}

export interface ParsedRow {
  rawCells: string[];
  cells: string[];
  boundary: number | null;
  errors: string[];
}

export function parseDocument(text: string): Sheet[] {
  const sheets: Sheet[] = [];
  let currentName: string | null = null;
  let currentRows: string[] = [];

  function flushSheet(): void {
    if (currentName === null) return;
    const blocks = splitBlocks(currentRows);
    const tables = blocks
      .filter((block): block is TableBlock => block.kind === "table")
      .map((block) => block.table);
    const table = tables.length > 0 ? tables[0] : null;
    sheets.push({
      name: currentName,
      blocks,
      table,
      hasMultipleTables: tables.length > 1,
    });
    currentRows = [];
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("# ")) {
      flushSheet();
      currentName = line.slice(2).trim();
      continue;
    }
    if (currentName !== null) {
      currentRows.push(line);
    }
  }

  flushSheet();
  return sheets;
}

function splitBlocks(lines: string[]): SheetBlock[] {
  const blocks: SheetBlock[] = [];
  let mode: "table" | "unparsed" | null = null;
  let current: string[] = [];

  function flushCurrent(): void {
    if (mode === null || current.length === 0) return;
    if (mode === "table") {
      blocks.push({ kind: "table", table: { rows: current } });
    } else {
      blocks.push({ kind: "unparsed", lines: current });
    }
    current = [];
    mode = null;
  }

  for (const line of lines) {
    const stripped = line.trim();
    const nextMode: "table" | "unparsed" =
      stripped.startsWith("|") && stripped.endsWith("|") ? "table" : "unparsed";
    const value = nextMode === "table" ? stripped : line;
    if (mode === null) {
      mode = nextMode;
      current.push(value);
      continue;
    }
    if (mode !== nextMode) {
      flushCurrent();
      mode = nextMode;
    }
    current.push(value);
  }

  flushCurrent();
  return blocks;
}

export function parseTableRow(row: string): ParsedRow {
  const content = row.trim();
  const errors: string[] = [];
  if (!(content.startsWith("|") && content.endsWith("|"))) {
    return { rawCells: [], cells: [], boundary: null, errors: ["row must start and end with '|'"] };
  }

  const inner = content.slice(1, -1);
  const { parts, errors: splitErrors } = splitUnescapedPipes(inner);
  errors.push(...splitErrors);

  const rawCells: string[] = [];
  const cells: string[] = [];
  let boundary: number | null = null;
  for (const segment of parts) {
    if (segment === "") {
      if (boundary === null) {
        boundary = cells.length;
      } else {
        errors.push("multiple || boundary markers in one row");
      }
      continue;
    }
    rawCells.push(segment);
    cells.push(segment.trim());
  }

  return { rawCells, cells, boundary, errors };
}

export function escapeCellText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function splitUnescapedPipes(inner: string): { parts: string[]; errors: string[] } {
  const parts: string[] = [""];
  const errors: string[] = [];
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === "\\") {
      if (i + 1 >= inner.length) {
        errors.push("dangling escape at end of row");
        i += 1;
        continue;
      }
      parts[parts.length - 1] += inner[i + 1];
      i += 2;
      continue;
    }
    if (ch === "|") {
      parts.push("");
      i += 1;
      continue;
    }
    parts[parts.length - 1] += ch;
    i += 1;
  }
  return { parts, errors };
}
