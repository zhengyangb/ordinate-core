import { ChangeKind, DocumentState, SheetState, type SheetHistorySnapshot } from "./incremental";
import { parseCellInput, splitCellDisplayMetadata } from "./runtime";
import type { FormatSpec, StylePatch } from "./runtime/types";
import { copyExpressionReferenceMetadata } from "./runtime/references";
import { assertInteger, CoreEditFailure, type CoreEditErrorCategory } from "./core_edit_common";
import {
  applyDeleteRowEdit,
  applyInsertRowEdit,
  type CoreDeleteRowEdit,
  type CoreInsertRowEdit,
} from "./core_edit_rows";
import {
  applyDuplicateColumnsEdit,
  applyDuplicateRowsEdit,
  applyMoveColumnsEdit,
  applyMoveRowsEdit,
  type CoreDuplicateColumnsEdit,
  type CoreDuplicateRowsEdit,
  type CoreMoveColumnsEdit,
  type CoreMoveRowsEdit,
} from "./core_edit_axis";
import { resolveSheetRowStructure } from "./row_structure";
import { applyFillRegion, type CoreFillMode } from "./core_fill";
import { isImplicitTextInput } from "./runtime/parse";
import { cloneDocumentState } from "./document_clone";
import { SheetNoteError, type SheetNotePosition } from "./sheet_notes";
import { convertRowsToNote } from "./core_note_rows";

export interface CoreEditError {
  category: CoreEditErrorCategory;
  message: string;
  editIndex: number;
  op: CoreEdit["op"];
}

export type CoreCellTarget =
  | {
      kind: "index";
      sheet: string;
      rowIndex: number;
      colIndex: number;
    }
  | {
      kind: "label";
      sheet: string;
      rowPath: string | string[];
      colLabel: string;
    };

export type CoreCellHandle = {
  sheet: string;
  rowId: number;
  colId: number;
};

export type CoreRegionTarget = {
  sheet: string;
  start: { rowId: number; colId: number };
  end: { rowId: number; colId: number };
};

export type CoreInsertSheetEdit = {
  op: "insert_sheet";
  name: string;
  sheetIndex: number;
};

export type CoreDeleteSheetEdit = {
  op: "delete_sheet";
  sheet: string;
};

export type CoreMoveSheetEdit = {
  op: "move_sheet";
  sheet: string;
  targetGapIndex: number;
};

export type CoreRenameSheetEdit = {
  op: "rename_sheet";
  sheet: string;
  newName: string;
};

export type CoreEdit =
  | { op: "set_sheet_note"; sheet: string; position: SheetNotePosition; markdown: string }
  | { op: "convert_rows_to_note"; sheet: string; rowIds: number[] }
  | { op: "set_cell_input"; target: CoreCellTarget; input: string }
  | { op: "clear_cell"; target: CoreCellTarget }
  | { op: "set_cell_local_format"; target: CoreCellTarget; format: FormatSpec | null }
  | { op: "clear_cell_local_format"; target: CoreCellTarget }
  | { op: "set_cell_local_style"; target: CoreCellTarget; style: StylePatch }
  | { op: "clear_cell_local_style"; target: CoreCellTarget }
  | { op: "set_column_default_format"; sheet: string; colId: number; format: FormatSpec | null }
  | { op: "clear_column_default_format"; sheet: string; colId: number }
  | { op: "set_column_default_style"; sheet: string; colId: number; style: StylePatch }
  | { op: "clear_column_default_style"; sheet: string; colId: number }
  | { op: "set_row_default_format"; sheet: string; rowId: number; format: FormatSpec | null }
  | { op: "clear_row_default_format"; sheet: string; rowId: number }
  | { op: "set_row_default_style"; sheet: string; rowId: number; style: StylePatch }
  | { op: "clear_row_default_style"; sheet: string; rowId: number }
  | { op: "set_region"; target: CoreRegionTarget; values: string[][] }
  | { op: "fill_region"; source: CoreRegionTarget; target: CoreRegionTarget; mode: CoreFillMode; excludedRowIds?: number[] }
  | { op: "clear_region"; target: CoreRegionTarget }
  | { op: "convert_rows_to_header"; sheet: string; rowIds: number[] }
  | { op: "convert_rows_to_body"; sheet: string; rowIds: number[]; depth: number }
  | { op: "set_header_columns"; sheet: string; count: number }
  | CoreRenameSheetEdit
  | CoreInsertSheetEdit
  | CoreDeleteSheetEdit
  | CoreMoveSheetEdit
  | CoreInsertRowEdit
  | CoreDeleteRowEdit
  | CoreMoveColumnsEdit
  | CoreMoveRowsEdit
  | CoreDuplicateColumnsEdit
  | CoreDuplicateRowsEdit
  | { op: "insert_column"; sheet: string; colIndex: number }
  | { op: "delete_column"; sheet: string; colIndex: number };

export interface ApplyBatchAtomicOptions {
  recalculate?: boolean;
}

export type { CoreEditErrorCategory } from "./core_edit_common";

export type CoreEditHistoryDirection = "undo" | "redo";

interface CoreSheetHistoryEntry {
  kind: "sheet";
  op: CoreEdit["op"];
  editIndex: number;
  before: SheetHistorySnapshot;
  after: SheetHistorySnapshot;
  beforeSignature: string;
  afterSignature: string;
}

interface CoreDocumentHistorySnapshot {
  nextSheetId: number;
  sheets: SheetHistorySnapshot[];
}

interface CoreDocumentHistoryEntry {
  kind: "document";
  op: CoreEdit["op"];
  editIndex: number;
  before: CoreDocumentHistorySnapshot;
  after: CoreDocumentHistorySnapshot;
  beforeSignature: string;
  afterSignature: string;
}

type CoreEditHistoryEntry = CoreSheetHistoryEntry | CoreDocumentHistoryEntry;

interface CoreEditHistoryMementoInternal {
  kind: "core_edit_history_memento";
  entryCount: number;
  entries: CoreEditHistoryEntry[];
}

export interface CoreEditHistoryMemento {
  kind: "core_edit_history_memento";
  entryCount: number;
  entries: readonly unknown[];
}

export interface CoreAffectedFormulaCell {
  sheet: string;
  rowId: number;
  colId: number;
  rowIndex: number;
  colIndex: number;
}

export interface CoreDeleteRowPreview {
  sheet: string;
  deletedRowCount: number;
  affectedFormulaCellCount: number;
  affectedFormulaCells: CoreAffectedFormulaCell[];
}

export interface CoreDeleteColumnPreview {
  sheet: string;
  deletedColumnCount: number;
  affectedFormulaCellCount: number;
  affectedFormulaCells: CoreAffectedFormulaCell[];
}

export type ApplyBatchAtomicResult =
  | { ok: true; nextDocument: DocumentState }
  | { ok: false; error: CoreEditError };

export type ApplyBatchWithUndoResult =
  | { ok: true; nextDocument: DocumentState; memento: CoreEditHistoryMemento }
  | { ok: false; error: CoreEditError };

export type ApplyCoreEditMementoResult =
  | { ok: true; nextDocument: DocumentState }
  | { ok: false; error: CoreEditError };

export function applyBatchAtomic(
  document: DocumentState,
  edits: CoreEdit[],
  options?: ApplyBatchAtomicOptions,
): ApplyBatchAtomicResult {
  const staged = cloneDocumentState(document);

  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];
    try {
      applyCoreEditToStaged(staged, edit);
    } catch (error) {
      if (error instanceof CoreEditFailure) {
        return {
          ok: false,
          error: {
            category: error.category,
            message: error.message,
            editIndex: i,
            op: edit.op,
          },
        };
      }
      if (error instanceof Error) {
        return {
          ok: false,
          error: {
            category: "invalid_operation",
            message: error.message,
            editIndex: i,
            op: edit.op,
          },
        };
      }
      return {
        ok: false,
        error: {
          category: "invalid_operation",
          message: String(error),
          editIndex: i,
          op: edit.op,
        },
      };
    }
  }

  if (options?.recalculate === true) {
    staged.evaluate();
  }

  return { ok: true, nextDocument: staged };
}

export function applyBatchWithUndo(
  document: DocumentState,
  edits: CoreEdit[],
  options?: ApplyBatchAtomicOptions,
): ApplyBatchWithUndoResult {
  const staged = cloneDocumentState(document);
  const entries: CoreEditHistoryEntry[] = [];

  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];
    try {
      if (isDocumentHistoryEdit(edit)) {
        const before = captureDocumentHistorySnapshot(staged);
        const beforeSignature = documentSnapshotSignature(before);
        applyCoreEditToStaged(staged, edit);
        const after = captureDocumentHistorySnapshot(staged);
        const afterSignature = documentSnapshotSignature(after);
        if (beforeSignature !== afterSignature) {
          entries.push({
            kind: "document",
            op: edit.op,
            editIndex: i,
            before,
            after,
            beforeSignature,
            afterSignature,
          });
        }
      } else {
        const sheet = resolveSheet(staged, sheetNameForEdit(edit));
        const before = sheet.captureHistorySnapshot();
        const beforeSignature = sheetSnapshotSignature(before);
        applyCoreEditToStaged(staged, edit);
        const after = sheet.captureHistorySnapshot();
        const afterSignature = sheetSnapshotSignature(after);
        if (beforeSignature !== afterSignature) {
          entries.push({
            kind: "sheet",
            op: edit.op,
            editIndex: i,
            before,
            after,
            beforeSignature,
            afterSignature,
          });
        }
      }
    } catch (error) {
      return { ok: false, error: coreEditErrorFromCaught(error, i, edit.op) };
    }
  }

  if (options?.recalculate === true) {
    staged.evaluate();
  }

  const memento: CoreEditHistoryMementoInternal = {
    kind: "core_edit_history_memento",
    entryCount: entries.length,
    entries,
  };
  return { ok: true, nextDocument: staged, memento };
}

export function applyCoreEditMemento(
  document: DocumentState,
  memento: CoreEditHistoryMemento,
  direction: CoreEditHistoryDirection,
  options?: ApplyBatchAtomicOptions,
): ApplyCoreEditMementoResult {
  const internal = asInternalMemento(memento);
  const staged = cloneDocumentState(document);
  const entries = direction === "undo" ? [...internal.entries].reverse() : internal.entries;

  for (const entry of entries) {
    try {
      if (entry.kind === "document") {
        const expectedSignature = direction === "undo" ? entry.afterSignature : entry.beforeSignature;
        const replacement = direction === "undo" ? entry.before : entry.after;
        const currentSignature = documentSnapshotSignature(captureDocumentHistorySnapshot(staged));
        if (currentSignature !== expectedSignature) {
          throw new CoreEditFailure(
            "invalid_operation",
            `cannot ${direction} ${entry.op}: document state does not match the history entry`,
          );
        }
        restoreDocumentHistorySnapshot(staged, replacement);
        bindAfterEdit(staged, entry.op);
      } else {
        const expected = direction === "undo" ? entry.after : entry.before;
        const expectedSignature = direction === "undo" ? entry.afterSignature : entry.beforeSignature;
        const replacement = direction === "undo" ? entry.before : entry.after;
        const sheet = resolveSheetById(staged, expected.sheetId);
        const currentSignature = sheetSnapshotSignature(sheet.captureHistorySnapshot());
        if (currentSignature !== expectedSignature) {
          throw new CoreEditFailure(
            "invalid_operation",
            `cannot ${direction} ${entry.op}: document state does not match the history entry`,
          );
        }
        if (entry.op === "set_sheet_note") {
          // Notes history changes only document content, never calculation state.
          sheet.sourceBlocks = structuredClone(replacement.sourceBlocks);
          sheet.primaryTableBlockIndex = replacement.primaryTableBlockIndex;
        } else sheet.restoreHistorySnapshot(replacement);
        bindAfterEdit(staged, entry.op);
      }
    } catch (error) {
      return { ok: false, error: coreEditErrorFromCaught(error, entry.editIndex, entry.op) };
    }
  }

  if (options?.recalculate === true) {
    staged.evaluate();
  }

  return { ok: true, nextDocument: staged };
}

export function previewDeleteRow(document: DocumentState, edit: CoreDeleteRowEdit): CoreDeleteRowPreview {
  const sheet = resolveSheet(document, edit.sheet);
  assertInteger(edit.rowId, "rowId", fail);
  const mode = edit.mode ?? "node";
  if (mode !== "node" && mode !== "subtree") {
    fail("invalid_operation", `unsupported delete_row mode '${String(edit.mode)}'`);
  }
  const rowIndex = resolveRowId(sheet, edit.rowId, edit.sheet);
  let deletedRowCount = 1;
  if (rowIndex < sheet.bodyStart) {
    if (mode !== "node") {
      fail("invalid_operation", "header row deletion does not support subtree mode");
    }
  } else {
    const bodyRowIndex = rowIndex - sheet.bodyStart;
    deletedRowCount = resolveSheetRowStructure(sheet)[bodyRowIndex]?.subtreeRowCount ?? 1;
    if (mode === "node" && deletedRowCount > 1) {
      fail("invalid_operation", `delete_row requires mode "subtree" for non-leaf rowId ${edit.rowId}`);
    }
    if (mode !== "subtree") {
      deletedRowCount = 1;
    }
  }

  const rowIndices = Array.from({ length: deletedRowCount }, (_, offset) => rowIndex + offset);
  const affectedFormulaCells = collectAffectedFormulaCells(sheet, rowIndices, []);
  return {
    sheet: sheet.name,
    deletedRowCount,
    affectedFormulaCellCount: affectedFormulaCells.length,
    affectedFormulaCells,
  };
}

export function previewDeleteColumn(
  document: DocumentState,
  edit: { sheet: string; colIndex: number },
): CoreDeleteColumnPreview {
  const sheet = resolveSheet(document, edit.sheet);
  assertColumnDeleteIndex(sheet, edit.colIndex);
  const affectedFormulaCells = collectAffectedFormulaCells(sheet, [], [edit.colIndex]);
  return {
    sheet: sheet.name,
    deletedColumnCount: 1,
    affectedFormulaCellCount: affectedFormulaCells.length,
    affectedFormulaCells,
  };
}

function coreEditErrorFromCaught(error: unknown, editIndex: number, op: CoreEdit["op"]): CoreEditError {
  if (error instanceof CoreEditFailure) {
    return {
      category: error.category,
      message: error.message,
      editIndex,
      op,
    };
  }
  if (error instanceof Error) {
    return {
      category: "invalid_operation",
      message: error.message,
      editIndex,
      op,
    };
  }
  return {
    category: "invalid_operation",
    message: String(error),
    editIndex,
    op,
  };
}

function sheetNameForEdit(edit: CoreEdit): string {
  if ("target" in edit) return edit.target.sheet;
  if (
    edit.op === "insert_sheet" ||
    edit.op === "delete_sheet" ||
    edit.op === "move_sheet" ||
    edit.op === "rename_sheet"
  ) {
    throw new CoreEditFailure("invalid_operation", `${edit.op} is a document-level edit`);
  }
  return edit.sheet;
}

function bindAfterEdit(document: DocumentState, op: CoreEdit["op"]): void {
  if (op !== "set_sheet_note") document.bindCrossSheetFormulas();
}

function isDocumentHistoryEdit(edit: CoreEdit): boolean {
  return (
    edit.op === "insert_sheet" ||
    edit.op === "delete_sheet" ||
    edit.op === "move_sheet" ||
    edit.op === "rename_sheet"
  );
}

function asInternalMemento(memento: CoreEditHistoryMemento): CoreEditHistoryMementoInternal {
  if (!memento || memento.kind !== "core_edit_history_memento" || !Array.isArray(memento.entries)) {
    throw new CoreEditFailure("invalid_operation", "invalid core edit history memento");
  }
  return memento as CoreEditHistoryMementoInternal;
}

function sheetSnapshotSignature(snapshot: SheetHistorySnapshot): string {
  return JSON.stringify(snapshot);
}

function captureDocumentHistorySnapshot(document: DocumentState): CoreDocumentHistorySnapshot {
  return {
    nextSheetId: document.nextSheetId,
    sheets: document.sheets.map((sheet) => sheet.captureHistorySnapshot()),
  };
}

function restoreDocumentHistorySnapshot(document: DocumentState, snapshot: CoreDocumentHistorySnapshot): void {
  const restored = structuredClone(snapshot) as CoreDocumentHistorySnapshot;
  copyDocumentHistoryReferenceMetadata(snapshot, restored);
  document.sheets = restored.sheets.map(sheetFromHistorySnapshot);
  document.nextSheetId = restored.nextSheetId;
}

function sheetFromHistorySnapshot(snapshot: SheetHistorySnapshot): SheetState {
  const sheet = SheetState.fromTableRows(snapshot.name, [], undefined, undefined, snapshot.sheetId);
  sheet.restoreHistorySnapshot(snapshot);
  return sheet;
}

function documentSnapshotSignature(snapshot: CoreDocumentHistorySnapshot): string {
  return JSON.stringify(snapshot);
}

function copyDocumentHistoryReferenceMetadata(
  source: CoreDocumentHistorySnapshot,
  target: CoreDocumentHistorySnapshot,
): void {
  source.sheets.forEach((sheet, sheetIndex) => {
    const targetSheet = target.sheets[sheetIndex];
    if (!targetSheet) return;
    copySheetSnapshotReferenceMetadata(sheet, targetSheet);
  });
}

function copySheetSnapshotReferenceMetadata(source: SheetHistorySnapshot, target: SheetHistorySnapshot): void {
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

/** Shared single-step execution on private staged state; unexpected faults propagate. */
export function applyCoreEditToStaged(document: DocumentState, edit: CoreEdit): void {
  try {
    applySingleEdit(document, edit);
  } catch (error) {
    if (error instanceof SheetNoteError) throw new CoreEditFailure("invalid_operation", error.message);
    throw error;
  }
  bindAfterEdit(document, edit.op);
}

function applySingleEdit(document: DocumentState, edit: CoreEdit): void {
  if (edit.op === "convert_rows_to_note") {
    convertRowsToNote(document, edit.sheet, edit.rowIds);
    return;
  }
  if (edit.op === "set_sheet_note") {
    resolveSheet(document, edit.sheet).setSheetNote(edit.position, edit.markdown);
    return;
  }
  if (edit.op === "fill_region") {
    if (edit.source.sheet !== edit.target.sheet) fail("invalid_operation", "fill regions must belong to the same sheet");
    const source = resolveRegionTarget(document, edit.source);
    const target = resolveRegionTarget(document, edit.target);
    const excludedRows = (edit.excludedRowIds ?? []).map(id => {
      const index = source.sheet.rowIds.indexOf(id);
      if (index < 0) fail("invalid_operation", `unknown excluded fill row ${id}`);
      return index;
    });
    applyFillRegion(source.sheet, source, target, edit.mode, excludedRows);
    return;
  }
  if (edit.op === "set_cell_input") {
    const { sheet, rowIndex, colIndex } = resolveCellTarget(document, edit.target);
    assertCellInput(edit.input, sheet, rowIndex, colIndex);
    sheet.setCellByIndex(rowIndex, colIndex, edit.input, ChangeKind.VALUE, false);
    return;
  }

  if (edit.op === "clear_cell") {
    const { sheet, rowIndex, colIndex } = resolveCellTarget(document, edit.target);
    sheet.clearCellByIndex(rowIndex, colIndex, false);
    return;
  }

  if (edit.op === "set_cell_local_format") {
    const { sheet, rowIndex, colIndex } = resolveCellTarget(document, edit.target);
    assertDataCell(sheet, rowIndex, colIndex);
    sheet.setCellLocalFormatByIndex(rowIndex, colIndex, edit.format);
    return;
  }

  if (edit.op === "clear_cell_local_format") {
    const { sheet, rowIndex, colIndex } = resolveCellTarget(document, edit.target);
    assertDataCell(sheet, rowIndex, colIndex);
    sheet.clearCellLocalFormatByIndex(rowIndex, colIndex);
    return;
  }

  if (edit.op === "set_cell_local_style") {
    const { sheet, rowIndex, colIndex } = resolveCellTarget(document, edit.target);
    assertDataCell(sheet, rowIndex, colIndex);
    sheet.setCellLocalStyleByIndex(rowIndex, colIndex, edit.style);
    return;
  }

  if (edit.op === "clear_cell_local_style") {
    const { sheet, rowIndex, colIndex } = resolveCellTarget(document, edit.target);
    assertDataCell(sheet, rowIndex, colIndex);
    sheet.clearCellLocalStyleByIndex(rowIndex, colIndex);
    return;
  }

  if (edit.op === "set_column_default_format") {
    const { sheet, colIndex } = resolveColumnIdTarget(document, edit.sheet, edit.colId);
    sheet.setColumnDefaultFormatByIndex(colIndex, edit.format);
    return;
  }

  if (edit.op === "clear_column_default_format") {
    const { sheet, colIndex } = resolveColumnIdTarget(document, edit.sheet, edit.colId);
    sheet.clearColumnDefaultFormatByIndex(colIndex);
    return;
  }

  if (edit.op === "set_column_default_style") {
    const { sheet, colIndex } = resolveColumnIdTarget(document, edit.sheet, edit.colId);
    sheet.setColumnDefaultStyleByIndex(colIndex, edit.style);
    return;
  }

  if (edit.op === "clear_column_default_style") {
    const { sheet, colIndex } = resolveColumnIdTarget(document, edit.sheet, edit.colId);
    sheet.clearColumnDefaultStyleByIndex(colIndex);
    return;
  }

  if (edit.op === "set_row_default_format") {
    const { sheet, rowIndex } = resolveRowIdTarget(document, edit.sheet, edit.rowId);
    sheet.setRowDefaultFormatByIndex(rowIndex, edit.format);
    return;
  }

  if (edit.op === "clear_row_default_format") {
    const { sheet, rowIndex } = resolveRowIdTarget(document, edit.sheet, edit.rowId);
    sheet.clearRowDefaultFormatByIndex(rowIndex);
    return;
  }

  if (edit.op === "set_row_default_style") {
    const { sheet, rowIndex } = resolveRowIdTarget(document, edit.sheet, edit.rowId);
    sheet.setRowDefaultStyleByIndex(rowIndex, edit.style);
    return;
  }

  if (edit.op === "clear_row_default_style") {
    const { sheet, rowIndex } = resolveRowIdTarget(document, edit.sheet, edit.rowId);
    sheet.clearRowDefaultStyleByIndex(rowIndex);
    return;
  }

  if (edit.op === "set_region") {
    const region = resolveRegionTarget(document, edit.target);
    applySetRegion(region, edit.values);
    return;
  }

  if (edit.op === "clear_region") {
    const region = resolveRegionTarget(document, edit.target);
    forEachRegionCell(region, (rowIndex, colIndex) => {
      region.sheet.clearCellByIndex(rowIndex, colIndex, false);
    });
    return;
  }

  if (edit.op === "convert_rows_to_header") {
    const sheet = resolveSheet(document, edit.sheet);
    applyConvertRowsToHeader(sheet, edit.rowIds);
    return;
  }

  if (edit.op === "set_header_columns") {
    const sheet = resolveSheet(document, edit.sheet);
    assertInteger(edit.count, "count", fail, "invalid_operation");
    if (edit.count < 0 || edit.count >= sheet.colCount) throw new CoreEditFailure("invalid_operation", "Keep at least one data column.");
    sheet.setHeaderColumnCount(edit.count, false);
    return;
  }

  if (edit.op === "convert_rows_to_body") {
    const sheet = resolveSheet(document, edit.sheet);
    applyConvertRowsToBody(sheet, edit.rowIds, edit.depth);
    return;
  }

  if (edit.op === "insert_row") {
    const sheet = resolveSheet(document, edit.sheet);
    applyInsertRowEdit(sheet, edit, fail);
    return;
  }

  if (edit.op === "insert_sheet") {
    applyInsertSheetEdit(document, edit);
    return;
  }

  if (edit.op === "delete_sheet") {
    applyDeleteSheetEdit(document, edit);
    return;
  }

  if (edit.op === "move_sheet") {
    applyMoveSheetEdit(document, edit);
    return;
  }

  if (edit.op === "rename_sheet") {
    applyRenameSheetEdit(document, edit);
    return;
  }

  if (edit.op === "delete_row") {
    const sheet = resolveSheet(document, edit.sheet);
    applyDeleteRowEdit(sheet, edit, fail);
    return;
  }

  if (edit.op === "move_columns") {
    const sheet = resolveSheet(document, edit.sheet);
    applyMoveColumnsEdit(sheet, edit, fail);
    return;
  }

  if (edit.op === "move_rows") {
    const sheet = resolveSheet(document, edit.sheet);
    applyMoveRowsEdit(sheet, edit, fail);
    return;
  }

  if (edit.op === "duplicate_columns") {
    const sheet = resolveSheet(document, edit.sheet);
    applyDuplicateColumnsEdit(sheet, edit, fail);
    return;
  }

  if (edit.op === "duplicate_rows") {
    const sheet = resolveSheet(document, edit.sheet);
    applyDuplicateRowsEdit(sheet, edit, fail);
    return;
  }

  if (edit.op === "insert_column") {
    const sheet = resolveSheet(document, edit.sheet);
    assertColumnInsertIndex(sheet, edit.colIndex);
    sheet.insertCol(edit.colIndex, false);
    return;
  }

  if (edit.op === "delete_column") {
    const sheet = resolveSheet(document, edit.sheet);
    assertColumnDeleteIndex(sheet, edit.colIndex);
    sheet.deleteCol(edit.colIndex, false);
  }
}

function collectAffectedFormulaCells(
  sheet: SheetState,
  rowIndices: number[],
  colIndices: number[],
): CoreAffectedFormulaCell[] {
  const viewIds = new Set<number>();
  for (const rowIndex of rowIndices) {
    for (const id of sheet.viewRowIndex.get(rowIndex) ?? []) {
      viewIds.add(id);
    }
  }
  for (const colIndex of colIndices) {
    for (const id of sheet.viewColIndex.get(colIndex) ?? []) {
      viewIds.add(id);
    }
  }

  const formulaKeys = new Set<string>();
  const affected: CoreAffectedFormulaCell[] = [];
  for (const viewId of viewIds) {
    const formula = sheet.viewFormulas.get(viewId);
    if (!formula) continue;
    const [rowIndex, colIndex] = formula;
    const key = `${rowIndex}:${colIndex}`;
    if (formulaKeys.has(key)) continue;
    formulaKeys.add(key);
    affected.push({
      sheet: sheet.name,
      rowId: sheet.rowIds[rowIndex],
      colId: sheet.colIds[colIndex],
      rowIndex,
      colIndex,
    });
  }
  return affected.sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex);
}

function fail(category: CoreEditErrorCategory, message: string): never {
  throw new CoreEditFailure(category, message);
}

function applyInsertSheetEdit(document: DocumentState, edit: CoreInsertSheetEdit): void {
  const name = normalizeSheetName(edit.name);
  assertUniqueSheetName(document, name);
  assertInteger(edit.sheetIndex, "sheetIndex", fail);
  if (edit.sheetIndex < 0 || edit.sheetIndex > document.sheets.length) {
    throw new CoreEditFailure("out_of_bounds", `sheetIndex ${edit.sheetIndex} out of bounds`);
  }

  document.sheets.splice(edit.sheetIndex, 0, createBlankSheet(document, name));
}

function applyDeleteSheetEdit(document: DocumentState, edit: CoreDeleteSheetEdit): void {
  const sheetIndex = resolveSheetIndex(document, edit.sheet);
  if (document.sheets.length <= 1) {
    throw new CoreEditFailure("invalid_operation", "cannot delete the final sheet");
  }
  document.sheets.splice(sheetIndex, 1);
}

function applyMoveSheetEdit(document: DocumentState, edit: CoreMoveSheetEdit): void {
  const sheetIndex = resolveSheetIndex(document, edit.sheet);
  assertInteger(edit.targetGapIndex, "targetGapIndex", fail);
  const remainingSheetCount = document.sheets.length - 1;
  if (edit.targetGapIndex < 0 || edit.targetGapIndex > remainingSheetCount) {
    throw new CoreEditFailure("out_of_bounds", `targetGapIndex ${edit.targetGapIndex} out of bounds after source removal`);
  }
  if (edit.targetGapIndex === sheetIndex) {
    return;
  }
  const [sheet] = document.sheets.splice(sheetIndex, 1);
  if (!sheet) {
    throw new CoreEditFailure("invalid_target", `unknown sheet '${edit.sheet}'`);
  }
  document.sheets.splice(edit.targetGapIndex, 0, sheet);
}

function applyRenameSheetEdit(document: DocumentState, edit: CoreRenameSheetEdit): void {
  const sheet = resolveSheet(document, edit.sheet);
  const newName = normalizeSheetName(edit.newName);
  if (newName === sheet.name) {
    return;
  }
  assertUniqueSheetName(document, newName, sheet);
  sheet.name = newName;
}

function createBlankSheet(document: DocumentState, name: string): SheetState {
  const row = "|      ||      |      |      |      |";
  const separator = "| ---- || ---- | ---- | ---- | ---- |";
  const sheet = SheetState.fromTableRows(
    name,
    [row, separator, ...Array.from({ length: 9 }, () => row)],
    undefined,
    undefined,
    document.nextSheetId,
  );
  document.nextSheetId += 1;
  return sheet;
}

function normalizeSheetName(name: string): string {
  if (typeof name !== "string") {
    throw new CoreEditFailure("invalid_operation", "sheet name must be a string");
  }
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new CoreEditFailure("invalid_operation", "sheet name cannot be empty");
  }
  return normalized;
}

function assertUniqueSheetName(document: DocumentState, name: string, except?: SheetState): void {
  const duplicate = document.sheets.some((candidate) => candidate !== except && candidate.name === name);
  if (duplicate) {
    throw new CoreEditFailure("invalid_operation", `sheet name '${name}' already exists`);
  }
}

function resolveSheetIndex(document: DocumentState, sheetName: string): number {
  const matches: number[] = [];
  document.sheets.forEach((candidate, index) => {
    if (candidate.name === sheetName) {
      matches.push(index);
    }
  });
  if (matches.length === 0) {
    throw new CoreEditFailure("invalid_target", `unknown sheet '${sheetName}'`);
  }
  if (matches.length > 1) {
    throw new CoreEditFailure("ambiguous_target", `ambiguous sheet '${sheetName}'`);
  }
  return matches[0];
}

function resolveSheet(document: DocumentState, sheetName: string): SheetState {
  const matches = document.sheets.filter((candidate) => candidate.name === sheetName);
  if (matches.length === 0) {
    throw new CoreEditFailure("invalid_target", `unknown sheet '${sheetName}'`);
  }
  if (matches.length > 1) {
    throw new CoreEditFailure("ambiguous_target", `ambiguous sheet '${sheetName}'`);
  }
  return matches[0];
}

function resolveSheetById(document: DocumentState, sheetId: number): SheetState {
  const matches = document.sheets.filter((candidate) => candidate.sheetId === sheetId);
  if (matches.length === 0) {
    throw new CoreEditFailure("invalid_operation", `unknown sheetId ${sheetId}`);
  }
  if (matches.length > 1) {
    throw new CoreEditFailure("invalid_operation", `duplicate sheetId ${sheetId}`);
  }
  return matches[0];
}

function resolveCellTarget(
  document: DocumentState,
  target: CoreCellTarget,
): { sheet: SheetState; rowIndex: number; colIndex: number } {
  const sheet = resolveSheet(document, target.sheet);

  if (target.kind === "index") {
    assertInteger(target.rowIndex, "rowIndex", fail);
    assertInteger(target.colIndex, "colIndex", fail);
    if (target.rowIndex < 0 || target.rowIndex >= sheet.rowCount) {
      throw new CoreEditFailure(
        "out_of_bounds",
        `row index ${target.rowIndex} out of bounds for sheet '${target.sheet}'`,
      );
    }
    if (target.colIndex < 0 || target.colIndex >= sheet.colCount) {
      throw new CoreEditFailure(
        "out_of_bounds",
        `column index ${target.colIndex} out of bounds for sheet '${target.sheet}'`,
      );
    }
    return { sheet, rowIndex: target.rowIndex, colIndex: target.colIndex };
  }

  const rowPathParts = normalizeRowPath(target.rowPath);
  const rowMatches = sheet.rowMap.get(JSON.stringify(rowPathParts)) ?? [];
  if (rowMatches.length === 0) {
    throw new CoreEditFailure(
      "invalid_target",
      `unresolved row path '${rowPathParts.join(".")}' in sheet '${target.sheet}'`,
    );
  }
  if (rowMatches.length > 1) {
    throw new CoreEditFailure(
      "ambiguous_target",
      `ambiguous row path '${rowPathParts.join(".")}' in sheet '${target.sheet}'`,
    );
  }

  const colMatches = sheet.colMap.get(target.colLabel) ?? [];
  if (colMatches.length === 0) {
    throw new CoreEditFailure(
      "invalid_target",
      `unresolved column label '${target.colLabel}' in sheet '${target.sheet}'`,
    );
  }
  if (colMatches.length > 1) {
    throw new CoreEditFailure(
      "ambiguous_target",
      `ambiguous column label '${target.colLabel}' in sheet '${target.sheet}'`,
    );
  }

  return { sheet, rowIndex: rowMatches[0], colIndex: colMatches[0] };
}

function normalizeRowPath(rowPath: string | string[]): string[] {
  const parts = Array.isArray(rowPath)
    ? rowPath.map((part) => part.trim()).filter((part) => part.length > 0)
    : rowPath
        .split(".")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new CoreEditFailure("invalid_target", "rowPath must contain at least one label");
  }
  return parts;
}

function resolveColumnIdTarget(
  document: DocumentState,
  sheetName: string,
  colId: number,
): { sheet: SheetState; colIndex: number } {
  const sheet = resolveSheet(document, sheetName);
  assertInteger(colId, "colId", fail);
  const colIndex = sheet.colIdToIndex.get(colId);
  if (colIndex === undefined) {
    throw new CoreEditFailure("invalid_target", `unknown colId ${colId} in sheet '${sheetName}'`);
  }
  return { sheet, colIndex };
}

function resolveRowIdTarget(
  document: DocumentState,
  sheetName: string,
  rowId: number,
): { sheet: SheetState; rowIndex: number } {
  const sheet = resolveSheet(document, sheetName);
  const rowIndex = resolveRowId(sheet, rowId, sheetName);
  return { sheet, rowIndex };
}

type ResolvedRegionTarget = {
  sheet: SheetState;
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
};

function resolveRegionTarget(document: DocumentState, target: CoreRegionTarget): ResolvedRegionTarget {
  if (target.start.rowId === undefined || target.end.rowId === undefined) {
    throw new CoreEditFailure("invalid_target", "region rowId is required");
  }
  if (target.start.colId === undefined || target.end.colId === undefined) {
    throw new CoreEditFailure("invalid_target", "region colId is required");
  }
  const sheet = resolveSheet(document, target.sheet);
  const startRow = resolveRowId(sheet, target.start.rowId, target.sheet);
  const endRow = resolveRowId(sheet, target.end.rowId, target.sheet);
  const startCol = resolveColId(sheet, target.start.colId, target.sheet);
  const endCol = resolveColId(sheet, target.end.colId, target.sheet);
  return {
    sheet,
    rowStart: Math.min(startRow, endRow),
    rowEnd: Math.max(startRow, endRow),
    colStart: Math.min(startCol, endCol),
    colEnd: Math.max(startCol, endCol),
  };
}

function resolveRowId(sheet: SheetState, rowId: number, sheetName: string): number {
  assertInteger(rowId, "rowId", fail);
  const rowIndex = sheet.rowIdToIndex.get(rowId);
  if (rowIndex === undefined) {
    throw new CoreEditFailure("invalid_target", `unknown rowId ${rowId} in sheet '${sheetName}'`);
  }
  return rowIndex;
}

function resolveColId(sheet: SheetState, colId: number, sheetName: string): number {
  assertInteger(colId, "colId", fail);
  const colIndex = sheet.colIdToIndex.get(colId);
  if (colIndex === undefined) {
    throw new CoreEditFailure("invalid_target", `unknown colId ${colId} in sheet '${sheetName}'`);
  }
  return colIndex;
}

function applySetRegion(region: ResolvedRegionTarget, values: string[][]): void {
  if (!Array.isArray(values)) {
    throw new CoreEditFailure("invalid_operation", "set_region values must be a matrix");
  }
  const expectedRows = region.rowEnd - region.rowStart + 1;
  const expectedCols = region.colEnd - region.colStart + 1;
  if (values.length !== expectedRows) {
    throw new CoreEditFailure("invalid_operation", `set_region expected ${expectedRows} rows but received ${values.length}`);
  }
  for (let r = 0; r < values.length; r += 1) {
    if (!Array.isArray(values[r])) {
      throw new CoreEditFailure("invalid_operation", "set_region values must be a rectangular matrix");
    }
    if (values[r].length !== expectedCols) {
      throw new CoreEditFailure(
        "invalid_operation",
        `set_region expected ${expectedCols} columns in row ${r} but received ${values[r].length}`,
      );
    }
  }

  forEachRegionCell(region, (rowIndex, colIndex) => {
    const input = values[rowIndex - region.rowStart][colIndex - region.colStart];
    if (typeof input !== "string") {
      throw new CoreEditFailure("invalid_operation", "set_region values must be cell input strings");
    }
    assertCellInput(input, region.sheet, rowIndex, colIndex);
    region.sheet.setCellByIndex(rowIndex, colIndex, input, ChangeKind.VALUE, false);
  });
}

function forEachRegionCell(region: ResolvedRegionTarget, fn: (rowIndex: number, colIndex: number) => void): void {
  for (let rowIndex = region.rowStart; rowIndex <= region.rowEnd; rowIndex += 1) {
    for (let colIndex = region.colStart; colIndex <= region.colEnd; colIndex += 1) {
      fn(rowIndex, colIndex);
    }
  }
}

function applyConvertRowsToHeader(sheet: SheetState, rowIds: number[]): void {
  const rowIndices = resolveContiguousRowIds(sheet, rowIds);
  if (rowIndices.some((idx) => idx < sheet.bodyStart)) {
    throw new CoreEditFailure("invalid_operation", "convert_rows_to_header requires body rows");
  }
  if (rowIndices[0] !== sheet.bodyStart) {
    throw new CoreEditFailure("invalid_operation", "convert_rows_to_header rows must start at the first body row");
  }
  sheet.convertBodyPrefixToHeader(rowIndices.length, false);
}

function applyConvertRowsToBody(sheet: SheetState, rowIds: number[], depth: number): void {
  assertInteger(depth, "depth", fail, "invalid_operation");
  if (depth < 0) {
    throw new CoreEditFailure("invalid_operation", "depth must be non-negative");
  }
  const rowIndices = resolveContiguousRowIds(sheet, rowIds);
  if (rowIndices.some((idx) => idx >= sheet.bodyStart)) {
    throw new CoreEditFailure("invalid_operation", "convert_rows_to_body requires header rows");
  }
  const expectedStart = sheet.headerRowCount - rowIndices.length;
  if (rowIndices[0] !== expectedStart) {
    throw new CoreEditFailure("invalid_operation", "convert_rows_to_body rows must end at the last header row");
  }
  sheet.convertHeaderSuffixToBody(rowIndices.length, depth, false);
}

function resolveContiguousRowIds(sheet: SheetState, rowIds: number[]): number[] {
  if (!Array.isArray(rowIds) || rowIds.length === 0) {
    throw new CoreEditFailure("invalid_operation", "rowIds must contain at least one row");
  }
  const rowIndices = rowIds.map((rowId) => resolveRowId(sheet, rowId, sheet.name)).sort((a, b) => a - b);
  for (let i = 1; i < rowIndices.length; i += 1) {
    if (rowIndices[i] === rowIndices[i - 1]) {
      throw new CoreEditFailure("invalid_target", `duplicate rowId ${rowIds[i]} in rowIds`);
    }
    if (rowIndices[i] !== rowIndices[i - 1] + 1) {
      throw new CoreEditFailure("invalid_operation", "rowIds must resolve to contiguous semantic rows");
    }
  }
  return rowIndices;
}

function assertDataCell(sheet: SheetState, rowIndex: number, colIndex: number): void {
  if (rowIndex < sheet.bodyStart || colIndex < sheet.headerColCount) {
    throw new CoreEditFailure("invalid_operation", "cell edit target must be inside data region");
  }
}

function assertColumnInsertIndex(sheet: SheetState, colIndex: number): void {
  assertInteger(colIndex, "colIndex", fail);
  if (colIndex < 0 || colIndex > sheet.colCount) {
    throw new CoreEditFailure("out_of_bounds", `column index ${colIndex} out of bounds`);
  }
  if (colIndex < sheet.headerColCount) {
    throw new CoreEditFailure("invalid_operation", "column insertion into header region is not supported");
  }
}

function assertColumnDeleteIndex(sheet: SheetState, colIndex: number): void {
  assertInteger(colIndex, "colIndex", fail);
  if (colIndex < 0 || colIndex >= sheet.colCount) {
    throw new CoreEditFailure("out_of_bounds", `column index ${colIndex} out of bounds`);
  }
  if (colIndex < sheet.headerColCount) {
    throw new CoreEditFailure("invalid_operation", "column deletion in header region is not supported");
  }
}

function assertCellInput(input: string, sheet: SheetState, rowIndex: number, colIndex: number): void {
  if (/[\r\n]/.test(input) && (!isImplicitTextInput(input) || rowIndex < sheet.bodyStart || colIndex < sheet.headerColCount)) {
    throw new CoreEditFailure(
      "invalid_operation",
      'Only implicit text in data cells accepts literal line breaks; use \\n inside quoted strings',
    );
  }
  if (splitCellDisplayMetadata(input).displayMetaRaw !== null) {
    throw new CoreEditFailure(
      "invalid_operation",
      "cell input must not include display metadata; use display metadata edit operations",
    );
  }
  const parsed = parseCellInput(input);
  if (parsed.initialCachedValue !== null && !input.trim().startsWith("=")) {
    throw new CoreEditFailure(
      "invalid_operation",
      'cell input must not include cached values; use formula input such as "= expr"',
    );
  }
}
