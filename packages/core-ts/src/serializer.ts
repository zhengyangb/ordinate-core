import { formatDocument } from "./formatter";
import { type DocumentState } from "./incremental";
import { type ExprNode, type ReferenceExpr, type RefSelector, type RuntimeValue } from "./runtime/types";

// Serialize a DocumentState to canonical .ord text.
export function serializeDocumentState(state: DocumentState): string {
  const lines: string[] = [];

  state.sheets.forEach((sheet, sheetIdx) => {
    lines.push(`# ${sheet.name}`);
    if (sheet.rowCount > 0 && sheet.colCount > 0) {
      const boundary = sheet.logicalRows.length > 0 ? sheet.logicalRows[0].boundary : null;
      const headerCount = sheet.headerRowCount;
      const rowIdToIndex = buildIdIndexMap(sheet.rowIds);
      const colIdToIndex = buildIdIndexMap(sheet.colIds);

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
    }
    if (sheetIdx !== state.sheets.length - 1) {
      lines.push("");
    }
  });

  const intermediate = `${lines.join("\n").replace(/\s+$/, "")}\n`;
  return formatDocument(intermediate);
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
