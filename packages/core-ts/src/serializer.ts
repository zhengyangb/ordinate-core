import { formatDocument } from "./formatter";
import { type DocumentState, type SheetState } from "./incremental";
import { type ExprNode, type ReferenceExpr, type RefSelector, type RuntimeValue } from "./runtime/types";

// Serialize a DocumentState to canonical .ord text.
export function serializeDocumentState(state: DocumentState): string {
  const lines: string[] = [];

  state.sheets.forEach((sheet, sheetIdx) => {
    lines.push(`# ${sheet.name}`);
    lines.push(...serializeSheetBodyLines(sheet));
    if (sheetIdx !== state.sheets.length - 1) {
      lines.push("");
    }
  });

  const intermediate = `${lines.join("\n").replace(/\s+$/, "")}\n`;
  return formatDocument(intermediate);
}

function serializeSheetBodyLines(sheet: SheetState): string[] {
  const tableLines = serializeCurrentTableLines(sheet);
  if (sheet.sourceBlocks.length === 0) {
    return tableLines;
  }

  if (sheet.primaryTableBlockIndex !== null) {
    const output: string[] = [];
    sheet.sourceBlocks.forEach((block, idx) => {
      if (block.kind === "table" && idx === sheet.primaryTableBlockIndex) {
        if (tableLines.length > 0) {
          output.push(...tableLines);
        } else {
          output.push(...block.lines);
        }
      } else {
        output.push(...block.lines);
      }
    });
    return output;
  }

  if (tableLines.length === 0) {
    return sheet.sourceBlocks.flatMap((block) => block.lines);
  }

  const output = sheet.sourceBlocks.flatMap((block) => block.lines);
  if (output.length > 0 && output[output.length - 1] !== "") {
    output.push("");
  }
  output.push(...tableLines);
  return output;
}

function serializeCurrentTableLines(sheet: SheetState): string[] {
  if (sheet.rowCount === 0 || sheet.colCount === 0) {
    return [];
  }

  const boundary = sheet.logicalRows.length > 0 ? sheet.logicalRows[0].boundary : null;
  const headerCount = sheet.headerRowCount;
  const rowIdToIndex = buildIdIndexMap(sheet.rowIds);
  const colIdToIndex = buildIdIndexMap(sheet.colIds);
  const lines: string[] = [];

  for (let rAbs = 0; rAbs < sheet.logicalRows.length; rAbs += 1) {
    if (headerCount > 0 && rAbs === headerCount) {
      const dividerCells = Array.from({ length: sheet.colCount }, () => "---");
      lines.push(buildRow(dividerCells, boundary));
    }

    const row = sheet.logicalRows[rAbs];
    const cells: string[] = [];
    for (let c = 0; c < sheet.colCount; c += 1) {
      const raw = c < row.rawCells.length ? row.rawCells[c] : "";
      const cellState = sheet.cells[rAbs][c];
      if (cellState.parsed.kind === "formula") {
        if (isParseErrorExpression(cellState.parsed.expression)) {
          const exprText = cellState.parsed.expressionText?.trim() ?? "";
          cells.push(`error = ${exprText}`);
          continue;
        }

        const rhs = renderExpression(cellState.parsed.expression, rowIdToIndex, colIdToIndex)
          ?? cellState.parsed.expressionText
          ?? "";
        if (!cellState.dirty && cellState.value !== null && cellState.value.kind !== "blank") {
          cells.push(`${serializeValue(cellState.value)} = ${rhs}`);
        } else {
          cells.push(`= ${rhs}`);
        }
      } else {
        cells.push(raw);
      }
    }
    lines.push(buildRow(cells, row.boundary));
  }

  return lines;
}

function isParseErrorExpression(node: ExprNode | null | undefined): boolean {
  if (!node || node.kind !== "literal") return false;
  const value = node.value as RuntimeValue;
  return value.kind === "error" && value.value === "parse_error";
}

function buildRow(cells: string[], boundary: number | null): string {
  const parts: string[] = [];
  if (boundary === 0) {
    parts.push("");
  }
  cells.forEach((cell, idx) => {
    parts.push(cell);
    if (boundary !== null && idx + 1 === boundary) {
      parts.push("");
    }
  });
  return `|${parts.join("|")}|`;
}

function serializeValue(value: RuntimeValue): string {
  if (value.kind === "number") {
    return serializeNumber(value.value as number | null);
  }
  if (value.kind === "string") {
    return serializeString(String(value.value ?? ""));
  }
  if (value.kind === "boolean") {
    return value.value ? "true" : "false";
  }
  if (value.kind === "blank") {
    return "";
  }
  if (value.kind === "null") {
    return "null";
  }
  if (value.kind === "error") {
    return "error";
  }
  return "error";
}

function serializeNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "error";
  }
  if (Number.isInteger(value)) {
    return `${value}`;
  }
  const text = Number(value).toPrecision(15);
  return Number(text).toString();
}

function serializeString(text: string): string {
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function buildIdIndexMap(ids: number[]): Map<number, number> {
  const map = new Map<number, number>();
  ids.forEach((id, idx) => map.set(id, idx));
  return map;
}

function renderExpression(
  node: ExprNode | null | undefined,
  rowIdToIndex: Map<number, number>,
  colIdToIndex: Map<number, number>,
  parentPrec = 0,
): string | null {
  if (!node) return null;
  if (node.kind === "literal") {
    const value = node.value as RuntimeValue;
    if (value.kind === "string") return serializeString(String(value.value ?? ""));
    if (value.kind === "number") return serializeNumber(value.value as number | null);
    if (value.kind === "boolean") return value.value ? "true" : "false";
    if (value.kind === "null") return "null";
    if (value.kind === "error") return "error";
    if (value.kind === "blank") return "";
    return "error";
  }
  if (node.kind === "reference") {
    const ref = node.value as ReferenceExpr;
    if (ref.style === "spreadsheet") {
      const spreadsheet = renderSpreadsheetReference(ref, rowIdToIndex, colIdToIndex);
      if (spreadsheet) return spreadsheet;
    }
    const rowSel = renderSelector(ref.rowSelector, rowIdToIndex);
    const colSel = renderSelector(ref.colSelector, colIdToIndex);
    return `@[${rowSel},${colSel}]`;
  }
  if (node.kind === "call") {
    const call = node.value as { name: string; args: ExprNode[] };
    const args = call.args.map((arg) => renderExpression(arg, rowIdToIndex, colIdToIndex) ?? "error");
    return `${call.name}(${args.join(", ")})`;
  }
  if (node.kind === "unary") {
    const inner = renderExpression(node.right ?? null, rowIdToIndex, colIdToIndex, precedence("unary")) ?? "error";
    const text = `-${inner}`;
    return parentPrec > precedence("unary") ? `(${text})` : text;
  }
  if (node.kind === "binary") {
    const op = String(node.value ?? "");
    const prec = precedence(op);
    const left = renderExpression(node.left ?? null, rowIdToIndex, colIdToIndex, prec) ?? "error";
    const right = renderExpression(node.right ?? null, rowIdToIndex, colIdToIndex, prec + 1) ?? "error";
    const text = `${left} ${op} ${right}`;
    return parentPrec > prec ? `(${text})` : text;
  }
  return null;
}

function precedence(op: string): number {
  if (op === "unary") return 4;
  if (op === "*" || op === "/") return 3;
  if (op === "+" || op === "-") return 2;
  if (op === "<" || op === "<=" || op === ">" || op === ">=") return 1;
  if (op === "==" || op === "!=") return 0;
  return 0;
}

function renderSelector(selector: RefSelector, idToIndex: Map<number, number>): string {
  if (selector.kind === "all") return ":";
  if (selector.kind === "range") {
    const [startSel, endSel] = selector.value as [RefSelector | null, RefSelector | null];
    const startText = startSel ? renderScalarSelector(startSel, idToIndex) : "";
    const endText = endSel ? renderScalarSelector(endSel, idToIndex) : "";
    return `${startText}:${endText}`;
  }
  return renderScalarSelector(selector, idToIndex);
}

function renderScalarSelector(selector: RefSelector, idToIndex: Map<number, number>): string {
  if (selector.kind === "current") return "_";
  if (selector.kind === "offset") {
    const offset = Number(selector.value ?? 0);
    return offset >= 0 ? `_${offset === 0 ? "" : `+${offset}`}` : `_${offset}`;
  }
  if (selector.kind === "absolute_fixed") {
    const idx = Number(selector.value ?? 0);
    return `#${idx + 1}!`;
  }
  if (selector.kind === "absolute") {
    const idx = Number(selector.value ?? 0);
    return `#${idx + 1}`;
  }
  if (selector.kind === "absolute_id") {
    const idx = idToIndex.get(Number(selector.value));
    if (idx === undefined) return "#?";
    return `#${idx + 1}`;
  }
  if (selector.kind === "label") {
    const parts = selector.value as string[];
    return parts.map((p) => quotePathComponent(p)).join(".");
  }
  return "?";
}

function quotePathComponent(text: string): string {
  if (/^[A-Za-z0-9_]+$/.test(text)) {
    return text;
  }
  return serializeString(text);
}

type SpreadsheetAxis =
  | { kind: "all" }
  | { kind: "scalar"; index: number }
  | { kind: "range"; start: number; end: number };

function renderSpreadsheetReference(
  ref: ReferenceExpr,
  rowIdToIndex: Map<number, number>,
  colIdToIndex: Map<number, number>,
): string | null {
  const rowAxis = spreadsheetAxis(ref.rowSelector, rowIdToIndex);
  const colAxis = spreadsheetAxis(ref.colSelector, colIdToIndex);
  if (!rowAxis || !colAxis) return null;

  if (rowAxis.kind === "all" && colAxis.kind === "all") {
    return null;
  }

  if (rowAxis.kind === "all") {
    if (colAxis.kind === "scalar") {
      const col = columnLabel(colAxis.index);
      return `${col}:${col}`;
    }
    if (colAxis.kind === "range") {
      const start = columnLabel(colAxis.start);
      const end = columnLabel(colAxis.end);
      return `${start}:${end}`;
    }
    return null;
  }

  if (colAxis.kind === "all") {
    if (rowAxis.kind === "scalar") {
      const row = rowAxis.index + 1;
      return `${row}:${row}`;
    }
    if (rowAxis.kind === "range") {
      const start = rowAxis.start + 1;
      const end = rowAxis.end + 1;
      return `${start}:${end}`;
    }
    return null;
  }

  const rowStart = rowAxis.kind === "scalar" ? rowAxis.index : rowAxis.start;
  const rowEnd = rowAxis.kind === "scalar" ? rowAxis.index : rowAxis.end;
  const colStart = colAxis.kind === "scalar" ? colAxis.index : colAxis.start;
  const colEnd = colAxis.kind === "scalar" ? colAxis.index : colAxis.end;

  const startCell = `${columnLabel(colStart)}${rowStart + 1}`;
  const endCell = `${columnLabel(colEnd)}${rowEnd + 1}`;
  if (rowStart === rowEnd && colStart === colEnd) return startCell;
  return `${startCell}:${endCell}`;
}

function spreadsheetAxis(selector: RefSelector, idToIndex: Map<number, number>): SpreadsheetAxis | null {
  if (selector.kind === "all") {
    return { kind: "all" };
  }
  if (selector.kind === "absolute") {
    return { kind: "scalar", index: Number(selector.value) };
  }
  if (selector.kind === "absolute_id") {
    const idx = idToIndex.get(Number(selector.value));
    if (idx === undefined) return null;
    return { kind: "scalar", index: idx };
  }
  if (selector.kind === "range") {
    const [startSel, endSel] = selector.value as [RefSelector | null, RefSelector | null];
    if (!startSel || !endSel) return null;
    const start = spreadsheetScalar(startSel, idToIndex);
    const end = spreadsheetScalar(endSel, idToIndex);
    if (start === null || end === null) return null;
    return { kind: "range", start, end };
  }
  return null;
}

function spreadsheetScalar(selector: RefSelector, idToIndex: Map<number, number>): number | null {
  if (selector.kind === "absolute") {
    return Number(selector.value);
  }
  if (selector.kind === "absolute_id") {
    const idx = idToIndex.get(Number(selector.value));
    return idx === undefined ? null : idx;
  }
  return null;
}

function columnLabel(index: number): string {
  let value = index + 1;
  let out = "";
  while (value > 0) {
    const rem = (value - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}
