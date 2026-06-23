import { parseDocument, parseHierarchyLabel, parseTableRow, stripDisplayControlFrame, type ParsedRow } from "./parser";
import { getCellTextView, parseCellInput, stripCellDisplayMetadata } from "./runtime/parse";
import { describeDisplayMetadataDiagnostic, validateFormatSpec } from "./runtime/displayMetadata";
import { parseTemporalFormatSpec } from "./runtime/temporalFormat";
import { renderFormulaExpression } from "./runtime/renderFormula";
import {
  buildBodyRows,
  buildColumnLabelMap,
  buildColumnLabelPaths,
  buildColumnLabels,
  buildRowKeys,
  computeDataRowIndices,
  evalExpr,
  headerColCountFrom,
  headerRowCountFrom,
  selectView,
  separatorRowIndex,
} from "./runtime/eval";
import {
  type CellBodyState,
  type CellDisplayState,
  type EvaluationResult,
  type ExprNode,
  type ParsedCell,
  type ParsedDisplayMetadata,
  type FormatSpec,
  type StyleSpec,
  type StylePatch,
  type ReferenceExpr,
  type RuntimeValue,
  type SheetEvaluation,
  type ViewSelection,
} from "./runtime/types";
import { makeInternalError, runtimeErrorFromDiagnostic } from "./runtime/errors";

export enum ChangeKind {
  VALUE = "value",
  CLEAR = "clear",
  LABEL = "label",
  STRUCTURAL = "structural",
  SHEET = "sheet",
}

interface CellState {
  body: CellBodyState;
  localDisplay: CellDisplayState;
  cachedValue: RuntimeValue | null;
  dirty: boolean;
}

export type PreservedSheetBlock =
  | { kind: "table"; lines: string[] }
  | { kind: "unparsed"; lines: string[] };

export class SheetState {
  name: string;
  rowCount: number;
  colCount: number;
  headerRowCount: number;
  headerColCount: number;
  bodyStart: number;
  bodyRowCount: number;
  rowPaths: string[];
  colLabels: string[];
  rowMap: Map<string, number[]>;
  colMap: Map<string, number[]>;
  rowIds: number[];
  colIds: number[];
  rowIdToIndex: Map<number, number>;
  colIdToIndex: Map<number, number>;
  nextRowId: number;
  nextColId: number;
  dataRowIndices: number[];
  dataColIndices: number[];
  logicalRows: ParsedRow[];
  cells: CellState[][];
  rowDisplayMetadata: Array<ParsedDisplayMetadata | null>;
  columnDisplayMetadata: Array<ParsedDisplayMetadata | null>;
  viewDependencies: Map<number, ViewSelection>;
  viewFormulas: Map<number, [number, number]>;
  viewRowIndex: Map<number, Set<number>>;
  viewColIndex: Map<number, Set<number>>;
  formulaViewIds: Map<string, Set<number>>;
  nextViewId: number;
  sourceBlocks: PreservedSheetBlock[];
  primaryTableBlockIndex: number | null;

  private constructor(
    name: string,
    rowCount: number,
    colCount: number,
    headerRowCount: number,
    headerColCount: number,
    bodyStart: number,
    bodyRowCount: number,
    rowPaths: string[],
    colLabels: string[],
    rowMap: Map<string, number[]>,
    colMap: Map<string, number[]>,
    rowIds: number[],
    colIds: number[],
    dataRowIndices: number[],
    dataColIndices: number[],
    logicalRows: ParsedRow[],
    cells: CellState[][],
    rowDisplayMetadata: Array<ParsedDisplayMetadata | null>,
    columnDisplayMetadata: Array<ParsedDisplayMetadata | null>,
    sourceBlocks: PreservedSheetBlock[],
    primaryTableBlockIndex: number | null,
  ) {
    this.name = name;
    this.rowCount = rowCount;
    this.colCount = colCount;
    this.headerRowCount = headerRowCount;
    this.headerColCount = headerColCount;
    this.bodyStart = bodyStart;
    this.bodyRowCount = bodyRowCount;
    this.rowPaths = rowPaths;
    this.colLabels = colLabels;
    this.rowMap = rowMap;
    this.colMap = colMap;
    this.rowIds = rowIds;
    this.colIds = colIds;
    this.rowIdToIndex = buildIdIndexMap(rowIds);
    this.colIdToIndex = buildIdIndexMap(colIds);
    this.nextRowId = rowIds.reduce((m, v) => Math.max(m, v), 0) + 1;
    this.nextColId = colIds.reduce((m, v) => Math.max(m, v), 0) + 1;
    this.dataRowIndices = dataRowIndices;
    this.dataColIndices = dataColIndices;
    this.logicalRows = logicalRows;
    this.cells = cells;
    this.rowDisplayMetadata = rowDisplayMetadata;
    this.columnDisplayMetadata = columnDisplayMetadata;
    this.viewDependencies = new Map();
    this.viewFormulas = new Map();
    this.viewRowIndex = new Map();
    this.viewColIndex = new Map();
    this.formulaViewIds = new Map();
    this.nextViewId = 1;
    this.sourceBlocks = sourceBlocks;
    this.primaryTableBlockIndex = primaryTableBlockIndex;
  }

  // Build a SheetState from raw table rows.
  static fromTableRows(
    name: string,
    rows: string[],
    sourceBlocks?: PreservedSheetBlock[],
    primaryTableBlockIndex?: number | null,
  ): SheetState {
    const normalizedBlocks: PreservedSheetBlock[] =
      sourceBlocks && sourceBlocks.length > 0 ? sourceBlocks : [{ kind: "table", lines: [...rows] }];
    const normalizedPrimary =
      primaryTableBlockIndex !== undefined
        ? primaryTableBlockIndex
        : normalizedBlocks.findIndex((b) => b.kind === "table");
    const primaryIndex = normalizedPrimary === -1 ? null : normalizedPrimary;

    const parsedRows = rows.map((r) => parseTableRow(r));
    const controlFrame = stripDisplayControlFrame(parsedRows);
    const semanticRows = controlFrame.rows;
    const sepIndex = separatorRowIndex(semanticRows);
    const logicalRows = semanticRows.filter((_, idx) => idx !== sepIndex);

    if (logicalRows.length === 0) {
      return new SheetState(
        name,
        0,
        0,
        0,
        0,
        0,
        0,
        [],
        [],
        new Map(),
        new Map(),
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        normalizedBlocks,
        primaryIndex,
      );
    }

    const colCount = logicalRows.reduce((m, r) => Math.max(m, r.cells.length), 0);
    const headerRowCount = headerRowCountFrom(semanticRows);
    const headerColCount = headerColCountFrom(logicalRows);
    const bodyStart = headerRowCount > 0 ? headerRowCount : 0;
    const columnDisplayMetadata = extractColumnDisplayMetadataFromControlRow(controlFrame.controlRow, colCount);
    const rowDisplayMetadata = extractRowDisplayMetadataFromLabelColumn(logicalRows, bodyStart, headerColCount);

    const colLabelPaths = buildColumnLabelPaths(logicalRows, headerRowCount, colCount);
    const colLabels = buildColumnLabels(colLabelPaths);

    const { rowPaths } = buildBodyRows(logicalRows, bodyStart);
    const rowKeys = buildRowKeys(logicalRows, bodyStart);
    const rowMap = new Map<string, number[]>();
    rowKeys.forEach((key, offset) => {
      const absIdx = bodyStart + offset;
      const k = JSON.stringify(key);
      const list = rowMap.get(k) ?? [];
      list.push(absIdx);
      rowMap.set(k, list);
    });

    const colMap = buildColumnLabelMap(colLabelPaths, colLabels);

    const bodyRowCount = logicalRows.length - bodyStart;
    const dataRowIndices = computeDataRowIndices(logicalRows, bodyStart);
    const dataColIndices = Array.from({ length: colCount - headerColCount }, (_, i) => i + headerColCount);

    const rowIds = Array.from({ length: logicalRows.length }, (_, i) => i + 1);
    const colIds = Array.from({ length: colCount }, (_, i) => i + 1);

    const cells: CellState[][] = [];
    for (let rAbs = 0; rAbs < logicalRows.length; rAbs += 1) {
      const row = logicalRows[rAbs];
      const rowCells: CellState[] = [];
      const trimmed = [...row.cells];
      if (trimmed.length < colCount) {
        trimmed.push(...Array(colCount - trimmed.length).fill(""));
      }
      for (let c = 0; c < trimmed.length; c += 1) {
        const value = trimmed[c];
        const normalizedText = normalizeCellTextForParsing(value, rAbs, c, headerRowCount, headerColCount);
        const parsed = parseCellInput(normalizedText);
        rowCells.push({
          body: parsed.body,
          localDisplay: parsed.localDisplay,
          cachedValue: parsed.initialCachedValue,
          dirty: !parsed.body.valid || parsed.initialCachedValue === null,
        });
      }
      cells.push(rowCells);
    }

    const sheet = new SheetState(
      name,
      logicalRows.length,
      colCount,
      headerRowCount,
      headerColCount,
      bodyStart,
      bodyRowCount,
      rowPaths,
      colLabels,
      rowMap,
      colMap,
      rowIds,
      colIds,
      dataRowIndices,
      dataColIndices,
      logicalRows,
      cells,
      rowDisplayMetadata,
      columnDisplayMetadata,
      normalizedBlocks,
      primaryIndex,
    );
    sheet.bindAllFormulas();
    sheet.rebuildDependencies();
    return sheet;
  }

  // Evaluate the current sheet state into a SheetEvaluation.
  toEvaluation(): SheetEvaluation {
    this.recalculate();
    const values: RuntimeValue[][] = [];
    for (let rAbs = this.bodyStart; rAbs < this.rowCount; rAbs += 1) {
      const rowValues = Array.from({ length: this.colCount }, (_, c) => this.evalCell(rAbs, c, new Map()));
      values.push(rowValues);
    }
    return {
      name: this.name,
      rowPaths: this.rowPaths,
      colLabels: this.colLabels,
      values,
    };
  }

  // Update a cell by row/column labels.
  setCellByLabel(rowPath: string, colLabel: string, text: string, kind: ChangeKind = ChangeKind.VALUE, eager = true) {
    if (!this.rowPaths.includes(rowPath)) {
      throw new Error(`unknown row path '${rowPath}'`);
    }
    if (!this.colLabels.includes(colLabel)) {
      throw new Error(`unknown column label '${colLabel}'`);
    }
    const rowRel = this.rowPaths.indexOf(rowPath);
    const rAbs = this.bodyStart + rowRel;
    const c = this.colLabels.indexOf(colLabel);
    this.setCellByIndex(rAbs, c, text, kind, eager);
  }

  // Clear a cell by row/column labels.
  clearCellByLabel(rowPath: string, colLabel: string, eager = true) {
    this.setCellByLabel(rowPath, colLabel, "", ChangeKind.CLEAR, eager);
  }

  // Update a cell by absolute indices.
  setCellByIndex(rAbs: number, c: number, text: string, kind: ChangeKind = ChangeKind.VALUE, eager = true) {
    if (rAbs < 0 || rAbs >= this.rowCount || c < 0 || c >= this.colCount) {
      throw new Error("cell index out of range");
    }

    const cell = this.cells[rAbs][c];
    const normalizedText = normalizeCellTextForParsing(text, rAbs, c, this.headerRowCount, this.headerColCount);
    const parsed = this.bindParsedCell(parseCellInput(normalizedText));
    cell.body = parsed.body;
    if (kind === ChangeKind.CLEAR) {
      cell.localDisplay = parsed.localDisplay;
    }
    cell.dirty = true;
    cell.cachedValue = null;

    const nextRawText = kind === ChangeKind.VALUE ? buildCellRawText(cell.body, cell.localDisplay) : text;
    this.updateRowText(rAbs, c, nextRawText);

    const affectsStructure = kind === ChangeKind.LABEL
      || kind === ChangeKind.STRUCTURAL
      || kind === ChangeKind.SHEET
      || rAbs < this.bodyStart
      || c < this.headerColCount;

    if (affectsStructure) {
      this.rebuildMetadata();
      this.refreshFormulaSourceTexts();
      this.markAllDirty();
    } else if (kind === ChangeKind.VALUE || kind === ChangeKind.CLEAR) {
      this.updateDependenciesForCell(rAbs, c);
      this.markDirtyFrom([rAbs, c]);
    } else {
      this.markAllDirty();
    }

    if (eager) {
      this.recalculate();
    }
  }

  // Clear a cell by absolute indices.
  clearCellByIndex(rAbs: number, c: number, eager = true) {
    this.setCellByIndex(rAbs, c, "", ChangeKind.CLEAR, eager);
  }

  // Set cell-local format metadata while preserving current local style metadata.
  setCellLocalFormatByIndex(rAbs: number, c: number, format: FormatSpec | null) {
    if (rAbs < 0 || rAbs >= this.rowCount || c < 0 || c >= this.colCount) {
      throw new Error("cell index out of range");
    }
    assertFormatSpecOrNull(format);
    const existing = this.cells[rAbs][c].localDisplay;
    const style = existing && existing.valid ? existing.style : null;
    this.setCellLocalDisplayByIndex(rAbs, c, format, style);
  }

  // Clear cell-local format metadata while preserving current local style metadata.
  clearCellLocalFormatByIndex(rAbs: number, c: number) {
    this.setCellLocalFormatByIndex(rAbs, c, null);
  }

  // Set cell-local style metadata while preserving current local format metadata.
  setCellLocalStyleByIndex(rAbs: number, c: number, stylePatch: StylePatch) {
    if (rAbs < 0 || rAbs >= this.rowCount || c < 0 || c >= this.colCount) {
      throw new Error("cell index out of range");
    }
    assertStylePatch(stylePatch);
    const existing = this.cells[rAbs][c].localDisplay;
    const format = existing && existing.valid ? existing.format : null;
    const currentStyle = existing && existing.valid ? existing.style : null;
    const style = applyStylePatch(currentStyle, stylePatch);
    this.setCellLocalDisplayByIndex(rAbs, c, format, style);
  }

  // Clear cell-local style metadata while preserving current local format metadata.
  clearCellLocalStyleByIndex(rAbs: number, c: number) {
    if (rAbs < 0 || rAbs >= this.rowCount || c < 0 || c >= this.colCount) {
      throw new Error("cell index out of range");
    }
    const existing = this.cells[rAbs][c].localDisplay;
    const format = existing && existing.valid ? existing.format : null;
    this.setCellLocalDisplayByIndex(rAbs, c, format, null);
  }

  setColumnDefaultFormatByIndex(c: number, format: FormatSpec | null) {
    if (c < 0 || c >= this.colCount) {
      throw new Error("column index out of range");
    }
    assertFormatSpecOrNull(format);
    const existing = this.columnDisplayMetadata[c];
    const style = existing && existing.valid ? existing.style : null;
    this.columnDisplayMetadata[c] = createDisplayFromSpecs(format, style);
  }

  clearColumnDefaultFormatByIndex(c: number) {
    this.setColumnDefaultFormatByIndex(c, null);
  }

  setColumnDefaultStyleByIndex(c: number, stylePatch: StylePatch) {
    if (c < 0 || c >= this.colCount) {
      throw new Error("column index out of range");
    }
    assertStylePatch(stylePatch);
    const existing = this.columnDisplayMetadata[c];
    const format = existing && existing.valid ? existing.format : null;
    const currentStyle = existing && existing.valid ? existing.style : null;
    const style = applyStylePatch(currentStyle, stylePatch);
    this.columnDisplayMetadata[c] = createDisplayFromSpecs(format, style);
  }

  clearColumnDefaultStyleByIndex(c: number) {
    if (c < 0 || c >= this.colCount) {
      throw new Error("column index out of range");
    }
    const existing = this.columnDisplayMetadata[c];
    const format = existing && existing.valid ? existing.format : null;
    this.columnDisplayMetadata[c] = createDisplayFromSpecs(format, null);
  }

  setRowDefaultFormatByIndex(rAbs: number, format: FormatSpec | null) {
    if (rAbs < 0 || rAbs >= this.rowCount) {
      throw new Error("row index out of range");
    }
    if (rAbs < this.bodyStart || this.headerColCount <= 0) {
      throw new Error("row default format requires a body row with a header label column");
    }
    assertFormatSpecOrNull(format);
    const existing = this.rowDisplayMetadata[rAbs];
    const style = existing && existing.valid ? existing.style : null;
    this.rowDisplayMetadata[rAbs] = createDisplayFromSpecs(format, style);
  }

  clearRowDefaultFormatByIndex(rAbs: number) {
    this.setRowDefaultFormatByIndex(rAbs, null);
  }

  setRowDefaultStyleByIndex(rAbs: number, stylePatch: StylePatch) {
    if (rAbs < 0 || rAbs >= this.rowCount) {
      throw new Error("row index out of range");
    }
    if (rAbs < this.bodyStart || this.headerColCount <= 0) {
      throw new Error("row default style requires a body row with a header label column");
    }
    assertStylePatch(stylePatch);
    const existing = this.rowDisplayMetadata[rAbs];
    const format = existing && existing.valid ? existing.format : null;
    const currentStyle = existing && existing.valid ? existing.style : null;
    const style = applyStylePatch(currentStyle, stylePatch);
    this.rowDisplayMetadata[rAbs] = createDisplayFromSpecs(format, style);
  }

  clearRowDefaultStyleByIndex(rAbs: number) {
    if (rAbs < 0 || rAbs >= this.rowCount) {
      throw new Error("row index out of range");
    }
    if (rAbs < this.bodyStart || this.headerColCount <= 0) {
      throw new Error("row default style requires a body row with a header label column");
    }
    const existing = this.rowDisplayMetadata[rAbs];
    const format = existing && existing.valid ? existing.format : null;
    this.rowDisplayMetadata[rAbs] = createDisplayFromSpecs(format, null);
  }

  // Update local display metadata without mutating formula/value dependency state.
  private setCellLocalDisplayByIndex(
    rAbs: number,
    c: number,
    format: FormatSpec | null,
    style: StyleSpec | null,
  ) {
    const nextDisplay = createDisplayFromSpecs(format, style);
    const cell = this.cells[rAbs][c];
    cell.localDisplay = nextDisplay;
  }

  // Bind absolute selectors to stable IDs (tentative RFC-0012 behavior).
  private bindParsedCell(parsed: ParsedCell): ParsedCell {
    if (!parsed.body.valid || parsed.body.kind !== "formula") {
      return parsed;
    }

    const bindSelector = (selector: any, axis: "row" | "col"): any => {
      if (!selector || typeof selector !== "object") return selector;
      if (selector.kind === "range") {
        const [startSel, endSel] = selector.value as [any | null, any | null];
        return {
          kind: "range",
          value: [
            startSel ? bindSelector(startSel, axis) : null,
            endSel ? bindSelector(endSel, axis) : null,
          ],
        };
      }
      if (selector.kind === "absolute") {
        const index = Number(selector.value);
        const ids = axis === "row" ? this.rowIds : this.colIds;
        if (index < 0 || index >= ids.length) {
          return { kind: "invalid" };
        }
        return { kind: "absolute_id", value: ids[index] };
      }
      if (selector.kind === "label") {
        const key = axis === "row"
          ? JSON.stringify(selector.value as string[])
          : (selector.value as string[]).join(".");
        const matches = axis === "row" ? this.rowMap.get(key) ?? [] : this.colMap.get(key) ?? [];
        if (matches.length !== 1) {
          return selector;
        }
        const ids = axis === "row" ? this.rowIds : this.colIds;
        const id = ids[matches[0]];
        return id == null ? selector : { kind: "label_id", value: id };
      }
      if (selector.kind === "absolute_fixed") {
        return selector;
      }
      return selector;
    };

    const walk = (node: ExprNode | null) => {
      if (!node) return;
      if (node.kind === "reference") {
        const ref = node.value as any;
        ref.rowSelector = bindSelector(ref.rowSelector, "row");
        ref.colSelector = bindSelector(ref.colSelector, "col");
        return;
      }
      if (node.kind === "call") {
        const call = node.value as { args: ExprNode[] };
        call.args.forEach((arg) => walk(arg));
        return;
      }
      if (node.kind === "unary") {
        walk(node.right ?? null);
        return;
      }
      if (node.kind === "binary") {
        walk(node.left ?? null);
        walk(node.right ?? null);
      }
    };

    walk(parsed.body.expression);
    return parsed;
  }

  // Bind all formulas to stable IDs after initial parse (tentative RFC-0012 behavior).
  private bindAllFormulas() {
    for (let rAbs = 0; rAbs < this.cells.length; rAbs += 1) {
      for (let c = 0; c < this.cells[rAbs].length; c += 1) {
        const cell = this.cells[rAbs][c];
        const parsed = this.bindParsedCell({
          body: cell.body,
          localDisplay: cell.localDisplay,
          initialCachedValue: cell.cachedValue,
        });
        cell.body = parsed.body;
      }
    }
  }

  // Insert a blank row at a logical row index (tentative RFC-0012 behavior).
  insertRow(rowIndex: number, eager = true, labelRaw = "") {
    if (rowIndex < this.bodyStart) {
      throw new Error("header row insertion is not supported (tentative)");
    }
    if (rowIndex < 0 || rowIndex > this.rowCount) {
      throw new Error("row index out of range");
    }
    this.insertBlankRowAt(rowIndex, labelRaw);
    this.finalizeStructuralRowEdit(eager);
  }

  insertHeaderRow(rowIndex: number, eager = true, labelRaw = "") {
    if (rowIndex < 0 || rowIndex > this.headerRowCount) {
      throw new Error("header row index out of range");
    }
    this.insertBlankRowAt(rowIndex, labelRaw);
    this.headerRowCount += 1;
    this.bodyStart = this.headerRowCount;
    this.finalizeStructuralRowEdit(eager);
  }

  // Delete a row at a logical row index (tentative RFC-0012 behavior).
  deleteRow(rowIndex: number, eager = true) {
    this.deleteRows(rowIndex, 1, eager);
  }

  deleteRows(rowIndex: number, count: number, eager = true) {
    if (rowIndex < this.bodyStart) {
      throw new Error("header row deletion is not supported (tentative)");
    }
    if (rowIndex < 0 || rowIndex >= this.rowCount) {
      throw new Error("row index out of range");
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("row delete count must be a positive integer");
    }
    if (rowIndex + count > this.rowCount) {
      throw new Error("row delete range out of range");
    }
    this.deleteRowRangeAt(rowIndex, count);
    this.finalizeStructuralRowEdit(eager);
  }

  deleteHeaderRow(rowIndex: number, eager = true) {
    if (rowIndex < 0 || rowIndex >= this.headerRowCount) {
      throw new Error("header row index out of range");
    }
    this.deleteRowRangeAt(rowIndex, 1);
    this.headerRowCount -= 1;
    this.bodyStart = this.headerRowCount > 0 ? this.headerRowCount : 0;
    this.finalizeStructuralRowEdit(eager);
  }

  convertBodyPrefixToHeader(count: number, eager = true) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("row conversion count must be a positive integer");
    }
    if (this.bodyStart + count > this.rowCount) {
      throw new Error("row conversion range out of range");
    }
    this.headerRowCount += count;
    this.bodyStart = this.headerRowCount;
    this.finalizeStructuralRowEdit(eager);
  }

  convertHeaderSuffixToBody(count: number, depth: number, eager = true) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("row conversion count must be a positive integer");
    }
    if (count > this.headerRowCount) {
      throw new Error("row conversion range out of range");
    }
    if (!Number.isInteger(depth) || depth < 0) {
      throw new Error("depth must be non-negative");
    }
    this.headerRowCount -= count;
    this.bodyStart = this.headerRowCount > 0 ? this.headerRowCount : 0;
    for (let offset = 0; offset < count; offset += 1) {
      const rowIndex = this.bodyStart + offset;
      const label = this.logicalRows[rowIndex].rawCells[0] ?? "";
      this.updateRowText(rowIndex, 0, applyHierarchyDepthToLabel(label, depth));
    }
    this.finalizeStructuralRowEdit(eager);
  }

  // Insert a blank column at a logical column index (tentative RFC-0012 behavior).
  insertCol(colIndex: number, eager = true) {
    if (colIndex < this.headerColCount) {
      throw new Error("header column insertion is not supported (tentative)");
    }
    if (colIndex < 0 || colIndex > this.colCount) {
      throw new Error("column index out of range");
    }

    for (const row of this.logicalRows) {
      row.rawCells.splice(colIndex, 0, "");
      row.cells.splice(colIndex, 0, "");
    }
    for (const rowCells of this.cells) {
      const parsed = this.bindParsedCell(parseCellInput(""));
      rowCells.splice(colIndex, 0, {
        body: parsed.body,
        localDisplay: parsed.localDisplay,
        cachedValue: null,
        dirty: true,
      });
    }
    this.colIds.splice(colIndex, 0, this.nextColId);
    this.columnDisplayMetadata.splice(colIndex, 0, null);
    this.nextColId += 1;

    this.rebuildMetadata();
    this.refreshFormulaSourceTexts();
    this.markAllDirty();
    if (eager) {
      this.recalculate();
    }
  }

  // Delete a column at a logical column index (tentative RFC-0012 behavior).
  deleteCol(colIndex: number, eager = true) {
    if (colIndex < this.headerColCount) {
      throw new Error("header column deletion is not supported (tentative)");
    }
    if (colIndex < 0 || colIndex >= this.colCount) {
      throw new Error("column index out of range");
    }
    for (const row of this.logicalRows) {
      if (colIndex < row.rawCells.length) row.rawCells.splice(colIndex, 1);
      if (colIndex < row.cells.length) row.cells.splice(colIndex, 1);
    }
    for (const rowCells of this.cells) {
      rowCells.splice(colIndex, 1);
    }
    this.colIds.splice(colIndex, 1);
    this.columnDisplayMetadata.splice(colIndex, 1);

    this.rebuildMetadata();
    this.refreshFormulaSourceTexts();
    this.markAllDirty();
    if (eager) {
      this.recalculate();
    }
  }

  // Rename a row label and rebind references when unique (tentative RFC-0012 behavior).
  renameRowLabel(rowPath: string, newLabel: string, eager = true) {
    if (!this.rowPaths.includes(rowPath)) {
      throw new Error(`unknown row path '${rowPath}'`);
    }
    const parts = rowPath.split(".");
    const parentParts = parts.slice(0, -1);
    const rowRel = this.rowPaths.indexOf(rowPath);
    const rAbs = this.bodyStart + rowRel;
    const row = this.logicalRows[rAbs];
    const raw = row.rawCells[0] ?? "";
    const leading = raw.match(/^\s*/)?.[0] ?? "";
    row.rawCells[0] = `${leading}${newLabel}`;
    row.cells[0] = newLabel.trim();

    const cellState = this.cells[rAbs]?.[0];
    if (cellState) {
      const normalized = normalizeCellTextForParsing(row.rawCells[0], rAbs, 0, this.headerRowCount, this.headerColCount);
      const parsed = this.bindParsedCell(parseCellInput(normalized));
      cellState.body = parsed.body;
      cellState.localDisplay = parsed.localDisplay;
      cellState.cachedValue = null;
      cellState.dirty = true;
    }

    this.rebuildMetadata();
    this.markAllDirty();

    const newPath = [...parentParts, newLabel].join(".");
    this.applyRowAlias(rowPath, newPath);
    this.refreshFormulaSourceTexts();

    if (eager) {
      this.recalculate();
    }
  }

  // Rename a column label and rebind references when unique (tentative RFC-0012 behavior).
  renameColLabel(oldLabel: string, newLabel: string, eager = true) {
    if (!this.colLabels.includes(oldLabel)) {
      throw new Error(`unknown column label '${oldLabel}'`);
    }
    if (this.headerRowCount === 0) {
      throw new Error("column rename requires a header row (tentative)");
    }
    const colIndex = this.colLabels.indexOf(oldLabel);
    const headerRowIndex = this.headerRowCount - 1;
    const headerRow = this.logicalRows[headerRowIndex];
    headerRow.rawCells[colIndex] = newLabel;
    headerRow.cells[colIndex] = newLabel.trim();

    const cellState = this.cells[headerRowIndex]?.[colIndex];
    if (cellState) {
      const normalized = normalizeCellTextForParsing(newLabel, headerRowIndex, colIndex, this.headerRowCount, this.headerColCount);
      const parsed = this.bindParsedCell(parseCellInput(normalized));
      cellState.body = parsed.body;
      cellState.localDisplay = parsed.localDisplay;
      cellState.cachedValue = null;
      cellState.dirty = true;
    }

    this.rebuildMetadata();
    this.markAllDirty();
    this.applyColAlias(oldLabel, newLabel);
    this.refreshFormulaSourceTexts();

    if (eager) {
      this.recalculate();
    }
  }

  // Recalculate all dirty cells.
  recalculate() {
    for (let rAbs = 0; rAbs < this.rowCount; rAbs += 1) {
      for (let c = 0; c < this.colCount; c += 1) {
        if (this.cells[rAbs][c].dirty) {
          this.evalCell(rAbs, c, new Map());
        }
      }
    }
  }

  // Evaluate a single cell with cycle detection and memoization.
  private evalCell(rAbs: number, c: number, states: Map<string, string>): RuntimeValue {
    const key = `${rAbs},${c}`;
    const state = states.get(key);
    if (state === "visiting") {
      return makeInternalError("cycle");
    }
    const cell = this.cells[rAbs][c];
    if (state === "done") {
      return cell.cachedValue ?? { kind: "blank", value: null };
    }
    if (!cell.dirty && cell.cachedValue !== null) {
      return cell.cachedValue;
    }

    states.set(key, "visiting");
    const body = cell.body;

    let value: RuntimeValue;
    if (!body.valid) {
      value = runtimeErrorFromDiagnostic(body.issue);
    } else if (body.kind === "literal") {
      value = body.literal;
    } else {
      value = evalExpr(
        body.expression,
        rAbs,
        c,
        (rDep, cDep) => this.evalCell(rDep, cDep, states),
        this.rowMap,
        this.colMap,
        this.rowCount,
        this.colCount,
        this.bodyStart,
        this.bodyRowCount,
        this.dataRowIndices,
        this.dataColIndices,
        this.rowIdToIndex,
        this.colIdToIndex,
      );
    }

    cell.cachedValue = value;
    cell.dirty = false;
    states.set(key, "done");
    return value;
  }

  // Update the cached parsed row text for a changed cell.
  private updateRowText(rAbs: number, c: number, text: string) {
    const row = this.logicalRows[rAbs];
    if (c >= row.rawCells.length) {
      row.rawCells.push(...Array(c - row.rawCells.length + 1).fill(""));
    }
    if (c >= row.cells.length) {
      row.cells.push(...Array(c - row.cells.length + 1).fill(""));
    }
    row.rawCells[c] = text;
    row.cells[c] = text.trim();
  }

  // Rebuild dependency indices for a single formula cell.
  private updateDependenciesForCell(rAbs: number, c: number) {
    const key = `${rAbs},${c}`;
    const existing = this.formulaViewIds.get(key) ?? new Set<number>();
    for (const viewId of existing) {
      const view = this.viewDependencies.get(viewId);
      this.viewDependencies.delete(viewId);
      this.viewFormulas.delete(viewId);
      if (!view) continue;
      for (const rDep of view.rowIndices) {
        const rowSet = this.viewRowIndex.get(rDep);
        if (rowSet) {
          rowSet.delete(viewId);
          if (rowSet.size === 0) this.viewRowIndex.delete(rDep);
        }
      }
      for (const cDep of view.colIndices) {
        const colSet = this.viewColIndex.get(cDep);
        if (colSet) {
          colSet.delete(viewId);
          if (colSet.size === 0) this.viewColIndex.delete(cDep);
        }
      }
    }
    this.formulaViewIds.delete(key);

    const views = this.collectViewDependencies(rAbs, c);
    if (views.length === 0) return;
    const newIds = new Set<number>();
    for (const view of views) {
      if (view.rowIndices.length === 0 || view.colIndices.length === 0) continue;
      const viewId = this.nextViewId;
      this.nextViewId += 1;
      this.viewDependencies.set(viewId, view);
      this.viewFormulas.set(viewId, [rAbs, c]);
      for (const rDep of view.rowIndices) {
        const set = this.viewRowIndex.get(rDep) ?? new Set<number>();
        set.add(viewId);
        this.viewRowIndex.set(rDep, set);
      }
      for (const cDep of view.colIndices) {
        const set = this.viewColIndex.get(cDep) ?? new Set<number>();
        set.add(viewId);
        this.viewColIndex.set(cDep, set);
      }
      newIds.add(viewId);
    }
    if (newIds.size > 0) {
      this.formulaViewIds.set(key, newIds);
    }
  }

  // Collect view dependencies referenced by a formula cell.
  private collectViewDependencies(rAbs: number, c: number): ViewSelection[] {
    const cell = this.cells[rAbs][c];
    if (!cell.body.valid || cell.body.kind !== "formula") return [];
    const expr = cell.body.expression;
    const views: ViewSelection[] = [];

    const walk = (node: ExprNode | null) => {
      if (!node) return;
      if (node.kind === "reference") {
        const view = selectView(
          node.value as ReferenceExpr,
          rAbs,
          c,
          this.rowMap,
          this.colMap,
          this.rowCount,
          this.colCount,
          this.bodyStart,
          this.bodyRowCount,
          this.dataRowIndices,
          this.dataColIndices,
          this.rowIdToIndex,
          this.colIdToIndex,
        );
        if (view) views.push(view);
        return;
      }
      if (node.kind === "call") {
        for (const arg of (node.value as { args: ExprNode[] }).args) {
          walk(arg);
        }
        return;
      }
      if (node.kind === "unary") {
        walk(node.right ?? null);
        return;
      }
      if (node.kind === "binary") {
        walk(node.left ?? null);
        walk(node.right ?? null);
      }
    };

    walk(expr);
    return views;
  }

  // Recompute label metadata and rebuild dependencies.
  private rebuildMetadata() {
    const colCount = this.logicalRows.reduce((m, r) => Math.max(m, r.cells.length), 0);
    this.colCount = colCount;
    const colLabelPaths = buildColumnLabelPaths(this.logicalRows, this.headerRowCount, colCount);
    const colLabels = buildColumnLabels(colLabelPaths);
    this.colLabels = colLabels;

    const { rowPaths } = buildBodyRows(this.logicalRows, this.bodyStart);
    this.rowPaths = rowPaths;

    const rowKeys = buildRowKeys(this.logicalRows, this.bodyStart);
    const rowMap = new Map<string, number[]>();
    rowKeys.forEach((key, offset) => {
      const absIdx = this.bodyStart + offset;
      const k = JSON.stringify(key);
      const list = rowMap.get(k) ?? [];
      list.push(absIdx);
      rowMap.set(k, list);
    });
    this.rowMap = rowMap;

    this.colMap = buildColumnLabelMap(colLabelPaths, colLabels);

    this.dataRowIndices = computeDataRowIndices(this.logicalRows, this.bodyStart);
    this.dataColIndices = Array.from({ length: colCount - this.headerColCount }, (_, i) => i + this.headerColCount);
    this.rowCount = this.logicalRows.length;
    this.bodyRowCount = this.rowCount - this.bodyStart;
    this.rowIdToIndex = buildIdIndexMap(this.rowIds);
    this.colIdToIndex = buildIdIndexMap(this.colIds);
    this.columnDisplayMetadata = resizeColumnDisplayMetadata(this.columnDisplayMetadata, this.colCount);

    this.rebuildDependencies();
  }

  private insertBlankRowAt(rowIndex: number, labelRaw: string) {
    const boundary = this.logicalRows.length > 0 ? this.logicalRows[0].boundary : null;
    const rawCells = Array.from({ length: this.colCount }, () => "");
    const cells = Array.from({ length: this.colCount }, () => "");
    if (rawCells.length > 0) {
      rawCells[0] = labelRaw;
      cells[0] = labelRaw.trim();
    }
    const newRow: ParsedRow = { rawCells, cells, boundary, errors: [] };
    this.logicalRows.splice(rowIndex, 0, newRow);

    const newCellStates: CellState[] = rawCells.map((cellText) => {
      const parsed = this.bindParsedCell(parseCellInput(cellText));
      return {
        body: parsed.body,
        localDisplay: parsed.localDisplay,
        cachedValue: null,
        dirty: true,
      };
    });
    this.cells.splice(rowIndex, 0, newCellStates);
    this.rowDisplayMetadata.splice(rowIndex, 0, null);
    this.rowIds.splice(rowIndex, 0, this.nextRowId);
    this.nextRowId += 1;
  }

  private deleteRowRangeAt(rowIndex: number, count: number) {
    this.logicalRows.splice(rowIndex, count);
    this.cells.splice(rowIndex, count);
    this.rowDisplayMetadata.splice(rowIndex, count);
    this.rowIds.splice(rowIndex, count);
  }

  private finalizeStructuralRowEdit(eager: boolean) {
    this.rebuildMetadata();
    this.refreshFormulaSourceTexts();
    this.markAllDirty();
    if (eager) {
      this.recalculate();
    }
  }

  // Add an alias for an old row path if the new label is unique (tentative RFC-0012 behavior).
  private applyRowAlias(oldPath: string, newPath: string) {
    const oldKey = JSON.stringify(oldPath.split("."));
    const newKey = JSON.stringify(newPath.split("."));
    const newMatches = this.rowMap.get(newKey) ?? [];
    if (newMatches.length === 1 && !this.rowMap.has(oldKey)) {
      this.rowMap.set(oldKey, [...newMatches]);
    }
  }

  // Add an alias for an old column label if the new label is unique (tentative RFC-0012 behavior).
  private applyColAlias(oldLabel: string, newLabel: string) {
    const newMatches = this.colMap.get(newLabel) ?? [];
    if (newMatches.length === 1 && !this.colMap.has(oldLabel)) {
      this.colMap.set(oldLabel, [...newMatches]);
    }
  }

  // Rebuild all view dependencies from scratch.
  private rebuildDependencies() {
    this.viewDependencies.clear();
    this.viewFormulas.clear();
    this.viewRowIndex.clear();
    this.viewColIndex.clear();
    this.formulaViewIds.clear();
    this.nextViewId = 1;
    for (let rAbs = 0; rAbs < this.rowCount; rAbs += 1) {
      for (let c = 0; c < this.colCount; c += 1) {
        this.updateDependenciesForCell(rAbs, c);
      }
    }
  }

  // After structural edits, formula ASTs may be rebased to new row/column positions.
  // Keep the source-facing formula text in sync with the rebased AST so UI/editor
  // surfaces do not show stale references until a serialize/parse round-trip.
  private refreshFormulaSourceTexts() {
    for (let rAbs = 0; rAbs < this.rowCount; rAbs += 1) {
      for (let c = 0; c < this.colCount; c += 1) {
        const cell = this.cells[rAbs][c];
        if (!cell.body.valid || cell.body.kind !== "formula") {
          continue;
        }
        const exprText =
          renderFormulaExpression(cell.body.expression, this.rowIdToIndex, this.colIdToIndex, {
            rowLabelPathsByIndex: Array.from({ length: this.rowCount }, (_, rowIndex) =>
              rowIndex >= this.bodyStart ? (this.rowPaths[rowIndex - this.bodyStart] ?? "").split(".") : [],
            ),
            colLabelsByIndex: this.colLabels,
          }) ?? cell.body.expressionText;
        cell.body.expressionText = exprText;
        cell.body.inputText = exprText.length > 0 ? `= ${exprText}` : "=";
        this.updateRowText(rAbs, c, buildCellRawText(cell.body, cell.localDisplay));
      }
    }
  }

  // Mark the dirty closure starting from a changed cell.
  private markDirtyFrom(origin: [number, number]) {
    const queue: Array<[number, number]> = [origin];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const [rAbs, c] = queue.pop() as [number, number];
      const key = `${rAbs},${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.cells[rAbs][c].dirty = true;
      const rowViews = this.viewRowIndex.get(rAbs) ?? new Set<number>();
      const colViews = this.viewColIndex.get(c) ?? new Set<number>();
      if (rowViews.size === 0 || colViews.size === 0) continue;

      const viewIds: number[] = [];
      if (rowViews.size <= colViews.size) {
        for (const id of rowViews) {
          if (colViews.has(id)) viewIds.push(id);
        }
      } else {
        for (const id of colViews) {
          if (rowViews.has(id)) viewIds.push(id);
        }
      }
      for (const viewId of viewIds) {
        const formula = this.viewFormulas.get(viewId);
        if (formula) {
          queue.push(formula);
        }
      }
    }
  }

  // Mark all cells dirty and clear cached values.
  private markAllDirty() {
    for (let rAbs = 0; rAbs < this.rowCount; rAbs += 1) {
      for (let c = 0; c < this.colCount; c += 1) {
        this.cells[rAbs][c].dirty = true;
        this.cells[rAbs][c].cachedValue = null;
      }
    }
  }
}

function buildIdIndexMap(ids: number[]): Map<number, number> {
  const map = new Map<number, number>();
  ids.forEach((id, idx) => map.set(id, idx));
  return map;
}

function normalizeCellTextForParsing(
  text: string,
  rAbs: number,
  c: number,
  headerRowCount: number,
  headerColCount: number,
): string {
  if (rAbs < headerRowCount || c < headerColCount) {
    return stripCellDisplayMetadata(text);
  }
  return text;
}

function extractColumnDisplayMetadataFromControlRow(
  controlRow: ParsedRow | null,
  colCount: number,
): Array<ParsedDisplayMetadata | null> {
  const output: Array<ParsedDisplayMetadata | null> = Array.from({ length: colCount }, () => null);
  if (!controlRow) {
    return output;
  }

  for (let c = 0; c < colCount; c += 1) {
    const raw = c + 1 < controlRow.rawCells.length ? controlRow.rawCells[c + 1] : "";
    if (raw.trim() === "") continue;
    const parsed = parseCellInput(raw);
    const content = stripCellDisplayMetadata(raw).trim();
    if (content !== "" || !parsed.localDisplay) {
      output[c] = {
        valid: false,
        rawBlock: raw.trim(),
        issue: {
          code: "display_control_cell_requires_metadata_only",
          context: {},
        },
      };
      continue;
    }
    output[c] = parsed.localDisplay;
  }
  return output;
}

function extractRowDisplayMetadataFromLabelColumn(
  logicalRows: ParsedRow[],
  bodyStart: number,
  headerColCount: number,
): Array<ParsedDisplayMetadata | null> {
  const output: Array<ParsedDisplayMetadata | null> = Array.from({ length: logicalRows.length }, () => null);
  if (headerColCount <= 0) {
    return output;
  }
  for (let rAbs = bodyStart; rAbs < logicalRows.length; rAbs += 1) {
    const raw = logicalRows[rAbs]?.rawCells[0] ?? "";
    if (raw.trim() === "") continue;
    output[rAbs] = parseCellInput(raw).localDisplay;
  }
  return output;
}

function resizeColumnDisplayMetadata(
  metadata: Array<ParsedDisplayMetadata | null>,
  colCount: number,
): Array<ParsedDisplayMetadata | null> {
  if (metadata.length === colCount) return metadata;
  if (metadata.length > colCount) return metadata.slice(0, colCount);
  return [...metadata, ...Array(colCount - metadata.length).fill(null)];
}

function createDisplayFromSpecs(format: FormatSpec | null, style: StyleSpec | null): ParsedDisplayMetadata | null {
  if (format === null && style === null) {
    return null;
  }

  return {
    valid: true,
    format,
    style,
  };
}

function applyHierarchyDepthToLabel(labelRaw: string, depth: number): string {
  const parsed = parseHierarchyLabel(labelRaw);
  const prefix = depth === 0 ? "" : `${"*".repeat(depth)} `;
  return `${prefix}${parsed.content}`;
}

function buildCellRawText(body: CellBodyState, localDisplay: ParsedDisplayMetadata | null): string {
  return getCellTextView({ body, localDisplay }).cellText;
}

function applyStylePatch(current: StyleSpec | null, patch: StylePatch): StyleSpec | null {
  const align = Object.hasOwn(patch, "align") ? patch.align ?? null : current?.align ?? null;
  const weight = Object.hasOwn(patch, "weight") ? patch.weight ?? null : current?.weight ?? null;
  const color = Object.hasOwn(patch, "color") ? patch.color ?? null : current?.color ?? null;
  if (align === null && weight === null && color === null) {
    return null;
  }
  return { align, weight, color };
}

function assertFormatSpecOrNull(format: FormatSpec | null): void {
  if (format === null) return;
  if (typeof format !== "object") {
    throw new Error("format spec must be an object or null");
  }
  if (format.kind === "temporal") {
    assertKnownKeys(format, ["kind", "pattern", "tokens"], "format");
    if (typeof format.pattern !== "string" || format.pattern.length === 0) {
      throw new Error("format.pattern must be a non-empty string");
    }
    const parsedTemporal = parseTemporalFormatSpec(format.pattern);
    if (!parsedTemporal || "issue" in parsedTemporal) {
      throw new Error(parsedTemporal && "issue" in parsedTemporal ? describeDisplayMetadataDiagnostic(parsedTemporal.issue) : "format.pattern must contain a supported temporal directive");
    }
    if (!Array.isArray(format.tokens)) {
      throw new Error("format.tokens must be an array");
    }
    for (const token of format.tokens) {
      if (!token || typeof token !== "object") {
        throw new Error("format.tokens entries must be objects");
      }
      assertKnownKeys(token, ["directive", "raw"], "format token");
      if (
        ![
          "literal_percent",
          "year",
          "month",
          "day",
          "hour",
          "minute",
          "second",
          "fraction",
          "offset_compact",
          "offset_colon",
          "date_iso",
          "time_iso",
          "duration_total_days",
          "duration_total_hours",
          "duration_total_minutes",
          "duration_total_seconds",
          "duration_total_milliseconds",
        ].includes(token.directive)
      ) {
        throw new Error("format token directive is invalid");
      }
      if (typeof token.raw !== "string" || token.raw.length === 0) {
        throw new Error("format token raw must be a non-empty string");
      }
    }
    if (JSON.stringify(format.tokens) !== JSON.stringify(parsedTemporal.value.tokens)) {
      throw new Error("format.tokens must match format.pattern");
    }
    return;
  }
  if (format.kind !== "numeric") {
    throw new Error("format.kind must be numeric or temporal");
  }
  assertKnownKeys(format, ["kind", "sign", "padWidth", "grouping", "precision", "type"], "format");
  if (!["default", "plus", "parentheses"].includes(format.sign)) {
    throw new Error("format.sign must be default, plus, or parentheses");
  }
  if (format.padWidth !== null && (!Number.isInteger(format.padWidth) || format.padWidth < 0)) {
    throw new Error("format.padWidth must be a non-negative integer or null");
  }
  if (typeof format.grouping !== "boolean") {
    throw new Error("format.grouping must be boolean");
  }
  if (format.precision !== null && (!Number.isInteger(format.precision) || format.precision < 0)) {
    throw new Error("format.precision must be a non-negative integer or null");
  }
  if (format.type !== null && !["f", "e", "%", "d"].includes(format.type)) {
    throw new Error("format.type must be f, e, %, d, or null");
  }
  const issue = validateFormatSpec(format);
  if (issue) {
    throw new Error(describeDisplayMetadataDiagnostic(issue));
  }
}

function assertStylePatch(style: StylePatch): void {
  if (!style || typeof style !== "object") {
    throw new Error("style patch must be an object");
  }
  assertKnownKeys(style, ["align", "weight", "color"], "style");
  const align = style.align;
  const weight = style.weight;
  const color = style.color;
  if (Object.hasOwn(style, "align") && align !== undefined && align !== null && !["left", "right", "center"].includes(align)) {
    throw new Error("style.align must be left, right, center, or null");
  }
  if (Object.hasOwn(style, "weight") && weight !== undefined && weight !== null && !["bold", "normal"].includes(weight)) {
    throw new Error("style.weight must be bold, normal, or null");
  }
  if (Object.hasOwn(style, "color") && color !== undefined && color !== null && !["red", "green", "blue"].includes(color)) {
    throw new Error("style.color must be red, green, blue, or null");
  }
}

function assertKnownKeys(value: object, allowed: string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new Error(`${label} contains unsupported field '${key}'`);
    }
  }
}

export class DocumentState {
  sheets: SheetState[];

  constructor(sheets: SheetState[]) {
    this.sheets = sheets;
  }

  // Build a document state from text.
  static fromText(text: string): DocumentState {
    const parsed = parseDocument(text);
    const sheets: SheetState[] = [];
    for (const sheet of parsed) {
      const sourceBlocks: PreservedSheetBlock[] = sheet.blocks.map((block) => {
        if (block.kind === "table") {
          return { kind: "table", lines: [...block.table.rows] };
        }
        return { kind: "unparsed", lines: [...block.lines] };
      });
      const primaryTableBlockIndex = sourceBlocks.findIndex((b) => b.kind === "table");
      const primaryRows =
        primaryTableBlockIndex >= 0 && primaryTableBlockIndex < sourceBlocks.length
          ? [...sourceBlocks[primaryTableBlockIndex].lines]
          : [];
      sheets.push(
        SheetState.fromTableRows(
          sheet.name,
          primaryRows,
          sourceBlocks,
          primaryTableBlockIndex === -1 ? null : primaryTableBlockIndex,
        ),
      );
    }
    return new DocumentState(sheets);
  }

  // Evaluate the current state into an EvaluationResult.
  evaluate(): EvaluationResult {
    const sheetEvals: SheetEvaluation[] = [];
    for (const sheetState of this.sheets) {
      sheetEvals.push(sheetState.toEvaluation());
    }
    return { sheets: sheetEvals };
  }

  // Update a cell by sheet name and row/column labels.
  setCell(
    sheetName: string,
    rowPath: string,
    colLabel: string,
    text: string,
    kind: ChangeKind = ChangeKind.VALUE,
    eager = true,
  ) {
    const sheet = this.findSheet(sheetName);
    sheet.setCellByLabel(rowPath, colLabel, text, kind, eager);
  }

  // Clear a cell by sheet name and row/column labels.
  clearCell(sheetName: string, rowPath: string, colLabel: string, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.clearCellByLabel(rowPath, colLabel, eager);
  }

  // Update a cell by sheet name and numeric indices.
  setCellByIndex(
    sheetName: string,
    rowIndex: number,
    colIndex: number,
    text: string,
    kind: ChangeKind = ChangeKind.VALUE,
    eager = true,
  ) {
    const sheet = this.findSheet(sheetName);
    sheet.setCellByIndex(rowIndex, colIndex, text, kind, eager);
  }

  // Clear a cell by sheet name and numeric indices.
  clearCellByIndex(sheetName: string, rowIndex: number, colIndex: number, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.clearCellByIndex(rowIndex, colIndex, eager);
  }

  // Insert a blank row into a sheet (tentative RFC-0012 behavior).
  insertRow(sheetName: string, rowIndex: number, eager = true, labelRaw = "") {
    const sheet = this.findSheet(sheetName);
    sheet.insertRow(rowIndex, eager, labelRaw);
  }

  insertHeaderRow(sheetName: string, rowIndex: number, eager = true, labelRaw = "") {
    const sheet = this.findSheet(sheetName);
    sheet.insertHeaderRow(rowIndex, eager, labelRaw);
  }

  // Delete a row from a sheet (tentative RFC-0012 behavior).
  deleteRow(sheetName: string, rowIndex: number, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.deleteRow(rowIndex, eager);
  }

  deleteHeaderRow(sheetName: string, rowIndex: number, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.deleteHeaderRow(rowIndex, eager);
  }

  deleteRows(sheetName: string, rowIndex: number, count: number, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.deleteRows(rowIndex, count, eager);
  }

  // Insert a blank column into a sheet (tentative RFC-0012 behavior).
  insertCol(sheetName: string, colIndex: number, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.insertCol(colIndex, eager);
  }

  // Delete a column from a sheet (tentative RFC-0012 behavior).
  deleteCol(sheetName: string, colIndex: number, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.deleteCol(colIndex, eager);
  }

  // Rename a row label in a sheet (tentative RFC-0012 behavior).
  renameRowLabel(sheetName: string, rowPath: string, newLabel: string, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.renameRowLabel(rowPath, newLabel, eager);
  }

  // Rename a column label in a sheet (tentative RFC-0012 behavior).
  renameColLabel(sheetName: string, oldLabel: string, newLabel: string, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.renameColLabel(oldLabel, newLabel, eager);
  }

  private findSheet(name: string): SheetState {
    const sheet = this.sheets.find((s) => s.name === name);
    if (!sheet) {
      throw new Error(`unknown sheet '${name}'`);
    }
    return sheet;
  }
}

// Expose separator check for test helpers.
