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

export interface DisplayControlFrameResult {
  hasControlFrame: boolean;
  controlRow: ParsedRow | null;
  rows: ParsedRow[];
}

export interface ParsedHierarchyLabel {
  depth: number;
  content: string;
}

export interface DerivedHierarchyRow {
  rowIndex: number;
  rawDepth: number;
  depth: number;
  content: string;
  path: string[];
}

const HIERARCHY_PREFIX_RE = /^(\*+)\s+(.*)$/;

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

// Strip serialization-only display control frame when top-left marker is "@display".
// Control frame consists of:
// - first row: column display defaults (top-left marker cell + per-column display cells)
// - first column: reserved control column (future row defaults)
// Returned rows are semantic table rows used by evaluation/validation/runtime.
export function stripDisplayControlFrame(rows: ParsedRow[]): DisplayControlFrameResult {
  if (rows.length === 0) {
    return { hasControlFrame: false, controlRow: null, rows: [] };
  }
  const first = rows[0];
  if (first.cells.length === 0 || first.cells[0] !== "@display") {
    return { hasControlFrame: false, controlRow: null, rows };
  }

  const stripped: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const nextRaw = row.rawCells.length > 0 ? row.rawCells.slice(1) : [];
    const nextCells = row.cells.length > 0 ? row.cells.slice(1) : [];
    let nextBoundary = row.boundary;
    const nextErrors = [...row.errors];
    if (nextBoundary !== null) {
      nextBoundary -= 1;
      if (nextBoundary < 0) {
        nextErrors.push("display control frame boundary underflow");
        nextBoundary = null;
      }
    }
    stripped.push({
      rawCells: nextRaw,
      cells: nextCells,
      boundary: nextBoundary,
      errors: nextErrors,
    });
  }

  return {
    hasControlFrame: true,
    controlRow: first,
    rows: stripped,
  };
}

export function escapeCellText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

export function parseHierarchyLabel(labelRaw: string): ParsedHierarchyLabel {
  const trimmed = labelRaw.trim();
  let depth = 0;
  let content = trimmed;

  const prefixed = HIERARCHY_PREFIX_RE.exec(trimmed);
  if (prefixed) {
    depth = prefixed[1].length;
    content = prefixed[2].trim();
  }

  return {
    depth,
    content,
  };
}

export function deriveHierarchyRows(parsedRows: ParsedRow[], bodyStart: number): DerivedHierarchyRow[] {
  const derived: DerivedHierarchyRow[] = [];
  let stack: string[] = [];

  parsedRows.slice(bodyStart).forEach((row, offset) => {
    const rowIndex = bodyStart + offset;
    const labelRaw = row.rawCells.length > 0 ? row.rawCells[0] : "";
    const parsed = parseHierarchyLabel(labelRaw);
    const depth = Math.min(parsed.depth, stack.length);
    const nextStack = stack.slice(0, depth);
    nextStack.push(parsed.content);
    derived.push({
      rowIndex,
      rawDepth: parsed.depth,
      depth,
      content: parsed.content,
      path: nextStack.filter((part) => part.length > 0),
    });
    stack = nextStack;
  });

  return derived;
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
        parts[parts.length - 1] += "\\";
        i += 1;
        continue;
      }
      const next = inner[i + 1];
      if (next === "|" || next === "\\") {
        // Table-layer escapes: \| -> | and \\ -> \
        parts[parts.length - 1] += next;
        i += 2;
        continue;
      }
      // Preserve unknown backslash sequences literally.
      parts[parts.length - 1] += `\\${next}`;
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
