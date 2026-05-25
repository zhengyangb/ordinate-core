import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type CellMouseDownEvent,
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
  LogicalCell,
  RailMenuView,
  Rect,
  RowIndexMetric,
  SheetSelection,
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
  queryGridHorizontalViewport,
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
import { resolveCoreRegionTarget } from "./utils/coreTargets";
import {
  getRectDimensions,
  getSelectionFocus,
  getSelectionRange,
  makeCellSelection,
  makeRangeSelection,
  makeRangeSelectionWithFocus,
} from "./utils/selectionModel";
import {
  makeFormulaPointRect,
  referenceTextForPreferredStyle,
  resolveFormulaReferenceViews,
  type FormulaReferenceContext,
  type FormulaReferenceView,
} from "./utils/formulaPointMode";

ModuleRegistry.registerModules([AllCommunityModule]);

type AutoPanTarget = {
  key: string;
  displayedRowIndex: number;
  colId: string;
};

type FormulaPointPick = {
  anchor: LogicalCell;
  focus: LogicalCell;
  range: Rect;
};

type FormulaReferenceOverlay = {
  tokenId: string;
  rect: Rect;
  colorIndex: number;
  active: boolean;
};

const SELECTION_DRAG_SCROLL_EDGE_PX = 48;
const SELECTION_DRAG_SCROLL_MAX_PX = 24;

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
    setRegion,
    clearRegion,
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
  const [selection, setSelection] = useState<SheetSelection | null>(null);
  const [formulaInputMode, setFormulaInputMode] = useState<FormulaInputMode>("read");
  const [formulaEditSourceCell, setFormulaEditSourceCell] = useState<SelectedCell | null>(null);
  const [formulaDraftInput, setFormulaDraftInput] = useState("");
  const [formulaPointPick, setFormulaPointPick] = useState<FormulaPointPick | null>(null);
  const [formulaPointReferenceRequest, setFormulaPointReferenceRequest] = useState<{ id: number; gestureId: number; text: string } | null>(null);
  const [activeReferenceTokenId, setActiveReferenceTokenId] = useState<string | null>(null);
  const [formulaBarSnapshot, setFormulaBarSnapshot] = useState<FormulaBarData | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialThemeMode);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [themeMenuPosition, setThemeMenuPosition] = useState<ThemeMenuPosition>({ top: 0, left: 0 });
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolMenuPosition, setToolMenuPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0 });
  const [sheetSetupOpen, setSheetSetupOpen] = useState(false);
  const [sheetSetupPosition, setSheetSetupPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0 });
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const [selectionMenuPosition, setSelectionMenuPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0 });
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
  const selectionRangeRef = useRef<HTMLDivElement | null>(null);
  const formulaReferenceOverlayLayerRef = useRef<HTMLDivElement | null>(null);
  const selectionRingRectRef = useRef<RingRect | null>(null);
  const selectionRingCellRef = useRef<HTMLElement | null>(null);
  const selectionRingCellKeyRef = useRef<string | null>(null);
  const selectionRangeRectRef = useRef<RingRect | null>(null);
  const formulaReferenceOverlayRectsRef = useRef<Map<string, RingRect>>(new Map());
  const selectionDragRef = useRef<{ anchor: LogicalCell; focus: LogicalCell } | null>(null);
  const formulaPointDragRef = useRef<{ anchor: LogicalCell; focus: LogicalCell; gestureId: number } | null>(null);
  const formulaPointGestureIdRef = useRef(0);
  const formulaPointReferenceRequestIdRef = useRef(0);
  const selectionDragPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const selectionAutoScrollRafRef = useRef<number | null>(null);
  const suppressCellFocusSelectionUntilRef = useRef(0);
  const columnTrackRef = useRef<HTMLDivElement | null>(null);
  const headerCenterTrackRef = useRef<HTMLDivElement | null>(null);
  const rowTrackRef = useRef<HTMLDivElement | null>(null);
  const gridApiRef = useRef<GridApi<GridRow> | null>(null);
  const pendingHeaderSelectionRef = useRef<{ colId: string; rAbs: number; expiresAt: number } | null>(null);
  const themeControlRef = useRef<HTMLDivElement | null>(null);
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetSetupButtonRef = useRef<HTMLButtonElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const sheetSetupMenuRef = useRef<HTMLDivElement | null>(null);
  const selectionMenuRef = useRef<HTMLDivElement | null>(null);
  const railMenuAnchorRef = useRef<HTMLElement | null>(null);
  const railMenuRef = useRef<HTMLDivElement | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);
  const tooltipAnchorRef = useRef<HTMLElement | null>(null);
  const suppressedTooltipTargetRef = useRef<HTMLElement | null>(null);
  const isGridApiAlive = useCallback((api: GridApi<GridRow> | null): api is GridApi<GridRow> => {
    return Boolean(api && !api.isDestroyed());
  }, []);
  const setSelectedColumnIndex = useCallback((colIndex: number | null) => {
    setSelection((current) => {
      if (colIndex == null) {
        return current?.kind === "column" ? null : current;
      }
      return { kind: "column", colIndex };
    });
  }, []);
  const setSelectedCell = useCallback((cell: SelectedCell | null) => {
    setSelection(cell ? makeCellSelection(cell.logical) : null);
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
  const sheetRowCount = currentSheetState?.cells.length ?? 0;
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

  const headerSemanticLabelPaths = useMemo(() => {
    if (sheetColCount === 0) return [] as string[][];
    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const path = headerMatrix
        .map((row) => compactColLabel(row[colIndex] ?? ""))
        .filter((label) => label.length > 0);
      if (path.length > 0) return path;
      const fromLabels = currentSheetState?.colLabels[colIndex];
      if (fromLabels && fromLabels.length > 0) return [fromLabels];
      return [headerLeafLabels[colIndex] ?? `C${colIndex + 1}`];
    });
  }, [currentSheetState, headerLeafLabels, headerMatrix, sheetColCount]);

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
    if (selection?.kind !== "column") return;
    if (selection.colIndex >= 0 && selection.colIndex < sheetColCount) return;
    setSelectedColumnIndex(null);
  }, [selection, sheetColCount, setSelectedColumnIndex]);

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
    setSelectionMenuOpen(false);
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
    setActiveReferenceTokenId(null);
    setFormulaEditSourceCell(null);
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
    setSheetSetupOpen(false);
    setSelectionMenuOpen(false);
    setOpenRailMenuTarget(null);
    railMenuAnchorRef.current = null;
    setColumnMetrics([]);
    setFormulaInputMode("read");
    selectionRingRectRef.current = null;
    selectionRangeRectRef.current = null;
    formulaReferenceOverlayRectsRef.current.clear();
    selectionRingCellRef.current = null;
    selectionRingCellKeyRef.current = null;
    selectionRingRef.current?.classList.add("is-hidden");
    selectionRangeRef.current?.classList.add("is-hidden");
    formulaReferenceOverlayLayerRef.current?.querySelectorAll<HTMLElement>(".formula-reference-range").forEach((node) => {
      node.classList.add("is-hidden");
    });
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
    setActiveReferenceTokenId(null);
    setFormulaEditSourceCell(null);
    clearRowTransition();
    clearColumnTransition();
  }, [activeSheet, mode, clearRowTransition, clearColumnTransition]);

  useEffect(() => {
    if (!isActiveSheetBlocked) return;
    setSelectedCell(null);
    setSelectedColumnIndex(null);
    setFormulaInputMode("read");
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
    setActiveReferenceTokenId(null);
    setFormulaEditSourceCell(null);
    setRailMenuOpen(false);
    setSheetSetupOpen(false);
    setSelectionMenuOpen(false);
    setOpenRailMenuTarget(null);
    railMenuAnchorRef.current = null;
  }, [isActiveSheetBlocked]);

  useEffect(() => {
    if (mode === "source") {
      setFormulaBarSnapshot(null);
      setFormulaInputMode("read");
      setActiveReferenceTokenId(null);
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
    if (!sheetSetupOpen) return;

    const updatePosition = () => {
      const button = sheetSetupButtonRef.current;
      const menu = sheetSetupMenuRef.current;
      if (!button || !menu) return;
      const nextPosition = resolveAnchoredMenuPosition(button.getBoundingClientRect(), menu.getBoundingClientRect(), {
        preferredY: "below",
        align: "start",
      });
      setSheetSetupPosition((current) => {
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
  }, [sheetSetupOpen]);

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
      if (!target?.closest(".sheet-setup-button") && !target?.closest(".sheet-setup-menu")) {
        setSheetSetupOpen(false);
      }
      if (!target?.closest(".selection-menu")) {
        setSelectionMenuOpen(false);
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
      if (sheetSetupOpen) {
        setSheetSetupOpen(false);
        return;
      }
      if (selectionMenuOpen) {
        setSelectionMenuOpen(false);
        return;
      }
      if (railMenuOpen) {
        setRailMenuOpen(false);
        setOpenRailMenuTarget(null);
        railMenuAnchorRef.current = null;
        return;
      }
      if (mode === "source" || isActiveSheetBlocked) return;
      if (!selection) return;
      clearActiveSelection();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, isActiveSheetBlocked, selection, clearActiveSelection, themeMenuOpen, toolMenuOpen, sheetSetupOpen, selectionMenuOpen, railMenuOpen]);

  useEffect(() => {
    const handleEnterToEdit = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.repeat) return;
      if (mode === "source" || isActiveSheetBlocked) return;
      const focus = getSelectionFocus(selection);
      if (!focus || formulaInputMode !== "read") return;
      if (themeMenuOpen || toolMenuOpen || sheetSetupOpen || selectionMenuOpen || railMenuOpen) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, [contenteditable='true'], .formula-format-menu, .formula-style-menu, .rail-menu, .theme-menu, .tool-menu, .sheet-setup-menu, .selection-menu",
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setFormulaInputMode("edit");
      selectionDebugLog("global enter edit request", {
        rAbs: focus.rAbs,
        cAbs: focus.cAbs,
      });
    };

    window.addEventListener("keydown", handleEnterToEdit);
    return () => window.removeEventListener("keydown", handleEnterToEdit);
  }, [mode, isActiveSheetBlocked, selection, formulaInputMode, themeMenuOpen, toolMenuOpen, sheetSetupOpen, selectionMenuOpen, railMenuOpen]);

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!selection) return;
      const interactiveRoot = target?.closest(
        ".ag-cell, .ag-header-cell, .ag-header-group-cell, .formula-bar, .formula-format-menu, .formula-style-menu, .source-button, .theme-control, .theme-menu, .tool-overflow-control, .tool-menu, .sheet-setup-button, .sheet-setup-menu, .selection-menu, .sheet-tab, .column-index-cell, .column-index-main, .row-index-cell, .row-index-main, .rail-menu, textarea",
      );
      if (interactiveRoot) return;
      clearActiveSelection();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [mode, isActiveSheetBlocked, selection, clearActiveSelection]);

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

  const selectedCell = useMemo<SelectedCell | null>(() => {
    const focus = getSelectionFocus(selection);
    if (!focus) return null;
    if (focus.cAbs < 0 || focus.cAbs >= sheetColCount) return null;
    const area = headerRowCount > 0 && focus.rAbs <= headerRowCount ? "header" : "body";
    return {
      area,
      logical: focus,
      colId: toColFieldId(focus.cAbs),
      rowPath: area === "body" ? resolveAbsoluteRowPath(focus.rAbs) : null,
    };
  }, [selection, sheetColCount, headerRowCount, resolveAbsoluteRowPath]);

  const selectedRange = useMemo(() => getSelectionRange(selection), [selection]);
  const isRangeSelection = selection?.kind === "range";
  const canStartFormulaPointPick = useCallback(() => {
    if (!activeSheet || isActiveSheetBlocked) return false;
    const liveEditor = document.querySelector<HTMLTextAreaElement>(".formula-source-textarea");
    if (!liveEditor && formulaInputMode !== "edit") return false;
    const liveDraft = liveEditor?.value ?? formulaDraftInput;
    return liveDraft.trimStart().startsWith("=");
  }, [formulaInputMode, activeSheet, isActiveSheetBlocked, formulaDraftInput]);
  const selectedColumnIndex = useMemo(() => {
    if (selection?.kind === "column") return selection.colIndex;
    const firstBodyRow = headerRowCount + 1;
    if (
      selection?.kind === "range" &&
      selectedRange &&
      selectedRange.colStart === selectedRange.colEnd &&
      selectedRange.rowStart === firstBodyRow &&
      selectedRange.rowEnd === sheetRowCount
    ) {
      return selectedRange.colStart;
    }
    return null;
  }, [selection, selectedRange, sheetRowCount, headerRowCount]);

  const formulaReferenceContext = useMemo<FormulaReferenceContext>(() => {
    const rowLabelsByAbsoluteIndex = new Map<number, string[]>();
    currentSheet?.rowPaths.forEach((path, index) => {
      const absoluteRowNumber = headerRowCount + index + 1;
      const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
      if (parts.length > 0) {
        rowLabelsByAbsoluteIndex.set(absoluteRowNumber, parts);
      }
    });
    return {
      rowCount: sheetRowCount,
      colCount: sheetColCount,
      headerRowCount,
      rowLabelsByAbsoluteIndex,
      colLabelPathsByIndex: headerSemanticLabelPaths,
      sourceCell: formulaEditSourceCell?.logical ?? null,
    };
  }, [currentSheet, formulaEditSourceCell, headerRowCount, headerSemanticLabelPaths, sheetColCount, sheetRowCount]);

  useEffect(() => {
    if (formulaInputMode !== "edit" || formulaEditSourceCell || !selectedCell) return;
    setFormulaEditSourceCell(selectedCell);
  }, [formulaEditSourceCell, formulaInputMode, selectedCell]);

  const formulaReferenceViews = useMemo<FormulaReferenceView[]>(() => {
    if (formulaInputMode !== "edit" || !formulaDraftInput.trimStart().startsWith("=")) return [];
    return resolveFormulaReferenceViews(formulaDraftInput, formulaReferenceContext);
  }, [formulaDraftInput, formulaInputMode, formulaReferenceContext]);

  useEffect(() => {
    if (formulaInputMode === "edit" || !formulaEditSourceCell) return;
    setFormulaEditSourceCell(null);
  }, [formulaEditSourceCell, formulaInputMode]);

  useEffect(() => {
    if (!activeReferenceTokenId) return;
    if (formulaReferenceViews.some((view) => view.id === activeReferenceTokenId)) return;
    setActiveReferenceTokenId(null);
  }, [activeReferenceTokenId, formulaReferenceViews]);

  const formulaReferenceOverlays = useMemo<FormulaReferenceOverlay[]>(() => {
    return formulaReferenceViews
      .filter((view): view is FormulaReferenceView & { rect: Rect } => view.rect != null)
      .map((view) => ({
        tokenId: view.id,
        rect: view.rect,
        colorIndex: view.colorIndex,
        active: view.id === activeReferenceTokenId,
      }));
  }, [activeReferenceTokenId, formulaReferenceViews]);


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

  const hideSelectionOverlays = useCallback(() => {
    selectionRingCellRef.current = null;
    selectionRingCellKeyRef.current = null;
    selectionRingRectRef.current = null;
    selectionRangeRectRef.current = null;
    selectionRingRef.current?.classList.add("is-hidden");
    selectionRangeRef.current?.classList.add("is-hidden");
  }, []);

  const hideFormulaReferenceOverlays = useCallback(() => {
    formulaReferenceOverlayRectsRef.current.clear();
    formulaReferenceOverlayLayerRef.current?.querySelectorAll<HTMLElement>(".formula-reference-range").forEach((node) => {
      node.classList.add("is-hidden");
    });
  }, []);

  useEffect(() => {
    if (formulaInputMode === "edit") return;
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
    setActiveReferenceTokenId(null);
    hideFormulaReferenceOverlays();
  }, [formulaInputMode, hideFormulaReferenceOverlays]);

  const resolveLogicalCellRect = useCallback(
    (root: HTMLElement, gridShell: HTMLElement, cell: LogicalCell): RingRect | null => {
      if (cell.cAbs < 0 || cell.cAbs >= sheetColCount) return null;

      if (headerRowCount > 0 && cell.rAbs <= headerRowCount) {
        const headerCell = Array.from(gridShell.querySelectorAll<HTMLElement>(".header-matrix-cell")).find((candidate) => {
          const candidateRow = Number(candidate.getAttribute("data-row-number"));
          const startCol = Number(candidate.getAttribute("data-start-col"));
          const endCol = Number(candidate.getAttribute("data-end-col"));
          return (
            Number.isFinite(candidateRow) &&
            Number.isFinite(startCol) &&
            Number.isFinite(endCol) &&
            candidateRow === cell.rAbs &&
            cell.cAbs >= startCol &&
            cell.cAbs <= endCol
          );
        });
        if (!headerCell) return null;
        const startCol = Number(headerCell.getAttribute("data-start-col"));
        const endCol = Number(headerCell.getAttribute("data-end-col"));
        if (!Number.isFinite(startCol) || !Number.isFinite(endCol)) return null;
        const span = Math.max(1, endCol - startCol + 1);
        const slot = Math.max(0, Math.min(span - 1, cell.cAbs - startCol));
        const rect = headerCell.getBoundingClientRect();
        const shellRect = gridShell.getBoundingClientRect();
        const slotWidth = rect.width / span;
        return {
          left: Math.round((rect.left - shellRect.left + slotWidth * slot) * 10) / 10,
          top: Math.round((rect.top - shellRect.top) * 10) / 10,
          width: Math.round(slotWidth * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        };
      }

      const displayedRowIndex = absoluteRowToDisplayedIndex.get(cell.rAbs);
      if (displayedRowIndex == null) return null;
      const colId = toColFieldId(cell.cAbs);
      const { cell: targetCell, key: targetKey } = resolveSelectionRingCell({
        root,
        displayedRowIndex,
        colId,
        rowKey: `r${cell.rAbs}`,
        cachedCell: selectionRingCellRef.current,
        cachedKey: selectionRingCellKeyRef.current,
      });
      selectionRingCellRef.current = targetCell;
      selectionRingCellKeyRef.current = targetKey;
      if (!targetCell) return null;
      return resolveSelectionRingRect({
        root,
        gridShell,
        targetCell,
        displayedRowIndex,
        gridApi: isGridApiAlive(gridApiRef.current) ? gridApiRef.current : null,
        gridRowHeight: GRID_ROW_HEIGHT,
      });
    },
    [absoluteRowToDisplayedIndex, headerRowCount, isGridApiAlive, sheetColCount],
  );

  const syncSelectionRing = useCallback(
    (root: HTMLElement | null) => {
      const ring = selectionRingRef.current;
      const rangeOverlay = selectionRangeRef.current;
      if (!ring || !rangeOverlay) {
        return;
      }
      if (mode === "source" || isActiveSheetBlocked || !root || !selectedCell) {
        hideSelectionOverlays();
        return;
      }

      const gridShell = root.closest<HTMLElement>(".grid-shell");
      if (!gridShell) {
        hideSelectionOverlays();
        return;
      }

      const nextRect = resolveLogicalCellRect(root, gridShell, selectedCell.logical);
      if (!nextRect) {
        hideSelectionOverlays();
        return;
      }

      ring.classList.remove("is-hidden");
      if (!ringRectEqual(selectionRingRectRef.current, nextRect)) {
        ring.style.transform = `translate3d(${nextRect.left}px, ${nextRect.top}px, 0)`;
        ring.style.width = `${nextRect.width}px`;
        ring.style.height = `${nextRect.height}px`;
        selectionRingRectRef.current = nextRect;
      }

      if (!selectedRange || !isRangeSelection) {
        rangeOverlay.classList.add("is-hidden");
        selectionRangeRectRef.current = null;
        return;
      }

      const startRect = resolveLogicalCellRect(root, gridShell, { rAbs: selectedRange.rowStart, cAbs: selectedRange.colStart });
      const endRect = resolveLogicalCellRect(root, gridShell, { rAbs: selectedRange.rowEnd, cAbs: selectedRange.colEnd });
      if (!startRect || !endRect) {
        rangeOverlay.classList.add("is-hidden");
        selectionRangeRectRef.current = null;
        return;
      }
      const left = Math.min(startRect.left, endRect.left);
      const top = Math.min(startRect.top, endRect.top);
      const rangeRect = {
        left,
        top,
        width: Math.max(startRect.left + startRect.width, endRect.left + endRect.width) - left,
        height: Math.max(startRect.top + startRect.height, endRect.top + endRect.height) - top,
      };
      rangeOverlay.classList.remove("is-hidden");
      if (!ringRectEqual(selectionRangeRectRef.current, rangeRect)) {
        rangeOverlay.style.transform = `translate3d(${rangeRect.left}px, ${rangeRect.top}px, 0)`;
        rangeOverlay.style.width = `${rangeRect.width}px`;
        rangeOverlay.style.height = `${rangeRect.height}px`;
        selectionRangeRectRef.current = rangeRect;
      }
    },
    [mode, isActiveSheetBlocked, selectedCell, selectedRange, isRangeSelection, hideSelectionOverlays, resolveLogicalCellRect],
  );

  const syncFormulaReferenceOverlays = useCallback(
    (root: HTMLElement | null) => {
      const layer = formulaReferenceOverlayLayerRef.current;
      if (!layer) return;
      if (mode === "source" || isActiveSheetBlocked || !root || formulaReferenceOverlays.length === 0) {
        hideFormulaReferenceOverlays();
        return;
      }

      const gridShell = root.closest<HTMLElement>(".grid-shell");
      if (!gridShell) {
        hideFormulaReferenceOverlays();
        return;
      }

      const liveTokenIds = new Set(formulaReferenceOverlays.map((overlay) => overlay.tokenId));
      layer.querySelectorAll<HTMLElement>(".formula-reference-range").forEach((node) => {
        const tokenId = node.dataset.tokenId;
        if (!tokenId || liveTokenIds.has(tokenId)) return;
        node.classList.add("is-hidden");
        formulaReferenceOverlayRectsRef.current.delete(tokenId);
      });

      for (const reference of formulaReferenceOverlays) {
        const overlay = layer.querySelector<HTMLElement>(`.formula-reference-range[data-token-id="${CSS.escape(reference.tokenId)}"]`);
        if (!overlay) continue;
        const startRect = resolveLogicalCellRect(root, gridShell, {
          rAbs: reference.rect.rowStart,
          cAbs: reference.rect.colStart,
        });
        const endRect = resolveLogicalCellRect(root, gridShell, {
          rAbs: reference.rect.rowEnd,
          cAbs: reference.rect.colEnd,
        });
        if (!startRect || !endRect) {
          overlay.classList.add("is-hidden");
          formulaReferenceOverlayRectsRef.current.delete(reference.tokenId);
          continue;
        }

        const left = Math.min(startRect.left, endRect.left);
        const top = Math.min(startRect.top, endRect.top);
        const rangeRect = {
          left,
          top,
          width: Math.max(startRect.left + startRect.width, endRect.left + endRect.width) - left,
          height: Math.max(startRect.top + startRect.height, endRect.top + endRect.height) - top,
        };
        overlay.classList.remove("is-hidden");
        if (!ringRectEqual(formulaReferenceOverlayRectsRef.current.get(reference.tokenId) ?? null, rangeRect)) {
          overlay.style.transform = `translate3d(${rangeRect.left}px, ${rangeRect.top}px, 0)`;
          overlay.style.width = `${rangeRect.width}px`;
          overlay.style.height = `${rangeRect.height}px`;
          formulaReferenceOverlayRectsRef.current.set(reference.tokenId, rangeRect);
        }
      }
    },
    [mode, isActiveSheetBlocked, formulaReferenceOverlays, hideFormulaReferenceOverlays, resolveLogicalCellRect],
  );

  const scheduleSelectionRingSync = useCallback(() => {
    if (selectionRingSyncRafRef.current != null) {
      window.cancelAnimationFrame(selectionRingSyncRafRef.current);
    }
    selectionRingSyncRafRef.current = window.requestAnimationFrame(() => {
      selectionRingSyncRafRef.current = null;
      syncSelectionRing(gridWrapRef.current);
      syncFormulaReferenceOverlays(gridWrapRef.current);
    });
  }, [syncSelectionRing, syncFormulaReferenceOverlays]);

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

  const resolveLogicalCellFromPoint = useCallback(
    (clientX: number, clientY: number): LogicalCell | null => {
      const target = document.elementFromPoint(clientX, clientY);
      if (!(target instanceof HTMLElement)) return null;

      const headerCell = target.closest<HTMLElement>(".header-matrix-cell");
      if (headerCell) {
        const rowNumber = Number(headerCell.getAttribute("data-row-number"));
        const startCol = Number(headerCell.getAttribute("data-start-col"));
        const endCol = Number(headerCell.getAttribute("data-end-col"));
        if (!Number.isFinite(rowNumber) || !Number.isFinite(startCol) || !Number.isFinite(endCol)) return null;
        const rect = headerCell.getBoundingClientRect();
        const span = Math.max(1, endCol - startCol + 1);
        const localX = Math.min(Math.max(0, clientX - rect.left), Math.max(0, rect.width - 1));
        const slot = Math.min(span - 1, Math.floor((rect.width > 0 ? localX / rect.width : 0) * span));
        return { rAbs: rowNumber, cAbs: startCol + slot };
      }

      const agCell = target.closest<HTMLElement>(".ag-cell[col-id]");
      const agRow = agCell?.closest<HTMLElement>(".ag-row[row-index]");
      if (!agCell || !agRow) return null;
      const rawColId = agCell.getAttribute("col-id");
      if (!rawColId) return null;
      const colNumber = colIndexLookup.get(rawColId);
      if (!colNumber) return null;
      const displayedRowIndex = Number(agRow.getAttribute("row-index"));
      if (!Number.isFinite(displayedRowIndex)) return null;
      const row = rowData[displayedRowIndex];
      if (!row) return null;
      return { rAbs: row.__absoluteRowNumber, cAbs: colNumber - 1 };
    },
    [colIndexLookup, rowData],
  );

  const requestFormulaPointReference = useCallback(
    (anchor: LogicalCell, focus: LogicalCell, gestureId: number) => {
      if (!canStartFormulaPointPick()) return false;
      const range = makeFormulaPointRect(anchor, focus);
      setFormulaPointPick({ anchor, focus, range });
      const activeReference = activeReferenceTokenId
        ? formulaReferenceViews.find((view) => view.id === activeReferenceTokenId) ?? null
        : null;
      const text = referenceTextForPreferredStyle(range, activeReference?.style ?? "ordinate-label", formulaReferenceContext);
      selectionDebugLog("formula point reference request", {
        anchor,
        focus,
        range,
        activeStyle: activeReference?.style ?? "ordinate-label",
        text,
      });
      const requestId = formulaPointReferenceRequestIdRef.current + 1;
      formulaPointReferenceRequestIdRef.current = requestId;
      setFormulaPointReferenceRequest({
        id: requestId,
        gestureId,
        text,
      });
      scheduleSelectionRingSync();
      return true;
    },
    [activeReferenceTokenId, canStartFormulaPointPick, formulaReferenceContext, formulaReferenceViews, scheduleSelectionRingSync],
  );

  const beginFormulaPointGesture = useCallback(
    (logical: LogicalCell) => {
      const gestureId = formulaPointGestureIdRef.current + 1;
      formulaPointGestureIdRef.current = gestureId;
      if (!requestFormulaPointReference(logical, logical, gestureId)) return false;
      formulaPointDragRef.current = { anchor: logical, focus: logical, gestureId };
      suppressCellFocusSelectionUntilRef.current = performance.now() + 320;
      setRailMenuOpen(false);
      setOpenRailMenuTarget(null);
      railMenuAnchorRef.current = null;
      return true;
    },
    [requestFormulaPointReference],
  );

  const beginSelectionGesture = useCallback(
    (logical: LogicalCell, extend: boolean, drag: boolean) => {
      const anchor =
        extend && selection && (selection.kind === "cell" || selection.kind === "range")
          ? selection.anchor
          : logical;
      const nextSelection = makeRangeSelection(anchor, logical);
      setSelection(nextSelection);
      if (drag) {
        selectionDragRef.current = { anchor, focus: logical };
        suppressCellFocusSelectionUntilRef.current = performance.now() + 320;
      }
      setFormulaInputMode("read");
      setActiveReferenceTokenId(null);
      setFormulaBarSnapshot(null);
      setRailMenuOpen(false);
      setOpenRailMenuTarget(null);
      railMenuAnchorRef.current = null;
    },
    [selection],
  );

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;

    const handleFormulaPointMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".ag-cell, .header-matrix-cell")) return;
      const logical = resolveLogicalCellFromPoint(event.clientX, event.clientY);
      if (!logical) return;
      if (!beginFormulaPointGesture(logical)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const suppressFormulaPointNativeSelection = (event: MouseEvent) => {
      if (performance.now() > suppressCellFocusSelectionUntilRef.current) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".ag-cell, .header-matrix-cell")) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    document.addEventListener("mousedown", handleFormulaPointMouseDown, true);
    document.addEventListener("mouseup", suppressFormulaPointNativeSelection, true);
    document.addEventListener("click", suppressFormulaPointNativeSelection, true);
    return () => {
      document.removeEventListener("mousedown", handleFormulaPointMouseDown, true);
      document.removeEventListener("mouseup", suppressFormulaPointNativeSelection, true);
      document.removeEventListener("click", suppressFormulaPointNativeSelection, true);
    };
  }, [mode, isActiveSheetBlocked, resolveLogicalCellFromPoint, beginFormulaPointGesture]);

  const setKeyboardSelection = useCallback(
    (logical: LogicalCell, extend: boolean) => {
      const anchor =
        extend && selection && (selection.kind === "cell" || selection.kind === "range")
          ? selection.anchor
          : logical;
      setSelection(extend ? makeRangeSelection(anchor, logical) : makeCellSelection(logical));
      setFormulaInputMode("read");
      setFormulaBarSnapshot(null);
    },
    [selection],
  );

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      if (mode === "source" || isActiveSheetBlocked) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".ag-cell, .header-matrix-cell, .persistent-range-selection, .persistent-selection-ring")) return;

      const logical = resolveLogicalCellFromPoint(event.clientX, event.clientY);
      const clickedInsideSelection =
        logical &&
        selectedRange &&
        logical.rAbs >= selectedRange.rowStart &&
        logical.rAbs <= selectedRange.rowEnd &&
        logical.cAbs >= selectedRange.colStart &&
        logical.cAbs <= selectedRange.colEnd;
      if (logical && !clickedInsideSelection) {
        setSelection(makeCellSelection(logical));
      } else if (!logical && !selectedRange) {
        return;
      }

      event.preventDefault();
      setSelectionMenuPosition({
        top: Math.min(event.clientY, window.innerHeight - 48),
        left: Math.min(event.clientX, window.innerWidth - 184),
      });
      setSelectionMenuOpen(true);
      setRailMenuOpen(false);
      setOpenRailMenuTarget(null);
      railMenuAnchorRef.current = null;
      setFormulaInputMode("read");
      setFormulaBarSnapshot(null);
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, [mode, isActiveSheetBlocked, resolveLogicalCellFromPoint, selectedRange]);

  useEffect(() => {
    const computeScrollDelta = (position: number, start: number, end: number) => {
      if (position < start + SELECTION_DRAG_SCROLL_EDGE_PX) {
        const ratio = Math.min(1, Math.max(0, (start + SELECTION_DRAG_SCROLL_EDGE_PX - position) / SELECTION_DRAG_SCROLL_EDGE_PX));
        return -Math.ceil(SELECTION_DRAG_SCROLL_MAX_PX * ratio);
      }
      if (position > end - SELECTION_DRAG_SCROLL_EDGE_PX) {
        const ratio = Math.min(1, Math.max(0, (position - (end - SELECTION_DRAG_SCROLL_EDGE_PX)) / SELECTION_DRAG_SCROLL_EDGE_PX));
        return Math.ceil(SELECTION_DRAG_SCROLL_MAX_PX * ratio);
      }
      return 0;
    };

    const resolveClampedLogicalCellFromPoint = (clientX: number, clientY: number) => {
      const root = gridWrapRef.current;
      if (!root) return null;

      const gridShell = root.closest<HTMLElement>(".grid-shell") ?? root;
      const shellRect = gridShell.getBoundingClientRect();
      const clipRectToShell = (rect: DOMRect) => ({
        left: Math.max(rect.left, shellRect.left),
        right: Math.min(rect.right, shellRect.right),
        top: Math.max(rect.top, shellRect.top),
        bottom: Math.min(rect.bottom, shellRect.bottom),
        width: Math.max(0, Math.min(rect.right, shellRect.right) - Math.max(rect.left, shellRect.left)),
        height: Math.max(0, Math.min(rect.bottom, shellRect.bottom) - Math.max(rect.top, shellRect.top)),
      });
      const centerViewport =
        root.querySelector<HTMLElement>(".ag-center-cols-viewport") ??
        queryGridBodyViewport(root) ??
        root;
      const centerRect = clipRectToShell(centerViewport.getBoundingClientRect());
      const headerCenterRect = gridShell.querySelector<HTMLElement>(".header-matrix-overlay--center")?.getBoundingClientRect();
      const headerPinnedRect = gridShell.querySelector<HTMLElement>(".header-matrix-overlay--pinned")?.getBoundingClientRect();
      const visibleHeaderCenterRect = headerCenterRect ? clipRectToShell(headerCenterRect) : null;
      const visibleHeaderPinnedRect = headerPinnedRect ? clipRectToShell(headerPinnedRect) : null;
      const isHeaderPoint =
        (visibleHeaderCenterRect &&
          clientY >= visibleHeaderCenterRect.top - 1 &&
          clientY <= visibleHeaderCenterRect.bottom + 1) ||
        (visibleHeaderPinnedRect &&
          clientY >= visibleHeaderPinnedRect.top - 1 &&
          clientY <= visibleHeaderPinnedRect.bottom + 1);
      const activeRect = isHeaderPoint
        ? visibleHeaderPinnedRect && clientX < visibleHeaderPinnedRect.right
          ? visibleHeaderPinnedRect
          : visibleHeaderCenterRect ?? visibleHeaderPinnedRect ?? centerRect
        : centerRect;
      if (activeRect.width <= 2 || activeRect.height <= 2) return null;

      const clampedX = Math.min(Math.max(clientX, activeRect.left + 1), activeRect.right - 1);
      const clampedY = Math.min(Math.max(clientY, activeRect.top + 1), activeRect.bottom - 1);
      return resolveLogicalCellFromPoint(clampedX, clampedY);
    };

    const updateSelectionDragFromPoint = (clientX: number, clientY: number) => {
      const drag = selectionDragRef.current;
      if (!drag) return false;
      const logical =
        resolveLogicalCellFromPoint(clientX, clientY) ??
        resolveClampedLogicalCellFromPoint(clientX, clientY);
      if (!logical) return false;
      if (logical.rAbs === drag.focus.rAbs && logical.cAbs === drag.focus.cAbs) return false;
      selectionDragRef.current = { ...drag, focus: logical };
      suppressCellFocusSelectionUntilRef.current = performance.now() + 320;
      setSelection(makeRangeSelection(drag.anchor, logical));
      return true;
    };

    const stopSelectionAutoScroll = () => {
      if (selectionAutoScrollRafRef.current != null) {
        window.cancelAnimationFrame(selectionAutoScrollRafRef.current);
        selectionAutoScrollRafRef.current = null;
      }
      selectionDragPointRef.current = null;
    };

    const tickSelectionAutoScroll = () => {
      selectionAutoScrollRafRef.current = null;
      const drag = selectionDragRef.current;
      const point = selectionDragPointRef.current;
      const root = gridWrapRef.current;
      if (!drag || !point || !root) return;

      const bodyViewport = queryGridBodyViewport(root);
      const horizontalViewport = queryGridHorizontalViewport(root);
      const centerViewport = root.querySelector<HTMLElement>(".ag-center-cols-viewport") ?? horizontalViewport;
      const horizontalRect = centerViewport?.getBoundingClientRect();
      const verticalRect = bodyViewport?.getBoundingClientRect();
      let didScroll = false;

      if (horizontalViewport && horizontalRect && horizontalViewport.scrollWidth > horizontalViewport.clientWidth + 1) {
        const rawDeltaX = computeScrollDelta(point.clientX, horizontalRect.left, horizontalRect.right);
        const maxScrollLeft = Math.max(0, horizontalViewport.scrollWidth - horizontalViewport.clientWidth);
        const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, horizontalViewport.scrollLeft + rawDeltaX));
        if (Math.abs(nextScrollLeft - horizontalViewport.scrollLeft) > 0.5) {
          horizontalViewport.scrollLeft = nextScrollLeft;
          didScroll = true;
        }
      }

      if (bodyViewport && verticalRect && bodyViewport.scrollHeight > bodyViewport.clientHeight + 1) {
        const rawDeltaY = computeScrollDelta(point.clientY, verticalRect.top, verticalRect.bottom);
        const maxScrollTop = Math.max(0, bodyViewport.scrollHeight - bodyViewport.clientHeight);
        const nextScrollTop = Math.min(maxScrollTop, Math.max(0, bodyViewport.scrollTop + rawDeltaY));
        if (Math.abs(nextScrollTop - bodyViewport.scrollTop) > 0.5) {
          bodyViewport.scrollTop = nextScrollTop;
          didScroll = true;
        }
      }

      if (didScroll) {
        updateSelectionDragFromPoint(point.clientX, point.clientY);
        selectionAutoScrollRafRef.current = window.requestAnimationFrame(tickSelectionAutoScroll);
      }
    };

    const ensureSelectionAutoScroll = () => {
      if (selectionAutoScrollRafRef.current != null) return;
      selectionAutoScrollRafRef.current = window.requestAnimationFrame(tickSelectionAutoScroll);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const formulaDrag = formulaPointDragRef.current;
      if (formulaDrag) {
        const logical =
          resolveLogicalCellFromPoint(event.clientX, event.clientY) ??
          resolveClampedLogicalCellFromPoint(event.clientX, event.clientY);
        if (logical && (logical.rAbs !== formulaDrag.focus.rAbs || logical.cAbs !== formulaDrag.focus.cAbs)) {
          formulaPointDragRef.current = { ...formulaDrag, focus: logical };
          requestFormulaPointReference(formulaDrag.anchor, logical, formulaDrag.gestureId);
        }
        event.preventDefault();
        return;
      }
      if (!selectionDragRef.current) return;
      selectionDragPointRef.current = { clientX: event.clientX, clientY: event.clientY };
      updateSelectionDragFromPoint(event.clientX, event.clientY);
      ensureSelectionAutoScroll();
      event.preventDefault();
    };

    const handlePointerUp = () => {
      formulaPointDragRef.current = null;
      selectionDragRef.current = null;
      stopSelectionAutoScroll();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      stopSelectionAutoScroll();
    };
  }, [resolveLogicalCellFromPoint, requestFormulaPointReference]);

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
    (rowNumber: number, colIndex: number, event?: { shiftKey: boolean; button?: number }) => {
      if (event && event.button != null && event.button !== 0) return;
      if (event && beginFormulaPointGesture({ rAbs: rowNumber, cAbs: colIndex })) {
        return;
      }
      if (event) {
        beginSelectionGesture({ rAbs: rowNumber, cAbs: colIndex }, event.shiftKey, true);
      } else {
        applyHeaderSelection(rowNumber, colIndex);
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.blur();
      }
    },
    [applyHeaderSelection, beginFormulaPointGesture, beginSelectionGesture],
  );

  const handleHeaderOverlayDoubleClick = useCallback(
    (rowNumber: number, colIndex: number) => {
      if (mode === "source" || isActiveSheetBlocked) return;
      applyHeaderSelection(rowNumber, colIndex);
      setFormulaEditSourceCell({
        area: "header",
        logical: { rAbs: rowNumber, cAbs: colIndex },
        colId: toColFieldId(colIndex),
        rowPath: null,
      });
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
      if (colIndex < headerColCount) return;
      const firstBodyRow = headerRowCount + 1;
      if (firstBodyRow > sheetRowCount) return;
      const focus = { rAbs: firstBodyRow, cAbs: colIndex };
      const anchor = { rAbs: firstBodyRow, cAbs: colIndex };
      const end = { rAbs: sheetRowCount, cAbs: colIndex };
      setSelection(makeRangeSelectionWithFocus(anchor, end, focus));
      suppressCellFocusSelectionUntilRef.current = performance.now() + 320;
      setFormulaInputMode("read");
      setFormulaBarSnapshot(null);
      closeRailMenu();
    },
    [mode, isActiveSheetBlocked, sheetColCount, headerColCount, headerRowCount, sheetRowCount, closeRailMenu],
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
      if (sheetColCount <= 0) return;
      const clampedRowNumber =
        area === "header"
          ? Math.max(1, Math.min(rowNumber, headerRowCount))
          : rowNumber;
      if (area === "header") {
        if (headerRowCount === 0) return;
      } else if (!absoluteRowToDisplayedIndex.has(clampedRowNumber)) {
        return;
      }
      const firstDataCol = headerColCount;
      if (firstDataCol >= sheetColCount) return;
      const focus = {
        rAbs: clampedRowNumber,
        cAbs: firstDataCol,
      };
      setSelection(makeRangeSelectionWithFocus(
        { rAbs: clampedRowNumber, cAbs: firstDataCol },
        { rAbs: clampedRowNumber, cAbs: sheetColCount - 1 },
        focus,
      ));
      suppressCellFocusSelectionUntilRef.current = performance.now() + 320;
      setFormulaInputMode("read");
      closeRailMenu();
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.blur();
      }
    },
    [mode, isActiveSheetBlocked, sheetColCount, headerRowCount, headerColCount, absoluteRowToDisplayedIndex, closeRailMenu],
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
    const headerCenterTrack = headerCenterTrackRef.current;
    const rowTrack = rowTrackRef.current;
    if (!root || !columnTrack || !rowTrack) return;

    return gridViewportAdapter.attachViewportSync(root, ({ top, left, hasVerticalOverlap: nextVertical, hasHorizontalOverlap: nextHorizontal }) => {
      rowTrack.style.transform = `translateY(${-top}px)`;
      columnTrack.style.transform = `translateX(${-left}px)`;
      if (headerCenterTrack) {
        headerCenterTrack.style.transform = `translateX(${-left}px)`;
      }
      syncSelectionRing(root);
      syncFormulaReferenceOverlays(root);
      setHasVerticalOverlap((current) => (current === nextVertical ? current : nextVertical));
      setHasHorizontalOverlap((current) => (current === nextHorizontal ? current : nextHorizontal));
    });
  }, [mode, isActiveSheetBlocked, activeSheet, rowData.length, headerOverlayHeight, syncSelectionRing, syncFormulaReferenceOverlays, gridViewportAdapter]);

  useEffect(() => {
    scheduleSelectionRingSync();
  }, [scheduleSelectionRingSync, selectedCell, selectedRange, formulaReferenceOverlays, rowData.length, headerOverlayHeight]);

  const handleCellMouseDown = useCallback(
    (event: CellMouseDownEvent<GridRow>) => {
      if (mode === "source" || isActiveSheetBlocked) return;
      const mouseEvent = event.event instanceof MouseEvent ? event.event : null;
      if (mouseEvent && mouseEvent.button !== 0) return;

      const rawColId = event.column.getColId();
      const colNumber = colIndexLookup.get(rawColId);
      if (!colNumber || event.rowIndex == null) return;
      const row = rowData[event.rowIndex];
      if (!row) return;
      const logical = {
        rAbs: row.__absoluteRowNumber,
        cAbs: colNumber - 1,
      };

      if (beginFormulaPointGesture(logical)) {
        mouseEvent?.preventDefault();
        mouseEvent?.stopPropagation();
        return;
      }

      beginSelectionGesture(
        logical,
        mouseEvent?.shiftKey === true,
        true,
      );
    },
    [mode, isActiveSheetBlocked, colIndexLookup, rowData, beginFormulaPointGesture, beginSelectionGesture],
  );

  const handleCellFocused = useCallback(
    (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => {
      if (performance.now() <= suppressCellFocusSelectionUntilRef.current) {
        return;
      }
      const liveFormulaEditor = document.querySelector<HTMLTextAreaElement>(".formula-source-textarea");
      if (liveFormulaEditor?.value.trimStart().startsWith("=")) {
        return;
      }
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

      const editSourceCell = {
        area: "body",
        logical: {
          rAbs: row.__absoluteRowNumber,
          cAbs: colNumber - 1,
        },
        colId: rawColId,
        rowPath: row.__rowPath,
      } satisfies SelectedCell;
      setSelectedCell(editSourceCell);
      setSelectedColumnIndex(null);
      setFormulaEditSourceCell(editSourceCell);
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
        keyboardEvent.shiftKey &&
        !keyboardEvent.altKey &&
        !keyboardEvent.ctrlKey &&
        !keyboardEvent.metaKey &&
        (keyboardEvent.key === "ArrowUp" ||
          keyboardEvent.key === "ArrowDown" ||
          keyboardEvent.key === "ArrowLeft" ||
          keyboardEvent.key === "ArrowRight")
      ) {
        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();
        let nextRowNumber = row.__absoluteRowNumber;
        let nextColIndex = colNumber - 1;
        if (keyboardEvent.key === "ArrowLeft") {
          nextColIndex = Math.max(0, nextColIndex - 1);
        } else if (keyboardEvent.key === "ArrowRight") {
          nextColIndex = Math.min(sheetColCount - 1, nextColIndex + 1);
        } else if (keyboardEvent.key === "ArrowUp") {
          if (event.rowIndex > 0) {
            nextRowNumber = rowData[event.rowIndex - 1].__absoluteRowNumber;
          } else if (headerRowCount > 0) {
            nextRowNumber = headerRowCount;
          }
        } else if (keyboardEvent.key === "ArrowDown" && event.rowIndex + 1 < rowData.length) {
          nextRowNumber = rowData[event.rowIndex + 1].__absoluteRowNumber;
        }
        setKeyboardSelection({ rAbs: nextRowNumber, cAbs: nextColIndex }, true);
        return;
      }

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
      const editSourceCell =
        selectedCell?.logical.rAbs === row.__absoluteRowNumber && selectedCell.logical.cAbs === colNumber - 1
          ? selectedCell
          : ({
              area: "body",
              logical: { rAbs: row.__absoluteRowNumber, cAbs: colNumber - 1 },
              colId: rawColId,
              rowPath: row.__rowPath,
            } satisfies SelectedCell);
      setFormulaEditSourceCell(editSourceCell);
      setFormulaInputMode("edit");
      selectionDebugLog("enter edit request", {
        rAbs: selectedCell?.logical.rAbs ?? row.__absoluteRowNumber,
        cAbs: selectedCell?.logical.cAbs ?? colNumber - 1,
      });
    },
    [mode, isActiveSheetBlocked, activeSheet, colIndexLookup, rowData, headerRowCount, sheetColCount, applyHeaderSelection, focusHeaderOverlayCell, setKeyboardSelection, selectedCell],
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
    suppressCellFocusSelectionUntilRef.current = performance.now() + 320;
    gridApiRef.current.setFocusedCell(displayedRowIndex, selectedCell.colId);
  }, [mode, isActiveSheetBlocked, selectedCell, absoluteRowToDisplayedIndex, isGridApiAlive]);

  const handleHeaderOverlayKeyDown = useCallback(
    (keyboardEvent: KeyboardEvent, rowNumber: number, colIndex: number) => {
      if (mode === "source" || isActiveSheetBlocked || formulaInputMode !== "read") return;

      const moveHeader = (nextRow: number, nextCol: number) => {
        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();
        const nextLogical = { rAbs: nextRow, cAbs: nextCol };
        if (keyboardEvent.shiftKey && !keyboardEvent.altKey && !keyboardEvent.ctrlKey && !keyboardEvent.metaKey) {
          setKeyboardSelection(nextLogical, true);
        } else {
          applyHeaderSelection(nextRow, nextCol);
        }
        if (nextRow <= headerRowCount) {
          focusHeaderOverlayCell(nextRow, nextCol);
        }
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
            if (keyboardEvent.shiftKey && !keyboardEvent.altKey && !keyboardEvent.ctrlKey && !keyboardEvent.metaKey) {
              setKeyboardSelection({ rAbs: rowData[0].__absoluteRowNumber, cAbs: colIndex }, true);
            } else {
              focusBodyCellAt(rowData[0].__absoluteRowNumber, colIndex);
            }
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
      setKeyboardSelection,
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
  const placeholderToolCount = Math.max(0, visibleToolCount - 1);
  const visibleTools = TOOLBAR_ITEMS.slice(1, 1 + placeholderToolCount);
  const overflowTools = TOOLBAR_ITEMS.slice(1 + placeholderToolCount);

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
  const canApplyFormulaInputToSelection = useMemo(() => {
    if (!activeSheet || !currentSheetState || !selectedRange || !isRangeSelection || isActiveSheetBlocked) return false;
    const rowCount = currentSheetState.cells.length;
    if (selectedRange.rowStart < 1 || selectedRange.rowEnd > rowCount) return false;
    if (selectedRange.colStart < 0 || selectedRange.colEnd >= sheetColCount) return false;
    for (let rowNumber = selectedRange.rowStart; rowNumber <= selectedRange.rowEnd; rowNumber += 1) {
      if (rowNumber > headerRowCount && !absoluteRowToDisplayedIndex.has(rowNumber)) {
        return false;
      }
    }
    return true;
  }, [
    activeSheet,
    currentSheetState,
    selectedRange,
    isRangeSelection,
    isActiveSheetBlocked,
    sheetColCount,
    headerRowCount,
    absoluteRowToDisplayedIndex,
  ]);
  const canClearSelectedRegion = useMemo(() => {
    if (!activeSheet || !currentSheetState || !selectedRange || isActiveSheetBlocked) return false;
    const rowCount = currentSheetState.cells.length;
    if (selectedRange.rowStart < 1 || selectedRange.rowEnd > rowCount) return false;
    if (selectedRange.colStart < 0 || selectedRange.colEnd >= sheetColCount) return false;
    for (let rowNumber = selectedRange.rowStart; rowNumber <= selectedRange.rowEnd; rowNumber += 1) {
      if (rowNumber > headerRowCount && !absoluteRowToDisplayedIndex.has(rowNumber)) {
        return false;
      }
    }
    return true;
  }, [
    activeSheet,
    currentSheetState,
    selectedRange,
    isActiveSheetBlocked,
    sheetColCount,
    headerRowCount,
    absoluteRowToDisplayedIndex,
  ]);
  const handleRenameSheet = useCallback((sheetName: string, nextName: string): string | null => {
    try {
      renameSheet(sheetName, nextName);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [renameSheet]);
  const handleCommitFormulaInput = useCallback((nextInput: string) => {
    if (!formulaEditSourceCell) {
      throw new Error("formula input commit requires an edit source cell");
    }
    if (!activeSheet) {
      throw new Error("formula input commit requires an active sheet");
    }
    const target = {
      kind: "index" as const,
      sheet: activeSheet,
      rowIndex: formulaEditSourceCell.logical.rAbs - 1,
      colIndex: formulaEditSourceCell.logical.cAbs,
    };
    if (nextInput === "") {
      clearCell(target);
    } else {
      const input =
        formulaEditSourceCell.area === "body" && formulaEditSourceCell.logical.cAbs === 0 && headerColCount > 0
          ? (() => {
              const row = currentSheetRowStructure.find((candidate) => candidate.absoluteRowNumber === formulaEditSourceCell.logical.rAbs);
              if (!row || row.depth <= 0 || /^\*+(?:\s|$)/.test(nextInput.trim())) return nextInput;
              return `${"*".repeat(row.depth)} ${nextInput}`;
            })()
          : nextInput;
      setCellInput(target, input);
    }
    selectionDebugLog("commit formula input", {
      sheet: activeSheet,
      rAbs: formulaEditSourceCell.logical.rAbs,
      cAbs: formulaEditSourceCell.logical.cAbs,
      nextInput,
    });
    setFormulaInputMode("read");
    setSelectedCell(formulaEditSourceCell);
    setFormulaDraftInput(nextInput);
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
    setActiveReferenceTokenId(null);
    setFormulaEditSourceCell(null);
    window.requestAnimationFrame(() => {
      if (formulaEditSourceCell.area === "header") {
        focusHeaderOverlayCell(formulaEditSourceCell.logical.rAbs, formulaEditSourceCell.logical.cAbs);
      } else {
        focusBodyCellAt(formulaEditSourceCell.logical.rAbs, formulaEditSourceCell.logical.cAbs);
      }
    });
  }, [formulaEditSourceCell, activeSheet, headerColCount, currentSheetRowStructure, clearCell, setCellInput, focusHeaderOverlayCell, focusBodyCellAt]);

  const handleApplyFormulaInputToSelection = useCallback((nextInput: string) => {
    if (!currentSheetState || !selectedRange || !isRangeSelection) {
      throw new Error("apply to selection requires a selected rectangular range");
    }
    if (!canApplyFormulaInputToSelection) {
      throw new Error("selected range must be a visible contiguous semantic rectangle");
    }
    const target = resolveCoreRegionTarget(
      currentSheetState,
      { rAbs: selectedRange.rowStart, cAbs: selectedRange.colStart },
      { rAbs: selectedRange.rowEnd, cAbs: selectedRange.colEnd },
    );
    if (nextInput === "") {
      clearRegion(target);
    } else {
      const dimensions = getRectDimensions(selectedRange);
      const values = Array.from({ length: dimensions.rows }, () => Array.from({ length: dimensions.cols }, () => nextInput));
      setRegion(target, values);
    }
    setFormulaInputMode("read");
    setFormulaDraftInput(nextInput);
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
    setActiveReferenceTokenId(null);
    window.requestAnimationFrame(() => {
      if (selectedCell?.area === "header") {
        focusHeaderOverlayCell(selectedCell.logical.rAbs, selectedCell.logical.cAbs);
      } else {
        focusSelectedBodyCell();
      }
    });
  }, [
    currentSheetState,
    selectedRange,
    isRangeSelection,
    canApplyFormulaInputToSelection,
    clearRegion,
    setRegion,
    selectedCell,
    focusHeaderOverlayCell,
    focusSelectedBodyCell,
  ]);

  const handleClearSelectedRegion = useCallback(() => {
    if (!currentSheetState || !selectedRange) {
      throw new Error("clear selection requires a selected semantic rectangle");
    }
    if (!canClearSelectedRegion) {
      throw new Error("selected range must be a visible contiguous semantic rectangle");
    }
    const target = resolveCoreRegionTarget(
      currentSheetState,
      { rAbs: selectedRange.rowStart, cAbs: selectedRange.colStart },
      { rAbs: selectedRange.rowEnd, cAbs: selectedRange.colEnd },
    );
    clearRegion(target);
    setSelectionMenuOpen(false);
    setFormulaInputMode("read");
    window.requestAnimationFrame(() => {
      if (selectedCell?.area === "header") {
        focusHeaderOverlayCell(selectedCell.logical.rAbs, selectedCell.logical.cAbs);
      } else {
        focusSelectedBodyCell();
      }
    });
  }, [
    currentSheetState,
    selectedRange,
    canClearSelectedRegion,
    clearRegion,
    selectedCell,
    focusHeaderOverlayCell,
    focusSelectedBodyCell,
  ]);

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

  const handleInsertRow = useCallback((rowNumber: number, side: "above" | "below", area: "header" | "body") => {
    if (!activeSheet) {
      throw new Error("row insertion requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("row insertion requires current sheet state");
    }
    if (area === "header") {
      const rowGapIndex = side === "above" ? rowNumber - 1 : rowNumber;
      const nextRowNumber = side === "above" ? rowNumber : rowNumber + 1;
      if (rowGapIndex < 0 || rowGapIndex > headerRowCount) {
        throw new Error("header row insertion gap must be inside the header region");
      }
      const nextColIndex = selectedCell?.logical.cAbs ?? defaultBodyRailColIndex ?? 0;
      startRowTransition("insert", nextRowNumber);
      insertRow(activeSheet, "header", rowGapIndex, 0);
      closeRailMenu();
      setSelectedColumnIndex(null);
      setSelectedCell({
        area: "header",
        logical: {
          rAbs: nextRowNumber,
          cAbs: nextColIndex,
        },
        colId: toColFieldId(nextColIndex),
        rowPath: null,
      });
      setFormulaInputMode("read");
      window.requestAnimationFrame(() => {
        focusHeaderOverlayCell(nextRowNumber, nextColIndex);
      });
      return;
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
  }, [activeSheet, currentSheet, currentSheetState, currentSheetRowStructure, defaultBodyRailColIndex, selectedCell, headerRowCount, startRowTransition, insertRow, closeRailMenu, focusHeaderOverlayCell, focusBodyCellAt]);

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

  const maxHeaderRowCount = useMemo(() => {
    const rowCount = currentSheetState?.rowIds.length ?? 0;
    return Math.max(0, rowCount - 1);
  }, [currentSheetState]);

  const handleSetHeaderRowCount = useCallback((nextCount: number) => {
    if (!activeSheet) {
      throw new Error("header row conversion requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("header row conversion requires current sheet state");
    }
    const targetCount = Math.max(0, Math.min(maxHeaderRowCount, nextCount));
    if (targetCount === headerRowCount) return;
    const rowIds = currentSheetState.rowIds;
    if (targetCount > headerRowCount) {
      const rowIdsToPromote = rowIds.slice(headerRowCount, targetCount);
      if (rowIdsToPromote.length !== targetCount - headerRowCount) {
        throw new Error("header row conversion target exceeds available body rows");
      }
      convertRowsToHeader(activeSheet, rowIdsToPromote);
    } else {
      const rowIdsToDemote = rowIds.slice(targetCount, headerRowCount);
      if (rowIdsToDemote.length !== headerRowCount - targetCount) {
        throw new Error("header row conversion target exceeds available header rows");
      }
      convertRowsToBody(activeSheet, rowIdsToDemote, 0);
    }
    clearActiveSelection();
    setFormulaInputMode("read");
  }, [
    activeSheet,
    currentSheetState,
    maxHeaderRowCount,
    headerRowCount,
    convertRowsToHeader,
    convertRowsToBody,
    clearActiveSelection,
  ]);

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
    setFormulaDraftInput(formulaBarSnapshot?.inputText ?? "");
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
    setActiveReferenceTokenId(null);
    setFormulaEditSourceCell(selectedCell);
    setFormulaInputMode("edit");
    selectionDebugLog("request formula edit", {
      rAbs: selectedCell.logical.rAbs,
      cAbs: selectedCell.logical.cAbs,
    });
  }, [mode, isActiveSheetBlocked, selectedCell, formulaBarSnapshot?.inputText]);

  const handleFormulaDraftInputChange = useCallback((nextInput: string) => {
    setFormulaDraftInput(nextInput);
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
  }, []);

  const handleCancelFormulaEdit = useCallback(() => {
    if (!formulaEditSourceCell) {
      throw new Error("formula edit cancel requires an edit source cell");
    }
    setFormulaInputMode("read");
    setFormulaDraftInput(formulaBarSnapshot?.inputText ?? "");
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
    setActiveReferenceTokenId(null);
    setSelectedCell(formulaEditSourceCell);
    setFormulaEditSourceCell(null);
    window.requestAnimationFrame(() => {
      if (formulaEditSourceCell.area === "header") {
        focusHeaderOverlayCell(formulaEditSourceCell.logical.rAbs, formulaEditSourceCell.logical.cAbs);
      } else {
        focusBodyCellAt(formulaEditSourceCell.logical.rAbs, formulaEditSourceCell.logical.cAbs);
      }
    });
    selectionDebugLog("cancel formula edit");
  }, [formulaBarSnapshot?.inputText, formulaEditSourceCell, focusBodyCellAt, focusHeaderOverlayCell]);

  const handleCancelFormulaPointPick = useCallback(() => {
    formulaPointDragRef.current = null;
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
  }, []);

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
          sheetSetupOpen={sheetSetupOpen}
          sheetSetupButtonRef={sheetSetupButtonRef}
          onToggleSheetSetup={() => {
            setSheetSetupOpen((open) => !open);
            setToolMenuOpen(false);
            setThemeMenuOpen(false);
          }}
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
                headerCenterTrackRef={headerCenterTrackRef}
                rowTrackRef={rowTrackRef}
                gridWrapRef={gridWrapRef}
                rowData={rowData}
                columnDefs={columnDefs}
                selectedCell={selectedCell}
                selectedColumnIndex={selectedColumnIndex}
                columnHasLocalConfig={columnHasLocalConfig}
                suppressAgHeaderFocus={Boolean(suppressAgHeaderFocus)}
                overlayOwnsGridHeader={headerOverlayRows > 0}
                showSelectionRing={mode === "table" && !isActiveSheetBlocked && Boolean(selectedCell)}
                selectionRingRef={selectionRingRef}
                selectionRangeRef={selectionRangeRef}
                formulaReferenceOverlayLayerRef={formulaReferenceOverlayLayerRef}
                formulaReferenceOverlays={formulaReferenceOverlays}
                onFormulaReferenceOverlaySelect={setActiveReferenceTokenId}
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
                handleCellMouseDown={handleCellMouseDown}
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
          onDraftInputChange={handleFormulaDraftInputChange}
          pointReferenceRequest={formulaPointReferenceRequest}
          referenceViews={formulaReferenceViews}
          activeReferenceTokenId={activeReferenceTokenId}
          onActiveReferenceTokenChange={setActiveReferenceTokenId}
          onCancelPointPick={handleCancelFormulaPointPick}
          canApplyToSelection={canApplyFormulaInputToSelection}
          onApplyToSelection={handleApplyFormulaInputToSelection}
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
        sheetSetupOpen={sheetSetupOpen}
        sheetSetupPosition={sheetSetupPosition}
        sheetSetupMenuRef={sheetSetupMenuRef}
        headerRowCount={headerRowCount}
        maxHeaderRowCount={maxHeaderRowCount}
        headerColCount={headerColCount}
        onSetHeaderRowCount={handleSetHeaderRowCount}
        selectionMenuOpen={selectionMenuOpen}
        selectionMenuPosition={selectionMenuPosition}
        selectionMenuRef={selectionMenuRef}
        canClearSelection={canClearSelectedRegion}
        onClearSelection={handleClearSelectedRegion}
        onInsertRowAbove={(rowNumber, area) => handleInsertRow(rowNumber, "above", area)}
        onInsertRowBelow={(rowNumber, area) => handleInsertRow(rowNumber, "below", area)}
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
