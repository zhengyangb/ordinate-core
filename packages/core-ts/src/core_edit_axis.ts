import type { SheetState } from "./incremental";
import { resolveSheetRowStructure } from "./row_structure";
import { assertInteger, type CoreEditErrorCategory } from "./core_edit_common";

export type CoreMoveColumnsEdit = {
  op: "move_columns";
  sheet: string;
  colIds: number[];
  targetGapIndex: number;
};

export type CoreMoveRowsEdit = {
  op: "move_rows";
  sheet: string;
  rowIds: number[];
  targetGapIndex: number;
};

export type CoreDuplicateColumnsEdit = {
  op: "duplicate_columns";
  sheet: string;
  colIds: number[];
  targetGapIndex: number;
};

export type CoreDuplicateRowsEdit = {
  op: "duplicate_rows";
  sheet: string;
  rowIds: number[];
  targetGapIndex: number;
};

type AxisFailure = (category: CoreEditErrorCategory, message: string) => never;

export function applyMoveColumnsEdit(sheet: SheetState, edit: CoreMoveColumnsEdit, fail: AxisFailure): void {
  const source = resolveContiguousIds(edit.colIds, sheet.colIdToIndex, "colIds", "colId", fail);
  assertInteger(edit.targetGapIndex, "targetGapIndex", fail);

  if (source.start < sheet.headerColCount) {
    fail("invalid_operation", "move_columns source must be inside data columns");
  }

  const remainingColCount = sheet.colCount - source.count;
  if (edit.targetGapIndex < 0 || edit.targetGapIndex > remainingColCount) {
    fail("out_of_bounds", `targetGapIndex ${edit.targetGapIndex} out of bounds after source removal`);
  }
  if (edit.targetGapIndex < sheet.headerColCount) {
    fail("invalid_operation", "move_columns target gap must be inside data columns");
  }

  sheet.moveColumns(source.start, source.count, edit.targetGapIndex, false);
}

export function applyMoveRowsEdit(sheet: SheetState, edit: CoreMoveRowsEdit, fail: AxisFailure): void {
  const source = resolveContiguousIds(edit.rowIds, sheet.rowIdToIndex, "rowIds", "rowId", fail);
  assertInteger(edit.targetGapIndex, "targetGapIndex", fail);

  const sourceRegion = rowRegionForSource(sheet, source.start, source.end, "move_rows", fail);
  const remainingRowCount = sheet.rowCount - source.count;
  if (edit.targetGapIndex < 0 || edit.targetGapIndex > remainingRowCount) {
    fail("out_of_bounds", `targetGapIndex ${edit.targetGapIndex} out of bounds after source removal`);
  }

  if (sourceRegion === "header") {
    const remainingHeaderRows = sheet.headerRowCount - source.count;
    if (edit.targetGapIndex > remainingHeaderRows) {
      fail("invalid_operation", "move_rows target gap must stay inside header rows");
    }
    sheet.moveRows(source.start, source.count, edit.targetGapIndex, false);
    return;
  }

  if (edit.targetGapIndex < sheet.bodyStart) {
    fail("invalid_operation", "move_rows target gap must stay inside body rows");
  }

  validateBodySubtreeCoverage(sheet, source.start, source.end, "move_rows", fail);
  validateBodyMoveTargetHierarchy(sheet, source.start, source.count, edit.targetGapIndex, fail);
  sheet.moveRows(source.start, source.count, edit.targetGapIndex, false);
}

export function applyDuplicateColumnsEdit(
  sheet: SheetState,
  edit: CoreDuplicateColumnsEdit,
  fail: AxisFailure,
): void {
  const source = resolveContiguousIds(edit.colIds, sheet.colIdToIndex, "colIds", "colId", fail);
  assertInteger(edit.targetGapIndex, "targetGapIndex", fail);

  if (source.start < sheet.headerColCount) {
    fail("invalid_operation", "duplicate_columns source must be inside data columns");
  }
  if (edit.targetGapIndex < 0 || edit.targetGapIndex > sheet.colCount) {
    fail("out_of_bounds", `targetGapIndex ${edit.targetGapIndex} out of bounds`);
  }
  if (edit.targetGapIndex < sheet.headerColCount) {
    fail("invalid_operation", "duplicate_columns target gap must be inside data columns");
  }
  validateTargetGapOutsideSourceInterior(edit.targetGapIndex, source.start, source.end, "duplicate_columns", fail);

  sheet.duplicateColumns(source.start, source.count, edit.targetGapIndex, false);
}

export function applyDuplicateRowsEdit(sheet: SheetState, edit: CoreDuplicateRowsEdit, fail: AxisFailure): void {
  const source = resolveContiguousIds(edit.rowIds, sheet.rowIdToIndex, "rowIds", "rowId", fail);
  assertInteger(edit.targetGapIndex, "targetGapIndex", fail);

  const sourceRegion = rowRegionForSource(sheet, source.start, source.end, "duplicate_rows", fail);
  if (edit.targetGapIndex < 0 || edit.targetGapIndex > sheet.rowCount) {
    fail("out_of_bounds", `targetGapIndex ${edit.targetGapIndex} out of bounds`);
  }
  validateTargetGapOutsideSourceInterior(edit.targetGapIndex, source.start, source.end, "duplicate_rows", fail);

  if (sourceRegion === "header") {
    if (edit.targetGapIndex > sheet.headerRowCount) {
      fail("invalid_operation", "duplicate_rows target gap must stay inside header rows");
    }
    sheet.duplicateRows(source.start, source.count, edit.targetGapIndex, false);
    return;
  }

  if (edit.targetGapIndex < sheet.bodyStart) {
    fail("invalid_operation", "duplicate_rows target gap must stay inside body rows");
  }

  validateBodySubtreeCoverage(sheet, source.start, source.end, "duplicate_rows", fail);
  validateBodyDuplicateTargetHierarchy(sheet, source.start, source.count, edit.targetGapIndex, fail);
  sheet.duplicateRows(source.start, source.count, edit.targetGapIndex, false);
}

function resolveContiguousIds(
  ids: number[],
  idToIndex: Map<number, number>,
  fieldName: string,
  itemName: string,
  fail: AxisFailure,
): { start: number; end: number; count: number; indices: number[] } {
  if (!Array.isArray(ids) || ids.length === 0) {
    fail("invalid_operation", `${fieldName} must contain at least one ${itemName}`);
  }
  const seen = new Set<number>();
  const indices: number[] = [];
  for (const id of ids) {
    assertInteger(id, itemName, fail);
    if (seen.has(id)) {
      fail("invalid_target", `duplicate ${itemName} ${id} in ${fieldName}`);
    }
    seen.add(id);
    const index = idToIndex.get(id);
    if (index === undefined) {
      fail("invalid_target", `unknown ${itemName} ${id}`);
    }
    indices.push(index);
  }

  indices.sort((a, b) => a - b);
  for (let i = 1; i < indices.length; i += 1) {
    if (indices[i] !== indices[i - 1] + 1) {
      fail("invalid_operation", `${fieldName} must resolve to a contiguous axis segment`);
    }
  }

  return {
    start: indices[0],
    end: indices[indices.length - 1],
    count: indices.length,
    indices,
  };
}

function rowRegionForSource(
  sheet: SheetState,
  sourceStart: number,
  sourceEnd: number,
  opName: string,
  fail: AxisFailure,
): "header" | "body" {
  const sourceInHeader = sourceEnd < sheet.bodyStart;
  const sourceInBody = sourceStart >= sheet.bodyStart;
  if (!sourceInHeader && !sourceInBody) {
    fail("invalid_operation", `${opName} source must stay within one row region`);
  }
  return sourceInHeader ? "header" : "body";
}

function validateTargetGapOutsideSourceInterior(
  targetGapIndex: number,
  sourceStart: number,
  sourceEnd: number,
  opName: string,
  fail: AxisFailure,
): void {
  if (targetGapIndex > sourceStart && targetGapIndex <= sourceEnd) {
    fail("invalid_operation", `${opName} target gap must not be inside the source segment`);
  }
}

function validateBodySubtreeCoverage(
  sheet: SheetState,
  sourceStart: number,
  sourceEnd: number,
  opName: string,
  fail: AxisFailure,
): void {
  const rows = resolveSheetRowStructure(sheet);
  for (let absIndex = sourceStart; absIndex <= sourceEnd; absIndex += 1) {
    const bodyIndex = absIndex - sheet.bodyStart;
    const subtreeCount = rows[bodyIndex]?.subtreeRowCount ?? 1;
    if (absIndex + subtreeCount - 1 > sourceEnd) {
      fail("invalid_operation", `${opName} source must include complete body subtrees`);
    }
  }
}

function validateBodyMoveTargetHierarchy(
  sheet: SheetState,
  sourceStart: number,
  sourceCount: number,
  targetGapIndex: number,
  fail: AxisFailure,
): void {
  const rows = resolveSheetRowStructure(sheet);
  const sourceBodyStart = sourceStart - sheet.bodyStart;
  const sourceDepths = rows.slice(sourceBodyStart, sourceBodyStart + sourceCount).map((row) => row.depth);
  const remainingRows = rows.filter((_, bodyIndex) => bodyIndex < sourceBodyStart || bodyIndex >= sourceBodyStart + sourceCount);
  validateBodyTargetHierarchy(sourceDepths, remainingRows, targetGapIndex - sheet.bodyStart, fail);
}

function validateBodyDuplicateTargetHierarchy(
  sheet: SheetState,
  sourceStart: number,
  sourceCount: number,
  targetGapIndex: number,
  fail: AxisFailure,
): void {
  const rows = resolveSheetRowStructure(sheet);
  const sourceBodyStart = sourceStart - sheet.bodyStart;
  const sourceDepths = rows.slice(sourceBodyStart, sourceBodyStart + sourceCount).map((row) => row.depth);
  validateBodyTargetHierarchy(sourceDepths, rows, targetGapIndex - sheet.bodyStart, fail);
}

function validateBodyTargetHierarchy(
  sourceDepths: number[],
  targetRows: Array<{ depth: number }>,
  targetBodyGap: number,
  fail: AxisFailure,
): void {
  const firstMovedDepth = sourceDepths[0] ?? 0;
  const lastMovedDepth = sourceDepths[sourceDepths.length - 1] ?? firstMovedDepth;

  if (targetBodyGap === 0) {
    if (firstMovedDepth !== 0) {
      fail("invalid_operation", "first body row after structural edit must have depth 0");
    }
  } else {
    const previousDepth = targetRows[targetBodyGap - 1]?.depth ?? 0;
    if (firstMovedDepth > previousDepth + 1) {
      fail(
        "invalid_operation",
        `row depth ${firstMovedDepth} exceeds available parent depth ${previousDepth + 1} at target gap`,
      );
    }
  }

  const followingDepth = targetRows[targetBodyGap]?.depth;
  if (followingDepth !== undefined && followingDepth > lastMovedDepth) {
    fail(
      "invalid_operation",
      `row depth ${lastMovedDepth} would implicitly adopt following rows at depth ${followingDepth}`,
    );
  }
}
