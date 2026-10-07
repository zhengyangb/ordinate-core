import { isError, isValidExternalErrorKind } from "./errors";
import { encodeStringLiteral } from "../text_encoding";
import { encodeNumberLiteral } from "../number_encoding";
import { renderSpreadsheetAddress } from "./spreadsheetAddress";
import { formatFormulaReferencePathComponent, formatFormulaSheetSelector } from "./referenceSyntax";
import { getBoundSheetId, selectorSource } from "./references";
import type { ArrayExpr, ExprNode, IndexAxisExpr, IndexExpr, ReferenceExpr, RefSelector, RuntimeValue } from "./types";

export type FormulaRenderContext = {
  rowLabelPathsByIndex?: string[][];
  colLabelsByIndex?: string[];
  sheetsById?: Map<number, FormulaSheetRenderContext>;
};

export type FormulaSheetRenderContext = {
  sheetName: string;
  rowIdToIndex: Map<number, number>;
  colIdToIndex: Map<number, number>;
  rowLabelPathsByIndex: string[][];
  colLabelsByIndex: string[];
};

export function renderFormulaExpression(
  node: ExprNode | null | undefined,
  rowIdToIndex: Map<number, number>,
  colIdToIndex: Map<number, number>,
  context: FormulaRenderContext = {},
  parentPrec = 0,
): string | null {
  if (!node) return null;
  if (node.sourceForm === "f_string") {
    const literal = (text: string) => JSON.stringify(text).slice(1, -1).replaceAll("{", "{{").replaceAll("}", "}}");
    const renderPart = (part: ExprNode): string => {
      if (part.kind === "binary" && (part.sourceForm === "f_concat" || part.sourceForm === "f_string")) {
        return renderPart(part.left!) + renderPart(part.right!);
      }
      if (part.kind === "literal") return literal((part.value as { value: string }).value);
      if (part.kind !== "call" || (part.sourceForm !== "f_field" && part.sourceForm !== "f_string")) throw new Error("Invalid f-string source annotation");
      const call = part.value as { args: ExprNode[] };
      const expression = renderFormulaExpression(call.args[0], rowIdToIndex, colIdToIndex, context);
      if (expression === null) throw new Error("Cannot render f-string expression");
      const spec = call.args[1] ? ":" + JSON.stringify((call.args[1].value as { value: string }).value).slice(1, -1) : "";
      return "{" + expression + spec + "}";
    };
    return 'f"' + renderPart(node) + '"';
  }
  if (node.kind === "literal") {
    const value = node.value as RuntimeValue;
    if (value.kind === "string") return serializeString(String(value.value ?? ""));
    if (value.kind === "number") return encodeNumberLiteral(value.value);
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
    if (ref.sheetSelector) {
      return renderCrossSheetReference(ref, context);
    }
    if (ref.style === "spreadsheet") {
      const spreadsheet = renderSpreadsheetAddress(ref, rowIdToIndex, colIdToIndex);
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
    const left = renderFormulaExpression(node.left ?? null, rowIdToIndex, colIdToIndex, context, prec + (op === "**" ? 1 : 0)) ?? "error[generic]";
    const right = renderFormulaExpression(node.right ?? null, rowIdToIndex, colIdToIndex, context, prec + (op === "**" ? 0 : 1)) ?? "error[generic]";
    const text = `${left} ${op} ${right}`;
    return parentPrec > prec ? `(${text})` : text;
  }
  return null;
}

function renderCrossSheetReference(ref: ReferenceExpr, context: FormulaRenderContext): string {
  const boundSheetId = boundSheetIdOf(ref);
  const targetContext = boundSheetId === null ? undefined : context.sheetsById?.get(boundSheetId);
  const sheetName = targetContext?.sheetName ?? ref.sheetSelector?.value ?? "";
  if (ref.style === "spreadsheet") {
    const address = renderSpreadsheetAddress(ref, targetContext?.rowIdToIndex ?? new Map(), targetContext?.colIdToIndex ?? new Map());
    if (address) return `@[${formatFormulaSheetSelector(sheetName)}::${address}]`;
  }
  const rowSel = renderSelector(
    ref.rowSelector,
    targetContext?.rowIdToIndex ?? new Map<number, number>(),
    targetContext?.rowLabelPathsByIndex,
  );
  const colSel = renderSelector(
    ref.colSelector,
    targetContext?.colIdToIndex ?? new Map<number, number>(),
    targetContext?.colLabelsByIndex.map((label) => [label]),
  );
  return `@[${formatFormulaSheetSelector(sheetName)}::[${rowSel},${colSel}]]`;
}

function boundSheetIdOf(ref: ReferenceExpr): number | null {
  return getBoundSheetId(ref.sheetSelector);
}

function precedence(op: string): number {
  if (op === "primary") return 7;
  if (op === "postfix") return 6;
  if (op === "**") return 5;
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
    if (isStructurallyBoundSelector(startSel) && isStructurallyBoundSelector(endSel)) {
      const startIndex = selectorIndex(startSel, idToIndex);
      const endIndex = selectorIndex(endSel, idToIndex);
      if (startIndex !== null && endIndex !== null && startIndex > endIndex) {
        const startText = renderScalarSelector(endSel, idToIndex, labelsByIndex);
        const endText = renderScalarSelector(startSel, idToIndex, labelsByIndex);
        return `${startText}:${endText}`;
      }
    }
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
    return `#${idx + 1}${selector.copyFixed ? "$" : ""}`;
  }
  if (selector.kind === "absolute_id") {
    const idx = idToIndex.get(Number(selector.value));
    if (idx === undefined) return renderSelectorSourceFallback(selector, idToIndex, labelsByIndex) ?? "#?";
    return `#${idx + 1}${selector.copyFixed ? "$" : ""}`;
  }
  if (selector.kind === "label_id") {
    const idx = idToIndex.get(Number(selector.value));
    if (idx === undefined) return renderSelectorSourceFallback(selector, idToIndex, labelsByIndex) ?? "#?";
    const label = labelsByIndex?.[idx];
    if (label && label.length > 0) {
      const key = JSON.stringify(label);
      const matchCount = labelsByIndex?.filter((candidate) => JSON.stringify(candidate) === key).length ?? 0;
      if (matchCount === 1) {
        return label.map((p) => formatFormulaReferencePathComponent(p)).join(".");
      }
    }
    return `#${idx + 1}`;
  }
  if (selector.kind === "label") {
    const parts = selector.value as string[];
    return parts.map((p) => formatFormulaReferencePathComponent(p)).join(".");
  }
  return "?";
}

function renderSelectorSourceFallback(selector: RefSelector, idToIndex: Map<number, number>, labelsByIndex?: string[][]): string | null {
  const source = selectorSource(selector);
  return source ? renderSelector(source, idToIndex, labelsByIndex) : null;
}

function isStructurallyBoundSelector(selector: RefSelector | null): selector is RefSelector {
  return selector?.kind === "absolute_id" || selector?.kind === "label_id";
}

function selectorIndex(selector: RefSelector, idToIndex: Map<number, number>): number | null {
  if (!isStructurallyBoundSelector(selector)) return null;
  return idToIndex.get(Number(selector.value)) ?? null;
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
