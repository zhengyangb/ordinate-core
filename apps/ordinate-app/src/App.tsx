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

import {
  getCellTextView,
  resolveSheetRowStructure,
  type FormatSpec,
  type RuntimeValue,
  type StylePatch,
} from "@ordinate/core";
import AppChrome from "./components/AppChrome";
import ErrorCellChip from "./components/ErrorCellChip";
import FormulaBarOverlay from "./components/FormulaBarOverlay";
import OverlayPortals from "./components/OverlayPortals";
import SheetParseErrorPanel from "./components/SheetParseErrorPanel";
import TableStage from "./components/TableStage";
import { shouldAnimateTableStructure } from "./config/motion";
import { createAgGridAdapter } from "./grid/agGridAdapter";
import { useStructureTransition } from "./hooks/useStructureTransition";
import { AutoIcon, MoonIcon, SunIcon, TOOLBAR_ITEMS } from "./icons/uiIcons";
import { resolveUiLocale } from "./i18n/messages";
import { useEditorStore } from "./store/editorStore";
import type {
  ColumnMetric,
  ChromeVisibilityPhase,
  FloatingMenuPosition,
  FloatingTooltip,
  FormatLocalKey,
  FormatLocalOptions,
  FormulaBarData,
  GridRow,
  HeaderIndexMetric,
  HeaderOverlayCell,
  RailMenuView,
  RowIndexMetric,
  SheetHealth,
  SheetIssueViewModel,
  SelectedCell,
  ThemeMenuPosition,
  ThemeMode,
} from "./types/ui";
import {
  compactColLabel,
  isVisiblePath,
  runtimeKindLabel,
  runtimeValueToText,
  splitPath,
} from "./utils/sheetView";
import { resolvePostRowStructureColumnIndex, resolveRowInsert } from "./utils/rowStructureEdits";
import {
  BLANK_RUNTIME_VALUE,
  CHROME_TRANSITION_MS,
  CONTROL_TOOLTIP_DELAY_MS,
  DATA_COLUMN_MIN_WIDTH,
  FLOATING_MENU_GAP,
  FLOATING_MENU_VIEWPORT_MARGIN,
  FORMULA_BAR_AUTO_PAN_CLEARANCE,
  FORMULA_BAR_AUTO_PAN_DURATION_MS,
  FORMULA_BAR_SAFE_SPACE,
  GRID_HEADER_HEIGHT,
  GRID_ROW_HEIGHT,
  HEADER_COLUMN_WIDTH,
  LABEL_COLUMN_WIDTH,
  POSITION_EPSILON,
  TAB_TOOLTIP_DELAY_MS,
  THEME_STORAGE_KEY,
  TOOLTIP_ESTIMATED_HEIGHT,
  TOOLTIP_ESTIMATED_WIDTH,
  TOOLTIP_GAP,
  TOOLTIP_VIEWPORT_MARGIN,
  type FormulaInputMode,
  type RingRect,
  buildRailMenu,
  buildColumnHasLocalConfig,
  buildHeaderMatrix,
  buildSheetHealthByName,
  buildSheetIssueBuckets,
  columnMetricsEqual,
  easeOutQuint,
  queryGridBodyViewport,
  resolveAnchoredMenuPosition,
  resolveRailMenuPosition,
  resolveInitialThemeMode,
  ringRectEqual,
  toColFieldId,
  toColumnLetters,
  trimSheetColCount,
} from "./utils/appHelpers";
import { selectionDebugLog } from "./utils/selectionDebug";
import {
  resolveSelectionRingCell,
  resolveSelectionRingRect,
} from "./utils/selectionRing";
import { buildFormulaBarData } from "./utils/formulaBarData";

ModuleRegistry.registerModules([AllCommunityModule]);

type AutoPanTarget = {
  key: string;
  displayedRowIndex: number;
  colId: string;
};

function formatSpecFromLocalKey(key: FormatLocalKey, options: FormatLocalOptions | null): FormatSpec | null {
  if (key === "auto") return null;
  const typeByKey: Record<Exclude<FormatLocalKey, "auto">, NonNullable<FormatSpec["type"]>> = {
    integer: "d",
    decimal: "f",
    scientific: "e",
    percent: "%",
  };
  return {
    sign: options?.sign ?? "default",
    padWidth: options?.padWidth ?? null,
    grouping: options?.grouping ?? false,
    precision: key === "integer" ? null : options?.precision ?? null,
    type: typeByKey[key],
  };
}

export default function App() {
  const uiLocale = useMemo(() => resolveUiLocale(window.navigator.language), []);
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
    renameSheet,
    setCellInput,
    clearCell,
    setCellLocalFormat,
    setCellLocalStyle,
    setColumnDefaultFormat,
    setColumnDefaultStyle,
    clearColumnDefaultFormat,
    previewDeleteRow,
    previewDeleteColumn,
    convertRowsToHeader,
    convertRowsToBody,
    insertRow,
    deleteRow,
    insertColumn,
    deleteColumn,
    enterSourceMode,
    exitSourceMode,
  } = useEditorStore();

  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [selectedColumnIndex, setSelectedColumnIndex] = useState<number | null>(null);
  const [formulaInputMode, setFormulaInputMode] = useState<FormulaInputMode>("read");
  const [formulaBarSnapshot, setFormulaBarSnapshot] = useState<FormulaBarData | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialThemeMode);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [themeMenuPosition, setThemeMenuPosition] = useState<ThemeMenuPosition>({ top: 0, left: 0 });
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolMenuPosition, setToolMenuPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0 });
  const [railMenuOpen, setRailMenuOpen] = useState(false);
  const [railMenuPosition, setRailMenuPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0 });
  const [isIndexRailsHovered, setIsIndexRailsHovered] = useState(false);
  const [openRailMenuTarget, setOpenRailMenuTarget] = useState<
    { kind: "column"; colIndex: number } | { kind: "row"; rowNumber: number; area: "header" | "body"; hasChildren: boolean } | null
  >(null);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const [tooltip, setTooltip] = useState<FloatingTooltip | null>(null);
  const [hasVerticalOverlap, setHasVerticalOverlap] = useState(false);
  const [hasHorizontalOverlap, setHasHorizontalOverlap] = useState(false);
  const [rowIndexMetrics, setRowIndexMetrics] = useState<RowIndexMetric[]>([]);
  const [rowIndexTrackHeight, setRowIndexTrackHeight] = useState(0);
  const [columnMetrics, setColumnMetrics] = useState<ColumnMetric[]>([]);

  const gridViewportAdapter = useMemo(() => createAgGridAdapter(), []);
  const {
    structureTransitionScope,
    isSelectionRingTransitioning,
    isStructureVeilVisible,
    startRowTransition,
    startColumnTransition,
    clearRowTransition,
    clearColumnTransition,
  } = useStructureTransition();
  const selectionRingSyncRafRef = useRef<number | null>(null);
  const autoPanRafRef = useRef<number | null>(null);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const selectionRingRef = useRef<HTMLDivElement | null>(null);
  const selectionRingRectRef = useRef<RingRect | null>(null);
  const selectionRingCellRef = useRef<HTMLElement | null>(null);
  const selectionRingCellKeyRef = useRef<string | null>(null);
  const columnTrackRef = useRef<HTMLDivElement | null>(null);
  const rowTrackRef = useRef<HTMLDivElement | null>(null);
  const gridApiRef = useRef<GridApi<GridRow> | null>(null);
  const pendingHeaderSelectionRef = useRef<{ colId: string; rAbs: number; expiresAt: number } | null>(null);
  const themeControlRef = useRef<HTMLDivElement | null>(null);
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolButtonRef = useRef<HTMLButtonElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const railMenuAnchorRef = useRef<HTMLElement | null>(null);
  const railMenuRef = useRef<HTMLDivElement | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);
  const tooltipAnchorRef = useRef<HTMLElement | null>(null);
  const suppressedTooltipTargetRef = useRef<HTMLElement | null>(null);
  const isGridApiAlive = useCallback((api: GridApi<GridRow> | null): api is GridApi<GridRow> => {
    return Boolean(api && !api.isDestroyed());
  }, []);

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

  const currentSheetRowStructure = useMemo(() => {
    if (!currentSheetState) return [];
    return resolveSheetRowStructure(currentSheetState);
  }, [currentSheetState]);

  const sheetNames = useMemo(() => {
    if (docState?.sheets?.length) {
      return docState.sheets.map((sheet) => sheet.name);
    }
    return evaluation?.sheets.map((sheet) => sheet.name) ?? [];
  }, [docState, evaluation]);

  const sheetIssueBuckets = useMemo(() => {
    return buildSheetIssueBuckets(sheetNames, sheetIssuesByName);
  }, [sheetNames, sheetIssuesByName]);

  const sheetHealthByName = useMemo<Record<string, SheetHealth>>(() => {
    return buildSheetHealthByName(sheetNames, sheetIssueBuckets);
  }, [sheetNames, sheetIssueBuckets]);

  const activeSheetBlockingIssues = useMemo<SheetIssueViewModel[]>(() => {
    if (!activeSheet) return [];
    return sheetIssueBuckets[activeSheet]?.blocking ?? [];
  }, [activeSheet, sheetIssueBuckets]);

  const isActiveSheetBlocked = activeSheetBlockingIssues.length > 0;

  const sheetColCount = useMemo(() => {
    return trimSheetColCount(currentSheetState, currentSheet);
  }, [currentSheetState, currentSheet]);
  const headerRowCount = currentSheetState?.headerRowCount ?? 0;
  const headerColCount = Math.min(currentSheetState?.headerColCount ?? 0, sheetColCount);
  const headerOverlayRows = headerRowCount;
  const headerOverlayHeight = headerOverlayRows * GRID_HEADER_HEIGHT;
  const pinnedHeaderWidth = useMemo(() => {
    return Array.from({ length: headerColCount }, (_, colIndex) => (colIndex === 0 ? LABEL_COLUMN_WIDTH : HEADER_COLUMN_WIDTH)).reduce(
      (sum, width) => sum + width,
      0,
    );
  }, [headerColCount]);

  const headerMatrix = useMemo(() => {
    return buildHeaderMatrix(
      currentSheetState,
      currentSheet,
      currentSheetPresentation,
      sheetColCount,
      headerRowCount,
    );
  }, [currentSheetState, currentSheetPresentation, currentSheet, sheetColCount, headerRowCount]);

  const headerLeafLabels = useMemo(() => {
    if (sheetColCount === 0) return [] as string[];
    const leafRow = headerMatrix[headerMatrix.length - 1] ?? [];
    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const label = leafRow[colIndex] ?? "";
      return compactColLabel(label);
    });
  }, [headerMatrix, sheetColCount]);

  const headerSemanticLabels = useMemo(() => {
    if (sheetColCount === 0) return [] as string[];
    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const fromLabels = currentSheetState?.colLabels[colIndex];
      if (fromLabels && fromLabels.length > 0) return fromLabels;
      return headerLeafLabels[colIndex] ?? `C${colIndex + 1}`;
    });
  }, [currentSheetState, headerLeafLabels, sheetColCount]);

  const columnHasLocalConfig = useMemo<boolean[]>(() => {
    return buildColumnHasLocalConfig(currentSheetPresentation, sheetColCount);
  }, [currentSheetPresentation, sheetColCount]);

  const railMenu = useMemo<RailMenuView | null>(() => {
    return buildRailMenu(
      openRailMenuTarget,
      sheetColCount,
      headerColCount,
      currentSheetState,
      currentSheetPresentation,
      columnHasLocalConfig,
    );
  }, [openRailMenuTarget, sheetColCount, headerColCount, currentSheetState, currentSheetPresentation, columnHasLocalConfig]);

  useEffect(() => {
    if (selectedColumnIndex == null) return;
    if (selectedColumnIndex >= 0 && selectedColumnIndex < sheetColCount) return;
    setSelectedColumnIndex(null);
  }, [selectedColumnIndex, sheetColCount]);

  useEffect(() => {
    if (!openRailMenuTarget) return;
    if (openRailMenuTarget.kind === "column") {
      if (openRailMenuTarget.colIndex >= 0 && openRailMenuTarget.colIndex < sheetColCount) return;
    } else {
      const bodyRowCount = currentSheet?.values.length ?? 0;
      const minRowNumber = openRailMenuTarget.area === "header" ? 1 : headerRowCount + 1;
      const maxRowNumber = openRailMenuTarget.area === "header" ? headerRowCount : headerRowCount + bodyRowCount;
      if (openRailMenuTarget.rowNumber >= minRowNumber && openRailMenuTarget.rowNumber <= maxRowNumber) return;
    }
    setRailMenuOpen(false);
    setOpenRailMenuTarget(null);
    railMenuAnchorRef.current = null;
  }, [openRailMenuTarget, sheetColCount, currentSheet, headerRowCount]);

  const clearActiveSelection = useCallback(() => {
    selectionDebugLog("clearActiveSelection");
    setSelectedCell(null);
    setSelectedColumnIndex(null);
    setFormulaInputMode("read");
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
    setSelectedColumnIndex(null);
    setRailMenuOpen(false);
    setOpenRailMenuTarget(null);
    railMenuAnchorRef.current = null;
    setColumnMetrics([]);
    setFormulaInputMode("read");
    selectionRingRectRef.current = null;
    selectionRingCellRef.current = null;
    selectionRingCellKeyRef.current = null;
    const ring = selectionRingRef.current;
    if (ring) {
      ring.classList.add("is-hidden");
    }
    clearRowTransition();
    clearColumnTransition();
  }, [activeSheet, mode, clearRowTransition, clearColumnTransition]);

  useEffect(() => {
    if (!isActiveSheetBlocked) return;
    setSelectedCell(null);
    setSelectedColumnIndex(null);
    setFormulaInputMode("read");
    setRailMenuOpen(false);
    setOpenRailMenuTarget(null);
    railMenuAnchorRef.current = null;
  }, [isActiveSheetBlocked]);

  useEffect(() => {
    if (mode === "source") {
      setFormulaBarSnapshot(null);
      setFormulaInputMode("read");
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
      const menu = themeMenuRef.current;
      if (!button || !menu) return;
      const rect = button.getBoundingClientRect();
      const nextPosition = resolveAnchoredMenuPosition(rect, menu.getBoundingClientRect(), {
        preferredY: "below",
        align: "end",
      });
      setThemeMenuPosition((current) => {
        if (
          Math.abs(current.top - nextPosition.top) < POSITION_EPSILON &&
          Math.abs(current.left - nextPosition.left) < POSITION_EPSILON
        ) {
          return current;
        }
        return nextPosition;
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
      const menu = toolMenuRef.current;
      if (!button || !menu) return;
      const rect = button.getBoundingClientRect();
      const nextPosition = resolveAnchoredMenuPosition(rect, menu.getBoundingClientRect(), {
        preferredY: "below",
        align: "end",
      });
      setToolMenuPosition((current) => {
        if (
          Math.abs(current.top - nextPosition.top) < POSITION_EPSILON &&
          Math.abs(current.left - nextPosition.left) < POSITION_EPSILON
        ) {
          return current;
        }
        return nextPosition;
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
    if (!railMenuOpen || !railMenu) return;

    const updatePosition = () => {
      const anchor = railMenuAnchorRef.current;
      const menu = railMenuRef.current;
      if (!anchor || !menu) return;
      const nextPosition = resolveRailMenuPosition(anchor.getBoundingClientRect(), menu.getBoundingClientRect());
      setRailMenuPosition((current) => {
        if (
          Math.abs(current.top - nextPosition.top) < POSITION_EPSILON &&
          Math.abs(current.left - nextPosition.left) < POSITION_EPSILON
        ) {
          return current;
        }
        return nextPosition;
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [railMenuOpen, railMenu]);

  useEffect(() => {
    const dismissTooltip = () =>
      setTooltip((current) => {
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

  const clearTooltip = useCallback(() => {
    if (tooltipTimerRef.current != null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    tooltipAnchorRef.current = null;
    setTooltip((current) => {
      if (!current) return current;
      return null;
    });
  }, []);

  const suppressTooltipForTarget = useCallback((target: HTMLElement) => {
    suppressedTooltipTargetRef.current = target;
    clearTooltip();
  }, [clearTooltip]);

  const releaseTooltipForTarget = useCallback((target: HTMLElement) => {
    if (suppressedTooltipTargetRef.current === target) {
      suppressedTooltipTargetRef.current = null;
    }
    clearTooltip();
  }, [clearTooltip]);

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current != null) {
        window.clearTimeout(tooltipTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!tooltip) return;
    let rafId: number | null = null;

    const validateAnchor = () => {
      const anchor = tooltipAnchorRef.current;
      if (!anchor || !anchor.isConnected || anchor.getClientRects().length === 0) {
        clearTooltip();
        return;
      }
      rafId = window.requestAnimationFrame(validateAnchor);
    };

    rafId = window.requestAnimationFrame(validateAnchor);
    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [tooltip, clearTooltip]);

  const buildTooltip = useCallback((text: string, target: HTMLElement): FloatingTooltip => {
    const rect = target.getBoundingClientRect();
    const belowTop = rect.bottom + TOOLTIP_GAP;
    const aboveTop = rect.top - TOOLTIP_GAP;
    const shouldPlaceAbove = belowTop + TOOLTIP_ESTIMATED_HEIGHT > window.innerHeight - TOOLTIP_VIEWPORT_MARGIN;
    const centerLeft = rect.left + rect.width / 2;
    const halfWidth = TOOLTIP_ESTIMATED_WIDTH / 2;
    const shouldAlignLeft = centerLeft - halfWidth < TOOLTIP_VIEWPORT_MARGIN;
    const shouldAlignRight = centerLeft + halfWidth > window.innerWidth - TOOLTIP_VIEWPORT_MARGIN;
    const alignment = shouldAlignLeft ? "left" : shouldAlignRight ? "right" : "center";
    const left = shouldAlignLeft
      ? TOOLTIP_VIEWPORT_MARGIN
      : shouldAlignRight
        ? window.innerWidth - TOOLTIP_VIEWPORT_MARGIN
        : centerLeft;
    return {
      text,
      top: shouldPlaceAbove ? aboveTop : belowTop,
      left,
      placement: shouldPlaceAbove ? "above" : "below",
      alignment,
    };
  }, []);

  const handleTabMouseEnter = useCallback((sheetName: string, target: HTMLButtonElement) => {
    if (target.scrollWidth <= target.clientWidth + 1) {
      clearTooltip();
      return;
    }
    if (tooltipTimerRef.current != null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    const next = buildTooltip(sheetName, target);
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null;
      tooltipAnchorRef.current = target;
      setTooltip((current) => {
        if (
          current &&
          current.text === next.text &&
          current.placement === next.placement &&
          current.alignment === next.alignment &&
          Math.abs(current.top - next.top) < POSITION_EPSILON &&
          Math.abs(current.left - next.left) < POSITION_EPSILON
        ) {
          return current;
        }
        return next;
      });
    }, TAB_TOOLTIP_DELAY_MS);
  }, [buildTooltip, clearTooltip]);

  const showTooltip = useCallback((text: string, target: HTMLElement, delayMs = CONTROL_TOOLTIP_DELAY_MS) => {
    if (suppressedTooltipTargetRef.current === target) {
      return;
    }
    if (tooltipTimerRef.current != null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    const next = buildTooltip(text, target);
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null;
      tooltipAnchorRef.current = target;
      setTooltip((current) => {
        if (
          current &&
          current.text === next.text &&
          current.placement === next.placement &&
          current.alignment === next.alignment &&
          Math.abs(current.top - next.top) < POSITION_EPSILON &&
          Math.abs(current.left - next.left) < POSITION_EPSILON
        ) {
          return current;
        }
        return next;
      });
    }, delayMs);
  }, [buildTooltip]);

  const syncRowIndexMetrics = useCallback((api: GridApi<GridRow> | null) => {
    const snapshot = gridViewportAdapter.collectRowMetrics(isGridApiAlive(api) ? api : null, GRID_ROW_HEIGHT);
    setRowIndexMetrics(snapshot.metrics);
    setRowIndexTrackHeight(snapshot.trackHeight);
  }, [gridViewportAdapter, isGridApiAlive]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      setTooltip(null);
      if (!target?.closest(".theme-control") && !target?.closest(".theme-menu")) {
        setThemeMenuOpen(false);
      }
      if (!target?.closest(".tool-overflow-control") && !target?.closest(".tool-menu")) {
        setToolMenuOpen(false);
      }
      if (
        !target?.closest(".column-index-menu-trigger") &&
        !target?.closest(".row-index-menu-trigger") &&
        !target?.closest(".rail-menu")
      ) {
        setRailMenuOpen(false);
        setOpenRailMenuTarget(null);
        railMenuAnchorRef.current = null;
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
      if (railMenuOpen) {
        setRailMenuOpen(false);
        setOpenRailMenuTarget(null);
        railMenuAnchorRef.current = null;
        return;
      }
      if (mode === "source" || isActiveSheetBlocked) return;
      if (!selectedCell && selectedColumnIndex == null) return;
      clearActiveSelection();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, isActiveSheetBlocked, selectedCell, selectedColumnIndex, clearActiveSelection, themeMenuOpen, toolMenuOpen, railMenuOpen]);

  useEffect(() => {
    const handleEnterToEdit = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.repeat) return;
      if (mode === "source" || isActiveSheetBlocked) return;
      if (!selectedCell || formulaInputMode !== "read") return;
      if (themeMenuOpen || toolMenuOpen || railMenuOpen) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, [contenteditable='true'], .formula-format-menu, .formula-style-menu, .rail-menu, .theme-menu, .tool-menu",
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setFormulaInputMode("edit");
      selectionDebugLog("global enter edit request", {
        rAbs: selectedCell.logical.rAbs,
        cAbs: selectedCell.logical.cAbs,
      });
    };

    window.addEventListener("keydown", handleEnterToEdit);
    return () => window.removeEventListener("keydown", handleEnterToEdit);
  }, [mode, isActiveSheetBlocked, selectedCell, formulaInputMode, themeMenuOpen, toolMenuOpen, railMenuOpen]);

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!selectedCell && selectedColumnIndex == null) return;
      const interactiveRoot = target?.closest(
        ".ag-cell, .ag-header-cell, .ag-header-group-cell, .formula-bar, .formula-format-menu, .formula-style-menu, .source-button, .theme-control, .theme-menu, .tool-overflow-control, .tool-menu, .sheet-tab, .column-index-cell, .column-index-main, .row-index-cell, .row-index-main, .rail-menu, textarea",
      );
      if (interactiveRoot) return;
      clearActiveSelection();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [mode, isActiveSheetBlocked, selectedCell, selectedColumnIndex, clearActiveSelection]);

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

    return currentSheetRowStructure
      .map((rowInfo, rowIndex) => {
        const row = currentSheet.values[rowIndex] ?? [];

        const item: GridRow = {
          __rowKey: `r${rowInfo.absoluteRowNumber}`,
          __rowId: rowInfo.rowId,
          __rowPath: rowInfo.rowPath,
          __absoluteRowNumber: rowInfo.absoluteRowNumber,
          __depth: rowInfo.depth,
          __hasChildren: rowInfo.hasChildren,
          __collapsed: collapsedPaths.has(rowInfo.rowPath),
          __displayLabel: rowInfo.label,
        };

        for (let colIndex = 0; colIndex < sheetColCount; colIndex += 1) {
          const field = toColFieldId(colIndex);
          const presentedCell = currentSheetPresentation?.cells[rowIndex]?.[colIndex] ?? null;
          const rawCell = currentSheetState.cells[rowInfo.absoluteRowIndex]?.[colIndex];
          const runtimeValue = row[colIndex] as RuntimeValue | undefined;
          const displayText = presentedCell?.displayText ?? runtimeValueToText(runtimeValue ?? BLANK_RUNTIME_VALUE);

          if (colIndex < headerColCount) {
            if (colIndex === 0) {
              item[field] = rowInfo.label;
              item[`__kind_${colIndex}`] = "label";
            } else {
              const headerValue = displayText.length > 0
                ? displayText
                : rawCell
                  ? getCellTextView(rawCell).inputText
                  : "";
              item[field] = headerValue;
              item[`__kind_${colIndex}`] = headerValue.length > 0 ? "string" : "blank";
            }
          } else {
            item[field] = displayText;
            item[`__kind_${colIndex}`] = runtimeValue?.kind ?? "blank";
            item[`__align_${colIndex}`] = presentedCell?.styleLayer.effective?.align ?? "";
            item[`__weight_${colIndex}`] = presentedCell?.styleLayer.effective?.weight ?? "";
            item[`__color_${colIndex}`] = presentedCell?.styleLayer.effective?.color ?? "";
            item[`__display_has_errors_${colIndex}`] = (presentedCell?.errors.length ?? 0) > 0;
            item[`__display_source_${colIndex}`] = presentedCell?.source ?? "default";
            if (runtimeValue?.kind === "error") {
              item[`__error_external_${colIndex}`] = runtimeValue.errorKind;
              item[`__error_internal_${colIndex}`] = runtimeValue.internalKind;
              item[`__error_context_${colIndex}`] = JSON.stringify(runtimeValue.context);
            }
          }
        }

        return item;
      })
      .filter((row) => isVisiblePath(row.__rowPath, collapsedPaths));
  }, [currentSheet, currentSheetState, currentSheetPresentation, currentSheetRowStructure, collapsedPaths, sheetColCount, headerColCount]);

  const absoluteRowPathLookup = useMemo(() => {
    const map = new Map<number, string>();
    rowData.forEach((row) => map.set(row.__absoluteRowNumber, row.__rowPath));
    return map;
  }, [rowData]);

  const absoluteRowToDisplayedIndex = useMemo(() => {
    const map = new Map<number, number>();
    rowData.forEach((row, index) => map.set(row.__absoluteRowNumber, index));
    return map;
  }, [rowData]);

  const resolveAbsoluteRowPath = useCallback(
    (rAbs: number): string | null => (absoluteRowPathLookup.has(rAbs) ? absoluteRowPathLookup.get(rAbs) ?? "" : null),
    [absoluteRowPathLookup],
  );


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

  const syncColumnMetrics = useCallback((api: GridApi<GridRow> | null) => {
    if (!isGridApiAlive(api) || sheetColCount === 0) {
      setColumnMetrics((current) => (current.length === 0 ? current : []));
      return;
    }
    const snapshot = gridViewportAdapter.collectColumnMetrics(api, colIndexLookup, sheetColCount);
    setColumnMetrics((current) => (columnMetricsEqual(current, snapshot) ? current : snapshot));
  }, [gridViewportAdapter, colIndexLookup, sheetColCount, isGridApiAlive]);

  const headerOverlayCells = useMemo<HeaderOverlayCell[]>(() => {
    if (mode === "source" || isActiveSheetBlocked || headerOverlayRows === 0 || sheetColCount === 0) {
      return [];
    }
    if (columnMetrics.length < sheetColCount) {
      return [];
    }

    const nextCells: HeaderOverlayCell[] = [];

    for (let rowOffset = 0; rowOffset < headerOverlayRows; rowOffset += 1) {
      let cursor = 0;
      while (cursor < columnMetrics.length) {
        const start = columnMetrics[cursor];
        const label = headerMatrix[rowOffset]?.[start.colIndex] ?? "";
        let end = cursor;
        while (end + 1 < columnMetrics.length) {
          const current = columnMetrics[end];
          const candidate = columnMetrics[end + 1];
          if (candidate.colIndex !== current.colIndex + 1) break;
          if (current.colIndex < headerColCount && candidate.colIndex >= headerColCount) break;
          const candidateLabel = headerMatrix[rowOffset]?.[candidate.colIndex] ?? "";
          if (candidateLabel !== label) break;
          end += 1;
        }

        const left = Math.round(start.left);
        const rightMetric = columnMetrics[end];
        const right = Math.round(rightMetric.left + rightMetric.width);
        const width = Math.max(0, right - left);
        if (width > 0.5) {
          const startCol = start.colIndex + 1;
          const endCol = rightMetric.colIndex + 1;
          const rowNumber = rowOffset + 1;
          nextCells.push({
            key: `r${rowNumber}-c${startCol}-${endCol}`,
            rowNumber,
            label,
            startCol: start.colIndex,
            endCol: rightMetric.colIndex,
            left,
            width,
            top: rowOffset * GRID_HEADER_HEIGHT,
            height: GRID_HEADER_HEIGHT,
          });
        }

        cursor = end + 1;
      }
    }

    return nextCells;
  }, [mode, isActiveSheetBlocked, headerOverlayRows, sheetColCount, columnMetrics, headerMatrix, headerColCount]);

  const syncSelectionRing = useCallback(
    (root: HTMLElement | null) => {
      const ring = selectionRingRef.current;
      if (!ring) {
        return;
      }
      if (mode === "source" || isActiveSheetBlocked || !root || selectedCell?.area !== "body") {
        selectionRingCellRef.current = null;
        selectionRingCellKeyRef.current = null;
        ring.classList.add("is-hidden");
        selectionRingRectRef.current = null;
        return;
      }

      const displayedRowIndex = absoluteRowToDisplayedIndex.get(selectedCell.logical.rAbs);
      if (displayedRowIndex == null) {
        selectionRingCellRef.current = null;
        selectionRingCellKeyRef.current = null;
        ring.classList.add("is-hidden");
        selectionRingRectRef.current = null;
        return;
      }

      const colId = selectedCell.colId;
      const { cell: targetCell, key: targetKey } = resolveSelectionRingCell({
        root,
        displayedRowIndex,
        colId,
        rowKey: `r${selectedCell.logical.rAbs}`,
        cachedCell: selectionRingCellRef.current,
        cachedKey: selectionRingCellKeyRef.current,
      });
      selectionRingCellRef.current = targetCell;
      selectionRingCellKeyRef.current = targetKey;
      const gridShell = root.closest<HTMLElement>(".grid-shell");

      if (!targetCell || !gridShell) {
        selectionRingCellRef.current = null;
        selectionRingCellKeyRef.current = null;
        ring.classList.add("is-hidden");
        selectionRingRectRef.current = null;
        return;
      }

      const nextRect = resolveSelectionRingRect({
        root,
        gridShell,
        targetCell,
        displayedRowIndex,
        gridApi: isGridApiAlive(gridApiRef.current) ? gridApiRef.current : null,
        gridRowHeight: GRID_ROW_HEIGHT,
      });

      ring.classList.remove("is-hidden");
      if (!ringRectEqual(selectionRingRectRef.current, nextRect)) {
        ring.style.transform = `translate3d(${nextRect.left}px, ${nextRect.top}px, 0)`;
        ring.style.width = `${nextRect.width}px`;
        ring.style.height = `${nextRect.height}px`;
        selectionRingRectRef.current = nextRect;
      }
    },
    [mode, isActiveSheetBlocked, selectedCell, resolveAbsoluteRowPath, absoluteRowToDisplayedIndex, isGridApiAlive],
  );

  const scheduleSelectionRingSync = useCallback(() => {
    if (selectionRingSyncRafRef.current != null) {
      window.cancelAnimationFrame(selectionRingSyncRafRef.current);
    }
    selectionRingSyncRafRef.current = window.requestAnimationFrame(() => {
      selectionRingSyncRafRef.current = null;
      syncSelectionRing(gridWrapRef.current);
    });
  }, [syncSelectionRing]);

  useEffect(() => {
    return () => {
      if (selectionRingSyncRafRef.current != null) {
        window.cancelAnimationFrame(selectionRingSyncRafRef.current);
        selectionRingSyncRafRef.current = null;
      }
      if (autoPanRafRef.current != null) {
        window.cancelAnimationFrame(autoPanRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (mode === "source") {
      gridApiRef.current = null;
    }
  }, [mode]);

  const handleGridReady = useCallback(
    (event: GridReadyEvent<GridRow>) => {
      gridApiRef.current = event.api;
      syncRowIndexMetrics(event.api);
      syncColumnMetrics(event.api);
      scheduleSelectionRingSync();
    },
    [syncRowIndexMetrics, syncColumnMetrics, scheduleSelectionRingSync],
  );

  const handleFirstDataRendered = useCallback(
    (event: FirstDataRenderedEvent<GridRow>) => {
      syncRowIndexMetrics(event.api);
      syncColumnMetrics(event.api);
      scheduleSelectionRingSync();
    },
    [syncRowIndexMetrics, syncColumnMetrics, scheduleSelectionRingSync],
  );

  const handleModelUpdated = useCallback(
    (event: ModelUpdatedEvent<GridRow>) => {
      syncRowIndexMetrics(event.api);
      syncColumnMetrics(event.api);
      scheduleSelectionRingSync();
    },
    [syncRowIndexMetrics, syncColumnMetrics, scheduleSelectionRingSync],
  );

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;
    if (!isGridApiAlive(gridApiRef.current)) return;
    syncColumnMetrics(gridApiRef.current);
    scheduleSelectionRingSync();
  }, [mode, isActiveSheetBlocked, activeSheet, rowData.length, scheduleSelectionRingSync, syncColumnMetrics, isGridApiAlive]);

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
        cellRenderer: (params: { data?: GridRow; value?: unknown }) => {
          const kind = params.data?.[`__kind_${colIndex}`];
          if (kind !== "error") {
            return params.value;
          }

          const externalKind = params.data?.[`__error_external_${colIndex}`];
          const internalKind = params.data?.[`__error_internal_${colIndex}`];
          const context = params.data?.[`__error_context_${colIndex}`];
          if (typeof externalKind !== "string" || typeof internalKind !== "string" || typeof context !== "string") {
            throw new Error(`missing error metadata for column ${colIndex}`);
          }

          return (
            <ErrorCellChip
              locale={uiLocale}
              externalKind={externalKind}
              internalKind={internalKind}
              context={context}
              onTooltipEnter={showTooltip}
              onTooltipLeave={clearTooltip}
            />
          );
        },
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
          if (params.data?.[`__weight_${colIndex}`] === "bold") {
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
    uiLocale,
    showTooltip,
    clearTooltip,
  ]);

  const headerIndexMetrics = useMemo<HeaderIndexMetric[]>(() => {
    return Array.from({ length: headerRowCount }, (_, index) => ({
      number: index + 1,
      top: index * GRID_HEADER_HEIGHT,
      height: GRID_HEADER_HEIGHT,
    }));
  }, [headerRowCount]);

  const headerIndexTrackHeight = headerRowCount * GRID_HEADER_HEIGHT;

  const focusHeaderOverlayCell = useCallback((rowNumber: number, colIndex: number) => {
    const root = gridWrapRef.current;
    if (!root) return;
    const gridShell = root.closest<HTMLElement>(".grid-shell");
    if (!gridShell) return;

    const cell = Array.from(gridShell.querySelectorAll<HTMLElement>(".header-matrix-cell")).find((candidate) => {
      const candidateRow = Number(candidate.getAttribute("data-row-number"));
      const startCol = Number(candidate.getAttribute("data-start-col"));
      const endCol = Number(candidate.getAttribute("data-end-col"));
      return (
        Number.isFinite(candidateRow) &&
        Number.isFinite(startCol) &&
        Number.isFinite(endCol) &&
        candidateRow === rowNumber &&
        colIndex >= startCol &&
        colIndex <= endCol
      );
    });
    if (!cell) return;

    cell.tabIndex = 0;
    requestAnimationFrame(() => cell.focus());
  }, []);

  const applyHeaderSelection = useCallback(
    (rowNumber: number, colIndex: number) => {
      if (headerRowCount === 0) return;
      if (colIndex < 0 || colIndex >= sheetColCount) return;

      const clampedRowNumber = Math.max(1, Math.min(rowNumber, headerRowCount));
      const colId = toColFieldId(colIndex);
      pendingHeaderSelectionRef.current = {
        colId,
        rAbs: clampedRowNumber,
        expiresAt: performance.now() + 420,
      };

      selectionDebugLog("header apply selection", {
        rowNumber,
        clampedRowNumber,
        colId,
        colNumber: colIndex + 1,
      });

      setSelectedCell({
        area: "header",
        logical: {
          rAbs: clampedRowNumber,
          cAbs: colIndex,
        },
        colId,
        rowPath: null,
      });
      setSelectedColumnIndex(null);
      setFormulaInputMode("read");
    },
    [headerRowCount, sheetColCount],
  );

  const handleHeaderOverlaySelect = useCallback(
    (rowNumber: number, colIndex: number) => {
      applyHeaderSelection(rowNumber, colIndex);
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.blur();
      }
    },
    [applyHeaderSelection],
  );

  const handleHeaderOverlayDoubleClick = useCallback(
    (rowNumber: number, colIndex: number) => {
      if (mode === "source" || isActiveSheetBlocked) return;
      applyHeaderSelection(rowNumber, colIndex);
      setFormulaInputMode("edit");
      selectionDebugLog("header doubleClick edit request", {
        rowNumber,
        colIndex,
      });
    },
    [mode, isActiveSheetBlocked, applyHeaderSelection],
  );

  const defaultBodyRailColIndex = useMemo(() => {
    if (sheetColCount <= 0) return null;
    return Math.min(Math.max(headerColCount, 0), sheetColCount - 1);
  }, [headerColCount, sheetColCount]);

  const closeRailMenu = useCallback(() => {
    setRailMenuOpen(false);
    setOpenRailMenuTarget(null);
    railMenuAnchorRef.current = null;
  }, []);

  const handleIndexRailsHoverChange = useCallback((hovering: boolean) => {
    setIsIndexRailsHovered(hovering);
  }, []);

  const handleColumnRailSelect = useCallback(
    (colIndex: number) => {
      if (mode === "source" || isActiveSheetBlocked) return;
      if (colIndex < 0 || colIndex >= sheetColCount) return;
      setSelectedColumnIndex(colIndex);
      setSelectedCell(null);
      setFormulaInputMode("read");
      setFormulaBarSnapshot(null);
      closeRailMenu();
    },
    [mode, isActiveSheetBlocked, sheetColCount, closeRailMenu],
  );

  const handleColumnRailMenuOpen = useCallback(
    (colIndex: number, anchorEl: HTMLElement) => {
      if (mode === "source" || isActiveSheetBlocked) return;
      if (colIndex < 0 || colIndex >= sheetColCount) return;
      railMenuAnchorRef.current = anchorEl;
      const anchorRect = anchorEl.getBoundingClientRect();
      setRailMenuPosition({
        top: anchorRect.bottom + FLOATING_MENU_GAP,
        left: anchorRect.left,
      });
      setOpenRailMenuTarget({ kind: "column", colIndex });
      setRailMenuOpen(true);
      setFormulaInputMode("read");
      setFormulaBarSnapshot(null);
    },
    [mode, isActiveSheetBlocked, sheetColCount],
  );

  const handleRowRailMenuOpen = useCallback(
    (rowNumber: number, area: "header" | "body", anchorEl: HTMLElement) => {
      if (mode === "source" || isActiveSheetBlocked) return;
      const row = area === "body" ? rowData.find((candidate) => candidate.__absoluteRowNumber === rowNumber) : null;
      if (area === "body" && !row) return;
      railMenuAnchorRef.current = anchorEl;
      const anchorRect = anchorEl.getBoundingClientRect();
      setRailMenuPosition({
        top: anchorRect.bottom + FLOATING_MENU_GAP,
        left: anchorRect.left,
      });
      setOpenRailMenuTarget({ kind: "row", rowNumber, area, hasChildren: row?.__hasChildren ?? false });
      setRailMenuOpen(true);
      setFormulaInputMode("read");
      setFormulaBarSnapshot(null);
    },
    [mode, isActiveSheetBlocked, rowData],
  );

  const handleRowRailSelect = useCallback(
    (rowNumber: number, area: "header" | "body") => {
      if (mode === "source" || isActiveSheetBlocked) return;
      if (defaultBodyRailColIndex == null) return;
      const targetCol = defaultBodyRailColIndex;
      const colId = toColFieldId(targetCol);
      if (area === "header") {
        if (headerRowCount === 0) return;
        const clampedHeaderRow = Math.max(1, Math.min(rowNumber, headerRowCount));
        applyHeaderSelection(clampedHeaderRow, targetCol);
        focusHeaderOverlayCell(clampedHeaderRow, targetCol);
      } else {
        const rowPath = resolveAbsoluteRowPath(rowNumber);
        setSelectedCell({
          area: "body",
          logical: {
            rAbs: rowNumber,
            cAbs: targetCol,
          },
          colId,
          rowPath,
        });
      }
      setSelectedColumnIndex(null);
      setFormulaInputMode("read");
      closeRailMenu();
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.blur();
      }
    },
    [mode, isActiveSheetBlocked, defaultBodyRailColIndex, headerRowCount, applyHeaderSelection, focusHeaderOverlayCell, closeRailMenu, resolveAbsoluteRowPath],
  );

  useEffect(() => {
    const root = gridWrapRef.current;
    if (!root || mode === "source" || isActiveSheetBlocked || headerRowCount === 0) return;

    const resolveHeaderFocusTarget = (target: HTMLElement | null, clientX?: number) => {
      if (!target) return null;

      const headerCell = target.closest<HTMLElement>(".ag-header-cell, .ag-header-group-cell");
      if (!headerCell) return null;

      const colId =
        clientX == null
          ? gridViewportAdapter.resolveHeaderColIdFromTarget(target, sheetColCount, colIndexLookup)
          : gridViewportAdapter.resolveLeafHeaderColIdAtClientX(root, clientX, colIndexLookup) ??
            gridViewportAdapter.resolveHeaderColIdFromTarget(target, sheetColCount, colIndexLookup);
      if (!colId) return null;

      return {
        rowNumber: headerRowCount,
        colId,
        headerCell,
      };
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".header-matrix-cell")) return;

      const resolved = resolveHeaderFocusTarget(target, event.clientX);
      if (!resolved) return;

      selectionDebugLog("header pointer select", {
        targetClassName: target?.className ?? null,
        ariaRowIndex: resolved.headerCell.getAttribute("aria-rowindex"),
        headerColId: resolved.headerCell.getAttribute("col-id"),
        resolvedRowNumber: resolved.rowNumber,
        resolvedColId: resolved.colId,
      });
      const colNumber = colIndexLookup.get(resolved.colId);
      if (!colNumber) {
        throw new Error(`unknown resolved header colId: ${resolved.colId}`);
      }
      applyHeaderSelection(resolved.rowNumber, colNumber - 1);

      resolved.headerCell.tabIndex = 0;
      focusHeaderOverlayCell(resolved.rowNumber, colNumber - 1);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".header-matrix-cell")) return;

      const resolved = resolveHeaderFocusTarget(target);
      if (!resolved) return;
      selectionDebugLog("header focusin select", {
        targetClassName: target?.className ?? null,
        ariaRowIndex: resolved.headerCell.getAttribute("aria-rowindex"),
        headerColId: resolved.headerCell.getAttribute("col-id"),
        resolvedRowNumber: resolved.rowNumber,
        resolvedColId: resolved.colId,
      });
      const colNumber = colIndexLookup.get(resolved.colId);
      if (!colNumber) {
        throw new Error(`unknown resolved header colId: ${resolved.colId}`);
      }
      applyHeaderSelection(resolved.rowNumber, colNumber - 1);
      focusHeaderOverlayCell(resolved.rowNumber, colNumber - 1);
    };

    root.addEventListener("mousedown", handlePointerDown);
    root.addEventListener("focusin", handleFocusIn);
    return () => {
      root.removeEventListener("mousedown", handlePointerDown);
      root.removeEventListener("focusin", handleFocusIn);
    };
  }, [mode, isActiveSheetBlocked, headerRowCount, sheetColCount, colIndexLookup, gridViewportAdapter, applyHeaderSelection, focusHeaderOverlayCell]);

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;
    const root = gridWrapRef.current;
    const columnTrack = columnTrackRef.current;
    const rowTrack = rowTrackRef.current;
    if (!root || !columnTrack || !rowTrack) return;

    return gridViewportAdapter.attachViewportSync(root, ({ top, left, hasVerticalOverlap: nextVertical, hasHorizontalOverlap: nextHorizontal }) => {
      rowTrack.style.transform = `translateY(${-top}px)`;
      columnTrack.style.transform = `translateX(${-left}px)`;
      syncSelectionRing(root);
      setHasVerticalOverlap((current) => (current === nextVertical ? current : nextVertical));
      setHasHorizontalOverlap((current) => (current === nextHorizontal ? current : nextHorizontal));
    });
  }, [mode, isActiveSheetBlocked, activeSheet, rowData.length, syncSelectionRing, gridViewportAdapter]);

  useEffect(() => {
    scheduleSelectionRingSync();
  }, [scheduleSelectionRingSync, selectedCell, rowData.length, headerOverlayHeight]);

  const handleCellFocused = useCallback(
    (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => {
      if (!event.column) {
        // AG Grid emits a null-focus event when focus moves into external UI
        // (e.g. formula input). Keep logical selection stable and only clear
        // via explicit dismiss paths (Esc/outside click/sheet switch).
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
        selectionDebugLog("handleCellFocused null-row", {
          rawColId,
          pending,
        });
        if (pending && performance.now() <= pending.expiresAt && pending.colId === rawColId) {
          pendingHeaderSelectionRef.current = null;
          selectionDebugLog("handleCellFocused -> pending header", {
            rawColId,
            rAbs: pending.rAbs,
          });
          setSelectedCell({
            area: "header",
            logical: {
              rAbs: pending.rAbs,
              cAbs: colNumber - 1,
            },
            colId: rawColId,
            rowPath: null,
          });
          setSelectedColumnIndex(null);
          setFormulaInputMode("read");
          return;
        }
        if (pending && performance.now() > pending.expiresAt) {
          pendingHeaderSelectionRef.current = null;
        }
        // Ignore ambiguous null-row focus changes (typically blur to external
        // controls like formula input). Header selection is handled via
        // explicit pointer/header-overlay paths.
        return;
      }

      const row = rowData[event.rowIndex];
      if (!row) {
        setSelectedCell(null);
        setSelectedColumnIndex(null);
        setFormulaInputMode("read");
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
      setSelectedColumnIndex(null);
      setFormulaInputMode("read");
    },
    [rowData, colIndexLookup],
  );

  const handleCellDoubleClicked = useCallback(
    (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => {
      // Editing contract:
      // - double-click body cell => enter formula input edit mode
      // - logical selection stays on the cell during/after edit
      if (mode === "source" || isActiveSheetBlocked) return;
      if (event.rowIndex == null || !event.column || !activeSheet) return;

      const rawColId = typeof event.column === "string" ? event.column : event.column.getColId();
      const colNumber = colIndexLookup.get(rawColId);
      if (!colNumber) return;

      const row = rowData[event.rowIndex];
      if (!row) return;

      setSelectedCell({
        area: "body",
        logical: {
          rAbs: row.__absoluteRowNumber,
          cAbs: colNumber - 1,
        },
        colId: rawColId,
        rowPath: row.__rowPath,
      });
      setSelectedColumnIndex(null);
      setFormulaInputMode("edit");
      selectionDebugLog("doubleClick edit request", {
        rowIndex: event.rowIndex,
        colId: rawColId,
      });
    },
    [mode, isActiveSheetBlocked, activeSheet, colIndexLookup, rowData],
  );

  const handleCellKeyDown = useCallback(
    (event: {
      rowIndex: number | null;
      column?: string | { getColId(): string } | null;
      event?: Event | null;
    }) => {
      const keyboardEvent = event.event instanceof KeyboardEvent ? event.event : null;
      if (!keyboardEvent) return;
      if (mode === "source" || isActiveSheetBlocked) return;
      if (event.rowIndex == null || !event.column || !activeSheet) return;

      const rawColId = typeof event.column === "string" ? event.column : event.column.getColId();
      const colNumber = colIndexLookup.get(rawColId);
      if (!colNumber) return;

      const row = rowData[event.rowIndex];
      if (!row) return;

      if (
        keyboardEvent.key === "ArrowUp" &&
        !keyboardEvent.shiftKey &&
        !keyboardEvent.altKey &&
        !keyboardEvent.ctrlKey &&
        !keyboardEvent.metaKey &&
        event.rowIndex === 0 &&
        headerRowCount > 0
      ) {
        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();
        applyHeaderSelection(headerRowCount, colNumber - 1);
        focusHeaderOverlayCell(headerRowCount, colNumber - 1);
        return;
      }

      if (keyboardEvent.key !== "Enter" || keyboardEvent.shiftKey || keyboardEvent.altKey || keyboardEvent.ctrlKey || keyboardEvent.metaKey) return;

      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      setSelectedCell({
        area: "body",
        logical: {
          rAbs: row.__absoluteRowNumber,
          cAbs: colNumber - 1,
        },
        colId: rawColId,
        rowPath: row.__rowPath,
      });
      setSelectedColumnIndex(null);
      setFormulaInputMode("edit");
      selectionDebugLog("enter edit request", {
        rowIndex: event.rowIndex,
        colId: rawColId,
      });
    },
    [mode, isActiveSheetBlocked, activeSheet, colIndexLookup, rowData, headerRowCount, applyHeaderSelection, focusHeaderOverlayCell],
  );

  const formulaBarData = useMemo<FormulaBarData | null>(
    () =>
      buildFormulaBarData({
        currentSheet,
        currentSheetState,
        currentSheetPresentation,
        selectedCell,
        isActiveSheetBlocked,
        sheetColCount,
        headerColCount,
        headerSemanticLabels,
      }),
    [
      currentSheet,
      currentSheetState,
      currentSheetPresentation,
      selectedCell,
      isActiveSheetBlocked,
      sheetColCount,
      headerColCount,
      headerSemanticLabels,
    ],
  );

  useEffect(() => {
    if (selectedCell?.area !== "header") return;
    selectionDebugLog("header formula bar data", {
      selectedCell,
      hasFormulaBarData: formulaBarData != null,
      primaryAddress: formulaBarData?.primaryAddress ?? null,
      displayText: formulaBarData?.displayText ?? null,
      cellText: formulaBarData?.cellText ?? null,
    });
  }, [selectedCell, formulaBarData]);

  const autoPanTarget = useMemo<AutoPanTarget | null>(() => {
    if (!formulaBarData || selectedCell?.area !== "body") return null;
    const displayedRowIndex = absoluteRowToDisplayedIndex.get(selectedCell.logical.rAbs);
    if (displayedRowIndex == null) return null;
    return {
      key: `${selectedCell.logical.rAbs}:${selectedCell.logical.cAbs}:${displayedRowIndex}`,
      displayedRowIndex,
      colId: selectedCell.colId,
    };
  }, [Boolean(formulaBarData), selectedCell, absoluteRowToDisplayedIndex]);
  const autoPanTargetKey = autoPanTarget?.key ?? null;

  const focusBodyCellAt = useCallback(
    (rAbs: number, cAbs: number) => {
      if (mode !== "table" || isActiveSheetBlocked) return;
      if (!isGridApiAlive(gridApiRef.current)) return;

      const displayedRowIndex = absoluteRowToDisplayedIndex.get(rAbs);
      if (displayedRowIndex == null) return;

      const colId = toColFieldId(cAbs);
      const rowPath = resolveAbsoluteRowPath(rAbs);
      setSelectedCell({
        area: "body",
        logical: {
          rAbs,
          cAbs,
        },
        colId,
        rowPath,
      });
      setSelectedColumnIndex(null);
      setFormulaInputMode("read");
      requestAnimationFrame(() => {
        gridApiRef.current?.setFocusedCell(displayedRowIndex, colId);
      });
    },
    [mode, isActiveSheetBlocked, resolveAbsoluteRowPath, absoluteRowToDisplayedIndex, isGridApiAlive],
  );

  const focusSelectedBodyCell = useCallback(() => {
    if (mode !== "table" || isActiveSheetBlocked) return;
    if (!selectedCell || selectedCell.area !== "body") return;
    if (!isGridApiAlive(gridApiRef.current)) return;
    const displayedRowIndex = absoluteRowToDisplayedIndex.get(selectedCell.logical.rAbs);
    if (displayedRowIndex == null) return;
    gridApiRef.current.setFocusedCell(displayedRowIndex, selectedCell.colId);
  }, [mode, isActiveSheetBlocked, selectedCell, absoluteRowToDisplayedIndex, isGridApiAlive]);

  const handleHeaderOverlayKeyDown = useCallback(
    (keyboardEvent: KeyboardEvent, rowNumber: number, colIndex: number) => {
      if (mode === "source" || isActiveSheetBlocked || formulaInputMode !== "read") return;

      const moveHeader = (nextRow: number, nextCol: number) => {
        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();
        applyHeaderSelection(nextRow, nextCol);
        focusHeaderOverlayCell(nextRow, nextCol);
      };

      switch (keyboardEvent.key) {
        case "ArrowLeft":
          if (colIndex > 0) {
            moveHeader(rowNumber, colIndex - 1);
          }
          return;
        case "ArrowRight":
          if (colIndex + 1 < sheetColCount) {
            moveHeader(rowNumber, colIndex + 1);
          }
          return;
        case "ArrowUp":
          if (rowNumber > 1) {
            moveHeader(rowNumber - 1, colIndex);
          }
          return;
        case "ArrowDown":
          if (rowNumber < headerRowCount) {
            moveHeader(rowNumber + 1, colIndex);
            return;
          }
          if (rowData.length > 0) {
            keyboardEvent.preventDefault();
            keyboardEvent.stopPropagation();
            focusBodyCellAt(rowData[0].__absoluteRowNumber, colIndex);
          }
          return;
        default:
          return;
      }
    },
    [
      mode,
      isActiveSheetBlocked,
      formulaInputMode,
      applyHeaderSelection,
      focusHeaderOverlayCell,
      sheetColCount,
      headerRowCount,
      rowData,
      focusBodyCellAt,
    ],
  );

  useEffect(() => {
    if (formulaBarData) {
      setFormulaBarSnapshot(formulaBarData);
      return;
    }

    const timeout = window.setTimeout(() => setFormulaBarSnapshot(null), CHROME_TRANSITION_MS);
    return () => window.clearTimeout(timeout);
  }, [formulaBarData]);

  useEffect(() => {
    if (mode !== "table" || isActiveSheetBlocked || !autoPanTarget) return;

    const root = gridWrapRef.current;
    if (!root) return;

    const viewport = queryGridBodyViewport(root);
    if (!viewport) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let kickoffRaf: number | null = null;

    const runAutoPan = () => {
      const selectedCellElement = root.querySelector<HTMLElement>(
        `.ag-row[row-index="${autoPanTarget.displayedRowIndex}"] .ag-cell[col-id="${autoPanTarget.colId}"]`,
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
  }, [mode, isActiveSheetBlocked, autoPanTargetKey]);

  const chromeVisibilityPhase: ChromeVisibilityPhase =
    mode === "table"
      ? selectedColumnIndex != null
        ? "visible"
        : isIndexRailsHovered || railMenuOpen
          ? "visible"
        : formulaBarData
          ? "visible"
          : formulaBarSnapshot
            ? "hiding"
            : "hidden"
      : "hidden";

  const cellChromeVisibilityPhase: ChromeVisibilityPhase =
    mode === "table"
      ? formulaBarData
        ? "visible"
        : formulaBarSnapshot
          ? "hiding"
          : "hidden"
      : "hidden";

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
  const suppressAgHeaderFocus = selectedCell?.area === "header";

  const tableStageStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--formula-bar-safe-space": `${FORMULA_BAR_SAFE_SPACE}px`,
        "--header-overlay-height": `${headerOverlayHeight}px`,
      }) as CSSProperties,
    [headerOverlayHeight],
  );
  const shouldRenderGrid = Boolean(currentSheet && currentSheetState && activeSheet && !isActiveSheetBlocked);
  const animateTableStructure = shouldAnimateTableStructure();
  const showGridHeader = headerRowCount > 0;
  const isFormulaBarInputEditable = Boolean(selectedCell && activeSheet && !isActiveSheetBlocked);
  const areFormulaBarDisplayControlsEditable = Boolean(
    selectedCell &&
      selectedCell.area === "body" &&
      activeSheet &&
      !isActiveSheetBlocked &&
      selectedCell.logical.rAbs > headerRowCount &&
      selectedCell.logical.cAbs >= headerColCount,
  );
  const handleRenameSheet = useCallback((sheetName: string, nextName: string): string | null => {
    try {
      renameSheet(sheetName, nextName);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [renameSheet]);
  const handleCommitFormulaInput = useCallback((nextInput: string) => {
    if (!selectedCell) {
      throw new Error("formula input commit requires a selected cell");
    }
    if (!activeSheet) {
      throw new Error("formula input commit requires an active sheet");
    }
    const target = {
      kind: "index" as const,
      sheet: activeSheet,
      rowIndex: selectedCell.logical.rAbs - 1,
      colIndex: selectedCell.logical.cAbs,
    };
    if (nextInput === "") {
      clearCell(target);
    } else {
      const input =
        selectedCell.area === "body" && selectedCell.logical.cAbs === 0 && headerColCount > 0
          ? (() => {
              const row = currentSheetRowStructure.find((candidate) => candidate.absoluteRowNumber === selectedCell.logical.rAbs);
              if (!row || row.depth <= 0 || /^\*+(?:\s|$)/.test(nextInput.trim())) return nextInput;
              return `${"*".repeat(row.depth)} ${nextInput}`;
            })()
          : nextInput;
      setCellInput(target, input);
    }
    selectionDebugLog("commit formula input", {
      sheet: activeSheet,
      rAbs: selectedCell.logical.rAbs,
      cAbs: selectedCell.logical.cAbs,
      nextInput,
    });
    setFormulaInputMode("read");
    window.requestAnimationFrame(() => {
      if (selectedCell.area === "header") {
        focusHeaderOverlayCell(selectedCell.logical.rAbs, selectedCell.logical.cAbs);
      } else {
        focusSelectedBodyCell();
      }
    });
  }, [selectedCell, activeSheet, headerColCount, currentSheetRowStructure, clearCell, setCellInput, focusHeaderOverlayCell, focusSelectedBodyCell]);

  const handleSetCellLocalFormat = useCallback((key: FormatLocalKey, options: FormatLocalOptions | null | undefined) => {
    if (!selectedCell || selectedCell.area !== "body" || selectedCell.logical.rAbs <= headerRowCount || selectedCell.logical.cAbs < headerColCount) {
      throw new Error("format edit requires a selected data cell");
    }
    if (!activeSheet) {
      throw new Error("format edit requires an active sheet");
    }
    setCellLocalFormat(
      {
        kind: "index",
        sheet: activeSheet,
        rowIndex: selectedCell.logical.rAbs - 1,
        colIndex: selectedCell.logical.cAbs,
      },
      formatSpecFromLocalKey(key, options ?? null),
    );
    setFormulaInputMode("read");
    window.requestAnimationFrame(() => {
      scheduleSelectionRingSync();
    });
  }, [selectedCell, activeSheet, headerRowCount, headerColCount, setCellLocalFormat, scheduleSelectionRingSync]);

  const handleSetCellLocalStyle = useCallback(<Axis extends "align" | "weight" | "color">(
    axis: Axis,
    value: NonNullable<FormulaBarData["styleLocal"]>[Axis],
  ) => {
    if (!selectedCell || selectedCell.area !== "body" || selectedCell.logical.rAbs <= headerRowCount || selectedCell.logical.cAbs < headerColCount) {
      throw new Error("style edit requires a selected data cell");
    }
    if (!activeSheet) {
      throw new Error("style edit requires an active sheet");
    }
    const patch: StylePatch = {
      [axis]: value === "auto" ? null : value,
    };
    setCellLocalStyle(
      {
        kind: "index",
        sheet: activeSheet,
        rowIndex: selectedCell.logical.rAbs - 1,
        colIndex: selectedCell.logical.cAbs,
      },
      patch,
    );
    setFormulaInputMode("read");
    window.requestAnimationFrame(() => {
      scheduleSelectionRingSync();
    });
  }, [selectedCell, activeSheet, headerRowCount, headerColCount, setCellLocalStyle, scheduleSelectionRingSync]);

  const handleSetColumnDefaultFormat = useCallback((colId: number, key: FormatLocalKey, options: FormatLocalOptions | null) => {
    if (!activeSheet) {
      throw new Error("column format edit requires an active sheet");
    }
    if (key === "auto") {
      clearColumnDefaultFormat(activeSheet, colId);
    } else {
      setColumnDefaultFormat(activeSheet, colId, formatSpecFromLocalKey(key, options));
    }
    setFormulaInputMode("read");
    window.requestAnimationFrame(() => {
      scheduleSelectionRingSync();
    });
  }, [activeSheet, clearColumnDefaultFormat, setColumnDefaultFormat, scheduleSelectionRingSync]);

  const handleSetColumnDefaultStyle = useCallback(<Axis extends "align" | "weight" | "color">(
    colId: number,
    axis: Axis,
    value: NonNullable<FormulaBarData["styleLocal"]>[Axis],
  ) => {
    if (!activeSheet) {
      throw new Error("column style edit requires an active sheet");
    }
    const patch: StylePatch = {
      [axis]: value === "auto" ? null : value,
    };
    setColumnDefaultStyle(activeSheet, colId, patch);
    setFormulaInputMode("read");
    window.requestAnimationFrame(() => {
      scheduleSelectionRingSync();
    });
  }, [activeSheet, setColumnDefaultStyle, scheduleSelectionRingSync]);

  const handleInsertRow = useCallback((rowNumber: number, side: "above" | "below") => {
    if (!activeSheet) {
      throw new Error("row insertion requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("row insertion requires current sheet state");
    }
    if (!currentSheet) {
      throw new Error("row insertion requires current sheet evaluation");
    }
    if (defaultBodyRailColIndex == null) {
      throw new Error("row insertion requires at least one selectable column");
    }
    const { rowGapIndex, depth, nextRowNumber, expandParentRowPath } = resolveRowInsert(
      currentSheetRowStructure,
      rowNumber,
      side,
    );
    if (expandParentRowPath) {
      setCollapsedPaths((prev) => {
        if (!prev.has(expandParentRowPath)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(expandParentRowPath);
        return next;
      });
    }
    const nextColIndex = resolvePostRowStructureColumnIndex(selectedCell, defaultBodyRailColIndex);
    startRowTransition("insert", nextRowNumber);
    insertRow(activeSheet, "body", rowGapIndex, depth);
    closeRailMenu();
    setSelectedColumnIndex(null);
    setSelectedCell({
      area: "body",
      logical: {
        rAbs: nextRowNumber,
        cAbs: nextColIndex,
      },
      colId: toColFieldId(nextColIndex),
      rowPath: null,
    });
    setFormulaInputMode("read");
    window.requestAnimationFrame(() => {
      focusBodyCellAt(nextRowNumber, nextColIndex);
    });
  }, [activeSheet, currentSheet, currentSheetState, currentSheetRowStructure, defaultBodyRailColIndex, selectedCell, startRowTransition, insertRow, closeRailMenu, focusBodyCellAt]);

  const handleDeleteRow = useCallback((rowNumber: number, area: "header" | "body", rowId: number, mode: "node" | "subtree" = "node") => {
    if (!activeSheet) {
      throw new Error("row deletion requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("row deletion requires current sheet state");
    }
    if (area === "body" && defaultBodyRailColIndex == null) {
      throw new Error("row deletion requires at least one selectable column");
    }
    const preview = previewDeleteRow(activeSheet, rowId, mode);
    if (
      preview.affectedFormulaCellCount > 0 &&
      !window.confirm(`Delete this row? ${preview.affectedFormulaCellCount} formula cell(s) reference the deleted row(s).`)
    ) {
      closeRailMenu();
      return;
    }
    if (area === "header") {
      const nextHeaderRowNumber = headerRowCount <= 1 ? null : Math.min(rowNumber, headerRowCount - 1);
      deleteRow(activeSheet, rowId, mode);
      closeRailMenu();
      setFormulaInputMode("read");
      setSelectedColumnIndex(null);
      if (nextHeaderRowNumber == null) {
        clearActiveSelection();
        return;
      }
      const nextColIndex = selectedCell?.logical.cAbs ?? defaultBodyRailColIndex ?? 0;
      setSelectedCell({
        area: "header",
        logical: {
          rAbs: nextHeaderRowNumber,
          cAbs: nextColIndex,
        },
        colId: toColFieldId(nextColIndex),
        rowPath: null,
      });
      window.requestAnimationFrame(() => {
        focusHeaderOverlayCell(nextHeaderRowNumber, nextColIndex);
      });
      return;
    }
    if (defaultBodyRailColIndex == null) {
      throw new Error("row deletion requires at least one selectable column");
    }
    const bodyRowCount = currentSheet?.values.length ?? 0;
    const nextRowNumber = bodyRowCount <= 1 ? null : rowNumber < headerRowCount + bodyRowCount ? rowNumber : rowNumber - 1;
    if (nextRowNumber != null) {
      startRowTransition("delete", nextRowNumber);
    }
    deleteRow(activeSheet, rowId, mode);
    closeRailMenu();
    setFormulaInputMode("read");
    if (bodyRowCount <= 1) {
      clearActiveSelection();
      return;
    }
    if (nextRowNumber == null) {
      throw new Error("row deletion expected a next row number");
    }
    const nextColIndex = resolvePostRowStructureColumnIndex(selectedCell, defaultBodyRailColIndex);
    setSelectedColumnIndex(null);
    setSelectedCell({
      area: "body",
      logical: {
        rAbs: nextRowNumber,
        cAbs: nextColIndex,
      },
      colId: toColFieldId(nextColIndex),
      rowPath: null,
    });
    window.requestAnimationFrame(() => {
      focusBodyCellAt(nextRowNumber, nextColIndex);
    });
  }, [activeSheet, currentSheetState, defaultBodyRailColIndex, currentSheet, selectedCell, previewDeleteRow, deleteRow, closeRailMenu, headerRowCount, clearActiveSelection, focusHeaderOverlayCell, startRowTransition, focusBodyCellAt]);

  const handleConvertRowsToHeader = useCallback((rowId: number) => {
    if (!activeSheet) {
      throw new Error("row conversion requires an active sheet");
    }
    convertRowsToHeader(activeSheet, [rowId]);
    closeRailMenu();
    clearActiveSelection();
    setFormulaInputMode("read");
  }, [activeSheet, convertRowsToHeader, closeRailMenu, clearActiveSelection]);

  const handleConvertRowsToBody = useCallback((rowId: number) => {
    if (!activeSheet) {
      throw new Error("row conversion requires an active sheet");
    }
    convertRowsToBody(activeSheet, [rowId], 0);
    closeRailMenu();
    clearActiveSelection();
    setFormulaInputMode("read");
  }, [activeSheet, convertRowsToBody, closeRailMenu, clearActiveSelection]);

  const handleInsertColumn = useCallback((colIndex: number, side: "left" | "right") => {
    if (!activeSheet) {
      throw new Error("column insertion requires an active sheet");
    }
    const nextColIndex = side === "left" ? colIndex : colIndex + 1;
    startColumnTransition("insert");
    insertColumn(activeSheet, nextColIndex);
    closeRailMenu();
    setSelectedCell(null);
    setSelectedColumnIndex(nextColIndex);
    setFormulaInputMode("read");
  }, [activeSheet, startColumnTransition, insertColumn, closeRailMenu]);

  const handleDeleteColumn = useCallback((colIndex: number) => {
    if (!activeSheet) {
      throw new Error("column deletion requires an active sheet");
    }
    const preview = previewDeleteColumn(activeSheet, colIndex);
    if (
      preview.affectedFormulaCellCount > 0 &&
      !window.confirm(`Delete this column? ${preview.affectedFormulaCellCount} formula cell(s) reference the deleted column.`)
    ) {
      closeRailMenu();
      return;
    }
    startColumnTransition("delete");
    deleteColumn(activeSheet, colIndex);
    closeRailMenu();
    setSelectedCell(null);
    const nextColIndex = colIndex < sheetColCount - 1 ? colIndex : colIndex - 1;
    if (nextColIndex >= headerColCount) {
      setSelectedColumnIndex(nextColIndex);
    } else {
      setSelectedColumnIndex(null);
    }
    setFormulaInputMode("read");
  }, [activeSheet, previewDeleteColumn, startColumnTransition, deleteColumn, closeRailMenu, sheetColCount, headerColCount]);

  const handleRequestFormulaEdit = useCallback(() => {
    if (mode === "source" || isActiveSheetBlocked) return;
    if (!selectedCell) return;
    setFormulaInputMode("edit");
    selectionDebugLog("request formula edit", {
      rAbs: selectedCell.logical.rAbs,
      cAbs: selectedCell.logical.cAbs,
    });
  }, [mode, isActiveSheetBlocked, selectedCell]);

  const handleCancelFormulaEdit = useCallback(() => {
    setFormulaInputMode("read");
    window.requestAnimationFrame(() => {
      focusSelectedBodyCell();
    });
    selectionDebugLog("cancel formula edit");
  }, [focusSelectedBodyCell]);

  return (
    <div className="page">
      <div className={mode === "source" ? "app-window source-mode" : "app-window"}>
        <AppChrome
          mode={mode}
          activeSheet={activeSheet}
          sheetNames={sheetNames}
          sheetHealthByName={sheetHealthByName}
          setActiveSheet={setActiveSheet}
          onRenameSheet={handleRenameSheet}
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
          onTooltipEnter={showTooltip}
          onTooltipLeave={clearTooltip}
          onTooltipSuppress={suppressTooltipForTarget}
          onTooltipRelease={releaseTooltipForTarget}
          onTabMouseEnter={handleTabMouseEnter}
          onTabMouseLeave={clearTooltip}
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
          <section
            className={
              animateTableStructure && isStructureVeilVisible
                ? structureTransitionScope === "column"
                  ? "workspace-shell is-structure-transition is-column-transition"
                  : "workspace-shell is-structure-transition is-row-transition"
                : "workspace-shell"
            }
          >
            {shouldRenderGrid ? (
              <TableStage
                tableStageClassName={tableStageClassName}
                tableStageStyle={tableStageStyle}
                columnMetrics={columnMetrics}
                headerIndexMetrics={headerIndexMetrics}
                headerIndexTrackHeight={headerIndexTrackHeight}
                headerOverlayHeight={headerOverlayHeight}
                headerOverlayCells={headerOverlayCells}
                headerColCount={headerColCount}
                showGridHeader={showGridHeader}
                pinnedHeaderWidth={pinnedHeaderWidth}
                rowIndexTrackHeight={rowIndexTrackHeight}
                indexRailsPhase={chromeVisibilityPhase}
                handleIndexRailsHoverChange={handleIndexRailsHoverChange}
                rowIndexMetrics={rowIndexMetrics}
                columnTrackRef={columnTrackRef}
                rowTrackRef={rowTrackRef}
                gridWrapRef={gridWrapRef}
                rowData={rowData}
                columnDefs={columnDefs}
                selectedCell={selectedCell}
                selectedColumnIndex={selectedColumnIndex}
                columnHasLocalConfig={columnHasLocalConfig}
                suppressAgHeaderFocus={Boolean(suppressAgHeaderFocus)}
                overlayOwnsGridHeader={headerOverlayRows > 0}
                showSelectionRing={mode === "table" && !isActiveSheetBlocked && selectedCell?.area === "body"}
                selectionRingRef={selectionRingRef}
                isSelectionRingTransitioning={isSelectionRingTransitioning}
                handleHeaderOverlaySelect={handleHeaderOverlaySelect}
                handleHeaderOverlayDoubleClick={handleHeaderOverlayDoubleClick}
                handleHeaderOverlayKeyDown={handleHeaderOverlayKeyDown}
                handleColumnRailSelect={handleColumnRailSelect}
                handleColumnRailMenuOpen={handleColumnRailMenuOpen}
                handleRowRailSelect={handleRowRailSelect}
                handleRowRailMenuOpen={handleRowRailMenuOpen}
                handleGridReady={handleGridReady}
                handleFirstDataRendered={handleFirstDataRendered}
                handleModelUpdated={handleModelUpdated}
                handleCellFocused={handleCellFocused}
                handleCellDoubleClicked={handleCellDoubleClicked}
                handleCellKeyDown={handleCellKeyDown}
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
        <FormulaBarOverlay
          locale={uiLocale}
          mode={mode}
          phase={cellChromeVisibilityPhase}
          formulaBarSnapshot={formulaBarSnapshot}
          inputMode={formulaInputMode}
          isInputEditable={isFormulaBarInputEditable}
          areDisplayControlsEditable={areFormulaBarDisplayControlsEditable}
          onRequestEdit={handleRequestFormulaEdit}
          onCancelEdit={handleCancelFormulaEdit}
          onCommitInput={handleCommitFormulaInput}
          onSetLocalFormat={handleSetCellLocalFormat}
          onSetLocalStyle={handleSetCellLocalStyle}
          onDismiss={clearActiveSelection}
          onTooltipEnter={showTooltip}
          onTooltipLeave={clearTooltip}
          onTooltipSuppress={suppressTooltipForTarget}
          onTooltipRelease={releaseTooltipForTarget}
        />
      </div>

      <OverlayPortals
        themeMenuOpen={themeMenuOpen}
        themeMenuPosition={themeMenuPosition}
        themeMenuRef={themeMenuRef}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        setThemeMenuOpen={setThemeMenuOpen}
        toolMenuOpen={toolMenuOpen}
        toolMenuPosition={toolMenuPosition}
        toolMenuRef={toolMenuRef}
        overflowTools={overflowTools}
        railMenuOpen={railMenuOpen}
        railMenuPosition={railMenuPosition}
        railMenu={railMenu}
        railMenuRef={railMenuRef}
        onInsertRowAbove={(rowNumber) => handleInsertRow(rowNumber, "above")}
        onInsertRowBelow={(rowNumber) => handleInsertRow(rowNumber, "below")}
        onDeleteRow={handleDeleteRow}
        onInsertColumnLeft={(colIndex) => handleInsertColumn(colIndex, "left")}
        onInsertColumnRight={(colIndex) => handleInsertColumn(colIndex, "right")}
        onDeleteColumn={handleDeleteColumn}
        onConvertRowsToHeader={handleConvertRowsToHeader}
        onConvertRowsToBody={handleConvertRowsToBody}
        onSetColumnDefaultFormat={handleSetColumnDefaultFormat}
        onSetColumnDefaultStyle={handleSetColumnDefaultStyle}
        tooltip={tooltip}
      />
    </div>
  );
}
