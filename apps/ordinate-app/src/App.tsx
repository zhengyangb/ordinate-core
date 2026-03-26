import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type FirstDataRenderedEvent,
  type GridApi,
  type GridReadyEvent,
  type ModelUpdatedEvent,
} from "ag-grid-community";

import { type PresentedCell, type RuntimeValue } from "@ordinate/core";
import AppChrome from "./components/AppChrome";
import FormulaBarOverlay from "./components/FormulaBarOverlay";
import OverlayPortals from "./components/OverlayPortals";
import SheetParseErrorPanel from "./components/SheetParseErrorPanel";
import TableStage from "./components/TableStage";
import { createAgGridAdapter } from "./grid/agGridAdapter";
import { AutoIcon, MoonIcon, SunIcon, TOOLBAR_ITEMS } from "./icons/uiIcons";
import { useEditorStore } from "./store/editorStore";
import type {
  ChromeVisibilityPhase,
  FloatingMenuPosition,
  FormulaBarData,
  GridRow,
  HeaderIndexMetric,
  HeaderOverlayCell,
  RowIndexMetric,
  SheetHealth,
  SheetIssueViewModel,
  SelectedCell,
  TabTooltip,
  ThemeMenuPosition,
  ThemeMode,
} from "./types/ui";
import {
  compactColLabel,
  isVisiblePath,
  leafLabel,
  runtimeKindLabel,
  runtimeValueToText,
  splitPath,
} from "./utils/sheetView";

ModuleRegistry.registerModules([AllCommunityModule]);

const LABEL_COLUMN_WIDTH = 280;
const HEADER_COLUMN_WIDTH = 168;
const DATA_COLUMN_MIN_WIDTH = 132;
const GRID_HEADER_HEIGHT = 40;
const GRID_ROW_HEIGHT = 38;
const FORMULA_BAR_SAFE_SPACE = 136;
const FORMULA_BAR_AUTO_PAN_CLEARANCE = 12;
const FORMULA_BAR_AUTO_PAN_DURATION_MS = 280;
const CHROME_TRANSITION_MS = 260;
const THEME_STORAGE_KEY = "ordinate-theme-mode";
const BLANK_RUNTIME_VALUE: RuntimeValue = { kind: "blank", value: null };
const POSITION_EPSILON = 0.5;

function resolveInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

function toColFieldId(colIndex: number): string {
  return `col_${colIndex}`;
}

function overlayCellsEqual(previous: HeaderOverlayCell[], next: HeaderOverlayCell[]): boolean {
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

function isBlockingSheetIssue(issue: { message: string; row?: number; col?: number }): boolean {
  if (issue.col != null) return false;
  const normalized = issue.message.trim().toLowerCase();
  return BLOCKING_SHEET_MESSAGE_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function normalizeIssueMessage(issue: { message: string; row?: number; col?: number }): string {
  let message = issue.message.trim();
  if (issue.row != null && issue.col != null) {
    message = message.replace(/^Row\s+\d+\s*,\s*col\s+\d+\s*:\s*/i, "");
  } else if (issue.row != null) {
    message = message.replace(/^Row\s+\d+\s*:\s*/i, "");
  }
  return message;
}

function queryGridBodyViewport(root: HTMLElement): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(".ag-body-viewport.ag-layout-normal") ??
    root.querySelector<HTMLElement>(".ag-body-viewport")
  );
}

function easeOutQuint(progress: number): number {
  return 1 - (1 - progress) ** 5;
}

export default function App() {
  const {
    mode,
    sourceText,
    docState,
    evaluation,
    presentation,
    sheetIssuesByName,
    activeSheet,
    error,
    setSourceText,
    setActiveSheet,
    enterSourceMode,
    exitSourceMode,
  } = useEditorStore();

  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [formulaBarSnapshot, setFormulaBarSnapshot] = useState<FormulaBarData | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialThemeMode);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [themeMenuPosition, setThemeMenuPosition] = useState<ThemeMenuPosition>({ top: 0, left: 0 });
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolMenuPosition, setToolMenuPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0 });
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const [tabTooltip, setTabTooltip] = useState<TabTooltip | null>(null);
  const [hasVerticalOverlap, setHasVerticalOverlap] = useState(false);
  const [hasHorizontalOverlap, setHasHorizontalOverlap] = useState(false);
  const [rowIndexMetrics, setRowIndexMetrics] = useState<RowIndexMetric[]>([]);
  const [rowIndexTrackHeight, setRowIndexTrackHeight] = useState(0);
  const [headerOverlayCells, setHeaderOverlayCells] = useState<HeaderOverlayCell[]>([]);

  const gridViewportAdapter = useMemo(() => createAgGridAdapter(), []);
  const overlaySyncRafRef = useRef<number | null>(null);
  const autoPanRafRef = useRef<number | null>(null);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const columnTrackRef = useRef<HTMLDivElement | null>(null);
  const rowTrackRef = useRef<HTMLDivElement | null>(null);
  const gridApiRef = useRef<GridApi<GridRow> | null>(null);
  const pendingHeaderSelectionRef = useRef<{ colId: string; rAbs: number; expiresAt: number } | null>(null);
  const themeControlRef = useRef<HTMLDivElement | null>(null);
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolButtonRef = useRef<HTMLButtonElement | null>(null);

  const currentSheet = useMemo(() => {
    if (!evaluation || !activeSheet) return null;
    return evaluation.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [evaluation, activeSheet]);

  const currentSheetState = useMemo(() => {
    if (!docState || !activeSheet) return null;
    return docState.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [docState, activeSheet]);

  const currentSheetPresentation = useMemo(() => {
    if (!presentation || !activeSheet) return null;
    return presentation.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [presentation, activeSheet]);

  const sheetNames = useMemo(() => {
    if (docState?.sheets?.length) {
      return docState.sheets.map((sheet) => sheet.name);
    }
    return evaluation?.sheets.map((sheet) => sheet.name) ?? [];
  }, [docState, evaluation]);

  const sheetIssueBuckets = useMemo(() => {
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
  }, [sheetNames, sheetIssuesByName]);

  const sheetHealthByName = useMemo<Record<string, SheetHealth>>(() => {
    return sheetNames.reduce<Record<string, SheetHealth>>((acc, name) => {
      const bucket = sheetIssueBuckets[name];
      acc[name] = (bucket?.blocking.length ?? 0) > 0 ? "invalid" : "ok";
      return acc;
    }, {});
  }, [sheetNames, sheetIssueBuckets]);

  const activeSheetBlockingIssues = useMemo<SheetIssueViewModel[]>(() => {
    if (!activeSheet) return [];
    return sheetIssueBuckets[activeSheet]?.blocking ?? [];
  }, [activeSheet, sheetIssueBuckets]);

  const isActiveSheetBlocked = activeSheetBlockingIssues.length > 0;

  const sheetColCount = useMemo(() => {
    if (!currentSheetState) return 0;

    let nextCount = currentSheetState.colCount;
    if (nextCount <= 0) return 0;

    while (nextCount > 0) {
      const colIndex = nextCount - 1;
      const headerLabel = currentSheetState.colLabels[colIndex]?.trim() ?? "";
      if (headerLabel.length > 0) break;

      let hasRawText = false;
      for (let rowIndex = 0; rowIndex < currentSheetState.cells.length; rowIndex += 1) {
        const rawText = currentSheetState.cells[rowIndex]?.[colIndex]?.text?.trim() ?? "";
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
  }, [currentSheetState, currentSheet]);
  const headerRowCount = currentSheetState?.headerRowCount ?? 0;
  const headerColCount = Math.min(currentSheetState?.headerColCount ?? 0, sheetColCount);
  const headerOverlayRows = Math.max(0, headerRowCount - 1);
  const headerOverlayHeight = headerOverlayRows * GRID_HEADER_HEIGHT;
  const pinnedHeaderWidth = useMemo(() => {
    return Array.from({ length: headerColCount }, (_, colIndex) => (colIndex === 0 ? LABEL_COLUMN_WIDTH : HEADER_COLUMN_WIDTH)).reduce(
      (sum, width) => sum + width,
      0,
    );
  }, [headerColCount]);

  const headerMatrix = useMemo(() => {
    if (!currentSheetState || sheetColCount === 0) return [] as string[][];

    const fromPresentation = currentSheetPresentation?.headerDisplayRows ?? [];
    if (fromPresentation.length > 0) {
      return fromPresentation.map((row) =>
        Array.from({ length: sheetColCount }, (_, colIndex) => row[colIndex] ?? ""),
      );
    }

    const matrixDepth = Math.max(1, headerRowCount);
    return Array.from({ length: matrixDepth }, (_, rowIndex) =>
      Array.from({ length: sheetColCount }, (_, colIndex) => {
        if (rowIndex === matrixDepth - 1) {
          return currentSheetState.colLabels[colIndex] ?? currentSheet?.colLabels[colIndex] ?? `C${colIndex + 1}`;
        }
        return "";
      }),
    );
  }, [currentSheetState, currentSheetPresentation, currentSheet, sheetColCount, headerRowCount]);

  const headerLeafLabels = useMemo(() => {
    if (sheetColCount === 0) return [] as string[];
    const leafRow = headerMatrix[headerMatrix.length - 1] ?? [];
    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const label = leafRow[colIndex] ?? currentSheetState?.colLabels[colIndex] ?? `C${colIndex + 1}`;
      return compactColLabel(label);
    });
  }, [headerMatrix, currentSheetState, sheetColCount]);

  const headerSemanticLabels = useMemo(() => {
    if (sheetColCount === 0) return [] as string[];
    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const fromLabels = currentSheetState?.colLabels[colIndex];
      if (fromLabels && fromLabels.length > 0) return fromLabels;
      return headerLeafLabels[colIndex] ?? `C${colIndex + 1}`;
    });
  }, [currentSheetState, headerLeafLabels, sheetColCount]);

  const clearActiveSelection = useCallback(() => {
    setSelectedCell(null);
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  }, []);

  useEffect(() => {
    setCollapsedPaths(new Set());
  }, [activeSheet]);

  useEffect(() => {
    setSelectedCell(null);
  }, [activeSheet, mode]);

  useEffect(() => {
    if (!isActiveSheetBlocked) return;
    setSelectedCell(null);
  }, [isActiveSheetBlocked]);

  useEffect(() => {
    if (mode === "source") {
      setFormulaBarSnapshot(null);
    }
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!themeMenuOpen) return;

    const updatePosition = () => {
      const button = themeButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 148;
      const nextTop = rect.bottom + 8;
      const nextLeft = Math.max(12, rect.right - menuWidth);
      setThemeMenuPosition((current) => {
        if (
          Math.abs(current.top - nextTop) < POSITION_EPSILON &&
          Math.abs(current.left - nextLeft) < POSITION_EPSILON
        ) {
          return current;
        }
        return {
          top: nextTop,
          left: nextLeft,
        };
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [themeMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;

    const updatePosition = () => {
      const button = toolButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 168;
      const nextTop = rect.bottom + 8;
      const nextLeft = Math.max(12, rect.right - menuWidth);
      setToolMenuPosition((current) => {
        if (
          Math.abs(current.top - nextTop) < POSITION_EPSILON &&
          Math.abs(current.left - nextLeft) < POSITION_EPSILON
        ) {
          return current;
        }
        return {
          top: nextTop,
          left: nextLeft,
        };
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [toolMenuOpen]);

  useEffect(() => {
    const dismissTooltip = () =>
      setTabTooltip((current) => {
        if (!current) return current;
        return null;
      });
    window.addEventListener("resize", dismissTooltip);
    window.addEventListener("scroll", dismissTooltip, true);
    return () => {
      window.removeEventListener("resize", dismissTooltip);
      window.removeEventListener("scroll", dismissTooltip, true);
    };
  }, []);

  const handleTabMouseEnter = useCallback((sheetName: string, target: HTMLButtonElement) => {
    if (target.scrollWidth <= target.clientWidth + 1) {
      setTabTooltip((current) => {
        if (!current) return current;
        return null;
      });
      return;
    }
    const rect = target.getBoundingClientRect();
    const next = {
      text: sheetName,
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2,
    };
    setTabTooltip((current) => {
      if (
        current &&
        current.text === next.text &&
        Math.abs(current.top - next.top) < POSITION_EPSILON &&
        Math.abs(current.left - next.left) < POSITION_EPSILON
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const syncRowIndexMetrics = useCallback((api: GridApi<GridRow> | null) => {
    const snapshot = gridViewportAdapter.collectRowMetrics(api, GRID_ROW_HEIGHT);
    setRowIndexMetrics(snapshot.metrics);
    setRowIndexTrackHeight(snapshot.trackHeight);
  }, [gridViewportAdapter]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      setTabTooltip(null);
      if (!target?.closest(".theme-control") && !target?.closest(".theme-menu")) {
        setThemeMenuOpen(false);
      }
      if (!target?.closest(".tool-overflow-control") && !target?.closest(".tool-menu")) {
        setToolMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (themeMenuOpen) {
        setThemeMenuOpen(false);
        return;
      }
      if (toolMenuOpen) {
        setToolMenuOpen(false);
        return;
      }
      if (mode === "source" || isActiveSheetBlocked) return;
      if (!selectedCell) return;
      clearActiveSelection();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, isActiveSheetBlocked, selectedCell, clearActiveSelection, themeMenuOpen, toolMenuOpen]);

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!selectedCell) return;
      const interactiveRoot = target?.closest(
        ".ag-cell, .ag-header-cell, .ag-header-group-cell, .formula-bar, .source-button, .theme-control, .theme-menu, .tool-overflow-control, .tool-menu, .sheet-tab, textarea",
      );
      if (interactiveRoot) return;
      clearActiveSelection();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [mode, isActiveSheetBlocked, selectedCell, clearActiveSelection]);

  const toggleCollapse = useCallback((rowPath: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(rowPath)) {
        next.delete(rowPath);
      } else {
        next.add(rowPath);
      }
      return next;
    });
  }, []);

  const rowData: GridRow[] = useMemo(() => {
    if (!currentSheet || !currentSheetState) return [];

    return currentSheet.values
      .map((row, rowIndex) => {
        const rowPath = currentSheet.rowPaths[rowIndex] ?? `R${rowIndex + 1}`;
        const depth = Math.max(0, splitPath(rowPath).length - 1);
        const hasChildren = currentSheet.rowPaths.some(
          (candidate) => candidate !== rowPath && candidate.startsWith(`${rowPath}.`),
        );
        const absoluteRowNumber = currentSheetState.bodyStart + rowIndex + 1;
        const rowLeaf = leafLabel(rowPath);

        const item: GridRow = {
          __rowPath: rowPath,
          __absoluteRowNumber: absoluteRowNumber,
          __depth: depth,
          __hasChildren: hasChildren,
          __isSection: hasChildren,
          __collapsed: collapsedPaths.has(rowPath),
          __displayLabel: rowLeaf,
        };

        for (let colIndex = 0; colIndex < sheetColCount; colIndex += 1) {
          const field = toColFieldId(colIndex);
          const presentedCell = currentSheetPresentation?.cells[rowIndex]?.[colIndex] ?? null;
          const rawCell = currentSheetState.cells[currentSheetState.bodyStart + rowIndex]?.[colIndex];
          const runtimeValue = row[colIndex] as RuntimeValue | undefined;
          const displayText = presentedCell?.displayText ?? runtimeValueToText(runtimeValue ?? BLANK_RUNTIME_VALUE);

          if (colIndex < headerColCount) {
            if (colIndex === 0) {
              item[field] = rowLeaf;
              item[`__kind_${colIndex}`] = "label";
            } else {
              const headerValue = displayText.length > 0 ? displayText : rawCell?.text ?? "";
              item[field] = headerValue;
              item[`__kind_${colIndex}`] = headerValue.length > 0 ? "string" : "blank";
            }
          } else {
            item[field] = displayText;
            item[`__kind_${colIndex}`] = runtimeValue?.kind ?? "blank";
            item[`__align_${colIndex}`] = presentedCell?.style?.align ?? "";
            item[`__bold_${colIndex}`] = presentedCell?.style?.bold ?? false;
            item[`__color_${colIndex}`] = presentedCell?.style?.color ?? "";
            item[`__display_has_errors_${colIndex}`] = (presentedCell?.errors.length ?? 0) > 0;
            item[`__display_source_${colIndex}`] = presentedCell?.source ?? "default";
            item[`__display_format_${colIndex}`] = presentedCell?.format?.raw ?? "";
            item[`__display_style_${colIndex}`] = presentedCell?.style?.raw ?? "";
          }
        }

        return item;
      })
      .filter((row) => isVisiblePath(row.__rowPath, collapsedPaths));
  }, [currentSheet, currentSheetState, currentSheetPresentation, collapsedPaths, sheetColCount, headerColCount]);

  const absoluteRowPathLookup = useMemo(() => {
    const map = new Map<number, string>();
    rowData.forEach((row) => map.set(row.__absoluteRowNumber, row.__rowPath));
    return map;
  }, [rowData]);

  const rowPathToDisplayedIndex = useMemo(() => {
    const map = new Map<string, number>();
    rowData.forEach((row, index) => map.set(row.__rowPath, index));
    return map;
  }, [rowData]);

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;
    syncRowIndexMetrics(gridApiRef.current);
  }, [mode, isActiveSheetBlocked, rowData, syncRowIndexMetrics]);

  const colIndexLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (let colIndex = 0; colIndex < sheetColCount; colIndex += 1) {
      map.set(toColFieldId(colIndex), colIndex + 1);
    }
    return map;
  }, [sheetColCount]);

  const syncHeaderOverlayCells = useCallback(
    (root: HTMLElement | null) => {
      if (!root || mode === "source" || isActiveSheetBlocked || headerOverlayRows === 0 || sheetColCount === 0) {
        setHeaderOverlayCells((current) => (current.length === 0 ? current : []));
        return;
      }

      const leafCells = gridViewportAdapter.readLeafHeaderCells(root, colIndexLookup);

      if (leafCells.length === 0) {
        setHeaderOverlayCells((current) => (current.length === 0 ? current : []));
        return;
      }
      if (leafCells.length < sheetColCount) {
        // AG can transiently report a partial header DOM before final layout.
        // Skip partial snapshots to prevent wrong merged group widths.
        return;
      }

      const rootWidth = root.getBoundingClientRect().width;
      const leafRightEdge = leafCells[leafCells.length - 1]?.right ?? 0;
      const scrollbarGutter = Math.max(0, rootWidth - leafRightEdge);

      const nextCells: HeaderOverlayCell[] = [];

      for (let rowOffset = 0; rowOffset < headerOverlayRows; rowOffset += 1) {
        let cursor = 0;
        while (cursor < leafCells.length) {
          const start = leafCells[cursor];
          const label = headerMatrix[rowOffset]?.[start.colIndex] ?? "";
          let end = cursor;
          while (end + 1 < leafCells.length) {
            const current = leafCells[end];
            const candidate = leafCells[end + 1];
            if (candidate.colIndex !== current.colIndex + 1) break;
            if (current.colIndex < headerColCount && candidate.colIndex >= headerColCount) break;
            const candidateLabel = headerMatrix[rowOffset]?.[candidate.colIndex] ?? "";
            if (candidateLabel !== label) break;
            end += 1;
          }

          const left = start.left;
          const right = leafCells[end].right + (end === leafCells.length - 1 ? scrollbarGutter : 0);
          const snappedLeft = Math.round(left);
          const snappedRight = Math.round(right);
          const width = Math.max(0, snappedRight - snappedLeft);
          if (width > 0.5) {
            const startCol = start.colIndex + 1;
            const endCol = leafCells[end].colIndex + 1;
            const rowNumber = rowOffset + 1;
            nextCells.push({
              key: `r${rowNumber}-c${startCol}-${endCol}`,
              rowNumber,
              label,
              startCol: start.colIndex,
              endCol: leafCells[end].colIndex,
              left: snappedLeft,
              width,
              top: rowOffset * GRID_HEADER_HEIGHT,
              height: GRID_HEADER_HEIGHT,
            });
          }

          cursor = end + 1;
        }
      }

      setHeaderOverlayCells((current) => (overlayCellsEqual(current, nextCells) ? current : nextCells));
    },
    [mode, isActiveSheetBlocked, headerOverlayRows, sheetColCount, colIndexLookup, headerMatrix, gridViewportAdapter],
  );

  const scheduleHeaderOverlaySync = useCallback(
    (passes = 2) => {
      if (overlaySyncRafRef.current != null) {
        window.cancelAnimationFrame(overlaySyncRafRef.current);
      }

      let remaining = Math.max(1, passes);
      const tick = () => {
        overlaySyncRafRef.current = null;
        syncHeaderOverlayCells(gridWrapRef.current);
        remaining -= 1;
        if (remaining > 0) {
          overlaySyncRafRef.current = window.requestAnimationFrame(tick);
        }
      };
      overlaySyncRafRef.current = window.requestAnimationFrame(tick);
    },
    [syncHeaderOverlayCells],
  );

  useEffect(() => {
    return () => {
      if (overlaySyncRafRef.current != null) {
        window.cancelAnimationFrame(overlaySyncRafRef.current);
      }
      if (autoPanRafRef.current != null) {
        window.cancelAnimationFrame(autoPanRafRef.current);
      }
    };
  }, []);

  const handleGridReady = useCallback(
    (event: GridReadyEvent<GridRow>) => {
      gridApiRef.current = event.api;
      syncRowIndexMetrics(event.api);
      scheduleHeaderOverlaySync(3);
    },
    [syncRowIndexMetrics, scheduleHeaderOverlaySync],
  );

  const handleFirstDataRendered = useCallback(
    (event: FirstDataRenderedEvent<GridRow>) => {
      syncRowIndexMetrics(event.api);
      scheduleHeaderOverlaySync(3);
    },
    [syncRowIndexMetrics, scheduleHeaderOverlaySync],
  );

  const handleModelUpdated = useCallback(
    (event: ModelUpdatedEvent<GridRow>) => {
      syncRowIndexMetrics(event.api);
      scheduleHeaderOverlaySync(2);
    },
    [syncRowIndexMetrics, scheduleHeaderOverlaySync],
  );

  const renderedColumnCount = sheetColCount;

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;
    scheduleHeaderOverlaySync(3);
  }, [mode, isActiveSheetBlocked, activeSheet, rowData.length, renderedColumnCount, scheduleHeaderOverlaySync]);

  const gridTemplateColumns = useMemo(() => {
    if (sheetColCount === 0) return "";
    const tracks = Array.from({ length: sheetColCount }, (_, colIndex) => {
      if (colIndex < headerColCount) {
        return colIndex === 0 ? `${LABEL_COLUMN_WIDTH}px` : `${HEADER_COLUMN_WIDTH}px`;
      }
      return `minmax(${DATA_COLUMN_MIN_WIDTH}px, 1fr)`;
    });
    return tracks.join(" ");
  }, [sheetColCount, headerColCount]);

  const columnDefs = useMemo<ColDef<GridRow>[]>(() => {
    if (!currentSheet || !currentSheetState || sheetColCount === 0) return [];

    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const field = toColFieldId(colIndex);
      const isHeaderColumn = colIndex < headerColCount;
      const leafHeader = headerLeafLabels[colIndex] ?? `C${colIndex + 1}`;
      const semanticLabel = headerSemanticLabels[colIndex] ?? leafHeader;

      const baseDef: ColDef<GridRow> = {
        colId: field,
        field,
        headerName: leafHeader,
        headerTooltip: semanticLabel,
        suppressMovable: true,
      };

      if (isHeaderColumn) {
        const withHeader: ColDef<GridRow> = {
          ...baseDef,
          pinned: "left",
          width: colIndex === 0 ? LABEL_COLUMN_WIDTH : HEADER_COLUMN_WIDTH,
          minWidth: colIndex === 0 ? LABEL_COLUMN_WIDTH : HEADER_COLUMN_WIDTH,
          headerClass: "line-item-header",
          cellClass: colIndex === 0 ? "line-item-cell" : "header-column-cell",
        };

        if (colIndex === 0) {
          withHeader.cellRenderer = (params: { data?: GridRow }) => {
            const data = params.data;
            if (!data) return null;

            const showToggle = data.__hasChildren;
            const showSpacer = !showToggle && data.__depth > 0;
            const paddingLeft = Math.max(0, data.__depth - 1) * 12;
            const isCollapsed = data.__collapsed;
            const leadingSlot = showToggle ? (
              <button
                className={isCollapsed ? "tree-toggle is-collapsed" : "tree-toggle"}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleCollapse(data.__rowPath);
                }}
                aria-label={isCollapsed ? "Expand section" : "Collapse section"}
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                <svg className="tree-toggle-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path d="M4 2.5 8.5 6 4 9.5Z" fill="currentColor" />
                </svg>
              </button>
            ) : showSpacer ? (
              <span className="tree-spacer" />
            ) : (
              <span className="tree-inline-pad" aria-hidden="true" />
            );

            return (
              <div className="tree-cell" style={{ paddingLeft }}>
                {leadingSlot}
                <span className={data.__hasChildren ? "tree-label section" : "tree-label"}>
                  {String(data.__displayLabel ?? data.__rowPath)}
                </span>
              </div>
            );
          };
        }

        return withHeader;
      }

      return {
        ...baseDef,
        minWidth: DATA_COLUMN_MIN_WIDTH,
        flex: 1,
        headerClass: "data-column-header",
        cellClass: (params: { data?: GridRow }) => {
          const kind = params.data?.[`__kind_${colIndex}`];
          const classes = ["data-cell"];
          if (kind === "number") classes.push("is-numeric");
          if (kind === "error") classes.push("is-error");
          if (kind === "blank") classes.push("is-blank");
          const align = params.data?.[`__align_${colIndex}`];
          if (align === "left" || align === "right" || align === "center") {
            classes.push(`align-${align}`);
          }
          if (params.data?.[`__bold_${colIndex}`] === true) {
            classes.push("is-bold");
          }
          const color = params.data?.[`__color_${colIndex}`];
          if (color === "red" || color === "green" || color === "blue") {
            classes.push(`is-color-${color}`);
          }
          if (params.data?.[`__display_has_errors_${colIndex}`] === true) {
            classes.push("has-display-errors");
          }
          return classes.join(" ");
        },
      } satisfies ColDef<GridRow>;
    });
  }, [
    currentSheet,
    currentSheetState,
    sheetColCount,
    headerColCount,
    headerLeafLabels,
    headerSemanticLabels,
    toggleCollapse,
  ]);

  const headerIndexMetrics = useMemo<HeaderIndexMetric[]>(() => {
    return Array.from({ length: headerRowCount }, (_, index) => ({
      number: index + 1,
      top: index * GRID_HEADER_HEIGHT,
      height: GRID_HEADER_HEIGHT,
    }));
  }, [headerRowCount]);

  const headerIndexTrackHeight = headerRowCount * GRID_HEADER_HEIGHT;

  const handleHeaderOverlaySelect = useCallback(
    (rowNumber: number, colIndex: number) => {
      const root = gridWrapRef.current;
      if (!root) return;

      if (colIndex < 0 || colIndex >= sheetColCount) return;
      const maxHeaderRow = Math.max(1, headerRowCount);
      const clampedRowNumber = Math.max(1, Math.min(rowNumber, maxHeaderRow));
      const colId = toColFieldId(colIndex);
      pendingHeaderSelectionRef.current = {
        colId,
        rAbs: clampedRowNumber,
        expiresAt: performance.now() + 420,
      };

      setSelectedCell({
        area: "header",
        logical: {
          rAbs: clampedRowNumber,
          cAbs: colIndex,
        },
        colId,
        rowPath: null,
      });
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.blur();
      }
    },
    [headerRowCount, sheetColCount],
  );

  useEffect(() => {
    const root = gridWrapRef.current;
    if (!root || mode === "source" || isActiveSheetBlocked) return;

    const leafHeaderRowNumber = Math.max(1, headerRowCount);

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const headerCell = target?.closest<HTMLElement>(".ag-header-cell, .ag-header-group-cell");
      if (!headerCell) return;

      const colId =
        gridViewportAdapter.resolveLeafHeaderColIdAtClientX(root, event.clientX, colIndexLookup) ??
        gridViewportAdapter.resolveHeaderColIdFromTarget(target, sheetColCount, colIndexLookup);
      if (!colId) return;

      const colNumber = colIndexLookup.get(colId);
      if (!colNumber) return;

      setSelectedCell({
        area: "header",
        logical: {
          rAbs: leafHeaderRowNumber,
          cAbs: colNumber - 1,
        },
        colId,
        rowPath: null,
      });

      headerCell.tabIndex = 0;
      requestAnimationFrame(() => headerCell.focus());
    };

    root.addEventListener("mousedown", handlePointerDown);
    return () => root.removeEventListener("mousedown", handlePointerDown);
  }, [mode, isActiveSheetBlocked, headerRowCount, sheetColCount, colIndexLookup, gridViewportAdapter]);

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;
    const root = gridWrapRef.current;
    const columnTrack = columnTrackRef.current;
    const rowTrack = rowTrackRef.current;
    if (!root || !columnTrack || !rowTrack) return;

    return gridViewportAdapter.attachViewportSync(root, ({ top, left, hasVerticalOverlap: nextVertical, hasHorizontalOverlap: nextHorizontal }) => {
      rowTrack.style.transform = `translateY(${-top}px)`;
      columnTrack.style.transform = `translateX(${-left}px)`;
      syncHeaderOverlayCells(root);
      setHasVerticalOverlap((current) => (current === nextVertical ? current : nextVertical));
      setHasHorizontalOverlap((current) => (current === nextHorizontal ? current : nextHorizontal));
    });
  }, [mode, isActiveSheetBlocked, activeSheet, rowData.length, renderedColumnCount, syncHeaderOverlayCells, gridViewportAdapter]);

  const handleCellFocused = useCallback(
    (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => {
      if (!event.column) {
        setSelectedCell(null);
        return;
      }

      const rawColId = typeof event.column === "string" ? event.column : event.column.getColId();
      if (!colIndexLookup.has(rawColId)) {
        return;
      }
      const colNumber = colIndexLookup.get(rawColId);
      if (!colNumber) return;

      if (event.rowIndex == null) {
        const pending = pendingHeaderSelectionRef.current;
        if (pending && performance.now() <= pending.expiresAt && pending.colId === rawColId) {
          pendingHeaderSelectionRef.current = null;
          setSelectedCell({
            area: "header",
            logical: {
              rAbs: pending.rAbs,
              cAbs: colNumber - 1,
            },
            colId: rawColId,
            rowPath: null,
          });
          return;
        }
        if (pending && performance.now() > pending.expiresAt) {
          pendingHeaderSelectionRef.current = null;
        }
        setSelectedCell((current) => {
          if (current?.area === "header" && current.colId === rawColId) {
            return current;
          }
          return {
            area: "header",
            logical: {
              rAbs: Math.max(1, headerRowCount),
              cAbs: colNumber - 1,
            },
            colId: rawColId,
            rowPath: null,
          };
        });
        return;
      }

      const row = rowData[event.rowIndex];
      if (!row) {
        setSelectedCell(null);
        return;
      }

      setSelectedCell({
        area: "body",
        logical: {
          rAbs: row.__absoluteRowNumber,
          cAbs: colNumber - 1,
        },
        colId: rawColId,
        rowPath: row.__rowPath,
      });
    },
    [rowData, colIndexLookup, headerRowCount],
  );

  const formulaBarData = useMemo<FormulaBarData | null>(() => {
    if (!currentSheet || !currentSheetState || !selectedCell || isActiveSheetBlocked) return null;

    const colIndex = selectedCell.logical.cAbs;
    if (colIndex < 0 || colIndex >= sheetColCount) return null;
    const colNumber = colIndex + 1;

    const semanticColLabel = headerSemanticLabels[colIndex] ?? `C${colIndex + 1}`;

    if (selectedCell.area === "header") {
      const maxHeaderRow = Math.max(1, headerRowCount);
      const headerRowNumber = Math.max(1, Math.min(selectedCell.logical.rAbs, maxHeaderRow));
      const headerAbsIndex = headerRowNumber - 1;
      const sourceFromSheet = headerRowCount > 0 ? currentSheetState.cells[headerAbsIndex]?.[colIndex]?.text ?? "" : "";
      const displayText =
        headerMatrix[headerRowNumber - 1]?.[colIndex] ??
        sourceFromSheet ??
        semanticColLabel;
      const sourceText = sourceFromSheet.length > 0 ? sourceFromSheet : displayText;

      return {
        primaryAddress: `Col ${colNumber} · Row ${headerRowNumber}`,
        secondaryAddress: `${semanticColLabel} / Header`,
        chip: "Header",
        displayText: displayText.length > 0 ? displayText : "(blank)",
        sourceText: sourceText.length > 0 ? sourceText : "(blank)",
      };
    }

    const rowNumber = selectedCell.logical.rAbs;
    const rowPath = selectedCell.rowPath ?? absoluteRowPathLookup.get(rowNumber);
    if (!rowPath) return null;

    const rowRel = currentSheet.rowPaths.indexOf(rowPath);
    if (rowRel < 0) return null;

    const rowLeaf = leafLabel(rowPath);
    const absoluteRowIndex = rowNumber - 1;
    const presentedCell = currentSheetPresentation?.cells[rowRel]?.[colIndex] as PresentedCell | undefined;

    if (colIndex < headerColCount) {
      const sourceText = currentSheetState.cells[absoluteRowIndex]?.[colIndex]?.text ?? "";
      const displayText = colIndex === 0 ? rowLeaf : (presentedCell?.displayText ?? sourceText);
      return {
        primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
        secondaryAddress: `${semanticColLabel} / ${rowLeaf}`,
        chip: colIndex === 0 ? "Label" : "Header Col",
        displayText: displayText.length > 0 ? displayText : "(blank)",
        sourceText: sourceText.length > 0 ? sourceText : displayText.length > 0 ? displayText : "(blank)",
        displaySource: presentedCell?.source,
        displayFormatRaw: presentedCell?.format?.raw ?? null,
        displayStyleRaw: presentedCell?.style?.raw ?? null,
        displayErrors: presentedCell?.errors ?? [],
      };
    }

    const runtimeValue = currentSheet.values[rowRel]?.[colIndex] as RuntimeValue | undefined;
    const rawCell = currentSheetState.cells[absoluteRowIndex]?.[colIndex];
    const sourceText = rawCell?.text ?? runtimeValueToText(runtimeValue ?? BLANK_RUNTIME_VALUE);
    const chip = rawCell?.parsed.kind === "formula" ? "Formula" : runtimeKindLabel(runtimeValue);

    return {
      primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
      secondaryAddress: `${semanticColLabel} / ${rowLeaf}`,
      chip,
      displayText: presentedCell?.displayText ?? (runtimeValue ? runtimeValueToText(runtimeValue) : ""),
      sourceText: sourceText.length > 0 ? sourceText : "(blank)",
      displaySource: presentedCell?.source,
      displayFormatRaw: presentedCell?.format?.raw ?? null,
      displayStyleRaw: presentedCell?.style?.raw ?? null,
      displayErrors: presentedCell?.errors ?? [],
    };
  }, [
    currentSheet,
    currentSheetState,
    currentSheetPresentation,
    selectedCell,
    isActiveSheetBlocked,
    sheetColCount,
    headerSemanticLabels,
    headerMatrix,
    headerRowCount,
    absoluteRowPathLookup,
    headerColCount,
  ]);

  useEffect(() => {
    if (formulaBarData) {
      setFormulaBarSnapshot(formulaBarData);
      return;
    }

    const timeout = window.setTimeout(() => setFormulaBarSnapshot(null), CHROME_TRANSITION_MS);
    return () => window.clearTimeout(timeout);
  }, [formulaBarData]);

  useEffect(() => {
    if (mode !== "table" || isActiveSheetBlocked || !formulaBarData || selectedCell?.area !== "body") return;

    const root = gridWrapRef.current;
    if (!root) return;

    const viewport = queryGridBodyViewport(root);
    if (!viewport) return;

    const selectedRowPath = selectedCell.rowPath ?? absoluteRowPathLookup.get(selectedCell.logical.rAbs);
    if (!selectedRowPath) return;

    const displayedRowIndex = rowPathToDisplayedIndex.get(selectedRowPath);
    if (displayedRowIndex == null) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let kickoffRaf: number | null = null;

    const runAutoPan = () => {
      const selectedCellElement = root.querySelector<HTMLElement>(
        `.ag-row[row-index="${displayedRowIndex}"] .ag-cell[col-id="${selectedCell.colId}"]`,
      );
      const formulaElement = document.querySelector<HTMLElement>(".formula-bar-shell .formula-bar");
      if (!selectedCellElement || !formulaElement) return;

      const cellRect = selectedCellElement.getBoundingClientRect();
      const formulaRect = formulaElement.getBoundingClientRect();
      const overlap = cellRect.bottom + FORMULA_BAR_AUTO_PAN_CLEARANCE - formulaRect.top;
      if (overlap <= 0) return;

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const targetScrollTop = Math.min(maxScrollTop, viewport.scrollTop + overlap);
      if (targetScrollTop <= viewport.scrollTop + 0.5) return;

      if (reduceMotion) {
        viewport.scrollTop = targetScrollTop;
        return;
      }

      if (autoPanRafRef.current != null) {
        window.cancelAnimationFrame(autoPanRafRef.current);
      }

      const startScrollTop = viewport.scrollTop;
      const distance = targetScrollTop - startScrollTop;
      const startTime = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.max(0, Math.min(1, elapsed / FORMULA_BAR_AUTO_PAN_DURATION_MS));
        const eased = easeOutQuint(progress);
        viewport.scrollTop = startScrollTop + distance * eased;

        if (progress < 1) {
          autoPanRafRef.current = window.requestAnimationFrame(animate);
        } else {
          autoPanRafRef.current = null;
        }
      };

      autoPanRafRef.current = window.requestAnimationFrame(animate);
    };

    kickoffRaf = window.requestAnimationFrame(runAutoPan);

    return () => {
      if (kickoffRaf != null) {
        window.cancelAnimationFrame(kickoffRaf);
      }
      if (autoPanRafRef.current != null) {
        window.cancelAnimationFrame(autoPanRafRef.current);
        autoPanRafRef.current = null;
      }
    };
  }, [mode, isActiveSheetBlocked, formulaBarData, selectedCell, absoluteRowPathLookup, rowPathToDisplayedIndex]);

  const chromeVisibilityPhase: ChromeVisibilityPhase =
    mode === "table" ? (formulaBarData ? "visible" : formulaBarSnapshot ? "hiding" : "hidden") : "hidden";

  const themeButtonLabel = themeMode === "auto" ? "Automatic appearance" : themeMode === "light" ? "Light mode" : "Dark mode";
  const themeButtonIcon = themeMode === "auto" ? <AutoIcon /> : themeMode === "light" ? <SunIcon /> : <MoonIcon />;

  const visibleToolCount = viewportWidth < 720 ? 3 : viewportWidth < 860 ? 4 : viewportWidth < 1040 ? 5 : TOOLBAR_ITEMS.length;
  const visibleTools = TOOLBAR_ITEMS.slice(0, visibleToolCount);
  const overflowTools = TOOLBAR_ITEMS.slice(visibleToolCount);

  const tableStageClassName = [
    "table-stage",
    `index-rails-${chromeVisibilityPhase}`,
    hasVerticalOverlap ? "has-scroll-y" : "",
    hasHorizontalOverlap ? "has-scroll-x" : "",
  ]
    .join(" ")
    .trim();
  const suppressAgHeaderFocus = selectedCell?.area === "header" && selectedCell.logical.rAbs <= headerOverlayRows;

  const tableStageStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--formula-bar-safe-space": `${FORMULA_BAR_SAFE_SPACE}px`,
        "--header-overlay-height": `${headerOverlayHeight}px`,
      }) as CSSProperties,
    [headerOverlayHeight],
  );
  const shouldRenderGrid = Boolean(currentSheet && currentSheetState && activeSheet && !isActiveSheetBlocked);

  return (
    <div className="page">
      <div className={mode === "source" ? "app-window source-mode" : "app-window"}>
        <AppChrome
          mode={mode}
          activeSheet={activeSheet}
          sheetNames={sheetNames}
          sheetHealthByName={sheetHealthByName}
          setActiveSheet={setActiveSheet}
          visibleTools={visibleTools}
          overflowTools={overflowTools}
          toolMenuOpen={toolMenuOpen}
          setToolMenuOpen={setToolMenuOpen}
          themeMenuOpen={themeMenuOpen}
          setThemeMenuOpen={setThemeMenuOpen}
          themeButtonLabel={themeButtonLabel}
          themeButtonIcon={themeButtonIcon}
          themeControlRef={themeControlRef}
          themeButtonRef={themeButtonRef}
          toolButtonRef={toolButtonRef}
          onEnterSourceMode={enterSourceMode}
          onExitSourceMode={exitSourceMode}
          onTabMouseEnter={handleTabMouseEnter}
          onTabMouseLeave={() => setTabTooltip(null)}
        />

        {error ? (
          <div className="error" role="alert">
            <strong>Source has parse or evaluation issues.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {mode === "source" ? (
          <section className="source-shell">
            <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} spellCheck={false} />
          </section>
        ) : (
          <section className="workspace-shell">
            {shouldRenderGrid ? (
              <TableStage
                tableStageClassName={tableStageClassName}
                tableStageStyle={tableStageStyle}
                gridTemplateColumns={gridTemplateColumns}
                renderedColumnCount={renderedColumnCount}
                headerIndexMetrics={headerIndexMetrics}
                headerIndexTrackHeight={headerIndexTrackHeight}
                headerOverlayHeight={headerOverlayHeight}
                headerOverlayCells={headerOverlayCells}
                headerColCount={headerColCount}
                pinnedHeaderWidth={pinnedHeaderWidth}
                rowIndexTrackHeight={rowIndexTrackHeight}
                indexRailsPhase={chromeVisibilityPhase}
                rowIndexMetrics={rowIndexMetrics}
                columnTrackRef={columnTrackRef}
                rowTrackRef={rowTrackRef}
                gridWrapRef={gridWrapRef}
                rowData={rowData}
                columnDefs={columnDefs}
                selectedCell={selectedCell}
                suppressAgHeaderFocus={Boolean(suppressAgHeaderFocus)}
                handleHeaderOverlaySelect={handleHeaderOverlaySelect}
                handleGridReady={handleGridReady}
                handleFirstDataRendered={handleFirstDataRendered}
                handleModelUpdated={handleModelUpdated}
                handleCellFocused={handleCellFocused}
              />
            ) : activeSheet && isActiveSheetBlocked ? (
              <SheetParseErrorPanel sheetName={activeSheet} issues={activeSheetBlockingIssues} onOpenSourceMode={enterSourceMode} />
            ) : (
              <div className="empty-state">
                <h3>No sheet selected</h3>
                <p>Pick a sheet from the tab strip or return to source mode to inspect the document.</p>
              </div>
            )}
          </section>
        )}
      </div>

      <FormulaBarOverlay
        mode={mode}
        phase={chromeVisibilityPhase}
        formulaBarData={formulaBarData}
        formulaBarSnapshot={formulaBarSnapshot}
      />

      <OverlayPortals
        themeMenuOpen={themeMenuOpen}
        themeMenuPosition={themeMenuPosition}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        setThemeMenuOpen={setThemeMenuOpen}
        toolMenuOpen={toolMenuOpen}
        toolMenuPosition={toolMenuPosition}
        overflowTools={overflowTools}
        tabTooltip={tabTooltip}
      />
    </div>
  );
}
