import { ChangeKind, DocumentState, SheetState } from "./incremental";

export type CoreEditErrorCategory =
  | "invalid_target"
  | "ambiguous_target"
  | "out_of_bounds"
  | "invalid_operation"
  | "rebase_conflict";

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

export type CoreEdit =
  | { op: "set_cell_input"; target: CoreCellTarget; input: string }
  | { op: "clear_cell"; target: CoreCellTarget }
  | { op: "set_cell_local_format"; target: CoreCellTarget; format: string }
  | { op: "clear_cell_local_format"; target: CoreCellTarget }
  | { op: "set_cell_local_style"; target: CoreCellTarget; style: string }
  | { op: "clear_cell_local_style"; target: CoreCellTarget }
  | { op: "rename_sheet"; sheet: string; newName: string }
  | { op: "insert_row"; sheet: string; rowIndex: number }
  | { op: "delete_row"; sheet: string; rowIndex: number }
  | { op: "insert_column"; sheet: string; colIndex: number }
  | { op: "delete_column"; sheet: string; colIndex: number };

export interface ApplyBatchAtomicOptions {
  recalculate?: boolean;
}

export type ApplyBatchAtomicResult =
  | { ok: true; nextDocument: DocumentState }
  | { ok: false; error: CoreEditError };

class CoreEditFailure extends Error {
  readonly category: CoreEditErrorCategory;

  constructor(category: CoreEditErrorCategory, message: string) {
    super(message);
    this.category = category;
  }
}

export function applyBatchAtomic(
  document: DocumentState,
  edits: CoreEdit[],
  options?: ApplyBatchAtomicOptions,
): ApplyBatchAtomicResult {
  const staged = cloneDocumentState(document);

  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];
    try {
      applySingleEdit(staged, edit);
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

function cloneDocumentState(document: DocumentState): DocumentState {
  const clone = structuredClone(document) as DocumentState;
  Object.setPrototypeOf(clone, DocumentState.prototype);
  for (const sheet of clone.sheets) {
    Object.setPrototypeOf(sheet, SheetState.prototype);
  }
  return clone;
}

function applySingleEdit(document: DocumentState, edit: CoreEdit): void {
  if (edit.op === "set_cell_input") {
    const { sheet, rowIndex, colIndex } = resolveCellTarget(document, edit.target);
    assertDataCell(sheet, rowIndex, colIndex);
    assertSingleLineCellInput(edit.input);
    sheet.setCellByIndex(rowIndex, colIndex, edit.input, ChangeKind.VALUE, false);
    return;
  }

  if (edit.op === "clear_cell") {
    const { sheet, rowIndex, colIndex } = resolveCellTarget(document, edit.target);
    assertDataCell(sheet, rowIndex, colIndex);
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

  if (edit.op === "insert_row") {
    const sheet = resolveSheet(document, edit.sheet);
    assertRowInsertIndex(sheet, edit.rowIndex);
    sheet.insertRow(edit.rowIndex, false);
    return;
  }

  if (edit.op === "rename_sheet") {
    const sheet = resolveSheet(document, edit.sheet);
    const newName = edit.newName.trim();
    if (newName.length === 0) {
      throw new CoreEditFailure("invalid_operation", "sheet name cannot be empty");
    }
    if (newName === sheet.name) {
      return;
    }
    const duplicate = document.sheets.some((candidate) => candidate !== sheet && candidate.name === newName);
    if (duplicate) {
      throw new CoreEditFailure("invalid_operation", `sheet name '${newName}' already exists`);
    }
    sheet.name = newName;
    return;
  }

  if (edit.op === "delete_row") {
    const sheet = resolveSheet(document, edit.sheet);
    assertRowDeleteIndex(sheet, edit.rowIndex);
    sheet.deleteRow(edit.rowIndex, false);
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

function resolveCellTarget(
  document: DocumentState,
  target: CoreCellTarget,
): { sheet: SheetState; rowIndex: number; colIndex: number } {
  const sheet = resolveSheet(document, target.sheet);

  if (target.kind === "index") {
    assertInteger(target.rowIndex, "rowIndex");
    assertInteger(target.colIndex, "colIndex");
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

function assertDataCell(sheet: SheetState, rowIndex: number, colIndex: number): void {
  if (rowIndex < sheet.bodyStart || colIndex < sheet.headerColCount) {
    throw new CoreEditFailure("invalid_operation", "cell edit target must be inside data region");
  }
}

function assertRowInsertIndex(sheet: SheetState, rowIndex: number): void {
  assertInteger(rowIndex, "rowIndex");
  if (rowIndex < 0 || rowIndex > sheet.rowCount) {
    throw new CoreEditFailure("out_of_bounds", `row index ${rowIndex} out of bounds`);
  }
  if (rowIndex < sheet.bodyStart) {
    throw new CoreEditFailure("invalid_operation", "row insertion into header region is not supported");
  }
}

function assertRowDeleteIndex(sheet: SheetState, rowIndex: number): void {
  assertInteger(rowIndex, "rowIndex");
  if (rowIndex < 0 || rowIndex >= sheet.rowCount) {
    throw new CoreEditFailure("out_of_bounds", `row index ${rowIndex} out of bounds`);
  }
  if (rowIndex < sheet.bodyStart) {
    throw new CoreEditFailure("invalid_operation", "row deletion in header region is not supported");
  }
}

function assertColumnInsertIndex(sheet: SheetState, colIndex: number): void {
  assertInteger(colIndex, "colIndex");
  if (colIndex < 0 || colIndex > sheet.colCount) {
    throw new CoreEditFailure("out_of_bounds", `column index ${colIndex} out of bounds`);
  }
  if (colIndex < sheet.headerColCount) {
    throw new CoreEditFailure("invalid_operation", "column insertion into header region is not supported");
  }
}

function assertColumnDeleteIndex(sheet: SheetState, colIndex: number): void {
  assertInteger(colIndex, "colIndex");
  if (colIndex < 0 || colIndex >= sheet.colCount) {
    throw new CoreEditFailure("out_of_bounds", `column index ${colIndex} out of bounds`);
  }
  if (colIndex < sheet.headerColCount) {
    throw new CoreEditFailure("invalid_operation", "column deletion in header region is not supported");
  }
}

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new CoreEditFailure("invalid_target", `${name} must be an integer`);
  }
}

function assertSingleLineCellInput(input: string): void {
  if (input.includes("\n") || input.includes("\r")) {
    throw new CoreEditFailure(
      "invalid_operation",
      'cell input must be single-line; use "\\n" for literal text',
    );
  }
}
