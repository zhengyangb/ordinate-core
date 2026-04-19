import type { SheetState } from "./incremental";
import { parseHierarchyLabel } from "./parser";
import { assertInteger, type CoreEditErrorCategory } from "./core_edit_common";

export type CoreRowInsertArea = "header" | "body";
export type CoreRowDeleteMode = "node" | "subtree";

export type CoreInsertRowEdit = {
  op: "insert_row";
  sheet: string;
  area: CoreRowInsertArea;
  rowGapIndex: number;
  depth: number;
};

export type CoreDeleteRowEdit = {
  op: "delete_row";
  sheet: string;
  rowId: number;
  mode?: CoreRowDeleteMode;
};

export type CoreRowEdit = CoreInsertRowEdit | CoreDeleteRowEdit;

type RowEditFailure = (category: CoreEditErrorCategory, message: string) => never;

/*
 * Row edit terminology:
 * - rowId: sheet-local, system-assigned row identity; stable across in-memory edits, not persisted
 * - rowGapIndex: sheet-wide semantic insertion gap index; divider rows do not count
 * - area: target row region; V1 accepts "body" only and rejects "header" fail-early
 */

export function applyInsertRowEdit(sheet: SheetState, edit: CoreInsertRowEdit, fail: RowEditFailure): void {
  if (edit.area !== "body" && edit.area !== "header") {
    fail("invalid_operation", `unsupported row insert area '${String(edit.area)}'`);
  }
  assertInteger(edit.rowGapIndex, "rowGapIndex", fail);
  assertInteger(edit.depth, "depth", fail, "invalid_operation");
  if (edit.depth < 0) {
    fail("invalid_operation", "depth must be non-negative");
  }
  if (edit.rowGapIndex < 0 || edit.rowGapIndex > sheet.rowCount) {
    fail("out_of_bounds", `rowGapIndex ${edit.rowGapIndex} out of bounds`);
  }
  if (edit.area === "header") {
    fail("invalid_operation", "header row insertion is not supported in V1");
  }
  if (edit.rowGapIndex < sheet.bodyStart) {
    fail("invalid_operation", "body row insertion gap must be inside body region");
  }

  const bodyGapIndex = edit.rowGapIndex - sheet.bodyStart;
  const bodyDepths = deriveBodyDepths(sheet);

  if (bodyGapIndex === 0) {
    if (edit.depth !== 0) {
      fail("invalid_operation", "first body row must have depth 0");
    }
  } else {
    const previousDepth = bodyDepths[bodyGapIndex - 1];
    if (edit.depth > previousDepth + 1) {
      fail(
        "invalid_operation",
        `row depth ${edit.depth} exceeds available parent depth ${previousDepth + 1} at insertion gap`,
      );
    }
  }

  if (bodyGapIndex < bodyDepths.length) {
    const nextDepth = bodyDepths[bodyGapIndex];
    if (nextDepth > edit.depth) {
      fail(
        "invalid_operation",
        `row depth ${edit.depth} would implicitly adopt following rows at depth ${nextDepth}`,
      );
    }
  }

  sheet.insertRow(edit.rowGapIndex, false, buildBlankHierarchyLabel(edit.depth));
}

export function applyDeleteRowEdit(sheet: SheetState, edit: CoreDeleteRowEdit, fail: RowEditFailure): void {
  assertInteger(edit.rowId, "rowId", fail);
  const mode = edit.mode ?? "node";
  if (mode !== "node" && mode !== "subtree") {
    fail("invalid_operation", `unsupported delete_row mode '${String(edit.mode)}'`);
  }
  const rowIndex = sheet.rowIdToIndex.get(edit.rowId);
  if (rowIndex === undefined) {
    fail("invalid_target", `unknown rowId ${edit.rowId} in sheet '${sheet.name}'`);
  }
  if (rowIndex < sheet.bodyStart) {
    fail("invalid_operation", "row deletion in header region is not supported in V1");
  }

  const deleteCount = countSubtreeRows(sheet, rowIndex);
  if (mode === "node" && deleteCount > 1) {
    fail(
      "invalid_operation",
      `delete_row requires mode "subtree" for non-leaf rowId ${edit.rowId}`,
    );
  }

  sheet.deleteRows(rowIndex, mode === "subtree" ? deleteCount : 1, false);
}

function deriveBodyDepths(sheet: SheetState): number[] {
  return sheet.logicalRows.slice(sheet.bodyStart).map((row) => parseHierarchyLabel(row.rawCells[0] ?? "").depth);
}

function buildBlankHierarchyLabel(depth: number): string {
  return depth === 0 ? "" : "*".repeat(depth);
}

function countSubtreeRows(sheet: SheetState, rowIndex: number): number {
  const bodyDepths = deriveBodyDepths(sheet);
  const bodyRowIndex = rowIndex - sheet.bodyStart;
  const currentDepth = bodyDepths[bodyRowIndex];
  let count = 1;
  for (let i = bodyRowIndex + 1; i < bodyDepths.length; i += 1) {
    if (bodyDepths[i] <= currentDepth) {
      break;
    }
    count += 1;
  }
  return count;
}
