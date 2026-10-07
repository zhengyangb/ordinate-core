import type { RefSelector, ReferenceExpr } from "./types";

// Shared coordinate grammar for native A1 syntax and the Excel boundary.
export const SPREADSHEET_REFERENCE_PATTERNS = [
  /\$?[A-Za-z]+\$?[1-9]\d*:\$?[A-Za-z]+\$?[1-9]\d*/y,
  /\$?[A-Za-z]+:\$?[A-Za-z]+/y,
  /\$?[1-9]\d*:\$?[1-9]\d*/y,
  /\$?[A-Za-z]+\$?[1-9]\d*/y,
];

export function columnAddress(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Invalid column index.");
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + (n - 1) % 26) + result;
  }
  return result;
}

function axis(text: string, kind: "row" | "col"): RefSelector | null {
  const fixed = text.startsWith("$");
  const raw = fixed ? text.slice(1) : text;
  let index: number;
  if (kind === "row") {
    if (!/^[1-9]\d*$/.test(raw)) return null;
    index = Number(raw) - 1;
  } else {
    if (!/^[A-Za-z]+$/.test(raw)) return null;
    index = 0;
    for (const char of raw.toUpperCase()) index = index * 26 + char.charCodeAt(0) - 64;
    index -= 1;
  }
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return { kind: "absolute", value: index, ...(fixed ? { copyFixed: true as const } : {}) };
}

function cell(text: string): { row: RefSelector; col: RefSelector } | null {
  const match = /^(\$?[A-Za-z]+)(\$?[1-9]\d*)$/.exec(text);
  if (!match) return null;
  const row = axis(match[2], "row");
  const col = axis(match[1], "col");
  return row && col ? { row, col } : null;
}

export function parseSpreadsheetAddress(text: string): ReferenceExpr | null {
  const parts = text.trim().split(":").map(part => part.trim());
  const first = cell(parts[0]);
  if (parts.length === 1) {
    return first ? { rowSelector: first.row, colSelector: first.col, style: "spreadsheet" } : null;
  }
  if (parts.length !== 2) return null;
  const last = cell(parts[1]);
  if (first && last) {
    return {
      rowSelector: { kind: "range", value: [first.row, last.row] },
      colSelector: { kind: "range", value: [first.col, last.col] }, style: "spreadsheet",
    };
  }
  for (const kind of ["row", "col"] as const) {
    const start = axis(parts[0], kind);
    const end = axis(parts[1], kind);
    if (start && end) {
      const range: RefSelector = { kind: "range", value: [start, end] };
      return {
        rowSelector: kind === "row" ? range : { kind: "all" },
        colSelector: kind === "col" ? range : { kind: "all" }, style: "spreadsheet",
      };
    }
  }
  return null;
}

type Endpoint = { index: number; copyFixed: boolean };
type AddressAxis = { kind: "all" } | { kind: "span"; start: Endpoint; end: Endpoint };

function resolveAxis(selector: RefSelector, ids: ReadonlyMap<number, number>): AddressAxis | null {
  if (selector.kind === "all") return { kind: "all" };
  if (selector.kind === "range") {
    const [start, end] = selector.value as [RefSelector | null, RefSelector | null];
    const left = start && resolveAxis(start, ids);
    const right = end && resolveAxis(end, ids);
    if (!left || !right || left.kind !== "span" || right.kind !== "span") return null;
    // Reordering tracks endpoint IDs; anchors belong to the endpoint they came from.
    return left.start.index <= right.end.index
      ? { kind: "span", start: left.start, end: right.end }
      : start?.kind === "absolute_id" && end?.kind === "absolute_id"
        ? { kind: "span", start: right.end, end: left.start }
        : { kind: "span", start: left.start, end: right.end };
  }
  const index = selector.kind === "absolute" ? Number(selector.value)
    : selector.kind === "absolute_id" ? ids.get(Number(selector.value)) : undefined;
  if (index === undefined) return null;
  const endpoint = { index, copyFixed: selector.copyFixed === true };
  return { kind: "span", start: endpoint, end: endpoint };
}

export function renderSpreadsheetAddress(ref: ReferenceExpr, rows: ReadonlyMap<number, number>, cols: ReadonlyMap<number, number>): string | null {
  const row = resolveAxis(ref.rowSelector, rows);
  const col = resolveAxis(ref.colSelector, cols);
  if (!row || !col || (row.kind === "all" && col.kind === "all")) return null;
  const axisText = (endpoint: Endpoint, kind: "row" | "col") =>
    `${endpoint.copyFixed ? "$" : ""}${kind === "row" ? endpoint.index + 1 : columnAddress(endpoint.index)}`;
  if (row.kind === "all" && col.kind === "span") return `${axisText(col.start, "col")}:${axisText(col.end, "col")}`;
  if (col.kind === "all" && row.kind === "span") return `${axisText(row.start, "row")}:${axisText(row.end, "row")}`;
  if (row.kind !== "span" || col.kind !== "span") return null;
  const start = `${axisText(col.start, "col")}${axisText(row.start, "row")}`;
  const end = `${axisText(col.end, "col")}${axisText(row.end, "row")}`;
  return start === end ? start : `${start}:${end}`;
}
