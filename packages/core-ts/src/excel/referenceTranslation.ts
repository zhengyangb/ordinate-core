import type { DocumentState, SheetState } from "../incremental";
import { selectViewDetailed } from "../runtime/eval";
import { getBoundSheetId } from "../runtime/references";
import { renderFormulaExpression } from "../runtime/renderFormula";
import { columnAddress } from "../runtime/spreadsheetAddress";
import { evaluateIndexing, type RuntimeIndexAxis } from "../runtime/indexing";
import { dimensionForShape, isRuntimeView, makeRuntimeView } from "../runtime/view";
import type { ReferenceExpr, RefSelector } from "../runtime/types";
import { ExcelFailure, type ExcelLocation } from "./contracts";

export interface FormulaLocation extends ExcelLocation {
  sheetName: string;
  rowIndex: number;
  colIndex: number;
}
export interface ExcelSelection {
  sourceSheet: SheetState;
  text: string;
  cells: string[][];
  rowIndices: number[];
  colIndices: number[];
  address: (row: number, col: number, end: boolean) => string;
  rows: number;
  columns: number;
  /** A range stays a view even when it currently selects a single cell. */
  view: boolean;
  /** Rectangular areas for aggregate arguments; never widen a sparse selection. */
  areas?: string[];
}

export function excelQuotedText(text: string): string { return `"${text.replace(/"/g, '""')}"`; }
/** Construct an already validated rectangular, nonempty CHOOSE array. */
export function excelChooseArray(rows: readonly (readonly string[])[]): string {
  const indices = rows.map((row, r) => row.map((_, c) => r * row.length + c + 1).join(",")).join(";");
  return `CHOOSE({${indices}},${rows.flat().join(",")})`;
}
const sheetPrefix = (name: string) => `'${name.replace(/'/g, "''")}'!`;
const continuous = (values: number[]) => values.every((value, i) => i === 0 || value === values[i - 1] + 1);

/** Reuse the native selector resolver, including hierarchy-aware all-axis selection. */
export function exportReference(ref: ReferenceExpr, document: DocumentState, source: SheetState, at: FormulaLocation, qualify = false): ExcelSelection {
  const bound = getBoundSheetId(ref.sheetSelector);
  const matches = ref.sheetSelector
    ? document.sheets.filter(sheet => bound === null ? sheet.name === ref.sheetSelector!.value : sheet.sheetId === bound)
    : [source];
  if (matches.length !== 1) throw new ExcelFailure("invalid_reference", "Reference does not resolve to exactly one sheet.", at);
  const target = matches[0];
  const resolved = selectViewDetailed(ref, at.rowIndex, at.colIndex, target.rowMap, target.colMap,
    target.rowCount, target.colCount, target.bodyStart, target.bodyRowCount,
    target.dataRowIndices, target.dataColIndices, target.rowIdToIndex, target.colIdToIndex);
  if (!resolved.ok) throw new ExcelFailure("invalid_reference", `Cannot resolve formula reference: ${resolved.internalKind}.`, at);
  const { rowIndices: rows, colIndices: cols } = resolved.view;
  if (rows.length === 0 || cols.length === 0) throw new ExcelFailure("unsupported_formula", "Excel has no empty reference range.", at);
  const prefix = ref.sheetSelector || qualify ? sheetPrefix(target.name) : "";
  const endpoints = (selector: RefSelector, ids: ReadonlyMap<number, number>): [RefSelector, RefSelector] => {
    if (selector.kind !== "range") return [selector, selector];
    const [a, b] = (selector.value as [RefSelector | null, RefSelector | null]).map((item): RefSelector => item ?? { kind: "absolute", copyFixed: true });
    if (a.kind === "absolute_id" && b.kind === "absolute_id" && ids.get(Number(a.value))! > ids.get(Number(b.value))!) return [b, a];
    return [a, b];
  };
  const [rowStart, rowEnd] = endpoints(ref.rowSelector, target.rowIdToIndex);
  const [colStart, colEnd] = endpoints(ref.colSelector, target.colIdToIndex);
  const copyFixed = (selector: RefSelector) => selector.copyFixed || ["all", "label", "label_id", "absolute_fixed"].includes(selector.kind);
  const address = (r: number, c: number, rs: RefSelector, cs: RefSelector): string => {
    return `${prefix}${copyFixed(cs) ? "$" : ""}${columnAddress(c)}${copyFixed(rs) ? "$" : ""}${r + 1}`;
  };
  const cells = rows.map((r, ri) => cols.map((c, ci) => address(r, c, ri === rows.length - 1 ? rowEnd : rowStart, ci === cols.length - 1 ? colEnd : colStart)));
  const view = ref.rowSelector.kind === "range" || ref.rowSelector.kind === "all" || ref.colSelector.kind === "range" || ref.colSelector.kind === "all";
  return renderSelection(target, rows, cols, cells, view, at,
    (r, c, end) => address(r, c, end ? rowEnd : rowStart, end ? colEnd : colStart));
}

/** Render resolved membership, shared by references and their static slices. */
function renderSelection(sourceSheet: SheetState, rows: number[], cols: number[], cells: string[][], view: boolean, at: FormulaLocation,
  address: ExcelSelection["address"]): ExcelSelection {
  const range = (first: string, last: string) => first + ":" + last.slice(last.lastIndexOf("!") + 1);
  let text: string;
  if (rows.length === 1 && cols.length === 1 && !view) text = cells[0][0];
  else if (continuous(rows) && continuous(cols)) {
    text = range(address(rows[0], cols[0], false), address(rows[rows.length - 1], cols[cols.length - 1], true));
  } else {
    const flattened = cells.flat();
    if (flattened.length > 254) throw new ExcelFailure("unsupported_formula", "Non-contiguous selection exceeds Excel CHOOSE's argument limit.", at);
    text = excelChooseArray(cells);
  }
  const selection = { sourceSheet, text, cells, rowIndices: rows, colIndices: cols, address, rows: rows.length, columns: cols.length, view };
  if (continuous(rows) && continuous(cols)) return selection;
  const runs = (indices: number[]): number[][] => indices.reduce<number[][]>((groups, index) => {
    const last = groups[groups.length - 1];
    if (last && index === last[last.length - 1] + 1) last.push(index);
    else groups.push([index]);
    return groups;
  }, []);
  const areas = runs(rows).flatMap(rs => runs(cols).map(cs => {
    const first = address(rs[0], cs[0], false);
    const last = address(rs[rs.length - 1], cs[cs.length - 1], true);
    return first === last ? first : range(first, last);
  }));
  return { ...selection, areas };
}

/** Slice address positions using the native indexing rules, never cell values. */
export function sliceReference(selection: ExcelSelection, axes: RuntimeIndexAxis[], at: FormulaLocation): ExcelSelection {
  const positions = selection.cells.flat().map((_, value) => ({ kind: "number" as const, value }));
  const indexed = evaluateIndexing(makeRuntimeView(dimensionForShape(selection.rows, selection.columns),
    selection.rows, selection.columns, positions), axes, "Excel export");
  if (!isRuntimeView(indexed)) throw new ExcelFailure("unsupported_formula", "Invalid reference slice dimensions or bounds.", at);
  if (!indexed.rowCount || !indexed.colCount) throw new ExcelFailure("unsupported_formula", "Excel has no empty reference range.", at);
  const sourcePositions = indexed.values.map(value => {
    if (value.kind !== "number") throw new Error("Reference slice did not return address positions.");
    return value.value;
  });
  const rows = Array.from({ length: indexed.rowCount }, (_, r) =>
    Math.floor(sourcePositions[r * indexed.colCount] / selection.columns));
  const cols = sourcePositions.slice(0, indexed.colCount).map(value => value % selection.columns);
  return renderSelection(selection.sourceSheet, rows.map(r => selection.rowIndices[r]), cols.map(c => selection.colIndices[c]),
    rows.map(r => cols.map(c => selection.cells[r][c])), true, at, selection.address);
}

/** Keep familiar A1 spelling and the source's row/column copy locks. */
export function importReference(ref: ReferenceExpr, sheetName: string | undefined, names: readonly string[], at: FormulaLocation): string {
  let sheet: string | undefined;
  if (sheetName !== undefined) {
    const matches = names.filter(name => name.toLowerCase() === sheetName.toLowerCase());
    if (matches.length !== 1) throw new ExcelFailure("invalid_reference", "Excel reference does not resolve to exactly one sheet.", at);
    sheet = matches[0];
  }
  const value: ReferenceExpr = { ...ref, style: "spreadsheet", ...(sheet === undefined ? {} : { sheetSelector: { kind: "sheet_name", value: sheet } as const }) };
  const text = renderFormulaExpression({ kind: "reference", value }, new Map(), new Map());
  if (text === null) throw new Error("Reference renderer rejected a validated reference.");
  return text;
}

/** Project a source rectangle by coordinates, never by sampled lookup values.
 * Keep both endpoint copy locks and sheet identity; even one cell stays a view. */
export function importReferenceColumn(ref: ReferenceExpr, offset: number, sheetName: string | undefined,
  names: readonly string[], at: FormulaLocation): string {
  const columns = ref.colSelector.kind === "range" ? ref.colSelector.value as [RefSelector, RefSelector]
    : [ref.colSelector, ref.colSelector];
  if (columns.some(selector => selector.kind !== "absolute"))
    throw new ExcelFailure("unsupported_formula", "Lookup table requires explicit column coordinates.", at);
  const column = Math.min(Number(columns[0].value), Number(columns[1].value)) + offset;
  const rows = ref.rowSelector.kind === "range" ? ref.rowSelector
    : { kind: "range" as const, value: [ref.rowSelector, ref.rowSelector] };
  return importReference({ ...ref, rowSelector: rows,
    colSelector: { kind: "range", value: columns.map(selector => ({ ...selector, value: column })) } }, sheetName, names, at);
}
