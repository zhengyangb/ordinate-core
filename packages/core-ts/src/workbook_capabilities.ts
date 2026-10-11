import { DocumentState, type SheetState } from "./incremental";
import { validateDocument, type ValidationSummary } from "./validator";
import { serializeDocumentState } from "./serializer";
import { cloneDocumentState } from "./document_clone";
import { applyCoreEditToStaged, type CoreEdit, type CoreRegionTarget } from "./core_edit";
import { CoreEditFailure } from "./core_edit_common";
import { deriveHierarchyRows } from "./parser";
import { getCellTextView } from "./runtime/parse";
import { diagnosticFromError } from "./runtime/errors";
import { encodeNumberLiteral } from "./number_encoding";
import { serializeSheetNote } from "./sheet_notes";
import type { RuntimeValue, ParsedDisplayMetadata, StyleSpec } from "./runtime/types";
import {
  CapabilityRequestError, WORKBOOK_LIMITS, decodeCellQuery, decodeEditRequest,
  decodeEvaluationOptions, decodePortableFormat, type CellQuery, type EvaluationOptions,
  type EditRequest, type WorkbookOperation, type RowSelector, type ColumnSelector,
  type RegionTarget, type IndexWindow, type PortableFormatSpec,
} from "./capability_schema";
export type SourceRevision = string;
export type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};
export type CapabilityDiagnostic = {
  phase: "validation" | "evaluation" | "import";
  severity?: "warning" | "error";
  code: string;
  message: string;
  location?: {
    kind: "sheet";
    sheet: string;
  } | {
    kind: "cell";
    sheet: string;
    rowIndex: number;
    colIndex: number;
  } | {
    kind: "note";
    sheet: string;
    position: "beforeTable" | "afterTable";
    line: number;
  };
  details?: Record<string, JsonValue>;
};
export type CapabilityFailure = {
  stage: "request" | "validation" | "resolve" | "edit" | "serialize" | "import";
  code: string;
  message: string;
  operationIndex?: number;
};
export type CapabilityResult<T> = {
  status: "completed";
  sourceRevision: SourceRevision;
  diagnostics: CapabilityDiagnostic[];
  data: T;
} | {
  status: "rejected";
  sourceRevision: SourceRevision | null;
  diagnostics: CapabilityDiagnostic[];
  failure: CapabilityFailure;
};
export type CandidateSource = {
  source: string;
  revision: SourceRevision;
};
export type ValidationReport = {
  valid: boolean;
  summary: ValidationSummary;
};
export type WindowSelection = {
  sheet: string;
  rows: IndexWindow;
  columns: IndexWindow;
  totalRows: number;
  totalColumns: number;
  hasMoreRows: boolean;
  hasMoreColumns: boolean;
};
type Display = null | {
  format: PortableFormatSpec | null;
  style: StyleSpec | null;
};
export type Inspection = {
  sheets: {
    name: string;
    rowCount: number;
    columnCount: number;
    headerRowCount: number;
    headerColumnCount: number;
    maxHierarchyDepth: number;
  }[];
  selection?: WindowSelection & {
    rowDescriptors: {
      rowIndex: number;
      area: "header" | "body";
      depth: number;
      path: string[];
    }[];
    columnDescriptors: {
      colIndex: number;
      label: string;
    }[];
    cells: {
      input: string;
      localDisplay: Display;
    }[][];
    rowDefaults: Display[];
    columnDefaults: Display[];
    notes?: {
      beforeTable: string;
      afterTable: string;
    };
  };
};
export type PortableValue = {
  kind: "blank" | "null";
  value: null;
} | {
  kind: "number";
  value: string;
} | {
  kind: "string";
  value: string;
} | {
  kind: "boolean";
  value: boolean;
} | {
  kind: "date" | "time" | "datetime";
  value: string;
  isOffsetQualified: boolean;
} | {
  kind: "duration";
  value: string;
} | {
  kind: "error";
  errorKind: string;
  diagnostic: {
    code: string;
    context: Record<string, JsonValue>;
  };
};
export type EvaluationReport = {
  summary: {
    sheetCount: number;
    evaluatedCellCount: number;
    errorCount: number;
  };
  selection?: WindowSelection & {
    values: PortableValue[][];
  };
  candidate: CandidateSource | null;
};
export type EditReport = {
  operationCount: number;
  evaluation: "not_run";
  candidate: CandidateSource;
};
const encoder = new TextEncoder();
function sourceBytes(source: string): Uint8Array {
  if (typeof source !== "string" || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source))
    throw new CapabilityRequestError("Source must be a Unicode string without unpaired surrogates.");
  const bytes = encoder.encode(source);
  if (bytes.length > WORKBOOK_LIMITS.sourceBytes)
    throw new CapabilityRequestError("Source exceeds the 16 MiB limit.", "limit_exceeded");
  return bytes;
}
export async function workbookSourceRevision(source: string): Promise<SourceRevision> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", sourceBytes(source) as BufferSource);
  return `sha256:${Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("")}`;
}
const rejected = (revision: SourceRevision | null, stage: CapabilityFailure["stage"], code: string, message: string, diagnostics: CapabilityDiagnostic[] = [], operationIndex?: number): Extract<CapabilityResult<never>, {
  status: "rejected";
}> => ({ status: "rejected", sourceRevision: revision, diagnostics, failure: { stage, code, message, ...(operationIndex === undefined ? {} : { operationIndex }) } });
function json(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value))
    return value;
  if (Array.isArray(value))
    return value.map(json);
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    // Runtime identities are private binding state, not portable locators.
    return Object.fromEntries(Object.entries(value).filter(([k]) => !["id", "sheetId", "rowId", "colId", "boundSheetId"].includes(k)).map(([k, v]) => [k, json(v)]));
  }
  throw new TypeError("Core diagnostic context is not JSON-compatible.");
}
function validation(source: string): {
  report: ValidationReport;
  diagnostics: CapabilityDiagnostic[];
} {
  const result = validateDocument(source);
  return {
    report: { valid: result.ok, summary: result.summary }, diagnostics: result.errors.map(e => ({
      phase: "validation", code: e.code ?? "validation_error", message: e.message,
      ...(e.sheet ? { location: { kind: "sheet" as const, sheet: e.sheet } } : {}),
      details: { ...(e.context ? json(e.context) as Record<string, JsonValue> : {}), ...(e.row === undefined ? {} : { tableRow: e.row }), ...(e.col === undefined ? {} : { tableColumn: e.col }) },
    }))
  };
}
function display(value: ParsedDisplayMetadata | null): Display {
  if (value === null)
    return null;
  if (!value.valid)
    throw new Error("Validated workbook has invalid display metadata.");
  return { format: value.format?.kind === "temporal" ? { kind: "temporal", pattern: value.format.pattern } : value.format ? { ...value.format } : null, style: value.style ? { ...value.style } : null };
}
function sheetByName(doc: DocumentState, name: string): SheetState {
  const matches = doc.sheets.filter(s => s.name === name);
  if (matches.length !== 1)
    throw new CoreEditFailure(matches.length ? "ambiguous_target" : "invalid_target", `Expected one sheet named '${name}'.`);
  return matches[0];
}
function indexWindow(window: IndexWindow | undefined, count: number, defaultCount: number): IndexWindow {
  if (!window)
    return { start: 0, end: Math.min(count, defaultCount) };
  if (window.start >= window.end || window.end > count)
    throw new CoreEditFailure("out_of_bounds", `Window [${window.start}, ${window.end}) must be nonempty and within axis length ${count}.`);
  return window;
}
function selection(doc: DocumentState, query: CellQuery): {
  sheet: SheetState;
  view: WindowSelection;
} {
  const sheet = sheetByName(doc, query.sheet);
  const rows = indexWindow(query.rows, sheet.rowCount, 50), columns = indexWindow(query.columns, sheet.colCount, 20);
  if ((rows.end - rows.start) * (columns.end - columns.start) > WORKBOOK_LIMITS.selectedCells)
    throw new CapabilityRequestError("Selection exceeds 10,000 cells.", "limit_exceeded");
  return { sheet, view: { sheet: sheet.name, rows, columns, totalRows: sheet.rowCount, totalColumns: sheet.colCount, hasMoreRows: rows.end < sheet.rowCount, hasMoreColumns: columns.end < sheet.colCount } };
}
function indices(window: IndexWindow): number[] { return Array.from({ length: window.end - window.start }, (_, i) => window.start + i); }
async function run<T>(source: string, decode: () => () => Promise<CapabilityResult<T>>): Promise<CapabilityResult<T>> {
  try {
    sourceBytes(source);
    const execute = decode();
    return await execute();
  }
  catch (error) {
    if (error instanceof CapabilityRequestError) {
      let revision: string | null = null;
      try {
        revision = await workbookSourceRevision(source);
      }
      catch (e) {
        if (!(e instanceof CapabilityRequestError))
          throw e;
      }
      return rejected(revision, "request", error.code, error.message);
    }
    throw error;
  }
}
export async function validateWorkbook(source: string): Promise<CapabilityResult<ValidationReport>> {
  return run(source, () => async () => {
    const revision = await workbookSourceRevision(source), { report, diagnostics } = validation(source);
    return { status: "completed", sourceRevision: revision, diagnostics, data: report };
  });
}
function validatedDocument(source: string, revision: string): DocumentState | Extract<CapabilityResult<never>, {
  status: "rejected";
}> {
  const result = validation(source);
  return result.report.valid ? DocumentState.fromText(source) : rejected(revision, "validation", "invalid_source", "Workbook failed validation.", result.diagnostics);
}
export async function inspectWorkbook(source: string, query?: CellQuery): Promise<CapabilityResult<Inspection>> {
  return run(source, () => {
    const decoded = query === undefined ? undefined : decodeCellQuery(query);
    return async () => {
      const revision = await workbookSourceRevision(source), doc = validatedDocument(source, revision);
      if (!(doc instanceof DocumentState))
        return doc;
      const data: Inspection = { sheets: doc.sheets.map(s => ({ name: s.name, rowCount: s.rowCount, columnCount: s.colCount, headerRowCount: s.headerRowCount, headerColumnCount: s.headerColCount, maxHierarchyDepth: deriveHierarchyRows(s.logicalRows, s.bodyStart).reduce((max, r) => Math.max(max, r.depth), 0) })) };
      try {
        if (decoded) {
          const { sheet, view } = selection(doc, decoded), rows = indices(view.rows), cols = indices(view.columns);
          const hierarchy = new Map(deriveHierarchyRows(sheet.logicalRows, sheet.bodyStart).map(r => [r.rowIndex, r]));
          data.selection = {
            ...view,
            rowDescriptors: rows.map(rowIndex => ({ rowIndex, area: rowIndex < sheet.bodyStart ? "header" : "body", depth: hierarchy.get(rowIndex)?.depth ?? 0, path: hierarchy.get(rowIndex)?.path ?? [] })),
            columnDescriptors: cols.map(colIndex => ({ colIndex, label: sheet.colLabels[colIndex] })),
            cells: rows.map(r => cols.map(c => ({ input: getCellTextView(sheet.cells[r][c]).inputText, localDisplay: display(sheet.cells[r][c].localDisplay) }))),
            rowDefaults: rows.map(r => display(sheet.rowDisplayMetadata[r])), columnDefaults: cols.map(c => display(sheet.columnDisplayMetadata[c])),
            ...(decoded.includeNotes ? { notes: { beforeTable: serializeSheetNote(sheet.getSheetNote("beforeTable")), afterTable: serializeSheetNote(sheet.getSheetNote("afterTable")) } } : {}),
          };
        }
      }
      catch (e) {
        if (e instanceof CoreEditFailure)
          return rejected(revision, "resolve", e.category, e.message);
        throw e;
      }
      return { status: "completed", sourceRevision: revision, diagnostics: [], data };
    };
  });
}
function portableValue(value: RuntimeValue): PortableValue {
  if (value.kind === "number")
    return { kind: "number", value: encodeNumberLiteral(value.value) };
  if (value.kind === "error") {
    const issue = diagnosticFromError(value);
    return { kind: "error", errorKind: value.errorKind, diagnostic: { code: issue.code, context: json(issue.context) as Record<string, JsonValue> } };
  }
  return { ...value };
}
async function candidate(doc: DocumentState): Promise<CandidateSource> {
  const source = serializeDocumentState(doc);
  return { source, revision: await workbookSourceRevision(source) };
}
export async function evaluateWorkbook(source: string, options?: EvaluationOptions): Promise<CapabilityResult<EvaluationReport>> {
  return run(source, () => {
    const decoded = decodeEvaluationOptions(options ?? {});
    return async () => {
      const revision = await workbookSourceRevision(source), doc = validatedDocument(source, revision);
      if (!(doc instanceof DocumentState))
        return doc;
      let selected: ReturnType<typeof selection> | undefined;
      try {
        if (decoded.query)
          selected = selection(doc, decoded.query);
      }
      catch (e) {
        if (e instanceof CoreEditFailure)
          return rejected(revision, "resolve", e.category, e.message);
        throw e;
      }
      const evaluated = doc.evaluate(), diagnostics: CapabilityDiagnostic[] = [];
      let evaluatedCellCount = 0;
      evaluated.sheets.forEach((s, si) => s.values.forEach((row, r) => row.forEach((value, c) => {
        evaluatedCellCount++;
        if (value.kind === "error") {
          const issue = diagnosticFromError(value);
          diagnostics.push({ phase: "evaluation", code: issue.code, message: `${s.name} [${r + doc.sheets[si].bodyStart}, ${c}]: ${value.errorKind} (${issue.code})`, location: { kind: "cell", sheet: s.name, rowIndex: r + doc.sheets[si].bodyStart, colIndex: c }, details: json(issue.context) as Record<string, JsonValue> });
        }
      })));
      const data: EvaluationReport = { summary: { sheetCount: doc.sheets.length, evaluatedCellCount, errorCount: diagnostics.length }, candidate: null };
      if (selected) {
        const { sheet, view } = selected;
        data.selection = {
          ...view, values: indices(view.rows).map(r => indices(view.columns).map(c => {
            const cell = sheet.cells[r][c];
            if (r < sheet.bodyStart) {
              if (!cell.body.valid || cell.body.kind !== "literal")
                throw new Error("Header is not a validated literal.");
              return portableValue(cell.body.literal);
            }
            if (!cell.cachedValue)
              throw new Error("Full evaluation did not produce a value.");
            return portableValue(cell.cachedValue);
          }))
        };
      }
      if (decoded.materialize && !diagnostics.length)
        data.candidate = await candidate(doc);
      return { status: "completed", sourceRevision: revision, diagnostics, data };
    };
  });
}
function axisIndex(sheet: SheetState, selector: RowSelector | ColumnSelector, axis: "row" | "column"): number {
  const count = axis === "row" ? sheet.rowCount : sheet.colCount;
  if (selector.kind === "index") {
    if (selector.index >= count)
      throw new CoreEditFailure("out_of_bounds", `${axis} index ${selector.index} exceeds axis length ${count}.`);
    return selector.index;
  }
  const matches = selector.kind === "path" ? sheet.rowMap.get(JSON.stringify(selector.path)) : sheet.colMap.get(selector.label);
  if (!matches?.length)
    throw new CoreEditFailure("invalid_target", `Unresolved ${axis} selector ${JSON.stringify(selector)}.`);
  if (matches.length !== 1)
    throw new CoreEditFailure("ambiguous_target", `Ambiguous ${axis} selector ${JSON.stringify(selector)}.`);
  return matches[0];
}
function coreRegion(doc: DocumentState, target: RegionTarget): {
  handle: CoreRegionTarget;
  cells: number;
} {
  const s = sheetByName(doc, target.sheet), rows = indexWindow(target.rows, s.rowCount, 0), cols = indexWindow(target.columns, s.colCount, 0);
  return { handle: { sheet: s.name, start: { rowId: s.rowIds[rows.start], colId: s.colIds[cols.start] }, end: { rowId: s.rowIds[rows.end - 1], colId: s.colIds[cols.end - 1] } }, cells: (rows.end - rows.start) * (cols.end - cols.start) };
}
function convertOperation(doc: DocumentState, op: WorkbookOperation): {
  edit: CoreEdit;
  cells: number;
} {
  if (op.op === "set_region" || op.op === "clear_region" || op.op === "fill_region") {
    const target = coreRegion(doc, op.target);
    if (op.op === "fill_region") {
      const source = coreRegion(doc, op.source);
      if (source.cells > WORKBOOK_LIMITS.selectedCells)
        throw new CapabilityRequestError("Fill source exceeds 10,000 cells.", "limit_exceeded");
      return { edit: { ...op, source: source.handle, target: target.handle }, cells: target.cells };
    }
    return { edit: { ...op, target: target.handle }, cells: target.cells };
  }
  if ("target" in op) {
    const s = sheetByName(doc, op.target.sheet), rowIndex = axisIndex(s, op.target.row, "row"), colIndex = axisIndex(s, op.target.column, "column");
    const converted = { ...op, target: { kind: "index" as const, sheet: s.name, rowIndex, colIndex }, ...("format" in op ? { format: decodePortableFormat(op.format) } : {}) };
    return { edit: converted as CoreEdit, cells: 1 };
  }
  if ("row" in op) {
    const s = sheetByName(doc, op.sheet), r = axisIndex(s, op.row, "row");
    if (op.op !== "delete_row" && r < s.bodyStart)
      throw new CoreEditFailure("invalid_operation", "Row display defaults require a body row.");
    const { row, ...rest } = op;
    return { edit: { ...rest, rowId: s.rowIds[r], ...("format" in op ? { format: decodePortableFormat(op.format) } : {}) } as CoreEdit, cells: 0 };
  }
  if ("column" in op) {
    const s = sheetByName(doc, op.sheet), c = axisIndex(s, op.column, "column"), { column, ...rest } = op;
    return { edit: op.op === "delete_column" ? { op: "delete_column", sheet: s.name, colIndex: c } : { ...rest, colId: s.colIds[c], ...("format" in op ? { format: decodePortableFormat(op.format) } : {}) } as CoreEdit, cells: 0 };
  }
  if (op.op === "move_rows" || op.op === "duplicate_rows") {
    const s = sheetByName(doc, op.sheet), ids = op.rows.map(row => s.rowIds[axisIndex(s, row, "row")]);
    if (new Set(ids).size !== ids.length)
      throw new CoreEditFailure("invalid_target", "Row selectors must identify distinct rows.");
    return { edit: { op: op.op, sheet: s.name, rowIds: ids, targetGapIndex: op.targetGapIndex }, cells: op.op === "duplicate_rows" ? ids.length * s.colCount : 0 };
  }
  if (op.op === "move_columns" || op.op === "duplicate_columns") {
    const s = sheetByName(doc, op.sheet), ids = op.columns.map(col => s.colIds[axisIndex(s, col, "column")]);
    if (new Set(ids).size !== ids.length)
      throw new CoreEditFailure("invalid_target", "Column selectors must identify distinct columns.");
    return { edit: { op: op.op, sheet: s.name, colIds: ids, targetGapIndex: op.targetGapIndex }, cells: op.op === "duplicate_columns" ? ids.length * s.rowCount : 0 };
  }
  return { edit: op, cells: 0 };
}
export async function editWorkbook(source: string, request: EditRequest): Promise<CapabilityResult<EditReport>> {
  return run(source, () => {
    const decoded = decodeEditRequest(request);
    return async () => {
      const revision = await workbookSourceRevision(source);
      if (decoded.baseRevision !== revision)
        return rejected(revision, "request", "stale_source", "Source revision differs from baseRevision.");
      const doc = validatedDocument(source, revision);
      if (!(doc instanceof DocumentState))
        return doc;
      const staged = cloneDocumentState(doc);
      let editedCells = 0;
      for (let i = 0; i < decoded.operations.length; i++) {
        try {
          const { edit, cells } = convertOperation(staged, decoded.operations[i]);
          editedCells += cells;
          if (editedCells > WORKBOOK_LIMITS.editedCells)
            return rejected(revision, "edit", "limit_exceeded", "Batch exceeds 10,000 directly edited/copied cells.", [], i);
          applyCoreEditToStaged(staged, edit);
        }
        catch (e) {
          if (e instanceof CoreEditFailure)
            return rejected(revision, "edit", e.category, e.message, [], i);
          if (e instanceof CapabilityRequestError)
            return rejected(revision, "edit", e.code, e.message, [], i);
          throw e;
        }
      }
      const result = await candidate(staged), checked = validation(result.source);
      if (!checked.report.valid)
        return rejected(revision, "validation", "invalid_source", "Edited workbook failed validation.", checked.diagnostics);
      return { status: "completed", sourceRevision: revision, diagnostics: [], data: { operationCount: decoded.operations.length, evaluation: "not_run", candidate: result } };
    };
  });
}
