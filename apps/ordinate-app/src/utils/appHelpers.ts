import { getCellTextView, type CellTextViewSource, type PresentedCell, type RuntimeValue } from "@ordinate/core";

import type {
  ColumnMetric,
  ColumnRailMenuView,
  FloatingMenuPosition,
  HeaderOverlayCell,
  RailMenuView,
  SheetHealth,
  SheetIssueViewModel,
  ThemeMode,
} from "../types/ui";
import { runtimeValueToText } from "./sheetView";

export const LABEL_COLUMN_WIDTH = 280;
export const HEADER_COLUMN_WIDTH = 168;
export const DATA_COLUMN_MIN_WIDTH = 132;
export const GRID_HEADER_HEIGHT = 40;
export const GRID_ROW_HEIGHT = 38;
export const FORMULA_BAR_SAFE_SPACE = 136;
export const FORMULA_BAR_AUTO_PAN_CLEARANCE = 12;
export const FORMULA_BAR_AUTO_PAN_DURATION_MS = 280;
export const CHROME_TRANSITION_MS = 260;
export const POSITION_EPSILON = 0.5;
export const TAB_TOOLTIP_DELAY_MS = 40;
export const CONTROL_TOOLTIP_DELAY_MS = 220;
export const TOOLTIP_GAP = 8;
export const TOOLTIP_VIEWPORT_MARGIN = 10;
export const TOOLTIP_ESTIMATED_HEIGHT = 34;
export const TOOLTIP_ESTIMATED_WIDTH = 240;
export const FLOATING_MENU_VIEWPORT_MARGIN = 24;
export const FLOATING_MENU_GAP = 8;
export const COLUMN_RAIL_MENU_MAX_WIDTH_REM = 27;
export const THEME_STORAGE_KEY = "ordinate-theme-mode";
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
  values: RuntimeValue[][];
};

type StateCell = CellTextViewSource;

type StateSheet = {
  colCount: number;
  colLabels: string[];
  cells: StateCell[][];
};

type PresentationColumnDefault = {
  formatLayer: { local: PresentedCell["formatLayer"]["local"] | null | undefined };
  styleLayer: { local: PresentedCell["styleLayer"]["local"] | null | undefined };
};

type PresentationSheet = {
  headerDisplayRows?: string[][];
  columnDefaults: Array<PresentationColumnDefault | undefined>;
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

export function resolveInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

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

export function formatLocalView(format: PresentedCell["formatLayer"]["local"] | null | undefined) {
  if (!format) {
    return {
      formatLocalKey: "auto" as const,
      formatLocalOptions: null,
    };
  }
  return {
    formatLocalKey: formatMenuKeyFromType(format.type),
    formatLocalOptions: {
      sign: format.sign,
      padWidth: format.padWidth,
      grouping: format.grouping,
      precision: format.precision,
    },
  };
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
      if (rowIndex === matrixDepth - 1) {
        return currentSheetState.colLabels[colIndex] ?? currentSheet?.colLabels[colIndex] ?? `C${colIndex + 1}`;
      }
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
  currentSheetPresentation: PresentationSheet | null,
  columnHasLocalConfig: boolean[],
): ColumnRailMenuView | null {
  if (openColumnMenuColIndex == null || openColumnMenuColIndex < 0 || openColumnMenuColIndex >= sheetColCount) {
    return null;
  }
  const columnDefault = currentSheetPresentation?.columnDefaults[openColumnMenuColIndex];
  const localStyle = columnDefault?.styleLayer.local;
  const styleLocal = styleLocalView(localStyle);
  return {
    kind: "column",
    colIndex: openColumnMenuColIndex,
    colLabel: toColumnLetters(openColumnMenuColIndex + 1),
    hasLocalConfig: columnHasLocalConfig[openColumnMenuColIndex] === true,
    canStructureEdit: openColumnMenuColIndex >= headerColCount,
    ...formatLocalView(columnDefault?.formatLayer.local),
    styleLocal,
  };
}

export function buildRowRailMenu(
  rowNumber: number | null,
  rowPath: string | null,
): RailMenuView | null {
  if (rowNumber == null || rowPath == null) {
    return null;
  }
  return {
    kind: "row",
    rowNumber,
    rowPath,
  };
}

export function buildRailMenu(
  target:
    | { kind: "column"; colIndex: number }
    | { kind: "row"; rowNumber: number; rowPath: string | null }
    | null,
  sheetColCount: number,
  headerColCount: number,
  currentSheetPresentation: PresentationSheet | null,
  columnHasLocalConfig: boolean[],
): RailMenuView | null {
  if (!target) return null;
  if (target.kind === "column") {
    return buildColumnRailMenu(target.colIndex, sheetColCount, headerColCount, currentSheetPresentation, columnHasLocalConfig);
  }
  return buildRowRailMenu(target.rowNumber, target.rowPath);
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

export type FormulaInputMode = "read" | "edit";
