import { parseDocument, parseTableRow, type ParsedRow } from "./parser";
import { parseCellInput } from "./runtime/parse";
import {
  buildBodyRows,
  buildRowKeys,
  computeDataRowIndices,
  evalExpr,
  headerColCountFrom,
  headerRowCountFrom,
  selectView,
  separatorRowIndex,
} from "./runtime/eval";
import {
  type EvaluationResult,
  type ExprNode,
  type ParsedCell,
  type RuntimeValue,
  type SheetEvaluation,
  type ViewSelection,
} from "./runtime/types";

export enum ChangeKind {
  VALUE = "value",
  CLEAR = "clear",
  LABEL = "label",
  STRUCTURAL = "structural",
  SHEET = "sheet",
}

interface CellState {
  text: string;
  parsed: ParsedCell;
  value: RuntimeValue | null;
  dirty: boolean;
}

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
  viewDependencies: Map<number, ViewSelection>;
  viewFormulas: Map<number, [number, number]>;
  viewRowIndex: Map<number, Set<number>>;
  viewColIndex: Map<number, Set<number>>;
  formulaViewIds: Map<string, Set<number>>;
  nextViewId: number;

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
    this.viewDependencies = new Map();
    this.viewFormulas = new Map();
    this.viewRowIndex = new Map();
    this.viewColIndex = new Map();
    this.formulaViewIds = new Map();
    this.nextViewId = 1;
  }

  // Build a SheetState from raw table rows.
  static fromTableRows(name: string, rows: string[]): SheetState {
    const parsedRows = rows.map((r) => parseTableRow(r));
    const sepIndex = separatorRowIndex(parsedRows);
    const logicalRows = parsedRows.filter((_, idx) => idx !== sepIndex);

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
      );
    }

    const colCount = logicalRows.reduce((m, r) => Math.max(m, r.cells.length), 0);
    const headerRowCount = headerRowCountFrom(parsedRows);
    const headerColCount = headerColCountFrom(logicalRows);
    const bodyStart = headerRowCount > 0 ? headerRowCount : 0;

    const headerLabels = headerRowCount > 0 ? logicalRows[headerRowCount - 1].cells : [];
    const colLabels: string[] = [];
    for (let c = 0; c < colCount; c += 1) {
      if (c < headerLabels.length && headerLabels[c] !== "") {
        colLabels.push(headerLabels[c]);
      } else {
        colLabels.push(`C${c + 1}`);
      }
    }

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

    const colMap = new Map<string, number[]>();
    colLabels.forEach((label, idx) => {
      const list = colMap.get(label) ?? [];
      list.push(idx);
      colMap.set(label, list);
    });

    const bodyRowCount = logicalRows.length - bodyStart;
    const dataRowIndices = computeDataRowIndices(logicalRows, bodyStart);
    const dataColIndices = Array.from({ length: colCount - headerColCount }, (_, i) => i + headerColCount);

    const rowIds = Array.from({ length: logicalRows.length }, (_, i) => i + 1);
    const colIds = Array.from({ length: colCount }, (_, i) => i + 1);

    const cells: CellState[][] = [];
    for (const row of logicalRows) {
      const rowCells: CellState[] = [];
      const trimmed = [...row.cells];
      if (trimmed.length < colCount) {
        trimmed.push(...Array(colCount - trimmed.length).fill(""));
      }
      for (const value of trimmed) {
        const parsed = parseCellInput(value);
        rowCells.push({ text: value, parsed, value: null, dirty: true });
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
    cell.text = text;
    cell.parsed = this.bindParsedCell(parseCellInput(text));
    cell.dirty = true;
    cell.value = null;

    this.updateRowText(rAbs, c, text);

    if (kind === ChangeKind.VALUE || kind === ChangeKind.CLEAR) {
      this.updateDependenciesForCell(rAbs, c);
      this.markDirtyFrom([rAbs, c]);
    } else if (kind === ChangeKind.LABEL || kind === ChangeKind.STRUCTURAL || kind === ChangeKind.SHEET) {
      this.rebuildMetadata();
      this.markAllDirty();
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

  // Bind absolute selectors to stable IDs (tentative RFC-0012 behavior).
  private bindParsedCell(parsed: ParsedCell): ParsedCell {
    if (parsed.kind !== "formula" || !parsed.expression) {
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

    walk(parsed.expression);
    return parsed;
  }

  // Bind all formulas to stable IDs after initial parse (tentative RFC-0012 behavior).
  private bindAllFormulas() {
    for (let rAbs = 0; rAbs < this.cells.length; rAbs += 1) {
      for (let c = 0; c < this.cells[rAbs].length; c += 1) {
        const cell = this.cells[rAbs][c];
        cell.parsed = this.bindParsedCell(cell.parsed);
      }
    }
  }

  // Insert a blank row at a logical row index (tentative RFC-0012 behavior).
  insertRow(rowIndex: number, eager = true) {
    if (rowIndex < this.bodyStart) {
      throw new Error("header row insertion is not supported (tentative)");
    }
    if (rowIndex < 0 || rowIndex > this.rowCount) {
      throw new Error("row index out of range");
    }

    const boundary = this.logicalRows.length > 0 ? this.logicalRows[0].boundary : null;
    const rawCells = Array.from({ length: this.colCount }, () => " ");
    const cells = Array.from({ length: this.colCount }, () => "");
    const newRow: ParsedRow = { rawCells, cells, boundary, errors: [] };
    this.logicalRows.splice(rowIndex, 0, newRow);

    const newCellStates: CellState[] = rawCells.map((text) => ({
      text,
      parsed: this.bindParsedCell(parseCellInput(text)),
      value: null,
      dirty: true,
    }));
    this.cells.splice(rowIndex, 0, newCellStates);
    this.rowIds.splice(rowIndex, 0, this.nextRowId);
    this.nextRowId += 1;

    this.rebuildMetadata();
    this.markAllDirty();
    if (eager) {
      this.recalculate();
    }
  }

  // Delete a row at a logical row index (tentative RFC-0012 behavior).
  deleteRow(rowIndex: number, eager = true) {
    if (rowIndex < this.bodyStart) {
      throw new Error("header row deletion is not supported (tentative)");
    }
    if (rowIndex < 0 || rowIndex >= this.rowCount) {
      throw new Error("row index out of range");
    }
    this.logicalRows.splice(rowIndex, 1);
    this.cells.splice(rowIndex, 1);
    this.rowIds.splice(rowIndex, 1);
    this.rebuildMetadata();
    this.markAllDirty();
    if (eager) {
      this.recalculate();
    }
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
      row.rawCells.splice(colIndex, 0, " ");
      row.cells.splice(colIndex, 0, "");
    }
    for (const rowCells of this.cells) {
      rowCells.splice(colIndex, 0, {
        text: " ",
        parsed: this.bindParsedCell(parseCellInput(" ")),
        value: null,
        dirty: true,
      });
    }
    this.colIds.splice(colIndex, 0, this.nextColId);
    this.nextColId += 1;

    this.rebuildMetadata();
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

    this.rebuildMetadata();
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
      cellState.text = row.rawCells[0];
      cellState.parsed = this.bindParsedCell(parseCellInput(row.rawCells[0]));
      cellState.value = null;
      cellState.dirty = true;
    }

    this.rebuildMetadata();
    this.markAllDirty();

    const newPath = [...parentParts, newLabel].join(".");
    this.applyRowAlias(rowPath, newPath);

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
      cellState.text = newLabel;
      cellState.parsed = this.bindParsedCell(parseCellInput(newLabel));
      cellState.value = null;
      cellState.dirty = true;
    }

    this.rebuildMetadata();
    this.markAllDirty();
    this.applyColAlias(oldLabel, newLabel);

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
      return { kind: "error", value: "cycle" };
    }
    const cell = this.cells[rAbs][c];
    if (state === "done") {
      return cell.value ?? { kind: "blank", value: null };
    }
    if (!cell.dirty && cell.value !== null) {
      return cell.value;
    }

    states.set(key, "visiting");
    const parsedCell = cell.parsed;

    let value: RuntimeValue;
    if (parsedCell.kind === "literal") {
      value = parsedCell.literal ?? { kind: "blank", value: null };
    } else {
      value = evalExpr(
        parsedCell.expression,
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

    cell.value = value;
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
    if (cell.parsed.kind !== "formula") return [];
    const expr = cell.parsed.expression;
    if (!expr) return [];
    const views: ViewSelection[] = [];

    const walk = (node: ExprNode | null) => {
      if (!node) return;
      if (node.kind === "reference") {
        const view = selectView(
          node.value,
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
    const headerLabels = this.headerRowCount > 0 ? this.logicalRows[this.headerRowCount - 1].cells : [];
    const colLabels: string[] = [];
    for (let c = 0; c < colCount; c += 1) {
      if (c < headerLabels.length && headerLabels[c] !== "") {
        colLabels.push(headerLabels[c]);
      } else {
        colLabels.push(`C${c + 1}`);
      }
    }
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

    const colMap = new Map<string, number[]>();
    colLabels.forEach((label, idx) => {
      const list = colMap.get(label) ?? [];
      list.push(idx);
      colMap.set(label, list);
    });
    this.colMap = colMap;

    this.dataRowIndices = computeDataRowIndices(this.logicalRows, this.bodyStart);
    this.dataColIndices = Array.from({ length: colCount - this.headerColCount }, (_, i) => i + this.headerColCount);
    this.rowCount = this.logicalRows.length;
    this.bodyRowCount = this.rowCount - this.bodyStart;
    this.rowIdToIndex = buildIdIndexMap(this.rowIds);
    this.colIdToIndex = buildIdIndexMap(this.colIds);

    this.rebuildDependencies();
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
        this.cells[rAbs][c].value = null;
      }
    }
  }
}

function buildIdIndexMap(ids: number[]): Map<number, number> {
  const map = new Map<number, number>();
  ids.forEach((id, idx) => map.set(id, idx));
  return map;
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
      if (sheet.table) {
        sheets.push(SheetState.fromTableRows(sheet.name, sheet.table.rows));
      } else {
        sheets.push(SheetState.fromTableRows(sheet.name, []));
      }
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
  insertRow(sheetName: string, rowIndex: number, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.insertRow(rowIndex, eager);
  }

  // Delete a row from a sheet (tentative RFC-0012 behavior).
  deleteRow(sheetName: string, rowIndex: number, eager = true) {
    const sheet = this.findSheet(sheetName);
    sheet.deleteRow(rowIndex, eager);
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
