import type { SheetBodyRowStructure } from "@ordinate/core";

import type { ColumnMetric, GridRow, HeaderIndexMetric, RowIndexMetric } from "../types/ui";
import { columnViewportXToTrackX, type ColumnAxisViewport } from "./gridGeometry";

export type AxisMoveDropMapping =
  | { kind: "target"; targetGapIndex: number }
  | { kind: "noop" };

export type ColumnDragSource =
  | {
      ok: true;
      colIds: number[];
      sourceStartIndex: number;
      sourceCount: number;
    }
  | { ok: false; reason: string };

export type RowDragSource =
  | {
      ok: true;
      area: "header" | "body";
      rowIds: number[];
      sourceStartIndex: number;
      sourceCount: number;
      firstDepth: number;
      lastDepth: number;
    }
  | { ok: false; reason: string };

export type AxisDropValidation =
  | { ok: true; mapping: AxisMoveDropMapping }
  | { ok: false; reason: string };

export type AxisDropBoundary = {
  gapIndex: number;
  position: number;
};

export type AxisAutoPanRequest = {
  pointerPosition: number;
  viewportStart: number;
  viewportEnd: number;
  scrollPosition: number;
  scrollSize: number;
  viewportSize: number;
  edgeSize: number;
  maxDelta: number;
  scrollBoundaryInset?: number;
};

export type AxisRailDragModifiers = {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

export type ColumnAxisSelection = {
  axis: "column";
  colStart: number;
  colEnd: number;
};

export type RowAxisSelection = {
  axis: "row";
  area: "header" | "body";
  rowStart: number;
  rowEnd: number;
};

export function canStartColumnRailMoveDrag(
  colIndex: number,
  axisSelection: ColumnAxisSelection | null,
  modifiers: AxisRailDragModifiers,
): boolean {
  assertNonNegativeInteger(colIndex, "colIndex");
  if (hasAxisRailDragModifier(modifiers)) return false;
  return Boolean(axisSelection && colIndex >= axisSelection.colStart && colIndex <= axisSelection.colEnd);
}

export function canStartRowRailMoveDrag(
  rowNumber: number,
  area: "header" | "body",
  axisSelection: RowAxisSelection | null,
  modifiers: AxisRailDragModifiers,
): boolean {
  assertPositiveInteger(rowNumber, "rowNumber");
  if (hasAxisRailDragModifier(modifiers)) return false;
  return Boolean(
    axisSelection &&
      axisSelection.area === area &&
      rowNumber >= axisSelection.rowStart &&
      rowNumber <= axisSelection.rowEnd,
  );
}

export function canStartColumnRailSelectionDrag(
  colIndex: number,
  headerColCount: number,
  colCount: number,
  axisSelection: ColumnAxisSelection | null,
  modifiers: AxisRailDragModifiers,
): boolean {
  assertNonNegativeInteger(colIndex, "colIndex");
  assertNonNegativeInteger(headerColCount, "headerColCount");
  assertNonNegativeInteger(colCount, "colCount");
  if (hasAxisRailDragModifier(modifiers)) return false;
  if (colIndex < headerColCount || colIndex >= colCount) return false;
  return !(axisSelection && colIndex >= axisSelection.colStart && colIndex <= axisSelection.colEnd);
}

export function canStartRowRailSelectionDrag(
  rowNumber: number,
  area: "header" | "body",
  headerRowCount: number,
  rowCount: number,
  axisSelection: RowAxisSelection | null,
  modifiers: AxisRailDragModifiers,
): boolean {
  assertPositiveInteger(rowNumber, "rowNumber");
  assertNonNegativeInteger(headerRowCount, "headerRowCount");
  assertNonNegativeInteger(rowCount, "rowCount");
  if (hasAxisRailDragModifier(modifiers)) return false;
  if (area === "header" && rowNumber > headerRowCount) return false;
  if (area === "body" && (rowNumber <= headerRowCount || rowNumber > rowCount)) return false;
  return !(
    axisSelection &&
    axisSelection.area === area &&
    rowNumber >= axisSelection.rowStart &&
    rowNumber <= axisSelection.rowEnd
  );
}

export function mapMoveDropGapToCoreTargetGap(
  sourceStartIndex: number,
  sourceCount: number,
  currentDropGapIndex: number,
): AxisMoveDropMapping {
  assertNonNegativeInteger(sourceStartIndex, "sourceStartIndex");
  assertPositiveInteger(sourceCount, "sourceCount");
  assertNonNegativeInteger(currentDropGapIndex, "currentDropGapIndex");

  const sourceEndGap = sourceStartIndex + sourceCount;
  if (currentDropGapIndex >= sourceStartIndex && currentDropGapIndex <= sourceEndGap) {
    return { kind: "noop" };
  }
  if (currentDropGapIndex < sourceStartIndex) {
    return { kind: "target", targetGapIndex: currentDropGapIndex };
  }
  return { kind: "target", targetGapIndex: currentDropGapIndex - sourceCount };
}

export function resolveColumnDragSource(
  colIndex: number,
  headerColCount: number,
  colIds: number[],
  selection: ColumnAxisSelection | null = null,
): ColumnDragSource {
  assertNonNegativeInteger(colIndex, "colIndex");
  assertNonNegativeInteger(headerColCount, "headerColCount");
  const sourceStartIndex =
    selection && colIndex >= selection.colStart && colIndex <= selection.colEnd
      ? selection.colStart
      : colIndex;
  const sourceEndIndex =
    selection && colIndex >= selection.colStart && colIndex <= selection.colEnd
      ? selection.colEnd
      : colIndex;

  if (sourceStartIndex < headerColCount) {
    return { ok: false, reason: "Header columns cannot be moved." };
  }
  const colIdSegment = colIds.slice(sourceStartIndex, sourceEndIndex + 1);
  const sourceCount = sourceEndIndex - sourceStartIndex + 1;
  if (colIdSegment.length !== sourceCount) {
    return { ok: false, reason: "Column no longer exists." };
  }
  return {
    ok: true,
    colIds: colIdSegment,
    sourceStartIndex,
    sourceCount,
  };
}

export function resolveRowDragSource(
  rowNumber: number,
  area: "header" | "body",
  headerRowCount: number,
  rowIds: number[],
  bodyRows: SheetBodyRowStructure[],
  selection: RowAxisSelection | null = null,
): RowDragSource {
  assertPositiveInteger(rowNumber, "rowNumber");
  assertNonNegativeInteger(headerRowCount, "headerRowCount");
  const useSelection =
    selection &&
    selection.area === area &&
    rowNumber >= selection.rowStart &&
    rowNumber <= selection.rowEnd
      ? selection
      : null;
  const rowIndex = rowNumber - 1;

  if (area === "header") {
    const sourceStartIndex = (useSelection?.rowStart ?? rowNumber) - 1;
    const sourceEndIndex = (useSelection?.rowEnd ?? rowNumber) - 1;
    if (sourceStartIndex < 0 || sourceEndIndex >= headerRowCount) {
      return { ok: false, reason: "Header row no longer exists." };
    }
    const rowIdSegment = rowIds.slice(sourceStartIndex, sourceEndIndex + 1);
    const sourceCount = sourceEndIndex - sourceStartIndex + 1;
    if (rowIdSegment.length !== sourceCount) {
      return { ok: false, reason: "Header row no longer exists." };
    }
    return {
      ok: true,
      area,
      rowIds: rowIdSegment,
      sourceStartIndex,
      sourceCount,
      firstDepth: 0,
      lastDepth: 0,
    };
  }

  const bodyRow = bodyRows.find((candidate) => candidate.absoluteRowNumber === rowNumber);
  if (!bodyRow) {
    return { ok: false, reason: "Body row no longer exists." };
  }
  const selectedBodySegment =
    useSelection &&
    !(
      useSelection.rowStart === rowNumber &&
      useSelection.rowEnd === rowNumber &&
      bodyRow.hasChildren
    )
      ? useSelection
      : null;
  const selectionStartRow =
    selectedBodySegment ? bodyRows.find((candidate) => candidate.absoluteRowNumber === selectedBodySegment.rowStart) : null;
  const selectionEndRow =
    selectedBodySegment ? bodyRows.find((candidate) => candidate.absoluteRowNumber === selectedBodySegment.rowEnd) : null;
  if (selectedBodySegment && (!selectionStartRow || !selectionEndRow)) {
    return { ok: false, reason: "Body row segment no longer exists." };
  }
  const sourceStartIndex = selectionStartRow?.absoluteRowIndex ?? bodyRow.absoluteRowIndex;
  const sourceEndIndex = selectionEndRow?.absoluteRowIndex ?? (bodyRow.hasChildren ? bodyRow.absoluteRowIndex + bodyRow.subtreeRowCount - 1 : bodyRow.absoluteRowIndex);
  const partialHierarchyReason = validateCompleteBodyHierarchySegment(sourceStartIndex, sourceEndIndex, bodyRows);
  if (partialHierarchyReason) {
    return { ok: false, reason: partialHierarchyReason };
  }
  const sourceCount = sourceEndIndex - sourceStartIndex + 1;
  const rowIdSegment = rowIds.slice(sourceStartIndex, sourceStartIndex + sourceCount);
  if (rowIdSegment.length !== sourceCount) {
    return { ok: false, reason: "Body row segment no longer exists." };
  }
  const firstBodyRow = bodyRows.find((candidate) => candidate.absoluteRowIndex === sourceStartIndex);
  const lastBodyRow = bodyRows.find((candidate) => candidate.absoluteRowIndex === sourceStartIndex + sourceCount - 1);
  if (!firstBodyRow || !lastBodyRow) {
    return { ok: false, reason: "Body row segment no longer exists." };
  }
  return {
    ok: true,
    area,
    rowIds: rowIdSegment,
    sourceStartIndex,
    sourceCount,
    firstDepth: firstBodyRow.depth,
    lastDepth: lastBodyRow.depth,
  };
}

export function validateColumnMoveDrop(
  source: ColumnDragSource,
  currentDropGapIndex: number,
  headerColCount: number,
  colCount: number,
): AxisDropValidation {
  assertNonNegativeInteger(currentDropGapIndex, "currentDropGapIndex");
  assertNonNegativeInteger(headerColCount, "headerColCount");
  assertNonNegativeInteger(colCount, "colCount");
  if (!source.ok) return source;
  if (currentDropGapIndex < headerColCount || currentDropGapIndex > colCount) {
    return { ok: false, reason: "Drop inside the data-column region." };
  }
  const mapping = mapMoveDropGapToCoreTargetGap(source.sourceStartIndex, source.sourceCount, currentDropGapIndex);
  if (mapping.kind === "target" && (mapping.targetGapIndex < headerColCount || mapping.targetGapIndex > colCount - source.sourceCount)) {
    return { ok: false, reason: "Drop inside the data-column region." };
  }
  return { ok: true, mapping };
}

export function validateRowMoveDrop(
  source: RowDragSource,
  currentDropGapIndex: number,
  headerRowCount: number,
  rowCount: number,
  bodyRows: SheetBodyRowStructure[],
): AxisDropValidation {
  assertNonNegativeInteger(currentDropGapIndex, "currentDropGapIndex");
  assertNonNegativeInteger(headerRowCount, "headerRowCount");
  assertNonNegativeInteger(rowCount, "rowCount");
  if (!source.ok) return source;

  if (source.area === "header") {
    if (currentDropGapIndex < 0 || currentDropGapIndex > headerRowCount) {
      return { ok: false, reason: "Drop inside the header-row region." };
    }
    const mapping = mapMoveDropGapToCoreTargetGap(source.sourceStartIndex, source.sourceCount, currentDropGapIndex);
    if (mapping.kind === "target" && mapping.targetGapIndex > headerRowCount - source.sourceCount) {
      return { ok: false, reason: "Drop inside the header-row region." };
    }
    return { ok: true, mapping };
  }

  if (currentDropGapIndex < headerRowCount || currentDropGapIndex > rowCount) {
    return { ok: false, reason: "Drop inside the body-row region." };
  }
  const mapping = mapMoveDropGapToCoreTargetGap(source.sourceStartIndex, source.sourceCount, currentDropGapIndex);
  if (mapping.kind === "noop") return { ok: true, mapping };

  const remainingDepths = buildRemainingRowDepths(headerRowCount, rowCount, source, bodyRows);
  const targetGapIndex = mapping.targetGapIndex;
  if (targetGapIndex < headerRowCount || targetGapIndex > rowCount - source.sourceCount) {
    return { ok: false, reason: "Drop inside the body-row region." };
  }

  const previousDepth = targetGapIndex > headerRowCount ? remainingDepths[targetGapIndex - 1] : null;
  const nextDepth = targetGapIndex < remainingDepths.length ? remainingDepths[targetGapIndex] : null;
  if (previousDepth == null && source.firstDepth !== 0) {
    return { ok: false, reason: "Nested rows cannot become the first body row." };
  }
  if (previousDepth != null && source.firstDepth > previousDepth + 1) {
    return { ok: false, reason: "Drop would create an invalid hierarchy jump." };
  }
  if (nextDepth != null && nextDepth > source.lastDepth) {
    return { ok: false, reason: "Drop would implicitly adopt following rows." };
  }
  return { ok: true, mapping };
}

export function resolveColumnDropGap(localX: number, metrics: ColumnMetric[]): number | null {
  return resolveColumnDropBoundary(localX, metrics)?.gapIndex ?? null;
}

export function computeAxisAutoPanDelta(request: AxisAutoPanRequest): number {
  assertFiniteNumber(request.pointerPosition, "pointerPosition");
  assertFiniteNumber(request.viewportStart, "viewportStart");
  assertFiniteNumber(request.viewportEnd, "viewportEnd");
  assertNonNegativeFiniteNumber(request.scrollPosition, "scrollPosition");
  assertNonNegativeFiniteNumber(request.scrollSize, "scrollSize");
  assertNonNegativeFiniteNumber(request.viewportSize, "viewportSize");
  assertPositiveFiniteNumber(request.edgeSize, "edgeSize");
  assertPositiveFiniteNumber(request.maxDelta, "maxDelta");
  const scrollBoundaryInset = request.scrollBoundaryInset ?? 0;
  assertNonNegativeFiniteNumber(scrollBoundaryInset, "scrollBoundaryInset");
  if (request.viewportEnd <= request.viewportStart) {
    throw new Error("viewportEnd must be greater than viewportStart");
  }

  const maxScrollPosition = Math.max(0, request.scrollSize - request.viewportSize);
  if (maxScrollPosition <= 0) return 0;

  const distanceFromStart = request.pointerPosition - request.viewportStart;
  const distanceFromEnd = request.viewportEnd - request.pointerPosition;
  let rawDelta = 0;
  if (distanceFromStart < request.edgeSize) {
    const ratio = Math.min(1, Math.max(0, (request.edgeSize - distanceFromStart) / request.edgeSize));
    rawDelta = -Math.ceil(request.maxDelta * ratio);
  } else if (distanceFromEnd < request.edgeSize) {
    const ratio = Math.min(1, Math.max(0, (request.edgeSize - distanceFromEnd) / request.edgeSize));
    rawDelta = Math.ceil(request.maxDelta * ratio);
  }

  if (rawDelta === 0) return 0;
  const minScrollPosition = request.scrollPosition > scrollBoundaryInset ? scrollBoundaryInset : 0;
  const maxGuardedScrollPosition =
    request.scrollPosition < maxScrollPosition - scrollBoundaryInset
      ? Math.max(minScrollPosition, maxScrollPosition - scrollBoundaryInset)
      : maxScrollPosition;
  const nextScrollPosition = Math.min(
    maxGuardedScrollPosition,
    Math.max(minScrollPosition, request.scrollPosition + rawDelta),
  );
  return nextScrollPosition - request.scrollPosition;
}

export function resolveColumnDropBoundaryInViewport(
  localX: number,
  metrics: ColumnMetric[],
  viewport: ColumnAxisViewport,
): AxisDropBoundary | null {
  if (!Number.isFinite(localX)) return null;
  return resolveColumnDropBoundary(columnViewportXToTrackX(localX, viewport), metrics);
}

export function resolveColumnIndexInViewport(
  localX: number,
  metrics: ColumnMetric[],
  viewport: ColumnAxisViewport,
): number | null {
  if (!Number.isFinite(localX)) return null;
  return resolveColumnIndexAtTrackX(columnViewportXToTrackX(localX, viewport), metrics);
}

export function resolveColumnDropBoundary(localX: number, metrics: ColumnMetric[]): AxisDropBoundary | null {
  if (!Number.isFinite(localX) || metrics.length === 0) return null;
  let best: AxisDropBoundary | null = null;
  for (const metric of metrics) {
    best = nearestBoundaryCandidate(localX, best, { gapIndex: metric.colIndex, position: metric.left });
    best = nearestBoundaryCandidate(localX, best, { gapIndex: metric.colIndex + 1, position: metric.left + metric.width });
  }
  return best;
}

export function resolveHeaderRowDropGap(localY: number, metrics: HeaderIndexMetric[]): number | null {
  return resolveHeaderRowDropBoundary(localY, metrics)?.gapIndex ?? null;
}

export function resolveHeaderRowNumberAtTrackY(localY: number, metrics: HeaderIndexMetric[]): number | null {
  return resolveRowNumberAtTrackY(localY, metrics);
}

export function resolveHeaderRowDropBoundary(localY: number, metrics: HeaderIndexMetric[]): AxisDropBoundary | null {
  if (!Number.isFinite(localY) || metrics.length === 0) return null;
  let best: AxisDropBoundary | null = null;
  for (const metric of metrics) {
    best = nearestBoundaryCandidate(localY, best, { gapIndex: metric.number - 1, position: metric.top });
    best = nearestBoundaryCandidate(localY, best, { gapIndex: metric.number, position: metric.top + metric.height });
  }
  return best;
}

export function resolveBodyRowDropGap(
  localY: number,
  metrics: RowIndexMetric[],
  visibleRows: GridRow[],
  bodyRows: SheetBodyRowStructure[],
): number | null {
  return resolveBodyRowDropBoundary(localY, metrics, visibleRows, bodyRows)?.gapIndex ?? null;
}

export function resolveBodyRowNumberAtTrackY(localY: number, metrics: RowIndexMetric[]): number | null {
  return resolveRowNumberAtTrackY(localY, metrics);
}

export function resolveBodyRowDropBoundary(
  localY: number,
  metrics: RowIndexMetric[],
  visibleRows: GridRow[],
  bodyRows: SheetBodyRowStructure[],
): AxisDropBoundary | null {
  if (!Number.isFinite(localY) || metrics.length === 0) return null;
  const rowByNumber = new Map(visibleRows.map((row) => [row.__absoluteRowNumber, row]));
  const structureByNumber = new Map(bodyRows.map((row) => [row.absoluteRowNumber, row]));
  let best: AxisDropBoundary | null = null;
  for (const metric of metrics) {
    const row = rowByNumber.get(metric.number);
    const structure = structureByNumber.get(metric.number);
    if (!row || !structure) continue;
    best = nearestBoundaryCandidate(localY, best, { gapIndex: structure.absoluteRowIndex, position: metric.top });
    const afterGap = row.__collapsed && structure.hasChildren
      ? structure.absoluteRowIndex + structure.subtreeRowCount
      : structure.absoluteRowIndex + 1;
    best = nearestBoundaryCandidate(localY, best, { gapIndex: afterGap, position: metric.top + metric.height });
  }
  return best;
}

function buildRemainingRowDepths(
  headerRowCount: number,
  rowCount: number,
  source: Extract<RowDragSource, { ok: true }>,
  bodyRows: SheetBodyRowStructure[],
): Array<number | null> {
  const depths: Array<number | null> = Array.from({ length: rowCount }, () => null);
  for (let rowIndex = 0; rowIndex < headerRowCount; rowIndex += 1) {
    depths[rowIndex] = 0;
  }
  for (const row of bodyRows) {
    depths[row.absoluteRowIndex] = row.depth;
  }
  return depths.filter((_, rowIndex) => (
    rowIndex < source.sourceStartIndex ||
    rowIndex >= source.sourceStartIndex + source.sourceCount
  ));
}

function validateCompleteBodyHierarchySegment(
  sourceStartIndex: number,
  sourceEndIndex: number,
  bodyRows: SheetBodyRowStructure[],
): string | null {
  for (const row of bodyRows) {
    if (row.absoluteRowIndex < sourceStartIndex || row.absoluteRowIndex > sourceEndIndex) continue;
    if (!row.hasChildren) continue;
    const subtreeEndIndex = row.absoluteRowIndex + row.subtreeRowCount - 1;
    if (subtreeEndIndex > sourceEndIndex) {
      return "Selected row segment does not include the complete subtree.";
    }
  }
  return null;
}

function resolveColumnIndexAtTrackX(trackX: number, metrics: ColumnMetric[]): number | null {
  if (!Number.isFinite(trackX) || metrics.length === 0) return null;
  let best = metrics[0];
  let bestDistance = distanceToSegment(trackX, best.left, best.left + best.width);
  for (let index = 1; index < metrics.length; index += 1) {
    const candidate = metrics[index];
    const distance = distanceToSegment(trackX, candidate.left, candidate.left + candidate.width);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.colIndex;
}

function resolveRowNumberAtTrackY<T extends { number: number; top: number; height: number }>(
  trackY: number,
  metrics: T[],
): number | null {
  if (!Number.isFinite(trackY) || metrics.length === 0) return null;
  let best = metrics[0];
  let bestDistance = distanceToSegment(trackY, best.top, best.top + best.height);
  for (let index = 1; index < metrics.length; index += 1) {
    const candidate = metrics[index];
    const distance = distanceToSegment(trackY, candidate.top, candidate.top + candidate.height);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.number;
}

function distanceToSegment(value: number, start: number, end: number): number {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

function nearestBoundaryCandidate(
  localPosition: number,
  current: AxisDropBoundary | null,
  candidate: AxisDropBoundary,
): AxisDropBoundary {
  if (!current) return candidate;
  if (Math.abs(localPosition - candidate.position) < Math.abs(localPosition - current.position)) {
    return candidate;
  }
  return current;
}

function hasAxisRailDragModifier(modifiers: AxisRailDragModifiers): boolean {
  return Boolean(modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey || modifiers.shiftKey);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertNonNegativeFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function assertPositiveFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
