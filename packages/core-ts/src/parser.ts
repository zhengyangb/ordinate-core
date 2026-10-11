import { trimCellText } from "./text_encoding";
import { parseSheetNote, SheetNoteError, type NoteDiagnostic, type NoteSourceBlock } from "./sheet_notes";

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
  diagnostics: NoteDiagnostic[];
}

export type SheetBlock = TableBlock | NoteSourceBlock | UnparsedBlock;

export interface Sheet {
  name: string;
  blocks: SheetBlock[];
  table: Table | null;
  hasMultipleTables: boolean;
}

export interface ParsedDocument {
  /** Front-matter block, including delimiters; only its format marker is interpreted. */
  frontMatter: string | null;
  sheets: Sheet[];
}

export const ORD_FORMAT_VERSION = "0.1";
const ORD_FORMAT_LINE = `ord-format: "${ORD_FORMAT_VERSION}"`;

export class DocumentParseError extends Error {
  readonly code: "front_matter_unterminated" | "invalid_ord_format" | "unsupported_ord_format" | "legacy_meta_frame";

  constructor(
    code: DocumentParseError["code"] = "front_matter_unterminated",
    message = "YAML front matter must end with a standalone '---' or '...' line.",
  ) {
    super(message);
    this.code = code;
    this.name = "DocumentParseError";
  }
}

function frontMatterPayloadStart(frontMatter: string): { offset: number; newline: string } {
  const newlineIndex = frontMatter.indexOf("\n");
  if (newlineIndex < 0) throw new DocumentParseError();
  return {
    offset: newlineIndex + 1,
    newline: frontMatter[newlineIndex - 1] === "\r" ? "\r\n" : "\n",
  };
}

function checkOrdFormat(frontMatter: string | null): boolean {
  if (frontMatter === null) return false;
  const { offset } = frontMatterPayloadStart(frontMatter);
  const lines = frontMatter.slice(offset).split(/\r?\n/);
  const formatLines = lines.flatMap((line, index) => /^ord-format[ \t]*:/.test(line) ? [index] : []);
  if (formatLines.length === 0) return false;
  if (formatLines.length !== 1 || formatLines[0] !== 0) {
    throw new DocumentParseError("invalid_ord_format", "ord-format must occur exactly once, as the first front-matter content line.");
  }
  const version = /^ord-format:[ \t]*"(\d+\.\d+)"[ \t]*$/.exec(lines[0])?.[1];
  if (version === undefined) {
    throw new DocumentParseError("invalid_ord_format", "ord-format must be a quoted major.minor string on the first front-matter content line.");
  }
  if (version !== ORD_FORMAT_VERSION) {
    throw new DocumentParseError("unsupported_ord_format", `Unsupported ORD format ${version}; this version supports ${ORD_FORMAT_VERSION}.`);
  }
  return true;
}

/** Add the canonical format marker while preserving all other front-matter bytes. */
export function withOrdFormatFrontMatter(frontMatter: string | null): string {
  if (frontMatter === null) return `---\n${ORD_FORMAT_LINE}\n---`;
  if (checkOrdFormat(frontMatter)) return frontMatter;
  const { offset, newline } = frontMatterPayloadStart(frontMatter);
  return `${frontMatter.slice(0, offset)}${ORD_FORMAT_LINE}${newline}${frontMatter.slice(offset)}`;
}

/** True when front matter contains content beyond the canonical format marker. */
export function hasNonFormatFrontMatter(frontMatter: string | null): boolean {
  if (frontMatter === null) return false;
  const { offset } = frontMatterPayloadStart(frontMatter);
  const payload = frontMatter.slice(offset).replace(/\r?\n(?:---|\.\.\.)[ \t]*$/, "");
  const lines = payload.split(/\r?\n/);
  if (checkOrdFormat(frontMatter)) lines.shift();
  return lines.some((line) => line.trim() !== "");
}

function splitDocumentEnvelope(text: string): { frontMatter: string | null; body: string } {
  // An optional UTF-8 BOM is a file encoding marker, not front-matter data.
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const opening = /^---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!opening) return { frontMatter: null, body: source };
  const closingPattern = /\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/g;
  closingPattern.lastIndex = opening[0].length - 1;
  const closing = closingPattern.exec(source);
  if (!closing) throw new DocumentParseError();
  const end = closing.index + closing[0].length;
  const newlineLength = source.startsWith("\r\n", end) ? 2 : source[end] === "\n" ? 1 : 0;
  const frontMatter = source.slice(0, end);
  checkOrdFormat(frontMatter);
  return { frontMatter, body: source.slice(end + newlineLength) };
}

export interface ParsedRow {
  /** Serialization-only row display metadata, removed from logical coordinates. */
  metaControl?: string;
  rawCells: string[];
  cells: string[];
  boundary: number | null;
  errors: string[];
}

export interface MetaControlFrameResult {
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

const HIERARCHY_PREFIX_RE = /^(\*+)(?:\s+(.*))?$/;

export function parseDocument(text: string): ParsedDocument {
  const { frontMatter, body } = splitDocumentEnvelope(text);
  const sheets: Sheet[] = [];
  let currentName: string | null = null;
  let currentRows: string[] = [];

  function flushSheet(): void {
    if (currentName === null) return;
    const blocks = splitBlocks(currentRows);
    const tables = blocks
      .filter((block): block is TableBlock => block.kind === "table")
      .map((block) => block.table);
    if (tables.some((table) => parseTableRow(table.rows[0]).cells[0] === "@display")) {
      throw new DocumentParseError("legacy_meta_frame", "The @metadata control frame is no longer supported; use @meta.");
    }
    const table = tables.length > 0 ? tables[0] : null;
    sheets.push({
      name: currentName,
      blocks,
      table,
      hasMultipleTables: tables.length > 1,
    });
    currentRows = [];
  }

  for (const raw of body.split(/\r?\n/)) {
    const line = raw;
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
  return { frontMatter, sheets };
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
      try {
        const note = parseSheetNote(current.join("\n"));
        blocks.push(note.blocks.length ? { kind: "note", note } : { kind: "unparsed", lines: current, diagnostics: [] });
      } catch (error) {
        if (!(error instanceof SheetNoteError)) throw error;
        blocks.push({ kind: "unparsed", lines: current, diagnostics: [{ code: error.code, message: error.message, line: error.line }] });
      }
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
    cells.push(trimCellText(segment));
  }

  return { rawCells, cells, boundary, errors };
}

// Strip the serialization-only metadata control frame when its top-left marker is "@meta".
// Control frame consists of:
// - first row: column display defaults (top-left marker cell + per-column display cells)
// - first column: row display defaults
// Returned rows are semantic table rows used by evaluation/validation/runtime.
export function stripMetaControlFrame(rows: ParsedRow[]): MetaControlFrameResult {
  if (rows.length === 0) {
    return { hasControlFrame: false, controlRow: null, rows: [] };
  }
  const first = rows[0];
  if (first.cells.length === 0 || first.cells[0] !== "@meta") {
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
        nextErrors.push("metadata control frame boundary underflow");
        nextBoundary = null;
      }
    }
    stripped.push({
      metaControl: row.rawCells[0] ?? "",
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
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

export function parseHierarchyLabel(labelRaw: string): ParsedHierarchyLabel {
  const trimmed = labelRaw.trim();
  let depth = 0;
  let content = trimmed;

  const prefixed = HIERARCHY_PREFIX_RE.exec(trimmed);
  if (prefixed) {
    depth = prefixed[1].length;
    content = prefixed[2]?.trim() ?? "";
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
      if (next === "n" || next === "r") {
        parts[parts.length - 1] += next === "n" ? "\n" : "\r";
        i += 2;
        continue;
      }
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
