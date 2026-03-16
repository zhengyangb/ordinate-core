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
      dataRowIndices,
      dataColIndices,
      logicalRows,
      cells,
    );
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
    cell.parsed = parseCellInput(text);
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

    this.rebuildDependencies();
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

  private findSheet(name: string): SheetState {
    const sheet = this.sheets.find((s) => s.name === name);
    if (!sheet) {
      throw new Error(`unknown sheet '${name}'`);
    }
    return sheet;
  }
}

// Expose separator check for test helpers.
