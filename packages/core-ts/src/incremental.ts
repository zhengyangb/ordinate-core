import { parseDocument, parseHierarchyLabel, parseTableRow, stripDisplayControlFrame, type ParsedRow, type UnparsedBlock } from "./parser";
import { assertNotePosition, parseSheetNote, SheetNoteError, type SheetNote, type SheetNotePosition, type NoteSourceBlock } from "./sheet_notes";
import { trimCellText } from "./text_encoding";
import { getCellTextView, parseCellInput, parseDisplayControlCell, stripCellDisplayMetadata } from "./runtime/parse";
import { describeDisplayMetadataDiagnostic, validateFormatSpec } from "./runtime/displayMetadata";
import { parseTemporalFormatSpec } from "./runtime/temporalFormat";
import { renderFormulaExpression, type FormulaRenderContext } from "./runtime/renderFormula";
import { buildFormulaRenderContext } from "./formula_context";
import {
  buildBodyRows,
  buildColumnLabelMap,
  buildColumnLabelPaths,
  buildColumnLabels,
  buildRowKeys,
  computeDataRowIndices,
  evalExpr,
  type CrossSheetResolver,
  type ExpressionValue,
  headerColCountFrom,
  headerRowCountFrom,
  selectView,
  selectViewDetailed,
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
  type RefSelector,
  type StyleSpec,
  type StylePatch,
  type ReferenceExpr,
  type RuntimeValue,
  type SheetEvaluation,
  type ViewSelection,
} from "./runtime/types";
import { makeInternalError, runtimeErrorFromDiagnostic } from "./runtime/errors";
import {
  copyExpressionReferenceMetadata,
  getBoundSheetId,
  setBoundSheetId,
  structurallyBindSelector,
  walkExpressionReferences,
} from "./runtime/references";
import { materializeViewSelection } from "./runtime/view";

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
  | NoteSourceBlock
  | UnparsedBlock;

export interface SheetHistoryCellSnapshot {
  body: CellBodyState;
  localDisplay: CellDisplayState;
}

export interface SheetHistorySnapshot {
  sheetId: number;
  name: string;
  headerRowCount: number;
  headerColCount: number;
  logicalRows: ParsedRow[];
  cells: SheetHistoryCellSnapshot[][];
  rowDisplayMetadata: Array<ParsedDisplayMetadata | null>;
  columnDisplayMetadata: Array<ParsedDisplayMetadata | null>;
  rowIds: number[];
  colIds: number[];
  nextRowId: number;
  nextColId: number;
  sourceBlocks: PreservedSheetBlock[];
  primaryTableBlockIndex: number | null;
}

export class SheetState {
  sheetId: number;
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
    sheetId: number,
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
    this.sheetId = sheetId;
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
    sheetId = 1,
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
        sheetId,
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
    const rowDisplayMetadata = extractRowDisplayMetadata(logicalRows, bodyStart, headerColCount);

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
      sheetId,
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

  captureHistorySnapshot(): SheetHistorySnapshot {
    const raw: SheetHistorySnapshot = {
      sheetId: this.sheetId,
      name: this.name,
      headerRowCount: this.headerRowCount,
      headerColCount: this.headerColCount,
      logicalRows: this.logicalRows,
      cells: this.cells.map((row) =>
        row.map((cell) => ({
          body: cell.body,
          localDisplay: cell.localDisplay,
        })),
      ),
      rowDisplayMetadata: this.rowDisplayMetadata,
      columnDisplayMetadata: this.columnDisplayMetadata,
      rowIds: this.rowIds,
      colIds: this.colIds,
      nextRowId: this.nextRowId,
      nextColId: this.nextColId,
      sourceBlocks: this.sourceBlocks,
      primaryTableBlockIndex: this.primaryTableBlockIndex,
    };
    const cloned = cloneHistoryValue(raw);
    copySheetHistoryReferenceMetadata(raw, cloned);
    return cloned;
  }

  private noteBlockRange(position: SheetNotePosition): [number, number] {
    assertNotePosition(position);
    const primary = this.primaryTableBlockIndex;
    if (primary === null || this.rowCount === 0 || this.sourceBlocks.filter(block => block.kind === "table").length !== 1) {
      throw new SheetNoteError("Sheet notes require exactly one nonempty table.");
    }
    return position === "beforeTable" ? [0, primary] : [primary + 1, this.sourceBlocks.length];
  }

  getSheetNote(position: SheetNotePosition): SheetNote {
    const [start, end] = this.noteBlockRange(position);
    const note: SheetNote = { blocks: [] };
    for (const block of this.sourceBlocks.slice(start, end)) {
      if (block.kind === "note") note.blocks.push(...block.note.blocks);
      else if (block.kind === "unparsed" && block.diagnostics.length) {
        const diagnostic = block.diagnostics[0];
        throw new SheetNoteError(diagnostic.message, diagnostic.line);
      }
    }
    return structuredClone(note);
  }

  setSheetNote(position: SheetNotePosition, markdown: string): void {
    const [start, end] = this.noteBlockRange(position);
    const note = parseSheetNote(markdown);
    const blocks: PreservedSheetBlock[] = note.blocks.length ? [{ kind: "note", note }] : [];
    const existing = this.sourceBlocks.slice(start, end).filter(block => block.kind !== "unparsed" || block.lines.some(line => line.trim()));
    if (JSON.stringify(existing) === JSON.stringify(blocks)) return;
    this.sourceBlocks.splice(start, end - start, ...blocks);
    this.primaryTableBlockIndex = this.sourceBlocks.findIndex(block => block.kind === "table");
  }

  restoreHistorySnapshot(snapshot: SheetHistorySnapshot): void {
    const restored = cloneHistoryValue(snapshot);
    copySheetHistoryReferenceMetadata(snapshot, restored);
    this.sheetId = restored.sheetId;
    this.name = restored.name;
    this.headerRowCount = restored.headerRowCount;
    this.headerColCount = restored.headerColCount;
    this.bodyStart = this.headerRowCount > 0 ? this.headerRowCount : 0;
    this.logicalRows = restored.logicalRows;
    this.cells = restored.cells.map((row) =>
      row.map((cell) => ({
        body: cell.body,
        localDisplay: cell.localDisplay,
        cachedValue: null,
        dirty: true,
      })),
    );
    this.rowDisplayMetadata = restored.rowDisplayMetadata;
    this.columnDisplayMetadata = restored.columnDisplayMetadata;
    this.rowIds = restored.rowIds;
    this.colIds = restored.colIds;
    this.nextRowId = restored.nextRowId;
    this.nextColId = restored.nextColId;
    this.sourceBlocks = restored.sourceBlocks;
    this.primaryTableBlockIndex = restored.primaryTableBlockIndex;
    this.rebuildMetadata();
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
    if (rAbs < this.bodyStart) {
      throw new Error("row default format requires a body row");
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
    if (rAbs < this.bodyStart) {
      throw new Error("row default style requires a body row");
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
    if (rAbs < this.bodyStart) {
      throw new Error("row default style requires a body row");
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

    walkExpressionReferences(parsed.body.expression, (ref) => {
      if (ref.sheetSelector) return;
      ref.rowSelector = structurallyBindSelector(ref.rowSelector, "row", this.rowIds, this.rowMap);
      ref.colSelector = structurallyBindSelector(ref.colSelector, "col", this.colIds, this.colMap);
    });
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

  moveRows(rowIndex: number, count: number, targetGapIndex: number, eager = true) {
    if (rowIndex < 0 || rowIndex >= this.rowCount) {
      throw new Error("row index out of range");
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("row move count must be a positive integer");
    }
    if (rowIndex + count > this.rowCount) {
      throw new Error("row move range out of range");
    }
    if (targetGapIndex < 0 || targetGapIndex > this.rowCount - count) {
      throw new Error("row target gap out of range");
    }

    const changed = moveContiguousSegment(this.logicalRows, rowIndex, count, targetGapIndex);
    if (!changed) return;
    moveContiguousSegment(this.cells, rowIndex, count, targetGapIndex);
    moveContiguousSegment(this.rowDisplayMetadata, rowIndex, count, targetGapIndex);
    moveContiguousSegment(this.rowIds, rowIndex, count, targetGapIndex);
    this.finalizeStructuralRowEdit(eager);
  }

  duplicateRows(rowIndex: number, count: number, targetGapIndex: number, eager = true) {
    if (rowIndex < 0 || rowIndex >= this.rowCount) {
      throw new Error("row index out of range");
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("row duplicate count must be a positive integer");
    }
    if (rowIndex + count > this.rowCount) {
      throw new Error("row duplicate range out of range");
    }
    if (targetGapIndex < 0 || targetGapIndex > this.rowCount) {
      throw new Error("row duplicate target gap out of range");
    }
    if (targetGapIndex > rowIndex && targetGapIndex < rowIndex + count) {
      throw new Error("row duplicate target gap must not be inside the source segment");
    }

    const sourceInHeader = rowIndex + count <= this.bodyStart;
    const sourceInBody = rowIndex >= this.bodyStart;
    if (!sourceInHeader && !sourceInBody) {
      throw new Error("row duplicate source must stay within one row region");
    }
    if (sourceInHeader && targetGapIndex > this.headerRowCount) {
      throw new Error("header row duplicate target gap out of range");
    }
    if (sourceInBody && targetGapIndex < this.bodyStart) {
      throw new Error("body row duplicate target gap out of range");
    }

    const sourceIds = this.rowIds.slice(rowIndex, rowIndex + count);
    const newRowIds = sourceIds.map(() => this.nextRowId++);
    const rowIdRemap = buildIdRemap(sourceIds, newRowIds);

    const clonedRows = this.logicalRows
      .slice(rowIndex, rowIndex + count)
      .map((row) => structuredClone(row) as ParsedRow);
    const clonedCells = this.cells
      .slice(rowIndex, rowIndex + count)
      .map((rowCells) => rowCells.map((cell) => cloneCellStateForDuplicate(cell, rowIdRemap, new Map())));
    const clonedRowMetadata = this.rowDisplayMetadata
      .slice(rowIndex, rowIndex + count)
      .map((metadata) => structuredClone(metadata) as ParsedDisplayMetadata | null);

    this.logicalRows.splice(targetGapIndex, 0, ...clonedRows);
    this.cells.splice(targetGapIndex, 0, ...clonedCells);
    this.rowDisplayMetadata.splice(targetGapIndex, 0, ...clonedRowMetadata);
    this.rowIds.splice(targetGapIndex, 0, ...newRowIds);

    if (sourceInHeader) {
      this.headerRowCount += count;
      this.bodyStart = this.headerRowCount;
    }

    this.finalizeStructuralRowEdit(eager);
  }

  convertBodyPrefixToHeader(count: number, eager = true) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("row conversion count must be a positive integer");
    }
    if (this.bodyStart + count > this.rowCount) {
      throw new Error("row conversion range out of range");
    }
    this.prepareHeaderCells(this.bodyStart, this.bodyStart + count, 0, this.colCount);
    for (let r = this.bodyStart; r < this.bodyStart + count; r++) this.rowDisplayMetadata[r] = null;
    this.headerRowCount += count;
    this.bodyStart = this.headerRowCount;
    this.finalizeStructuralRowEdit(eager);
  }

  /** Change the semantic boundary, never insert/delete/reidentify columns. */
  setHeaderColumnCount(count: number, eager = true) {
    if (!Number.isInteger(count) || count < 0 || count >= this.colCount) throw new Error("Keep at least one data column.");
    if (count === this.headerColCount) return;
    for (let r = this.bodyStart; r < this.rowCount; r++) {
      for (let c = this.headerColCount; c < count; c++) {
        const body = this.cells[r][c].body;
        if (!body.valid || body.kind === "formula") throw new Error("Cells containing formulas or invalid input cannot become header columns.");
      }
    }
    this.prepareHeaderCells(this.bodyStart, this.rowCount, this.headerColCount, count);
    this.headerColCount = count;
    for (const row of this.logicalRows) row.boundary = count === 0 ? null : count;
    this.finalizeStructuralRowEdit(eager);
  }

  private prepareHeaderCells(rowStart: number, rowEnd: number, colStart: number, colEnd: number) {
    for (let r = rowStart; r < rowEnd; r++) {
      for (let c = colStart; c < colEnd; c++) {
        const cell = this.cells[r][c];
        if (!cell.body.valid || cell.body.kind === "formula") continue;
        if (cell.body.valid && cell.body.kind === "literal" && cell.body.literal.kind === "string") {
          const text = cell.body.literal.value;
          const parsed = parseCellInput(text);
          // Remove literal quotes only when the label has the same native
          // meaning. Reserved syntax and hierarchy-looking text stay escaped.
          if (parsed.body.valid && parsed.body.kind === "literal" && parsed.body.literal.kind === "string"
            && parsed.body.literal.value === text && !parsed.localDisplay && !/[\r\n]/.test(text)
            && parseHierarchyLabel(text).depth === 0) {
            cell.body = parsed.body;
          }
        }
        // Header cells have no cell-local display metadata in ORD. Do not
        // accidentally reinterpret a former cell style as a whole-row style.
        cell.localDisplay = null;
        this.updateRowText(r, c, buildCellRawText(cell.body, null));
      }
    }
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

  moveColumns(colIndex: number, count: number, targetGapIndex: number, eager = true) {
    if (colIndex < this.headerColCount) {
      throw new Error("header column movement is not supported");
    }
    if (colIndex < 0 || colIndex >= this.colCount) {
      throw new Error("column index out of range");
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("column move count must be a positive integer");
    }
    if (colIndex + count > this.colCount) {
      throw new Error("column move range out of range");
    }
    if (targetGapIndex < 0 || targetGapIndex > this.colCount - count) {
      throw new Error("column target gap out of range");
    }

    let changed = false;
    for (const row of this.logicalRows) {
      padArray(row.rawCells, this.colCount, "");
      padArray(row.cells, this.colCount, "");
      changed = moveContiguousSegment(row.rawCells, colIndex, count, targetGapIndex) || changed;
      moveContiguousSegment(row.cells, colIndex, count, targetGapIndex);
    }
    for (const rowCells of this.cells) {
      moveContiguousSegment(rowCells, colIndex, count, targetGapIndex);
    }
    moveContiguousSegment(this.colIds, colIndex, count, targetGapIndex);
    moveContiguousSegment(this.columnDisplayMetadata, colIndex, count, targetGapIndex);

    if (!changed) return;
    this.rebuildMetadata();
    this.refreshFormulaSourceTexts();
    this.markAllDirty();
    if (eager) {
      this.recalculate();
    }
  }

  duplicateColumns(colIndex: number, count: number, targetGapIndex: number, eager = true) {
    if (colIndex < this.headerColCount) {
      throw new Error("header column duplication is not supported");
    }
    if (colIndex < 0 || colIndex >= this.colCount) {
      throw new Error("column index out of range");
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("column duplicate count must be a positive integer");
    }
    if (colIndex + count > this.colCount) {
      throw new Error("column duplicate range out of range");
    }
    if (targetGapIndex < 0 || targetGapIndex > this.colCount) {
      throw new Error("column duplicate target gap out of range");
    }
    if (targetGapIndex < this.headerColCount) {
      throw new Error("column duplicate target gap must be inside data columns");
    }
    if (targetGapIndex > colIndex && targetGapIndex < colIndex + count) {
      throw new Error("column duplicate target gap must not be inside the source segment");
    }

    const sourceIds = this.colIds.slice(colIndex, colIndex + count);
    const newColIds = sourceIds.map(() => this.nextColId++);
    const colIdRemap = buildIdRemap(sourceIds, newColIds);

    for (const row of this.logicalRows) {
      padArray(row.rawCells, this.colCount, "");
      padArray(row.cells, this.colCount, "");
      row.rawCells.splice(targetGapIndex, 0, ...structuredClone(row.rawCells.slice(colIndex, colIndex + count)));
      row.cells.splice(targetGapIndex, 0, ...structuredClone(row.cells.slice(colIndex, colIndex + count)));
    }
    for (const rowCells of this.cells) {
      const clonedCells = rowCells
        .slice(colIndex, colIndex + count)
        .map((cell) => cloneCellStateForDuplicate(cell, new Map(), colIdRemap));
      rowCells.splice(targetGapIndex, 0, ...clonedCells);
    }
    this.colIds.splice(targetGapIndex, 0, ...newColIds);
    this.columnDisplayMetadata.splice(
      targetGapIndex,
      0,
      ...this.columnDisplayMetadata
        .slice(colIndex, colIndex + count)
        .map((metadata) => structuredClone(metadata) as ParsedDisplayMetadata | null),
    );

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
    row.cells[c] = trimCellText(text);
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
        const ref = node.value as ReferenceExpr;
        if (ref.sheetSelector) return;
        const view = selectView(
          ref,
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
      if (node.kind === "array") {
        for (const row of (node.value as { rows: ExprNode[][] }).rows) {
          for (const element of row) {
            walk(element);
          }
        }
        return;
      }
      if (node.kind === "index") {
        const index = node.value as { target: ExprNode; axes: Array<{ kind: string; value?: ExprNode; start?: ExprNode | null; end?: ExprNode | null }> };
        walk(index.target);
        for (const axis of index.axes) {
          if (axis.kind === "scalar") {
            walk(axis.value ?? null);
          } else {
            walk(axis.start ?? null);
            walk(axis.end ?? null);
          }
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
  refreshFormulaSourceTexts(context?: FormulaRenderContext, crossSheetOnly = false) {
    const renderContext: FormulaRenderContext = {
      ...context,
      rowLabelPathsByIndex: Array.from({ length: this.rowCount }, (_, rowIndex) =>
        rowIndex >= this.bodyStart ? (this.rowPaths[rowIndex - this.bodyStart] ?? "").split(".") : [],
      ),
      colLabelsByIndex: this.colLabels,
    };
    for (let rAbs = 0; rAbs < this.rowCount; rAbs += 1) {
      for (let c = 0; c < this.colCount; c += 1) {
        const cell = this.cells[rAbs][c];
        if (!cell.body.valid || cell.body.kind !== "formula") {
          continue;
        }
        if (crossSheetOnly) {
          let hasCrossSheet = false;
          walkExpressionReferences(cell.body.expression, ref => { if (ref.sheetSelector) hasCrossSheet = true; });
          if (!hasCrossSheet) continue;
        }
        const exprText =
          renderFormulaExpression(cell.body.expression, this.rowIdToIndex, this.colIdToIndex, renderContext) ?? cell.body.expressionText;
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

function moveContiguousSegment<T>(items: T[], start: number, count: number, targetGapIndex: number): boolean {
  if (targetGapIndex === start) return false;
  const segment = items.splice(start, count);
  items.splice(targetGapIndex, 0, ...segment);
  return true;
}

function padArray<T>(items: T[], length: number, value: T): void {
  while (items.length < length) {
    items.push(value);
  }
}

function buildIdRemap(sourceIds: number[], newIds: number[]): Map<number, number> {
  const remap = new Map<number, number>();
  sourceIds.forEach((sourceId, index) => {
    const newId = newIds[index];
    if (newId === undefined) {
      throw new Error("duplicate ID remap length mismatch");
    }
    remap.set(sourceId, newId);
  });
  return remap;
}

function cloneCellStateForDuplicate(
  cell: CellState,
  rowIdRemap: Map<number, number>,
  colIdRemap: Map<number, number>,
): CellState {
  const cloned = structuredClone(cell) as CellState;
  cloned.cachedValue = null;
  cloned.dirty = true;
  if (cloned.body.valid && cloned.body.kind === "formula") {
    remapDuplicateExpressionSelectors(cloned.body.expression, rowIdRemap, colIdRemap);
  }
  return cloned;
}

function remapDuplicateExpressionSelectors(
  node: ExprNode | null,
  rowIdRemap: Map<number, number>,
  colIdRemap: Map<number, number>,
): void {
  if (!node) return;
  if (node.kind === "reference") {
    const ref = node.value as ReferenceExpr;
    if (ref.sheetSelector) return;
    ref.rowSelector = remapDuplicateSelector(ref.rowSelector, rowIdRemap);
    ref.colSelector = remapDuplicateSelector(ref.colSelector, colIdRemap);
    return;
  }
  if (node.kind === "call") {
    const call = node.value as { args: ExprNode[] };
    call.args.forEach((arg) => remapDuplicateExpressionSelectors(arg, rowIdRemap, colIdRemap));
    return;
  }
  if (node.kind === "array") {
    const array = node.value as { rows: ExprNode[][] };
    array.rows.forEach((row) => row.forEach((element) => remapDuplicateExpressionSelectors(element, rowIdRemap, colIdRemap)));
    return;
  }
  if (node.kind === "index") {
    const index = node.value as {
      target: ExprNode;
      axes: Array<{ kind: string; value?: ExprNode; start?: ExprNode | null; end?: ExprNode | null }>;
    };
    remapDuplicateExpressionSelectors(index.target, rowIdRemap, colIdRemap);
    index.axes.forEach((axis) => {
      if (axis.kind === "scalar") {
        remapDuplicateExpressionSelectors(axis.value ?? null, rowIdRemap, colIdRemap);
      } else {
        remapDuplicateExpressionSelectors(axis.start ?? null, rowIdRemap, colIdRemap);
        remapDuplicateExpressionSelectors(axis.end ?? null, rowIdRemap, colIdRemap);
      }
    });
    return;
  }
  if (node.kind === "unary") {
    remapDuplicateExpressionSelectors(node.right ?? null, rowIdRemap, colIdRemap);
    return;
  }
  if (node.kind === "binary") {
    remapDuplicateExpressionSelectors(node.left ?? null, rowIdRemap, colIdRemap);
    remapDuplicateExpressionSelectors(node.right ?? null, rowIdRemap, colIdRemap);
  }
}

function remapDuplicateSelector(selector: RefSelector, idRemap: Map<number, number>): RefSelector {
  if (selector.kind === "range") {
    const [startSel, endSel] = selector.value as [RefSelector | null, RefSelector | null];
    if (
      isStructurallyBoundSelector(startSel) &&
      isStructurallyBoundSelector(endSel) &&
      idRemap.has(Number(startSel.value)) &&
      idRemap.has(Number(endSel.value))
    ) {
      return {
        kind: "range",
        value: [
          remapBoundSelector(startSel, idRemap),
          remapBoundSelector(endSel, idRemap),
        ],
      };
    }
    return selector;
  }
  if (isStructurallyBoundSelector(selector)) {
    return remapBoundSelector(selector, idRemap);
  }
  return selector;
}

function isStructurallyBoundSelector(selector: RefSelector | null): selector is RefSelector {
  return selector?.kind === "absolute_id" || selector?.kind === "label_id";
}

function remapBoundSelector(selector: RefSelector, idRemap: Map<number, number>): RefSelector {
  const nextId = idRemap.get(Number(selector.value));
  if (nextId === undefined) {
    return selector;
  }
  return { kind: selector.kind, value: nextId };
}

function cloneHistoryValue<T>(value: T): T {
  return structuredClone(value);
}

function copySheetHistoryReferenceMetadata(source: SheetHistorySnapshot, target: SheetHistorySnapshot): void {
  source.cells.forEach((row, rAbs) => {
    row.forEach((cell, c) => {
      const sourceBody = cell.body;
      const targetBody = target.cells[rAbs]?.[c]?.body;
      if (
        !sourceBody.valid ||
        sourceBody.kind !== "formula" ||
        !targetBody?.valid ||
        targetBody.kind !== "formula"
      ) {
        return;
      }
      copyExpressionReferenceMetadata(sourceBody.expression, targetBody.expression);
    });
  });
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
    output[c] = parseDisplayControlCell(raw);
  }
  return output;
}

function extractRowDisplayMetadata(
  logicalRows: ParsedRow[],
  bodyStart: number,
  headerColCount: number,
): Array<ParsedDisplayMetadata | null> {
  const output: Array<ParsedDisplayMetadata | null> = Array.from({ length: logicalRows.length }, () => null);
  for (let rAbs = 0; rAbs < logicalRows.length; rAbs += 1) {
    const row = logicalRows[rAbs];
    const control = row.displayControl?.trim() ?? "";
    if (rAbs < bodyStart) {
      if (control) throw new Error("Row display defaults require a body row.");
      continue;
    }
    const label = headerColCount > 0 ? parseCellInput(row.rawCells[0] ?? "").localDisplay : null;
    if (control) {
      if (label) throw new Error("Row display defaults must have a single source: control cell or label.");
      output[rAbs] = parseDisplayControlCell(control);
    } else output[rAbs] = label;
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

function assignSheetIds(sheets: SheetState[]): number {
  let nextSheetId = 1;
  for (const sheet of sheets) {
    sheet.sheetId = nextSheetId;
    nextSheetId += 1;
  }
  return nextSheetId;
}

function validateSheetIdentityState(sheets: SheetState[], nextSheetId: number): void {
  if (!Number.isInteger(nextSheetId) || nextSheetId < 1) {
    throw new Error("nextSheetId must be a positive integer");
  }

  const seen = new Set<number>();
  for (const sheet of sheets) {
    if (!Number.isInteger(sheet.sheetId) || sheet.sheetId < 1) {
      throw new Error("sheetId must be a positive integer");
    }
    if (seen.has(sheet.sheetId)) {
      throw new Error(`duplicate sheetId ${sheet.sheetId}`);
    }
    seen.add(sheet.sheetId);
    if (sheet.sheetId >= nextSheetId) {
      throw new Error("nextSheetId must be greater than every existing sheetId");
    }
  }
}

export class DocumentState {
  readonly frontMatter: string | null;
  sheets: SheetState[];
  nextSheetId: number;

  constructor(sheets: SheetState[], nextSheetId?: number, frontMatter: string | null = null) {
    this.frontMatter = frontMatter;
    this.sheets = sheets;
    if (nextSheetId !== undefined) {
      this.nextSheetId = nextSheetId;
      validateSheetIdentityState(this.sheets, this.nextSheetId);
    } else {
      this.nextSheetId = assignSheetIds(this.sheets);
    }
  }

  // Build a document state from text.
  static fromText(text: string): DocumentState {
    const { frontMatter, sheets: parsed } = parseDocument(text);
    const sheets: SheetState[] = [];
    let nextSheetId = 1;
    for (const sheet of parsed) {
      const sourceBlocks: PreservedSheetBlock[] = sheet.blocks.map((block) => {
        if (block.kind === "table") {
          return { kind: "table", lines: [...block.table.rows] };
        }
        return structuredClone(block);
      });
      const primaryTableBlockIndex = sourceBlocks.findIndex((b) => b.kind === "table");
      const primaryBlock = sourceBlocks[primaryTableBlockIndex];
      const primaryRows =
        primaryBlock?.kind === "table"
          ? [...primaryBlock.lines]
          : [];
      sheets.push(
        SheetState.fromTableRows(
          sheet.name,
          primaryRows,
          sourceBlocks,
          primaryTableBlockIndex === -1 ? null : primaryTableBlockIndex,
          nextSheetId,
        ),
      );
      nextSheetId += 1;
    }
    const document = new DocumentState(sheets, nextSheetId, frontMatter);
    document.bindCrossSheetFormulas();
    return document;
  }

  bindCrossSheetFormulas(): void {
    for (const sheet of this.sheets) {
      for (let rAbs = 0; rAbs < sheet.rowCount; rAbs += 1) {
        for (let c = 0; c < sheet.colCount; c += 1) {
          const cell = sheet.cells[rAbs][c];
          if (!cell.body.valid || cell.body.kind !== "formula") continue;
          walkExpressionReferences(cell.body.expression, (ref) => {
            if (!ref.sheetSelector) return;
            const target = this.resolveSheetForFormulaReference(ref);
            if (!target) return;
            setBoundSheetId(ref.sheetSelector, target.sheetId);
            ref.sheetSelector.value = target.name;
            ref.rowSelector = structurallyBindSelector(ref.rowSelector, "row", target.rowIds, target.rowMap);
            ref.colSelector = structurallyBindSelector(ref.colSelector, "col", target.colIds, target.colMap);
          });
        }
      }
    }
    this.refreshCrossSheetFormulaSources();
  }

  refreshCrossSheetFormulaSources(): void {
    const context = buildFormulaRenderContext(this);
    for (const sheet of this.sheets) sheet.refreshFormulaSourceTexts(context, true);
  }

  // Evaluate the current state into an EvaluationResult.
  evaluate(): EvaluationResult {
    this.bindCrossSheetFormulas();
    const states = new Map<string, string>();
    const memo = new Map<string, RuntimeValue>();

    const evalCell = (sheetIndex: number, rAbs: number, c: number): RuntimeValue => {
      const sheet = this.sheets[sheetIndex];
      if (!sheet) {
        return makeInternalError("unresolved_reference_sheet", { sheetIndex });
      }
      const key = `${sheet.sheetId}:${rAbs},${c}`;
      const state = states.get(key);
      if (state === "visiting") {
        return makeInternalError("cycle");
      }
      if (state === "done") {
        return memo.get(key) ?? { kind: "blank", value: null };
      }

      states.set(key, "visiting");
      const cell = rAbs >= 0 && rAbs < sheet.rowCount && c >= 0 && c < sheet.colCount ? sheet.cells[rAbs][c] : null;
      const body = cell?.body;

      let value: RuntimeValue;
      if (!body) {
        value = { kind: "blank", value: null };
      } else if (!body.valid) {
        value = runtimeErrorFromDiagnostic(body.issue);
      } else if (body.kind === "literal") {
        value = body.literal;
      } else {
        const crossSheetResolver: CrossSheetResolver = (ref, rowIdx, colIdx) =>
          this.resolveCrossSheetExpressionValue(ref, rowIdx, colIdx, evalCell);
        value = evalExpr(
          body.expression,
          rAbs,
          c,
          (rDep, cDep) => evalCell(sheetIndex, rDep, cDep),
          sheet.rowMap,
          sheet.colMap,
          sheet.rowCount,
          sheet.colCount,
          sheet.bodyStart,
          sheet.bodyRowCount,
          sheet.dataRowIndices,
          sheet.dataColIndices,
          sheet.rowIdToIndex,
          sheet.colIdToIndex,
          crossSheetResolver,
        );
      }

      if (cell) {
        cell.cachedValue = value;
        cell.dirty = false;
      }
      states.set(key, "done");
      memo.set(key, value);
      return value;
    };

    const sheetEvals: SheetEvaluation[] = this.sheets.map((sheet, sheetIndex) => {
      const values: RuntimeValue[][] = [];
      for (let rAbs = sheet.bodyStart; rAbs < sheet.rowCount; rAbs += 1) {
        values.push(Array.from({ length: sheet.colCount }, (_, c) => evalCell(sheetIndex, rAbs, c)));
      }
      return {
        name: sheet.name,
        rowPaths: sheet.rowPaths,
        colLabels: sheet.colLabels,
        values,
      };
    });
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
    this.editSheetStructure(sheetName, sheet => sheet.insertRow(rowIndex, eager, labelRaw));
  }

  insertHeaderRow(sheetName: string, rowIndex: number, eager = true, labelRaw = "") {
    this.editSheetStructure(sheetName, sheet => sheet.insertHeaderRow(rowIndex, eager, labelRaw));
  }

  // Delete a row from a sheet (tentative RFC-0012 behavior).
  deleteRow(sheetName: string, rowIndex: number, eager = true) {
    this.editSheetStructure(sheetName, sheet => sheet.deleteRow(rowIndex, eager));
  }

  deleteHeaderRow(sheetName: string, rowIndex: number, eager = true) {
    this.editSheetStructure(sheetName, sheet => sheet.deleteHeaderRow(rowIndex, eager));
  }

  deleteRows(sheetName: string, rowIndex: number, count: number, eager = true) {
    this.editSheetStructure(sheetName, sheet => sheet.deleteRows(rowIndex, count, eager));
  }

  // Insert a blank column into a sheet (tentative RFC-0012 behavior).
  insertCol(sheetName: string, colIndex: number, eager = true) {
    this.editSheetStructure(sheetName, sheet => sheet.insertCol(colIndex, eager));
  }

  // Delete a column from a sheet (tentative RFC-0012 behavior).
  deleteCol(sheetName: string, colIndex: number, eager = true) {
    this.editSheetStructure(sheetName, sheet => sheet.deleteCol(colIndex, eager));
  }

  // Rename a row label in a sheet (tentative RFC-0012 behavior).
  renameRowLabel(sheetName: string, rowPath: string, newLabel: string, eager = true) {
    this.editSheetStructure(sheetName, sheet => sheet.renameRowLabel(rowPath, newLabel, eager));
  }

  // Rename a column label in a sheet (tentative RFC-0012 behavior).
  renameColLabel(sheetName: string, oldLabel: string, newLabel: string, eager = true) {
    this.editSheetStructure(sheetName, sheet => sheet.renameColLabel(oldLabel, newLabel, eager));
  }

  private editSheetStructure(sheetName: string, edit: (sheet: SheetState) => void): void {
    const sheet = this.findSheet(sheetName);
    // Bind any newly entered cross-sheet positions before identities move.
    // Source text is part of the editor/fill contract, even with eager=false;
    // callers must not need an unrelated evaluate/serialize to refresh it.
    this.bindCrossSheetFormulas();
    edit(sheet);
    this.bindCrossSheetFormulas();
  }

  private findSheet(name: string): SheetState {
    const sheet = this.sheets.find((s) => s.name === name);
    if (!sheet) {
      throw new Error(`unknown sheet '${name}'`);
    }
    return sheet;
  }

  private resolveSheetForFormulaReference(ref: ReferenceExpr): SheetState | null {
    if (!ref.sheetSelector) return null;
    const boundSheetId = getBoundSheetId(ref.sheetSelector);
    if (boundSheetId !== null) {
      return this.sheets.find((candidate) => candidate.sheetId === boundSheetId) ?? null;
    }
    const matches = this.sheets.filter((candidate) => candidate.name === ref.sheetSelector?.value);
    return matches.length === 1 ? matches[0] : null;
  }

  private resolveCrossSheetExpressionValue(
    ref: ReferenceExpr,
    rowIdx: number,
    colIdx: number,
    evalCell: (sheetIndex: number, r: number, c: number) => RuntimeValue,
  ): ExpressionValue | null {
    if (!ref.sheetSelector) return null;
    const boundSheetId = getBoundSheetId(ref.sheetSelector);
    let targetIndex = -1;
    if (boundSheetId !== null) {
      targetIndex = this.sheets.findIndex((candidate) => candidate.sheetId === boundSheetId);
      if (targetIndex < 0) {
        return makeInternalError("unresolved_reference_sheet", { sheet: ref.sheetSelector.value, sheetId: boundSheetId });
      }
    } else {
      const matches: number[] = [];
      this.sheets.forEach((candidate, index) => {
        if (candidate.name === ref.sheetSelector?.value) matches.push(index);
      });
      if (matches.length === 0) {
        return makeInternalError("unresolved_reference_sheet", { sheet: ref.sheetSelector.value });
      }
      if (matches.length > 1) {
        return makeInternalError("ambiguous_reference_sheet", { sheet: ref.sheetSelector.value });
      }
      targetIndex = matches[0];
      setBoundSheetId(ref.sheetSelector, this.sheets[targetIndex].sheetId);
    }

    const target = this.sheets[targetIndex];
    const resolved = selectViewDetailed(
      ref,
      rowIdx,
      colIdx,
      target.rowMap,
      target.colMap,
      target.rowCount,
      target.colCount,
      target.bodyStart,
      target.bodyRowCount,
      target.dataRowIndices,
      target.dataColIndices,
      target.rowIdToIndex,
      target.colIdToIndex,
    );
    if (!resolved.ok) {
      return makeInternalError(resolved.internalKind, resolved.context);
    }
    return materializeViewSelection(resolved.view, (r, c) => evalCell(targetIndex, r, c));
  }
}

// Expose separator check for test helpers.
