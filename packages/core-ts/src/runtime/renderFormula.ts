import { isError, isValidExternalErrorKind } from "./errors";
import type { ArrayExpr, ExprNode, IndexAxisExpr, IndexExpr, ReferenceExpr, RefSelector, RuntimeValue } from "./types";

export type FormulaRenderContext = {
  rowLabelPathsByIndex?: string[][];
  colLabelsByIndex?: string[];
};

export function renderFormulaExpression(
  node: ExprNode | null | undefined,
  rowIdToIndex: Map<number, number>,
  colIdToIndex: Map<number, number>,
  context: FormulaRenderContext = {},
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
    const rowSel = renderSelector(ref.rowSelector, rowIdToIndex, context.rowLabelPathsByIndex);
    const colSel = renderSelector(ref.colSelector, colIdToIndex, context.colLabelsByIndex?.map((label) => [label]));
    return `@[${rowSel},${colSel}]`;
  }
  if (node.kind === "call") {
    const call = node.value as { name: string; args: ExprNode[] };
    const args = call.args.map((arg) => renderFormulaExpression(arg, rowIdToIndex, colIdToIndex, context) ?? "error[generic]");
    return `${call.name}(${args.join(", ")})`;
  }
  if (node.kind === "array") {
    const array = node.value as ArrayExpr;
    const rows = array.rows.map((row) =>
      row.map((element) => renderFormulaExpression(element, rowIdToIndex, colIdToIndex, context) ?? "error[generic]"));
    const text = array.depth === 2
      ? `[${rows.map((row) => `[${row.join(", ")}]`).join(", ")}]`
      : `[${(rows[0] ?? []).join(", ")}]`;
    return parentPrec > precedence("primary") ? `(${text})` : text;
  }
  if (node.kind === "index") {
    const index = node.value as IndexExpr;
    const target =
      renderFormulaExpression(index.target, rowIdToIndex, colIdToIndex, context, precedence("postfix")) ?? "error[generic]";
    const axes = index.axes.map((axis) => renderIndexAxis(axis, rowIdToIndex, colIdToIndex, context));
    const text = `${target}[${axes.join(", ")}]`;
    return parentPrec > precedence("postfix") ? `(${text})` : text;
  }
  if (node.kind === "unary") {
    const inner =
      renderFormulaExpression(node.right ?? null, rowIdToIndex, colIdToIndex, context, precedence("unary")) ?? "error[generic]";
    const text = `-${inner}`;
    return parentPrec > precedence("unary") ? `(${text})` : text;
  }
  if (node.kind === "binary") {
    const op = String(node.value ?? "");
    const prec = precedence(op);
    const left = renderFormulaExpression(node.left ?? null, rowIdToIndex, colIdToIndex, context, prec) ?? "error[generic]";
    const right = renderFormulaExpression(node.right ?? null, rowIdToIndex, colIdToIndex, context, prec + 1) ?? "error[generic]";
    const text = `${left} ${op} ${right}`;
    return parentPrec > prec ? `(${text})` : text;
  }
  return null;
}

function precedence(op: string): number {
  if (op === "primary") return 6;
  if (op === "postfix") return 5;
  if (op === "unary") return 4;
  if (op === "*" || op === "/") return 3;
  if (op === "+" || op === "-") return 2;
  if (op === "<" || op === "<=" || op === ">" || op === ">=") return 1;
  if (op === "==" || op === "!=") return 0;
  return 0;
}

function renderIndexAxis(
  axis: IndexAxisExpr,
  rowIdToIndex: Map<number, number>,
  colIdToIndex: Map<number, number>,
  context: FormulaRenderContext,
): string {
  if (axis.kind === "scalar") {
    return renderFormulaExpression(axis.value, rowIdToIndex, colIdToIndex, context) ?? "error[generic]";
  }
  const start = axis.start ? renderFormulaExpression(axis.start, rowIdToIndex, colIdToIndex, context) ?? "error[generic]" : "";
  const end = axis.end ? renderFormulaExpression(axis.end, rowIdToIndex, colIdToIndex, context) ?? "error[generic]" : "";
  return `${start}:${end}`;
}

function renderSelector(selector: RefSelector, idToIndex: Map<number, number>, labelsByIndex?: string[][]): string {
  if (selector.kind === "all") return ":";
  if (selector.kind === "range") {
    const [startSel, endSel] = selector.value as [RefSelector | null, RefSelector | null];
    const startText = startSel ? renderScalarSelector(startSel, idToIndex, labelsByIndex) : "";
    const endText = endSel ? renderScalarSelector(endSel, idToIndex, labelsByIndex) : "";
    return `${startText}:${endText}`;
  }
  return renderScalarSelector(selector, idToIndex, labelsByIndex);
}

function renderScalarSelector(selector: RefSelector, idToIndex: Map<number, number>, labelsByIndex?: string[][]): string {
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
  if (selector.kind === "label_id") {
    const idx = idToIndex.get(Number(selector.value));
    if (idx === undefined) return "#?";
    const label = labelsByIndex?.[idx];
    if (label && label.length > 0) {
      const key = JSON.stringify(label);
      const matchCount = labelsByIndex?.filter((candidate) => JSON.stringify(candidate) === key).length ?? 0;
      if (matchCount === 1) {
        return label.map((p) => quotePathComponent(p)).join(".");
      }
    }
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
  const escaped = text.replace(/\\/g, "\\\\").replace(/\"/g, '\\"');
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
