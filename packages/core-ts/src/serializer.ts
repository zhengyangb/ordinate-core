import { formatDocument } from "./formatter";
import { encodeStringLiteral } from "./text_encoding";
import { encodeNumberLiteral } from "./number_encoding";
import { type DocumentState, type SheetState } from "./incremental";
import { escapeCellText, withOrdFormatFrontMatter } from "./parser";
import { stripCellDisplayMetadata } from "./runtime/parse";
import { type ExprNode, type FormatSpec, type ParsedDisplayMetadata, type ReferenceExpr, type RefSelector, type RuntimeValue, type StyleSpec } from "./runtime/types";
import { isError, isValidExternalErrorKind } from "./runtime/errors";
import { renderFormulaExpression, type FormulaRenderContext } from "./runtime/renderFormula";
import { buildFormulaRenderContext } from "./formula_context";
import { noteBlockLines } from "./sheet_notes";

// Serialize a DocumentState to canonical .ord text.
export function serializeDocumentState(state: DocumentState): string {
  const formulaRenderContext = buildFormulaRenderContext(state);
  const lines: string[] = [];

  state.sheets.forEach((sheet, sheetIdx) => {
    lines.push(`# ${sheet.name}`);
    lines.push(...serializeSheetBodyLines(sheet, formulaRenderContext));
    if (sheetIdx !== state.sheets.length - 1) {
      lines.push("");
    }
  });

  const intermediate = `${lines.join("\n").replace(/(?:\n[ \t]*)+$/, "")}\n`;
  return formatDocument(`${withOrdFormatFrontMatter(state.frontMatter)}\n\n${intermediate}`);
}

function serializeSheetBodyLines(sheet: SheetState, formulaRenderContext: FormulaRenderContext): string[] {
  const tableLines = serializeCurrentTableLines(sheet, formulaRenderContext);
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
        output.push(...(block.kind === "note" ? noteBlockLines(block) : block.lines));
      }
    });
    return output;
  }

  if (tableLines.length === 0) {
    return sheet.sourceBlocks.flatMap((block) => block.kind === "note" ? noteBlockLines(block) : block.lines);
  }

  const output = sheet.sourceBlocks.flatMap((block) => block.kind === "note" ? noteBlockLines(block) : block.lines);
  if (output.length > 0 && output[output.length - 1] !== "") {
    output.push("");
  }
  output.push(...tableLines);
  return output;
}

function serializeCurrentTableLines(sheet: SheetState, formulaRenderContext: FormulaRenderContext): string[] {
  if (sheet.rowCount === 0 || sheet.colCount === 0) {
    return [];
  }

  const boundary = sheet.logicalRows.length > 0 ? sheet.logicalRows[0].boundary : null;
  const headerCount = sheet.headerRowCount;
  const includeMetaControlFrame = [...sheet.columnDisplayMetadata, ...sheet.rowDisplayMetadata].some((meta) => meta !== null);
  const rowIdToIndex = buildIdIndexMap(sheet.rowIds);
  const colIdToIndex = buildIdIndexMap(sheet.colIds);
  const rowLabelPathsByIndex = Array.from({ length: sheet.rowCount }, (_, rowIndex) =>
    rowIndex >= sheet.bodyStart ? (sheet.rowPaths[rowIndex - sheet.bodyStart] ?? "").split(".") : [],
  );
  const lines: string[] = [];

  if (includeMetaControlFrame) {
    const controlCells = ["@meta"];
    for (let c = 0; c < sheet.colCount; c += 1) {
      const meta = sheet.columnDisplayMetadata[c] ?? null;
      controlCells.push(meta ? renderMetaControlCell(meta) : " ");
    }
    const controlBoundary = boundary === null ? null : boundary + 1;
    lines.push(buildRow(controlCells, controlBoundary));
  }

  for (let rAbs = 0; rAbs < sheet.logicalRows.length; rAbs += 1) {
    if (headerCount > 0 && rAbs === headerCount) {
      const dividerCells = Array.from({ length: sheet.colCount + (includeMetaControlFrame ? 1 : 0) }, () => "---");
      const dividerBoundary = boundary === null ? null : boundary + (includeMetaControlFrame ? 1 : 0);
      lines.push(buildRow(dividerCells, dividerBoundary));
    }

    const row = sheet.logicalRows[rAbs];
    const rowBoundary = row.boundary === null ? null : row.boundary + (includeMetaControlFrame ? 1 : 0);
    const rowDefaultDisplay = sheet.rowDisplayMetadata[rAbs] ?? null;
    const cells: string[] = includeMetaControlFrame ? [rowDefaultDisplay ? renderMetaControlCell(rowDefaultDisplay) : " "] : [];
    for (let c = 0; c < sheet.colCount; c += 1) {
      const cellState = sheet.cells[rAbs][c];
      if (rAbs < sheet.headerRowCount || c < sheet.headerColCount) {
        const rawHeaderCell = c < row.rawCells.length ? row.rawCells[c] : "";
        const headerCellText = rAbs >= sheet.bodyStart && c === 0 ? stripCellDisplayMetadata(rawHeaderCell) : rawHeaderCell;
        cells.push(encodeTableCellText(headerCellText));
      } else {
        cells.push(encodeTableCellText(serializeCellState(
          cellState,
          rowIdToIndex,
          colIdToIndex,
          {
            ...formulaRenderContext,
            rowLabelPathsByIndex,
            colLabelsByIndex: sheet.colLabels,
          },
        )));
      }
    }
    lines.push(buildRow(cells, rowBoundary));
  }

  return lines;
}

function serializeCellState(
  cellState: SheetState["cells"][number][number],
  rowIdToIndex: Map<number, number>,
  colIdToIndex: Map<number, number>,
  formulaRenderContext: FormulaRenderContext,
): string {
  const body = cellState.body;
  const displaySuffix = renderDisplayBlock(cellState.localDisplay);
  if (!body.valid) {
    return `${body.unparsedBodyRaw}${displaySuffix}`;
  }
  if (body.kind === "literal") {
    return `${serializeLiteralBody(body.literal, body.inputText)}${displaySuffix}`;
  }

  const rhs = renderFormulaExpression(body.expression, rowIdToIndex, colIdToIndex, formulaRenderContext) ?? body.expressionText;
  if (!cellState.dirty && cellState.cachedValue !== null && cellState.cachedValue.kind !== "blank") {
    return `${serializeValue(cellState.cachedValue)} = ${rhs}${displaySuffix}`;
  }
  return `= ${rhs}${displaySuffix}`;
}


function serializeLiteralBody(value: RuntimeValue, inputText: string): string {
  if (value.kind === "blank") return "";
  if (value.kind === "string") return inputText;
  return serializeValue(value);
}

function buildRow(cells: string[], boundary: number | null): string {
  const parts: string[] = [];
  if (boundary === 0) {
    parts.push("");
  }
  cells.forEach((cell, idx) => {
    parts.push(escapeCellText(cell));
    if (boundary !== null && idx + 1 === boundary) {
      parts.push("");
    }
  });
  return `|${parts.join("|")}|`;
}

function encodeTableCellText(text: string): string {
  return text === "" ? " " : text;
}

function serializeValue(value: RuntimeValue): string {
  if (value.kind === "number") {
    return encodeNumberLiteral(value.value);
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

function serializeString(text: string): string {
  return encodeStringLiteral(text);
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

function renderDisplayBlock(display: ParsedDisplayMetadata | null): string {
  if (!display) return "";
  if (!display.valid) {
    return display.rawBlock ? ` ${display.rawBlock}` : "";
  }
  const format = display.format ? serializeFormatSpec(display.format) : "";
  const style = display.style ? serializeStyleSpec(display.style) : "";
  if (format === "" && style === "") {
    return "";
  }
  const blocks: string[] = [];
  if (format !== "") blocks.push(`{:${format}}`);
  if (style !== "") blocks.push(`{::${style}}`);
  return ` ${blocks.join(" ")}`;
}

function renderMetaControlCell(display: ParsedDisplayMetadata): string {
  if (!display.valid) {
    return display.rawBlock ?? "";
  }
  const format = display.format ? serializeFormatSpec(display.format) : "";
  const style = display.style ? serializeStyleSpec(display.style) : "";
  if (format === "" && style === "") return "";
  const blocks: string[] = [];
  if (format !== "") blocks.push(`{:${format}}`);
  if (style !== "") blocks.push(`{::${style}}`);
  return blocks.join(" ");
}

function serializeFormatSpec(spec: FormatSpec): string {
  if (spec.kind === "temporal") return spec.pattern;
  let out = "";
  if (spec.sign === "plus") out += "+";
  else if (spec.sign === "parentheses") out += "()";
  if (spec.padWidth !== null) out += `${spec.padWidth}`;
  if (spec.grouping) out += ",";
  if (spec.precision !== null) out += `.${spec.precision}`;
  if (spec.type !== null) out += spec.type;
  return out;
}

function serializeStyleSpec(spec: StyleSpec): string {
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
