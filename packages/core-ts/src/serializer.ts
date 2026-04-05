import { formatDocument } from "./formatter";
import { type DocumentState, type SheetState } from "./incremental";
import { stripCellDisplayMetadata } from "./runtime/parse";
import { type ExprNode, type ParsedDisplayMetadata, type ReferenceExpr, type RefSelector, type RuntimeValue } from "./runtime/types";
import { isError, isValidExternalErrorKind } from "./runtime/errors";

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
  const includeDisplayControlFrame = sheet.columnDisplayMetadata.some((meta) => meta !== null);
  const rowIdToIndex = buildIdIndexMap(sheet.rowIds);
  const colIdToIndex = buildIdIndexMap(sheet.colIds);
  const lines: string[] = [];

  if (includeDisplayControlFrame) {
    const controlCells = ["@display"];
    for (let c = 0; c < sheet.colCount; c += 1) {
      const meta = sheet.columnDisplayMetadata[c] ?? null;
      controlCells.push(meta ? renderDisplayControlCell(meta) : " ");
    }
    const controlBoundary = boundary === null ? null : boundary + 1;
    lines.push(buildRow(controlCells, controlBoundary));
  }

  for (let rAbs = 0; rAbs < sheet.logicalRows.length; rAbs += 1) {
    if (headerCount > 0 && rAbs === headerCount) {
      const dividerCells = Array.from({ length: sheet.colCount + (includeDisplayControlFrame ? 1 : 0) }, () => "---");
      const dividerBoundary = boundary === null ? null : boundary + (includeDisplayControlFrame ? 1 : 0);
      lines.push(buildRow(dividerCells, dividerBoundary));
    }

    const row = sheet.logicalRows[rAbs];
    const rowBoundary = row.boundary === null ? null : row.boundary + (includeDisplayControlFrame ? 1 : 0);
    const cells: string[] = includeDisplayControlFrame ? [" "] : [];
    for (let c = 0; c < sheet.colCount; c += 1) {
      const raw = c < row.rawCells.length ? row.rawCells[c] : "";
      const cellState = sheet.cells[rAbs][c];
      if (cellState.parsed.kind === "formula") {
        const displaySuffix = renderDisplayBlock(cellState.parsed.display ?? null);
        if (isParseErrorExpression(cellState.parsed.expression)) {
          const exprText = cellState.parsed.expressionText?.trim() ?? "";
          cells.push(`= ${exprText}${displaySuffix}`);
          continue;
        }

        const rhs = renderExpression(cellState.parsed.expression, rowIdToIndex, colIdToIndex)
          ?? cellState.parsed.expressionText
          ?? "";
        if (!cellState.dirty && cellState.cachedValue !== null && cellState.cachedValue.kind !== "blank") {
          cells.push(`${serializeValue(cellState.cachedValue)} = ${rhs}${displaySuffix}`);
        } else {
          cells.push(`= ${rhs}${displaySuffix}`);
        }
      } else {
        const displaySuffix = renderDisplayBlock(cellState.parsed.display ?? null);
        if (displaySuffix === "") {
          cells.push(raw);
        } else {
          const base = stripCellDisplayMetadata(raw).trim();
          cells.push(`${base}${displaySuffix}`);
        }
      }
    }
    lines.push(buildRow(cells, rowBoundary));
  }

  return lines;
}

function isParseErrorExpression(node: ExprNode | null | undefined): boolean {
  if (!node || node.kind !== "literal") return false;
  const value = node.value as RuntimeValue;
  return isError(value) && value.errorKind === "parse_error";
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
  if (value.kind === "date" || value.kind === "time" || value.kind === "datetime" || value.kind === "duration") {
    return String(value.value ?? "");
  }
  if (value.kind === "error") {
    return serializeErrorValue(value);
  }
  return "error[generic]";
}

function serializeNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "error[generic]";
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

function serializeErrorValue(value: RuntimeValue): string {
  if (!isError(value)) {
    return "error[generic]";
  }
  const externalKind = String(value.errorKind ?? "generic");
  if (!isValidExternalErrorKind(externalKind)) {
    throw new Error(`invalid error kind during serialization: '${externalKind}'`);
  }
  return `error[${externalKind}]`;
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
    if (value.kind === "date" || value.kind === "time" || value.kind === "datetime" || value.kind === "duration") {
      return String(value.value ?? "");
    }
    if (value.kind === "error") return serializeErrorValue(value);
    if (value.kind === "blank") return "";
    return "error[generic]";
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
    const args = call.args.map((arg) => renderExpression(arg, rowIdToIndex, colIdToIndex) ?? "error[generic]");
    return `${call.name}(${args.join(", ")})`;
  }
  if (node.kind === "unary") {
    const inner = renderExpression(node.right ?? null, rowIdToIndex, colIdToIndex, precedence("unary")) ?? "error[generic]";
    const text = `-${inner}`;
    return parentPrec > precedence("unary") ? `(${text})` : text;
  }
  if (node.kind === "binary") {
    const op = String(node.value ?? "");
    const prec = precedence(op);
    const left = renderExpression(node.left ?? null, rowIdToIndex, colIdToIndex, prec) ?? "error[generic]";
    const right = renderExpression(node.right ?? null, rowIdToIndex, colIdToIndex, prec + 1) ?? "error[generic]";
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

function renderDisplayBlock(display: ParsedDisplayMetadata | null): string {
  if (!display) return "";
  if (!display.valid) {
    return display.rawBlock ? ` ${display.rawBlock}` : "";
  }
  const format = display.formatSpec ? serializeFormatSpec(display.formatSpec) : "";
  const style = display.styleSpec ? serializeStyleSpec(display.styleSpec) : "";
  if (format === "" && style === "") {
    return "";
  }
  if (style === "") {
    return ` {:${format}}`;
  }
  if (format === "") {
    return ` {::${style}}`;
  }
  return ` {:${format}:${style}}`;
}

function renderDisplayControlCell(display: ParsedDisplayMetadata): string {
  if (!display.valid) {
    return display.rawBlock ?? "";
  }
  const format = display.formatSpec ? serializeFormatSpec(display.formatSpec) : "";
  const style = display.styleSpec ? serializeStyleSpec(display.styleSpec) : "";
  if (format === "" && style === "") return "";
  if (style === "") return `{:${format}}`;
  if (format === "") return `{::${style}}`;
  return `{:${format}:${style}}`;
}

function serializeFormatSpec(spec: NonNullable<ParsedDisplayMetadata["formatSpec"]>): string {
  let out = "";
  if (spec.sign === "plus") out += "+";
  else if (spec.sign === "parentheses") out += "()";
  if (spec.zeroPad) out += "0";
  if (spec.width !== null) out += `${spec.width}`;
  if (spec.grouping) out += ",";
  if (spec.precision !== null) out += `.${spec.precision}`;
  if (spec.type !== null) out += spec.type;
  return out;
}

function serializeStyleSpec(spec: NonNullable<ParsedDisplayMetadata["styleSpec"]>): string {
  const parts: string[] = [];
  if (spec.align === "left") parts.push("<");
  if (spec.align === "right") parts.push(">");
  if (spec.align === "center") parts.push("^");
  if (spec.weight === "bold") parts.push("bold");
  if (spec.weight === "normal") parts.push("normal");
  if (spec.color === "red") parts.push("red");
  if (spec.color === "green") parts.push("green");
  if (spec.color === "blue") parts.push("blue");
  return parts.join(",");
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
