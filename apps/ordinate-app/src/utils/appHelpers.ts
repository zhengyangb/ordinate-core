import {
  getCellTextView,
  type CellTextViewSource,
  type CoreRowDeleteMode,
  type PresentedCell,
  type RuntimeValue,
  type SheetBodyRowStructure,
} from "@ordinate/core";

import type {
  ColumnMetric,
  ColumnRailMenuView,
  FloatingMenuPosition,
  HeaderOverlayCell,
  RailMenuView,
  RowRailMenuView,
  SheetSelection,
  SheetHealth,
  SheetIssueViewModel,
} from "../types/ui";
import { firstColumnFormatPreviewValue, formatLocalViewFromSpec } from "./formatDisplay";
import { runtimeValueToText } from "./sheetView";

export const APPEND_AXIS_SLOT_GAP = 8;
export const APPEND_COLUMN_WIDTH = 32;
export const GRID_HEADER_HEIGHT = 40;
export const GRID_ROW_HEIGHT = 38;
export const APPEND_ROW_SLOT_HEIGHT = 32;
export const FORMULA_BAR_SAFE_SPACE = 136;
export const FORMULA_BAR_AUTO_PAN_CLEARANCE = 12;
export const FORMULA_BAR_AUTO_PAN_DURATION_MS = 280;
export const CHROME_TRANSITION_MS = 260;
export const POSITION_EPSILON = 0.5;
export const TAB_TOOLTIP_DELAY_MS = 40;
export const CONTROL_TOOLTIP_DELAY_MS = 220;
export const TOOLTIP_GAP = 8;
export const TOOLTIP_VIEWPORT_MARGIN = 10;
export const FLOATING_MENU_VIEWPORT_MARGIN = 24;
export const FLOATING_MENU_GAP = 8;
export const COLUMN_RAIL_MENU_MAX_WIDTH_REM = 27;
export const BLANK_RUNTIME_VALUE: RuntimeValue = { kind: "blank", value: null };

export type RingRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ValidationIssue = {
  message: string;
  row?: number;
  col?: number;
};

type RuntimeSheet = {
  colLabels: string[];
  rowPaths?: string[];
  values: RuntimeValue[][];
};

type StateCell = CellTextViewSource;

type StateSheet = {
  colCount: number;
  rowIds?: number[];
  colIds?: number[];
  colLabels: string[];
  headerRowCount?: number;
  bodyStart?: number;
  cells: StateCell[][];
};

type PresentationColumnDefault = {
  formatLayer: { local: PresentedCell["formatLayer"]["local"] | null | undefined };
  styleLayer: { local: PresentedCell["styleLayer"]["local"] | null | undefined };
  valid?: boolean;
  errors?: PresentedCell["errors"];
};

type PresentationRowDefault = {
  formatLayer: { local: PresentedCell["formatLayer"]["local"] | null | undefined };
  styleLayer: { local: PresentedCell["styleLayer"]["local"] | null | undefined };
  valid?: boolean;
  errors?: PresentedCell["errors"];
};

type PresentationSheet = {
  headerDisplayRows?: string[][];
  columnDefaults: Array<PresentationColumnDefault | undefined>;
  rowDefaults?: Array<PresentationRowDefault | undefined>;
};

const BLOCKING_SHEET_MESSAGE_FRAGMENTS = [
  "sheet has no table",
  "sheet contains multiple tables",
  "table is not rectangular",
  "table has inconsistent || boundary position",
  "table has multiple separator rows",
  "table separator row cannot be first row",
  "row must start and end with '|'",
  "multiple || boundary markers in one row",
];

export function toColFieldId(colIndex: number): string {
  return `col_${colIndex}`;
}

export function toColumnLetters(colNumber: number): string {
  let n = Math.max(1, Math.trunc(colNumber));
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function overlayCellsEqual(previous: HeaderOverlayCell[], next: HeaderOverlayCell[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    const a = previous[index];
    const b = next[index];
    if (a.key !== b.key) return false;
    if (a.rowNumber !== b.rowNumber || a.label !== b.label) return false;
    if (Math.abs(a.left - b.left) > 0.5) return false;
    if (Math.abs(a.width - b.width) > 0.5) return false;
  }
  return true;
}

export function columnMetricsEqual(previous: ColumnMetric[], next: ColumnMetric[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    const a = previous[index];
    const b = next[index];
    if (a.colIndex !== b.colIndex) return false;
    if (Math.abs(a.left - b.left) > 0.5) return false;
    if (Math.abs(a.width - b.width) > 0.5) return false;
  }
  return true;
}

export function ringRectEqual(previous: RingRect | null, next: RingRect | null): boolean {
  if (previous == null || next == null) {
    return previous === next;
  }
  return (
    Math.abs(previous.left - next.left) <= 0.5 &&
    Math.abs(previous.top - next.top) <= 0.5 &&
    Math.abs(previous.width - next.width) <= 0.5 &&
    Math.abs(previous.height - next.height) <= 0.5
  );
}

export function isBlockingSheetIssue(issue: ValidationIssue): boolean {
  if (issue.col != null) return false;
  const normalized = issue.message.trim().toLowerCase();
  return BLOCKING_SHEET_MESSAGE_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

export function normalizeIssueMessage(issue: ValidationIssue): string {
  let message = issue.message.trim();
  if (issue.row != null && issue.col != null) {
    message = message.replace(/^Row\s+\d+\s*,\s*col\s+\d+\s*:\s*/i, "");
  } else if (issue.row != null) {
    message = message.replace(/^Row\s+\d+\s*:\s*/i, "");
  }
  return message;
}

export function buildSheetIssueBuckets(
  sheetNames: string[],
  sheetIssuesByName: Record<string, ValidationIssue[]>,
): Record<string, { blocking: SheetIssueViewModel[] }> {
  return sheetNames.reduce<Record<string, { blocking: SheetIssueViewModel[] }>>((acc, name) => {
    const issues = sheetIssuesByName[name] ?? [];
    const blocking: SheetIssueViewModel[] = [];
    for (const issue of issues) {
      const viewIssue: SheetIssueViewModel = {
        message: normalizeIssueMessage(issue),
        row: issue.row,
        col: issue.col,
      };
      if (isBlockingSheetIssue(issue)) {
        blocking.push(viewIssue);
      }
    }
    acc[name] = { blocking };
    return acc;
  }, {});
}

export function buildSheetHealthByName(
  sheetNames: string[],
  sheetIssueBuckets: Record<string, { blocking: SheetIssueViewModel[] }>,
): Record<string, SheetHealth> {
  return sheetNames.reduce<Record<string, SheetHealth>>((acc, name) => {
    const bucket = sheetIssueBuckets[name];
    acc[name] = (bucket?.blocking.length ?? 0) > 0 ? "invalid" : "ok";
    return acc;
  }, {});
}

export function queryGridBodyViewport(root: HTMLElement): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(".ag-body-viewport.ag-layout-normal") ??
    root.querySelector<HTMLElement>(".ag-body-viewport")
  );
}

export function queryGridHorizontalViewport(root: HTMLElement): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(".ag-body-horizontal-scroll-viewport") ??
    root.querySelector<HTMLElement>(".ag-center-cols-viewport")
  );
}

export function easeOutQuint(progress: number): number {
  return 1 - (1 - progress) ** 5;
}

export function formatMenuKeyFromType(type: "f" | "e" | "%" | "d" | null | undefined): "auto" | "integer" | "decimal" | "scientific" | "percent" {
  if (type === "d") return "integer";
  if (type === "f") return "decimal";
  if (type === "e") return "scientific";
  if (type === "%") return "percent";
  return "auto";
}

export function styleLocalView(style: PresentedCell["styleLayer"]["local"] | null | undefined) {
  return {
    align: style?.align ?? "auto",
    weight: style?.weight ?? "auto",
    color: style?.color ?? "auto",
  } as const;
}

export function formatLocalView(format: PresentedCell["formatLayer"]["local"] | null | undefined, previewValue?: RuntimeValue | null) {
  return formatLocalViewFromSpec(format, previewValue);
}

export function resolveGridInstanceKey(sheetId: number, sheetColCount: number, headerColCount: number, headerRowCount: number): string {
  if (!Number.isInteger(sheetId) || sheetId <= 0) {
    throw new Error("grid instance key requires a positive sheet id");
  }
  if (!Number.isInteger(sheetColCount) || sheetColCount < 0) {
    throw new Error("sheetColCount must be a non-negative integer");
  }
  if (!Number.isInteger(headerColCount) || headerColCount < 0 || headerColCount > sheetColCount) {
    throw new Error("headerColCount must be a non-negative integer within sheetColCount");
  }
  if (!Number.isInteger(headerRowCount) || headerRowCount < 0) {
    throw new Error("headerRowCount must be a non-negative integer");
  }
  const dataColumnCount = sheetColCount - headerColCount;
  const sizingMode = headerColCount === 0 && headerRowCount === 0
    ? "plain-data-columns"
    : dataColumnCount === 1
      ? "single-data-column"
      : "multi-data-column";
  return JSON.stringify(["sheet-grid", sheetId, headerColCount, headerRowCount, sizingMode]);
}

export function trimSheetColCount(currentSheetState: StateSheet | null, currentSheet: RuntimeSheet | null): number {
  if (!currentSheetState) return 0;

  let nextCount = currentSheetState.colCount;
  if (nextCount <= 0) return 0;

  while (nextCount > 0) {
    const colIndex = nextCount - 1;
    const headerLabel = currentSheetState.colLabels[colIndex]?.trim() ?? "";
    if (headerLabel.length > 0) break;

    let hasRawText = false;
    for (let rowIndex = 0; rowIndex < currentSheetState.cells.length; rowIndex += 1) {
      const cell = currentSheetState.cells[rowIndex]?.[colIndex];
      const rawText = cell ? getCellTextView(cell).inputText.trim() : "";
      if (rawText.length > 0) {
        hasRawText = true;
        break;
      }
    }
    if (hasRawText) break;

    let hasRuntimeContent = false;
    if (currentSheet) {
      for (let rowIndex = 0; rowIndex < currentSheet.values.length; rowIndex += 1) {
        const value = currentSheet.values[rowIndex]?.[colIndex] as RuntimeValue | undefined;
        const text = runtimeValueToText(value ?? BLANK_RUNTIME_VALUE).trim();
        if (text.length > 0) {
          hasRuntimeContent = true;
          break;
        }
      }
    }
    if (hasRuntimeContent) break;

    nextCount -= 1;
  }

  return nextCount;
}

export function buildHeaderMatrix(
  currentSheetState: StateSheet | null,
  currentSheet: RuntimeSheet | null,
  currentSheetPresentation: PresentationSheet | null,
  sheetColCount: number,
  headerRowCount: number,
): string[][] {
  if (!currentSheetState || sheetColCount === 0) return [];
  if (headerRowCount === 0) return [];

  const fromPresentation = currentSheetPresentation?.headerDisplayRows ?? [];
  if (fromPresentation.length > 0) {
    return fromPresentation.map((row) =>
      Array.from({ length: sheetColCount }, (_, colIndex) => row[colIndex] ?? ""),
    );
  }

  const matrixDepth = headerRowCount;
  return Array.from({ length: matrixDepth }, (_, rowIndex) =>
    Array.from({ length: sheetColCount }, (_, colIndex) => {
      return "";
    }),
  );
}

export function buildColumnHasLocalConfig(
  currentSheetPresentation: PresentationSheet | null,
  sheetColCount: number,
): boolean[] {
  return Array.from({ length: sheetColCount }, (_, colIndex) => {
    const columnDefault = currentSheetPresentation?.columnDefaults[colIndex];
    if (!columnDefault) return false;
    const localStyle = columnDefault.styleLayer.local;
    return Boolean(
      columnDefault.formatLayer.local ||
        localStyle?.align ||
        localStyle?.weight ||
        localStyle?.color,
    );
  });
}

export function buildColumnRailMenu(
  openColumnMenuColIndex: number | null,
  sheetColCount: number,
  headerColCount: number,
  currentSheet: RuntimeSheet | null,
  currentSheetState: StateSheet | null,
  currentSheetPresentation: PresentationSheet | null,
  columnHasLocalConfig: boolean[],
): ColumnRailMenuView | null {
  if (openColumnMenuColIndex == null || openColumnMenuColIndex < 0 || openColumnMenuColIndex >= sheetColCount) {
    return null;
  }
  const columnDefault = currentSheetPresentation?.columnDefaults[openColumnMenuColIndex];
  const colId = currentSheetState?.colIds?.[openColumnMenuColIndex];
  if (colId == null) {
    return null;
  }
  const localStyle = columnDefault?.styleLayer.local;
  const styleLocal = styleLocalView(localStyle);
  const previewValue = firstColumnFormatPreviewValue(currentSheet?.values, openColumnMenuColIndex);
  return {
    kind: "column",
    colIndex: openColumnMenuColIndex,
    colId,
    colLabel: toColumnLetters(openColumnMenuColIndex + 1),
    hasLocalConfig: columnHasLocalConfig[openColumnMenuColIndex] === true,
    canStructureEdit: openColumnMenuColIndex >= headerColCount,
    ...formatLocalView(columnDefault?.formatLayer.local, previewValue),
    formatPreviewContext: {
      value: previewValue,
      scope: previewValue ? "column" : "sample",
    },
    styleLocal,
  };
}

function firstRowFormatPreviewValue(values: RuntimeValue[][] | null | undefined, rowRel: number, headerColCount: number): RuntimeValue | null {
  if (!values || rowRel < 0 || rowRel >= values.length) return null;
  const row = values[rowRel];
  if (!row) return null;
  for (let colIndex = Math.max(0, headerColCount); colIndex < row.length; colIndex += 1) {
    const value = row[colIndex];
    if (!value || value.kind === "blank" || value.kind === "null" || value.kind === "error") continue;
    return value;
  }
  return null;
}

export function buildRowRailMenu(
  target: { rowNumber: number; area: "header" | "body"; hasChildren: boolean } | null,
  currentSheetState: StateSheet | null,
  currentSheet: RuntimeSheet | null,
  currentSheetPresentation: PresentationSheet | null,
  headerColCount: number,
): RowRailMenuView | null {
  if (target == null) {
    return null;
  }
  const rowIndex = target.rowNumber - 1;
  const rowId = currentSheetState?.rowIds?.[rowIndex];
  if (rowId == null) {
    return null;
  }
  const headerRowCount = currentSheetState?.headerRowCount ?? 0;
  const bodyStart = currentSheetState?.bodyStart ?? headerRowCount;
  const canDisplayEdit = target.area === "body" && rowIndex >= bodyStart && headerColCount > 0;
  const rowDefault = canDisplayEdit ? currentSheetPresentation?.rowDefaults?.[rowIndex] : null;
  const localStyle = rowDefault?.styleLayer.local;
  const rowRel = rowIndex - bodyStart;
  const previewValue = canDisplayEdit ? firstRowFormatPreviewValue(currentSheet?.values, rowRel, headerColCount) : null;
  const styleLocal = styleLocalView(localStyle);
  const rowHasLocalConfig = Boolean(
    rowDefault?.formatLayer.local ||
      localStyle?.align ||
      localStyle?.weight ||
      localStyle?.color ||
      rowDefault?.valid === false,
  );
  return {
    kind: "row",
    area: target.area,
    rowNumber: target.rowNumber,
    rowId,
    rowPath: canDisplayEdit ? currentSheet?.rowPaths?.[rowRel] ?? null : null,
    hasChildren: target.hasChildren,
    canDisplayEdit,
    hasLocalConfig: rowHasLocalConfig,
    ...formatLocalView(rowDefault?.formatLayer.local, previewValue),
    formatPreviewContext: {
      value: previewValue,
      scope: previewValue ? "row" : "sample",
    },
    styleLocal,
    canConvertToHeader: target.area === "body" && rowIndex === bodyStart,
    canConvertToBody: target.area === "header" && headerRowCount > 0 && rowIndex === headerRowCount - 1,
  };
}

export function buildRailMenu(
  target:
    | { kind: "column"; colIndex: number }
    | { kind: "row"; rowNumber: number; area: "header" | "body"; hasChildren: boolean }
    | null,
  sheetColCount: number,
  headerColCount: number,
  currentSheet: RuntimeSheet | null,
  currentSheetState: StateSheet | null,
  currentSheetPresentation: PresentationSheet | null,
  columnHasLocalConfig: boolean[],
): RailMenuView | null {
  if (!target) return null;
  if (target.kind === "column") {
    return buildColumnRailMenu(target.colIndex, sheetColCount, headerColCount, currentSheet, currentSheetState, currentSheetPresentation, columnHasLocalConfig);
  }
  return buildRowRailMenu(
    { rowNumber: target.rowNumber, area: target.area, hasChildren: target.hasChildren },
    currentSheetState,
    currentSheet,
    currentSheetPresentation,
    headerColCount,
  );
}

export type RowDeleteTarget = {
  rowNumber: number;
  rowId: number;
  mode: CoreRowDeleteMode;
  deletedRowCount: number;
};

export function resolveColumnDeleteTargets(
  colIndex: number,
  selection: SheetSelection | null,
  headerColCount: number,
  sheetColCount: number,
): number[] {
  if (colIndex < headerColCount || colIndex >= sheetColCount) {
    throw new Error("column delete target must be inside data columns");
  }
  if (
    selection?.kind !== "column" ||
    colIndex < selection.colStart ||
    colIndex > selection.colEnd
  ) {
    return [colIndex];
  }
  if (selection.colStart < headerColCount || selection.colEnd >= sheetColCount) {
    throw new Error("column selection delete target must be inside data columns");
  }
  return Array.from(
    { length: selection.colEnd - selection.colStart + 1 },
    (_, offset) => selection.colStart + offset,
  );
}

export function resolveRowDeleteTargets(
  rowNumber: number,
  area: "header" | "body",
  rowId: number,
  selection: SheetSelection | null,
  currentSheetState: StateSheet,
  rowStructure: SheetBodyRowStructure[],
): RowDeleteTarget[] {
  const selectedRange =
    selection?.kind === "row" &&
    selection.area === area &&
    rowNumber >= selection.rowStart &&
    rowNumber <= selection.rowEnd
      ? { start: selection.rowStart, end: selection.rowEnd }
      : { start: rowNumber, end: rowNumber };

  if (area === "header") {
    const headerRowCount = currentSheetState.headerRowCount ?? 0;
    if (selectedRange.start < 1 || selectedRange.end > headerRowCount) {
      throw new Error("header row delete target must be inside header rows");
    }
    return Array.from({ length: selectedRange.end - selectedRange.start + 1 }, (_, offset) => {
      const targetRowNumber = selectedRange.start + offset;
      const targetRowId = currentSheetState.rowIds?.[targetRowNumber - 1];
      if (targetRowId == null) {
        throw new Error(`missing rowId for header row ${targetRowNumber}`);
      }
      return {
        rowNumber: targetRowNumber,
        rowId: targetRowId,
        mode: "node",
        deletedRowCount: 1,
      };
    });
  }

  const rows = rowStructure.filter((row) => (
    row.absoluteRowNumber >= selectedRange.start &&
    row.absoluteRowNumber <= selectedRange.end
  ));
  if (rows.length === 0) {
    throw new Error("body row delete target must resolve to row structure");
  }
  if (selectedRange.start === rowNumber && selectedRange.end === rowNumber && rows[0]?.rowId !== rowId) {
    throw new Error("body row delete target rowId does not match row structure");
  }

  const targets: RowDeleteTarget[] = [];
  let coveredThroughRowNumber = 0;
  for (const row of rows) {
    if (row.absoluteRowNumber <= coveredThroughRowNumber) continue;
    const mode: CoreRowDeleteMode = row.hasChildren ? "subtree" : "node";
    const deletedRowCount = row.hasChildren ? row.subtreeRowCount : 1;
    coveredThroughRowNumber = row.absoluteRowNumber + deletedRowCount - 1;
    targets.push({
      rowNumber: row.absoluteRowNumber,
      rowId: row.rowId,
      mode,
      deletedRowCount,
    });
  }
  if (targets.length === 0) {
    throw new Error("body row delete target resolved to no delete targets");
  }
  return targets;
}

export function resolveRailMenuWidthPx(kind: RailMenuView["kind"]): number {
  if (typeof window === "undefined") {
    return kind === "row" ? 208 : COLUMN_RAIL_MENU_MAX_WIDTH_REM * 16;
  }
  if (kind === "row") {
    return Math.min(208, window.innerWidth - FLOATING_MENU_VIEWPORT_MARGIN * 2);
  }
  const rootFontPx = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  const maxWidthPx = COLUMN_RAIL_MENU_MAX_WIDTH_REM * rootFontPx;
  return Math.min(maxWidthPx, window.innerWidth - FLOATING_MENU_VIEWPORT_MARGIN * 2);
}

export function resolveAnchoredMenuPosition(
  anchorRect: DOMRect,
  menuRect: Pick<DOMRect, "width" | "height">,
  {
    preferredY = "below",
    align = "end",
  }: {
    preferredY?: "below" | "above";
    align?: "start" | "end";
  } = {},
): FloatingMenuPosition {
  const menuWidth = menuRect.width;
  const menuHeight = menuRect.height;
  const belowTop = anchorRect.bottom + FLOATING_MENU_GAP;
  const aboveTop = anchorRect.top - menuHeight - FLOATING_MENU_GAP;
  const canPlaceBelow = belowTop + menuHeight <= window.innerHeight - FLOATING_MENU_VIEWPORT_MARGIN;
  const canPlaceAbove = aboveTop >= FLOATING_MENU_VIEWPORT_MARGIN;
  const unclampedTop =
    preferredY === "below"
      ? canPlaceBelow || !canPlaceAbove
        ? belowTop
        : aboveTop
      : canPlaceAbove || !canPlaceBelow
        ? aboveTop
        : belowTop;
  const top = Math.max(
    FLOATING_MENU_VIEWPORT_MARGIN,
    Math.min(unclampedTop, window.innerHeight - menuHeight - FLOATING_MENU_VIEWPORT_MARGIN),
  );
  const preferredLeft = align === "start" ? anchorRect.left : anchorRect.right - menuWidth;
  const left = Math.max(
    FLOATING_MENU_VIEWPORT_MARGIN,
    Math.min(preferredLeft, window.innerWidth - menuWidth - FLOATING_MENU_VIEWPORT_MARGIN),
  );
  return { top, left };
}

export function resolveRailMenuPosition(
  anchorRect: DOMRect,
  menuRect: Pick<DOMRect, "width" | "height">,
): FloatingMenuPosition {
  return resolveAnchoredMenuPosition(anchorRect, menuRect, {
    preferredY: "below",
    align: "start",
  });
}

export function resolveFlyoutMenuPosition(
  triggerRect: DOMRect,
  containerRect: DOMRect,
  menuRect: Pick<DOMRect, "width" | "height">,
  { preferredSide = "right" }: { preferredSide?: "right" | "left" } = {},
): FloatingMenuPosition {
  const menuWidth = menuRect.width;
  const menuHeight = menuRect.height;
  const rightLeft = containerRect.right + FLOATING_MENU_GAP;
  const leftLeft = containerRect.left - menuWidth - FLOATING_MENU_GAP;
  const canPlaceRight = rightLeft + menuWidth <= window.innerWidth - FLOATING_MENU_VIEWPORT_MARGIN;
  const canPlaceLeft = leftLeft >= FLOATING_MENU_VIEWPORT_MARGIN;
  const unclampedLeft =
    preferredSide === "right"
      ? canPlaceRight || !canPlaceLeft
        ? rightLeft
        : leftLeft
      : canPlaceLeft || !canPlaceRight
        ? leftLeft
        : rightLeft;
  const left = Math.max(
    FLOATING_MENU_VIEWPORT_MARGIN,
    Math.min(unclampedLeft, window.innerWidth - menuWidth - FLOATING_MENU_VIEWPORT_MARGIN),
  );
  const top = Math.max(
    FLOATING_MENU_VIEWPORT_MARGIN,
    Math.min(triggerRect.top, window.innerHeight - menuHeight - FLOATING_MENU_VIEWPORT_MARGIN),
  );
  return { top, left };
}

export type FormulaInputMode = "read" | "edit";
