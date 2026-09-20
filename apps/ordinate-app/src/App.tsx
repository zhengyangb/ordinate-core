import {
  AllCommunityModule,
  ModuleRegistry,
  type CellDoubleClickedEvent,
  type CellMouseDownEvent,
  type FirstDataRenderedEvent,
  type GridApi,
  type GridReadyEvent,
  type GridSizeChangedEvent,
  type ModelUpdatedEvent
} from "ag-grid-community";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";

import {
  type SheetEvaluation,
  type SheetPresentation
} from "@ordinate/core";
import AppChrome from "./components/AppChrome";
import { useConfirmationDialog } from "./components/ConfirmationDialog";
import FileSessionNotices from "./components/FileSessionNotices";
import FormulaBarOverlay from "./components/FormulaBarOverlay";
import OverlayPortals from "./components/OverlayPortals";
import SheetParseErrorPanel from "./components/SheetParseErrorPanel";
import TableStage from "./components/TableStage";
import { shouldAnimateTableStructure } from "./config/motion";
import { createAgGridAdapter } from "./grid/agGridAdapter";
import { useAnchoredMenuPosition } from "./hooks/useAnchoredMenuPosition";
import { useDisplayFormatCommands } from "./hooks/useDisplayFormatCommands";
import { useFileSessionController } from "./hooks/useFileSessionController";
import { useGridColumnDefs } from "./hooks/useGridColumnDefs";
import { useSheetStructureCommands } from "./hooks/useSheetStructureCommands";
import { useSheetViewModel } from "./hooks/useSheetViewModel";
import { useStructureTransition } from "./hooks/useStructureTransition";
import { useTooltips } from "./hooks/useTooltips";
import { resolveUiLocale } from "./i18n/messages";
import { AutoIcon, MoonIcon, SunIcon, TOOLBAR_ITEMS } from "./icons/uiIcons";
import { useWindowAppearance } from "./platform/useWindowAppearance";
import { useEditorStore } from "./store/editorStore";
import { buildSearchCells } from "./search/searchModel";
import { SearchPanel, SheetSearchContext } from "./search/SheetSearch";
import { useSheetSearch } from "./search/useSheetSearch";
import type {
  AxisDragPreview,
  AxisDropIndicator,
  AxisSelectionView,
  ChromeVisibilityPhase,
  ColumnMetric,
  FloatingMenuPosition,
  FormulaBarData,
  GridRow,
  HeaderIndexMetric,
  HeaderOverlayCell,
  LogicalCell,
  RailMenuView,
  Rect,
  RowIndexMetric,
  SelectedCell,
  SheetSelection,
  ThemeMenuPosition,
  ThemeMode
} from "./types/ui";
import {
  APPEND_AXIS_SLOT_GAP,
  APPEND_COLUMN_WIDTH,
  buildColumnHasLocalConfig,
  buildHeaderMatrix,
  buildRailMenu,
  CHROME_TRANSITION_MS,
  columnMetricsEqual,
  easeOutQuint,
  FLOATING_MENU_GAP,
  FORMULA_BAR_AUTO_PAN_CLEARANCE,
  FORMULA_BAR_AUTO_PAN_DURATION_MS,
  FORMULA_BAR_SAFE_SPACE,
  GRID_HEADER_HEIGHT,
  GRID_ROW_HEIGHT,
  POSITION_EPSILON,
  queryGridBodyViewport,
  queryGridHorizontalViewport,
  resolveGridInstanceKey,
  resolveInitialThemeMode,
  resolveRailMenuPosition,
  toColFieldId,
  trimSheetColCount,
  type FormulaInputMode
} from "./utils/appHelpers";
import {
  canStartColumnRailMoveDrag,
  canStartColumnRailSelectionDrag,
  canStartRowRailMoveDrag,
  canStartRowRailSelectionDrag,
  computeAxisAutoPanDelta,
  resolveBodyRowDropBoundary,
  resolveBodyRowNumberAtTrackY,
  resolveColumnDragSource,
  resolveColumnDropBoundaryInViewport,
  resolveColumnIndexInViewport,
  resolveHeaderRowDropBoundary,
  resolveHeaderRowNumberAtTrackY,
  resolveRowDragSource,
  validateColumnMoveDrop,
  validateRowMoveDrop,
  type AxisDropValidation,
  type ColumnAxisSelection,
  type ColumnDragSource,
  type RowAxisSelection,
  type RowDragSource,
} from "./utils/axisRailDrag";
import {
  isBooleanKeyboardActivation,
  resolveBooleanCellView,
  toggledBooleanInput,
} from "./utils/booleanCell";
import { resolveCoreRegionTarget } from "./utils/coreTargets";
import { buildFormulaBarData } from "./utils/formulaBarData";
import {
  makeFormulaPointRect,
  referenceTextForPreferredStyle,
  resolveFormulaReferenceViews,
  type FormulaReferenceContext,
  type FormulaReferenceSheetContext,
  type FormulaReferenceView,
} from "./utils/formulaPointMode";
import {
  bodyRowTrackYToViewportY,
  columnTrackXToViewportX,
  EMPTY_GRID_SCROLL_SNAPSHOT,
  gridScrollSnapshotEqual,
  projectActiveSheetGridScrollSnapshot,
  resolveColumnCenterTrackWidth,
  resolveFrozenHeaderGeometry,
  resolveHorizontalWheelDelta,
  type GridScrollSnapshot,
  type SheetGridScrollSnapshot,
} from "./utils/gridGeometry";
import {
  resolveAppendAnchorScrollPositionAfterSizeChange,
  resolveAppendEndScrollPosition,
} from "./utils/quickAddControls";
import { selectionDebugLog } from "./utils/selectionDebug";
import {
  getRectDimensions,
  getSelectionFocus,
  getSelectionRange,
  makeCellSelection,
  makeRangeSelection
} from "./utils/selectionModel";
import {
  compactColLabel
} from "./utils/sheetView";
import { isNativeTextEditingTarget } from "./utils/textEditingTarget";
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

type ColumnAxisDragSession = {
  axis: "column";
  sheetName: string;
  pointerId: number;
  captureTarget: HTMLElement;
  startX: number;
  startY: number;
  active: boolean;
  source: Extract<ColumnDragSource, { ok: true }>;
  lastValidation: AxisDropValidation | null;
};

type RowAxisDragSession = {
  axis: "row";
  sheetName: string;
  pointerId: number;
  captureTarget: HTMLElement;
  startX: number;
  startY: number;
  active: boolean;
  source: Extract<RowDragSource, { ok: true }>;
  lastValidation: AxisDropValidation | null;
};

type AxisDragSession = ColumnAxisDragSession | RowAxisDragSession;

type ColumnAxisSelectionDragSession = {
  axis: "column";
  pointerId: number;
  captureTarget: HTMLElement;
  startX: number;
  startY: number;
  active: boolean;
  anchorColIndex: number;
};

type RowAxisSelectionDragSession = {
  axis: "row";
  area: "header" | "body";
  pointerId: number;
  captureTarget: HTMLElement;
  startX: number;
  startY: number;
  active: boolean;
  anchorRowNumber: number;
};

type AxisSelectionDragSession = ColumnAxisSelectionDragSession | RowAxisSelectionDragSession;


type FormulaReferenceOverlay = {
  tokenId: string;
  rect: Rect;
  colorIndex: number;
  active: boolean;
};



const SELECTION_DRAG_SCROLL_EDGE_PX = 48;
const SELECTION_DRAG_SCROLL_MAX_PX = 24;
const AXIS_RAIL_AUTO_PAN_EDGE_PX = 48;
const AXIS_RAIL_AUTO_PAN_MAX_DELTA_PX = 24;
const AXIS_RAIL_AUTO_PAN_BOUNDARY_INSET_PX = 1;
const AXIS_RAIL_DRAG_THRESHOLD_PX = 4;
const AXIS_DROP_INDICATOR_THICKNESS_PX = 3;
const RAIL_CLICK_SUPPRESSION_MS = 250;

function axisDropIndicatorEqual(previous: AxisDropIndicator | null, next: AxisDropIndicator | null): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return (
    previous.axis === next.axis &&
    previous.state === next.state &&
    previous.left === next.left &&
    previous.top === next.top &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.reason === next.reason
  );
}

function axisDragPreviewFromSession(session: AxisDragSession): AxisDragPreview {
  if (session.axis === "column") {
    return {
      axis: "column",
      colStart: session.source.sourceStartIndex,
      colEnd: session.source.sourceStartIndex + session.source.sourceCount - 1,
    };
  }
  return {
    axis: "row",
    area: session.source.area,
    rowStart: session.source.sourceStartIndex + 1,
    rowEnd: session.source.sourceStartIndex + session.source.sourceCount,
    rowCount: session.source.sourceCount,
  };
}

function axisColumnSelectionEqual(
  current: SheetSelection | null,
  colIndex: number,
  anchorColIndex: number,
  colStart: number,
  colEnd: number,
): boolean {
  return (
    current?.kind === "column" &&
    current.colIndex === colIndex &&
    current.anchorColIndex === anchorColIndex &&
    current.colStart === colStart &&
    current.colEnd === colEnd
  );
}

function axisRowSelectionEqual(
  current: SheetSelection | null,
  area: "header" | "body",
  rowNumber: number,
  anchorRowNumber: number,
  rowStart: number,
  rowEnd: number,
): boolean {
  return (
    current?.kind === "row" &&
    current.area === area &&
    current.rowNumber === rowNumber &&
    current.anchorRowNumber === anchorRowNumber &&
    current.rowStart === rowStart &&
    current.rowEnd === rowEnd
  );
}

export default function App() {
  const uiLocale = useMemo(() => resolveUiLocale(window.navigator.language), []);
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const {
    mode,
    sourceText,
    docState,
    evaluation,
    presentation,
    sheetIssuesByName,
    activeSheet,
    error,
    revision,
    setSourceText,
    setActiveSheet,
    insertSheet,
    deleteSheet,
    moveSheet,
    renameSheet,
    setCellInput,
    clearCell,
    setRegion,
    clearRegion,
    moveColumns,
    moveRows,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    undo,
    redo,
    enterSourceMode,
    exitSourceMode,
  } = useEditorStore();
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
  const [gridViewportWidth, setGridViewportWidth] = useState(0);
  const { tooltip, setTooltip, clearTooltip, showTooltip, handleTabMouseEnter, suppressTooltipForTarget, releaseTooltipForTarget } = useTooltips();
  const [gridScrollSnapshot, setGridScrollSnapshot] = useState<SheetGridScrollSnapshot>(EMPTY_GRID_SCROLL_SNAPSHOT);
  const [rowIndexMetrics, setRowIndexMetrics] = useState<RowIndexMetric[]>([]);
  const [rowIndexTrackHeight, setRowIndexTrackHeight] = useState(0);
  const [columnMetrics, setColumnMetrics] = useState<ColumnMetric[]>([]);
  const [axisDropIndicator, setAxisDropIndicator] = useState<AxisDropIndicator | null>(null);
  const [axisDragPreview, setAxisDragPreview] = useState<AxisDragPreview | null>(null);

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
  const gridMetricsSyncRafRef = useRef<number | null>(null);
  const autoPanRafRef = useRef<number | null>(null);
  const appendRowAnchorRafRef = useRef<number | null>(null);
  const appendColumnAnchorRafRef = useRef<number | null>(null);
  const activeSheetRef = useRef(activeSheet);
  const pendingAppendRowAnchorScrollRef = useRef<{
    sheetName: string;
    previousScrollTop: number;
    previousScrollHeight: number;
    attemptsRemaining: number;
    settleFramesRemaining: number;
    focusTarget: { rAbs: number; colId: string } | null;
    focusApplied: boolean;
  } | null>(null);
  const pendingAppendColumnAnchorScrollRef = useRef<{
    sheetName: string;
    expectedColumnCount: number;
    attemptsRemaining: number;
    settleFramesRemaining: number;
  } | null>(null);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const selectionDragRef = useRef<{ anchor: LogicalCell; focus: LogicalCell } | null>(null);
  const formulaPointDragRef = useRef<{ anchor: LogicalCell; focus: LogicalCell; gestureId: number } | null>(null);
  const formulaPointGestureIdRef = useRef(0);
  const formulaPointReferenceRequestIdRef = useRef(0);
  const selectionDragPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const selectionAutoScrollRafRef = useRef<number | null>(null);
  const suppressCellFocusSelectionUntilRef = useRef(0);
  const rowTrackRef = useRef<HTMLDivElement | null>(null);
  const gridApiRef = useRef<GridApi<GridRow> | null>(null);
  const pendingHeaderSelectionRef = useRef<{ colId: string; rAbs: number; expiresAt: number } | null>(null);
  const pendingBodyFocusRef = useRef<{ rAbs: number; cAbs: number; expiresAt: number } | null>(null);
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
  const axisDragSessionRef = useRef<AxisDragSession | null>(null);
  const axisSelectionDragSessionRef = useRef<AxisSelectionDragSession | null>(null);
  const axisDragCleanupRef = useRef<(() => void) | null>(null);
  const axisDragPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const axisAutoPanRafRef = useRef<number | null>(null);
  const suppressRailClickUntilRef = useRef(0);

  useLayoutEffect(() => {
    activeSheetRef.current = activeSheet;
  }, [activeSheet]);

  const isGridApiAlive = useCallback((api: GridApi<GridRow> | null): api is GridApi<GridRow> => {
    return Boolean(api && !api.isDestroyed());
  }, []);
  const setSelectedColumnIndex = useCallback((colIndex: number | null) => {
    setSelection((current) => {
      if (colIndex == null) {
        return current?.kind === "column" ? null : current;
      }
      return {
        kind: "column",
        colIndex,
        anchorColIndex: colIndex,
        colStart: colIndex,
        colEnd: colIndex,
      };
    });
  }, []);
  const setSelectedCell = useCallback((cell: SelectedCell | null) => {
    setSelection(cell ? makeCellSelection(cell.logical) : null);
  }, []);


  const {
    currentSheet,
    currentSheetState,
    currentSheetPresentation,
    currentSheetRowStructure,
    sheetNames,
    sheetHealthByName,
    activeSheetBlockingIssues,
    isActiveSheetBlocked,
    sheetColCount,
    sheetRowCount,
    headerRowCount,
    headerColCount,
    headerOverlayRows,
    headerOverlayHeight,
    headerMatrix,
    headerLeafLabels,
    headerSemanticLabels,
    headerSemanticLabelPaths,
    allRowData,
    rowData,
    columnLayouts,
    toggleCollapse, expandRowPath,
  } = useSheetViewModel({ docState, evaluation, presentation, activeSheet, sheetIssuesByName });


  const columnHasLocalConfig = useMemo<boolean[]>(() => {
    return buildColumnHasLocalConfig(currentSheetPresentation, sheetColCount);
  }, [currentSheetPresentation, sheetColCount]);

  const railMenu = useMemo<RailMenuView | null>(() => {
    const baseMenu = buildRailMenu(
      openRailMenuTarget,
      sheetColCount,
      headerColCount,
      currentSheet,
      currentSheetState,
      currentSheetPresentation,
      columnHasLocalConfig,
    );
    if (!baseMenu) return null;
    if (
      baseMenu.kind === "column" &&
      selection?.kind === "column" &&
      baseMenu.colIndex >= selection.colStart &&
      baseMenu.colIndex <= selection.colEnd
    ) {
      return {
        ...baseMenu,
        deleteSelectionCount: selection.colEnd - selection.colStart + 1,
      };
    }
    if (
      baseMenu.kind === "row" &&
      selection?.kind === "row" &&
      baseMenu.area === selection.area &&
      baseMenu.rowNumber >= selection.rowStart &&
      baseMenu.rowNumber <= selection.rowEnd
    ) {
      return {
        ...baseMenu,
        deleteSelectionCount: selection.rowEnd - selection.rowStart + 1,
      };
    }
    return baseMenu;
  }, [openRailMenuTarget, sheetColCount, headerColCount, currentSheet, currentSheetState, currentSheetPresentation, columnHasLocalConfig, selection]);

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
    setSelectedCell(null);
    setSelectedColumnIndex(null);
    setRailMenuOpen(false);
    setSheetSetupOpen(false);
    setSelectionMenuOpen(false);
    setOpenRailMenuTarget(null);
    railMenuAnchorRef.current = null;
    setColumnMetrics([]);
    setFormulaInputMode("read");
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

  useWindowAppearance(themeMode);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useAnchoredMenuPosition(themeMenuOpen, themeButtonRef, themeMenuRef, setThemeMenuPosition, "end");

  useAnchoredMenuPosition(toolMenuOpen, toolButtonRef, toolMenuRef, setToolMenuPosition, "end");

  useAnchoredMenuPosition(sheetSetupOpen, sheetSetupButtonRef, sheetSetupMenuRef, setSheetSetupPosition, "start");

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
    const handleHistoryKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (mode === "source") return;
      if (isNativeTextEditingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      const wantsUndo = hasCommandModifier && key === "z" && !event.shiftKey && !event.altKey;
      const wantsRedo =
        (hasCommandModifier && key === "z" && event.shiftKey && !event.altKey) ||
        (event.ctrlKey && !event.metaKey && key === "y" && !event.shiftKey && !event.altKey);
      if (wantsUndo && canUndo) {
        event.preventDefault();
        undo();
        return;
      }
      if (wantsRedo && canRedo) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleHistoryKeyDown);
    return () => window.removeEventListener("keydown", handleHistoryKeyDown);
  }, [mode, canUndo, canRedo, undo, redo]);

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

  const { columnCount: frozenColumnCount, width: pinnedHeaderWidth } = useMemo(
    () => resolveFrozenHeaderGeometry(gridViewportWidth, columnLayouts.slice(0, headerColCount).map((column) => column.width)),
    [gridViewportWidth, columnLayouts, headerColCount],
  );
  const projectedGridScrollSnapshot = useMemo<GridScrollSnapshot>(() => {
    const centerTrackWidth = resolveColumnCenterTrackWidth(columnMetrics, pinnedHeaderWidth);
    return projectActiveSheetGridScrollSnapshot({
      activeSheet,
      snapshot: gridScrollSnapshot,
      centerTrackWidth,
      appendSlotSize: APPEND_COLUMN_WIDTH,
      appendGap: APPEND_AXIS_SLOT_GAP,
    });
  }, [activeSheet, gridScrollSnapshot, columnMetrics, pinnedHeaderWidth]);

  const evaluationRowIndexByAbsoluteRowNumber = useMemo(
    () => new Map(currentSheetRowStructure.map((row, index) => [row.absoluteRowNumber, index])),
    [currentSheetRowStructure],
  );

  const toggleBooleanLiteralAt = useCallback(
    (absoluteRowNumber: number, colIndex: number, expectedValue: boolean) => {
      if (!activeSheet || !currentSheetState) {
        throw new Error("boolean toggle requires an active sheet state");
      }
      const body = currentSheetState.cells[absoluteRowNumber - 1]?.[colIndex]?.body;
      const evaluationRowIndex = evaluationRowIndexByAbsoluteRowNumber.get(absoluteRowNumber);
      if (evaluationRowIndex == null) {
        throw new Error(`boolean toggle cannot resolve absolute row ${absoluteRowNumber}`);
      }
      const runtimeValue = currentSheet?.values[evaluationRowIndex]?.[colIndex];
      const view = resolveBooleanCellView(runtimeValue, body);
      if (!view?.interactive) {
        throw new Error("only literal boolean cells can be toggled");
      }
      if (view.value !== expectedValue) {
        throw new Error("boolean toggle rejected a stale rendered value");
      }
      setCellInput(
        { kind: "index", sheet: activeSheet, rowIndex: absoluteRowNumber - 1, colIndex },
        toggledBooleanInput(view.value),
      );
    },
    [activeSheet, currentSheet, currentSheetState, evaluationRowIndexByAbsoluteRowNumber, setCellInput],
  );

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

  const activateBooleanLiteralAt = useCallback(
    (row: GridRow, colIndex: number, expectedValue: boolean) => {
      const displayedRowIndex = absoluteRowToDisplayedIndex.get(row.__absoluteRowNumber);
      if (displayedRowIndex == null) {
        throw new Error(`boolean activation cannot resolve absolute row ${row.__absoluteRowNumber}`);
      }
      const logical = { rAbs: row.__absoluteRowNumber, cAbs: colIndex };
      const colId = toColFieldId(colIndex);
      beginSelectionGesture(logical, false, false);
      toggleBooleanLiteralAt(row.__absoluteRowNumber, colIndex, expectedValue);
      window.requestAnimationFrame(() => {
        if (isGridApiAlive(gridApiRef.current)) {
          gridApiRef.current.setFocusedCell(displayedRowIndex, colId);
        }
      });
    },
    [absoluteRowToDisplayedIndex, beginSelectionGesture, isGridApiAlive, toggleBooleanLiteralAt],
  );

  const canStartFormulaPointPick = useCallback(() => {
    if (!activeSheet || isActiveSheetBlocked) return false;
    const liveEditor = document.querySelector<HTMLTextAreaElement>(".formula-source-textarea");
    if (!liveEditor && formulaInputMode !== "edit") return false;
    const liveDraft = liveEditor?.value ?? formulaDraftInput;
    return liveDraft.trimStart().startsWith("=");
  }, [formulaInputMode, activeSheet, isActiveSheetBlocked, formulaDraftInput]);
  const selectedColumnIndex = useMemo(() => {
    if (selection?.kind === "column") return selection.colIndex;
    return null;
  }, [selection]);

  const selectedColumnAxisSelection = useMemo<ColumnAxisSelection | null>(() => (
    selection?.kind === "column"
      ? { axis: "column", colStart: selection.colStart, colEnd: selection.colEnd }
      : null
  ), [selection]);

  const selectedRowAxisSelection = useMemo<RowAxisSelection | null>(() => (
    selection?.kind === "row"
      ? { axis: "row", area: selection.area, rowStart: selection.rowStart, rowEnd: selection.rowEnd }
      : null
  ), [selection]);

  const axisSelectionView = useMemo<AxisSelectionView | null>(() => {
    if (selection?.kind === "column") {
      return {
        axis: "column",
        colStart: selection.colStart,
        colEnd: selection.colEnd,
      };
    }
    if (selection?.kind !== "row") return null;
    const rowSelection = {
      axis: "row" as const,
      area: selection.area,
      rowStart: selection.rowStart,
      rowEnd: selection.rowEnd,
    };
    const draggable =
      currentSheetState != null &&
      resolveRowDragSource(
        selection.rowNumber,
        selection.area,
        headerRowCount,
        currentSheetState.rowIds,
        currentSheetRowStructure,
        rowSelection,
      ).ok;
    return {
      ...rowSelection,
      rowCount: selection.rowEnd - selection.rowStart + 1,
      draggable,
    };
  }, [currentSheetRowStructure, currentSheetState, headerRowCount, selection]);

  const formulaReferenceContext = useMemo<FormulaReferenceContext>(() => {
    const sheetNameCounts = new Map<string, number>();
    docState?.sheets.forEach((sheet) => {
      sheetNameCounts.set(sheet.name, (sheetNameCounts.get(sheet.name) ?? 0) + 1);
    });
    const runtimeSheetsByName = new Map<string, SheetEvaluation>();
    evaluation?.sheets.forEach((sheet) => runtimeSheetsByName.set(sheet.name, sheet));
    const presentationSheetsByName = new Map<string, SheetPresentation>();
    presentation?.sheets.forEach((sheet) => presentationSheetsByName.set(sheet.name, sheet));
    const sheetsByName = new Map<string, FormulaReferenceSheetContext | null>();

    docState?.sheets.forEach((sheetState) => {
      if (sheetNameCounts.get(sheetState.name) !== 1) {
        sheetsByName.set(sheetState.name, null);
        return;
      }
      const runtimeSheet = runtimeSheetsByName.get(sheetState.name) ?? null;
      const presentationSheet = presentationSheetsByName.get(sheetState.name) ?? null;
      const targetColCount = trimSheetColCount(sheetState, runtimeSheet);
      const targetHeaderRowCount = sheetState.headerRowCount;
      const targetHeaderMatrix = buildHeaderMatrix(
        sheetState,
        runtimeSheet,
        presentationSheet,
        targetColCount,
        targetHeaderRowCount,
      );
      const targetHeaderLeafLabels = Array.from({ length: targetColCount }, (_, colIndex) => {
        const leafRow = targetHeaderMatrix[targetHeaderMatrix.length - 1] ?? [];
        return compactColLabel(leafRow[colIndex] ?? "");
      });
      const colLabelPathsByIndex = Array.from({ length: targetColCount }, (_, colIndex) => {
        const path = targetHeaderMatrix
          .map((row) => compactColLabel(row[colIndex] ?? ""))
          .filter((label) => label.length > 0);
        if (path.length > 0) return path;
        const fromLabels = sheetState.colLabels[colIndex];
        if (fromLabels && fromLabels.length > 0) return [fromLabels];
        return [targetHeaderLeafLabels[colIndex] ?? `C${colIndex + 1}`];
      });
      const rowLabelsByAbsoluteIndex = new Map<number, string[]>();
      runtimeSheet?.rowPaths.forEach((path, index) => {
        const absoluteRowNumber = targetHeaderRowCount + index + 1;
        const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
        if (parts.length > 0) {
          rowLabelsByAbsoluteIndex.set(absoluteRowNumber, parts);
        }
      });
      sheetsByName.set(sheetState.name, {
        rowCount: sheetState.cells.length,
        colCount: targetColCount,
        headerRowCount: targetHeaderRowCount,
        rowLabelsByAbsoluteIndex,
        colLabelPathsByIndex,
      });
    });

    const activeSheetContext = activeSheet ? sheetsByName.get(activeSheet) : null;
    return {
      rowCount: activeSheetContext?.rowCount ?? sheetRowCount,
      colCount: activeSheetContext?.colCount ?? sheetColCount,
      headerRowCount: activeSheetContext?.headerRowCount ?? headerRowCount,
      rowLabelsByAbsoluteIndex: activeSheetContext?.rowLabelsByAbsoluteIndex ?? new Map<number, string[]>(),
      colLabelPathsByIndex: activeSheetContext?.colLabelPathsByIndex ?? headerSemanticLabelPaths,
      sourceCell: formulaEditSourceCell?.logical ?? null,
      currentSheetName: activeSheet,
      sheetsByName,
    };
  }, [
    activeSheet,
    docState,
    evaluation,
    formulaEditSourceCell,
    headerRowCount,
    headerSemanticLabelPaths,
    presentation,
    sheetColCount,
    sheetRowCount,
  ]);

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
      .filter((view): view is FormulaReferenceView & { rect: Rect } => (
        view.rect != null && (!view.sheetName || view.sheetName === activeSheet)
      ))
      .map((view) => ({
        tokenId: view.id,
        rect: view.rect,
        colorIndex: view.colorIndex,
        active: view.id === activeReferenceTokenId,
      }));
  }, [activeReferenceTokenId, activeSheet, formulaReferenceViews]);


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
    const snapshot = gridViewportAdapter.collectColumnMetrics(
      gridWrapRef.current,
      api,
      colIndexLookup,
      sheetColCount,
    );
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

  const searchCells = useMemo(() => currentSheetState && !isActiveSheetBlocked ? buildSearchCells(
    allRowData, headerOverlayCells, currentSheetState.colIds.slice(0, sheetColCount), currentSheetState.rowIds, uiLocale,
  ) : [], [allRowData, headerOverlayCells, currentSheetState, sheetColCount, isActiveSheetBlocked, uiLocale]);
  const sheetSearch = useSheetSearch({
    cells: searchCells, scope: activeSheet ?? "",
    enabled: mode === "table",
    gridApiRef, displayedRows: absoluteRowToDisplayedIndex, expandRowPath,
  });

  useEffect(() => {
    if (formulaInputMode === "edit") return;
    setFormulaPointPick(null);
    setFormulaPointReferenceRequest(null);
    setActiveReferenceTokenId(null);
  }, [formulaInputMode]);

  const scheduleGridMetricsSync = useCallback(
    (api: GridApi<GridRow> | null) => {
      if (gridMetricsSyncRafRef.current != null) {
        window.cancelAnimationFrame(gridMetricsSyncRafRef.current);
      }
      gridMetricsSyncRafRef.current = window.requestAnimationFrame(() => {
        gridMetricsSyncRafRef.current = window.requestAnimationFrame(() => {
          gridMetricsSyncRafRef.current = null;
          if (!isGridApiAlive(api)) return;
          syncRowIndexMetrics(api);
          syncColumnMetrics(api);
        });
      });
    },
    [isGridApiAlive, syncRowIndexMetrics, syncColumnMetrics],
  );

  const applyPendingAppendRowAnchorScroll = useCallback(() => {
    const pending = pendingAppendRowAnchorScrollRef.current;
    if (!pending) return false;
    if (pending.sheetName !== activeSheetRef.current) {
      pendingAppendRowAnchorScrollRef.current = null;
      return false;
    }
    const root = gridWrapRef.current;
    if (!root) return false;
    const bodyViewport = queryGridBodyViewport(root);
    if (!bodyViewport) return false;
    const targetScrollTop = resolveAppendAnchorScrollPositionAfterSizeChange({
      scrollPosition: pending.previousScrollTop,
      previousScrollSize: pending.previousScrollHeight,
      nextScrollSize: bodyViewport.scrollHeight,
      viewportSize: bodyViewport.clientHeight,
    });
    if (targetScrollTop == null) return false;
    bodyViewport.scrollTop = targetScrollTop;
    if (pending.focusTarget && !pending.focusApplied && isGridApiAlive(gridApiRef.current)) {
      const displayedRowIndex = absoluteRowToDisplayedIndex.get(pending.focusTarget.rAbs);
      if (displayedRowIndex != null) {
        gridApiRef.current.setFocusedCell(displayedRowIndex, pending.focusTarget.colId);
        bodyViewport.scrollTop = targetScrollTop;
        pending.focusApplied = true;
      }
    }
    return true;
  }, [absoluteRowToDisplayedIndex, isGridApiAlive]);

  const applyPendingAppendColumnAnchorScroll = useCallback(() => {
    const pending = pendingAppendColumnAnchorScrollRef.current;
    if (!pending) return false;
    if (pending.sheetName !== activeSheetRef.current) {
      pendingAppendColumnAnchorScrollRef.current = null;
      return false;
    }
    const api = gridApiRef.current;
    if (!isGridApiAlive(api) || api.getAllDisplayedColumns().length !== pending.expectedColumnCount) {
      return false;
    }
    const root = gridWrapRef.current;
    const horizontalViewport = root ? queryGridHorizontalViewport(root) : null;
    if (!horizontalViewport || horizontalViewport.clientWidth <= 0) return false;
    const targetScrollLeft = resolveAppendEndScrollPosition({
      scrollSize: horizontalViewport.scrollWidth,
      viewportSize: horizontalViewport.clientWidth,
    });
    horizontalViewport.scrollLeft = targetScrollLeft;
    setGridScrollSnapshot((current) => {
      const sheetName = activeSheetRef.current;
      const next = {
        ...current,
        sheetName,
        left: targetScrollLeft,
        hasHorizontalOverlap: targetScrollLeft > 0.5,
      };
      return gridScrollSnapshotEqual(current, next) ? current : next;
    });
    scheduleGridMetricsSync(api);
    return true;
  }, [isGridApiAlive, scheduleGridMetricsSync]);

  const scheduleAppendRowAnchorScrollFlush = useCallback(() => {
    if (appendRowAnchorRafRef.current != null) {
      window.cancelAnimationFrame(appendRowAnchorRafRef.current);
    }

    const tick = () => {
      appendRowAnchorRafRef.current = null;
      const pending = pendingAppendRowAnchorScrollRef.current;
      if (!pending) return;

      const applied = applyPendingAppendRowAnchorScroll();
      const latestPending = pendingAppendRowAnchorScrollRef.current;
      if (!latestPending) return;
      if (applied) {
        latestPending.settleFramesRemaining -= 1;
      } else {
        latestPending.attemptsRemaining -= 1;
      }

      if (
        (applied && latestPending.settleFramesRemaining <= 0) ||
        (!applied && latestPending.attemptsRemaining <= 0)
      ) {
        pendingAppendRowAnchorScrollRef.current = null;
        return;
      }

      appendRowAnchorRafRef.current = window.requestAnimationFrame(tick);
    };

    appendRowAnchorRafRef.current = window.requestAnimationFrame(tick);
  }, [applyPendingAppendRowAnchorScroll]);

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;
    const root = gridWrapRef.current;
    const api = gridApiRef.current;
    if (!root || !isGridApiAlive(api)) return;
    if (typeof ResizeObserver === "undefined") {
      throw new Error("ResizeObserver is required for grid metric sync");
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleGridMetricsSync(api);
    });
    resizeObserver.observe(root);
    root.querySelectorAll<HTMLElement>(".ag-header-cell[col-id]").forEach((cell) => {
      resizeObserver.observe(cell);
    });
    scheduleGridMetricsSync(api);

    return () => {
      resizeObserver.disconnect();
    };
  }, [mode, isActiveSheetBlocked, activeSheet, sheetColCount, rowData.length, isGridApiAlive, scheduleGridMetricsSync]);

  useEffect(() => {
    return () => {
      if (gridMetricsSyncRafRef.current != null) {
        window.cancelAnimationFrame(gridMetricsSyncRafRef.current);
        gridMetricsSyncRafRef.current = null;
      }
      if (autoPanRafRef.current != null) {
        window.cancelAnimationFrame(autoPanRafRef.current);
      }
      if (appendRowAnchorRafRef.current != null) {
        window.cancelAnimationFrame(appendRowAnchorRafRef.current);
        appendRowAnchorRafRef.current = null;
      }
      if (appendColumnAnchorRafRef.current != null) {
        window.cancelAnimationFrame(appendColumnAnchorRafRef.current);
        appendColumnAnchorRafRef.current = null;
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
    },
    [syncRowIndexMetrics, syncColumnMetrics],
  );

  const handleFirstDataRendered = useCallback(
    (event: FirstDataRenderedEvent<GridRow>) => {
      syncRowIndexMetrics(event.api);
      syncColumnMetrics(event.api);
    },
    [syncRowIndexMetrics, syncColumnMetrics],
  );

  const handleModelUpdated = useCallback(
    (event: ModelUpdatedEvent<GridRow>) => {
      applyPendingAppendRowAnchorScroll();
      applyPendingAppendColumnAnchorScroll();
      syncRowIndexMetrics(event.api);
      syncColumnMetrics(event.api);
    },
    [applyPendingAppendRowAnchorScroll, applyPendingAppendColumnAnchorScroll, syncRowIndexMetrics, syncColumnMetrics],
  );

  const handleGridSizeChanged = useCallback(
    (event: GridSizeChangedEvent<GridRow>) => {
      setGridViewportWidth(event.clientWidth);
      scheduleGridMetricsSync(event.api);
    },
    [scheduleGridMetricsSync],
  );

  const handleHeaderHorizontalWheel = useCallback((event: ReactWheelEvent<HTMLElement>) => {
    const deltaLeft = resolveHorizontalWheelDelta({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      shiftKey: event.shiftKey,
    });
    if (deltaLeft === 0) return;

    const root = gridWrapRef.current;
    if (!root) {
      throw new Error("header horizontal wheel requires grid root");
    }
    const didScroll = gridViewportAdapter.scrollHorizontalViewport(root, deltaLeft);
    if (!didScroll) return;
    event.preventDefault();
    event.stopPropagation();
  }, [gridViewportAdapter]);

  useEffect(() => {
    if (mode === "source" || isActiveSheetBlocked) return;
    if (!isGridApiAlive(gridApiRef.current)) return;
    syncColumnMetrics(gridApiRef.current);
  }, [mode, isActiveSheetBlocked, activeSheet, rowData.length, syncColumnMetrics, isGridApiAlive]);

  const axisColumnDragPreview = axisDragPreview?.axis === "column" ? axisDragPreview : null;

  const columnDefs = useGridColumnDefs({
    currentSheet, currentSheetState, sheetColCount, headerColCount, headerRowCount,
    frozenColumnCount, columnLayouts, headerLeafLabels, headerSemanticLabels, toggleCollapse,
    uiLocale, showTooltip, clearTooltip, selectedColumnAxisSelection, axisColumnDragPreview,
    activateBooleanLiteralAt, canStartFormulaPointPick, revision,
  });

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
      return true;
    },
    [activeReferenceTokenId, canStartFormulaPointPick, formulaReferenceContext, formulaReferenceViews],
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

  const suppressRailClickForCurrentGesture = useCallback(() => {
    suppressRailClickUntilRef.current = performance.now() + RAIL_CLICK_SUPPRESSION_MS;
  }, []);

  const shouldSuppressRailClick = useCallback(() => {
    const until = suppressRailClickUntilRef.current;
    if (until <= 0) return false;
    suppressRailClickUntilRef.current = 0;
    return performance.now() <= until;
  }, []);

  const handleIndexRailsHoverChange = useCallback((hovering: boolean) => {
    setIsIndexRailsHovered(hovering);
  }, []);

  const handleColumnRailSelect = useCallback(
    (colIndex: number, event?: { shiftKey: boolean }) => {
      if (shouldSuppressRailClick()) {
        return;
      }
      if (mode === "source" || isActiveSheetBlocked) return;
      if (colIndex < 0 || colIndex >= sheetColCount) return;
      if (colIndex < headerColCount) return;
      const anchorColIndex =
        event?.shiftKey === true && selection?.kind === "column"
          ? selection.anchorColIndex
          : colIndex;
      const colStart = Math.min(anchorColIndex, colIndex);
      const colEnd = Math.max(anchorColIndex, colIndex);
      if (colStart < headerColCount || colEnd >= sheetColCount) return;
      setSelection({
        kind: "column",
        colIndex,
        anchorColIndex,
        colStart,
        colEnd,
      });
      suppressCellFocusSelectionUntilRef.current = performance.now() + 320;
      setFormulaInputMode("read");
      setFormulaBarSnapshot(null);
      closeRailMenu();
    },
    [mode, isActiveSheetBlocked, sheetColCount, headerColCount, selection, closeRailMenu, shouldSuppressRailClick],
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
    (rowNumber: number, area: "header" | "body", event?: { shiftKey: boolean }) => {
      if (shouldSuppressRailClick()) {
        return;
      }
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
      const anchorRowNumber =
        event?.shiftKey === true && selection?.kind === "row" && selection.area === area
          ? selection.anchorRowNumber
          : clampedRowNumber;
      const rowStart = Math.min(anchorRowNumber, clampedRowNumber);
      const rowEnd = Math.max(anchorRowNumber, clampedRowNumber);
      if (area === "header" && (rowStart < 1 || rowEnd > headerRowCount)) return;
      if (area === "body" && rowStart <= headerRowCount) return;
      setSelection({
        kind: "row",
        area,
        rowNumber: clampedRowNumber,
        anchorRowNumber,
        rowStart,
        rowEnd,
      });
      suppressCellFocusSelectionUntilRef.current = performance.now() + 320;
      setFormulaInputMode("read");
      closeRailMenu();
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.blur();
      }
    },
    [mode, isActiveSheetBlocked, sheetColCount, headerRowCount, headerColCount, absoluteRowToDisplayedIndex, selection, closeRailMenu, shouldSuppressRailClick],
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
    if (!root) return;

    const tableStage = root.closest<HTMLElement>(".table-stage");
    if (!tableStage) throw new Error("grid viewport sync requires a table stage");
    return gridViewportAdapter.attachViewportSync(root, (snapshot) => {
      setGridScrollSnapshot((current) => {
        const next = { ...snapshot, sheetName: activeSheet };
        return gridScrollSnapshotEqual(current, next) ? current : next;
      });
    }, ({ top, left }) => {
      tableStage.classList.toggle("has-scroll-y", top > 0.5);
      tableStage.classList.toggle("has-scroll-x", left > 0.5);
      tableStage.style.setProperty("--grid-center-track-offset-x", `${-left}px`);
      tableStage.style.setProperty("--grid-body-track-offset-y", `${-top}px`);
    });
  }, [
    mode,
    isActiveSheetBlocked,
    activeSheet,
    rowData.length,
    gridViewportAdapter,
  ]);

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
    (event: CellDoubleClickedEvent<GridRow>) => {
      // Editing contract:
      // - double-click body cell => enter formula input edit mode
      // - logical selection stays on the cell during/after edit
      if (mode === "source" || isActiveSheetBlocked) return;
      const nativeTarget = event.event?.target;
      if (nativeTarget instanceof Element && nativeTarget.closest(".boolean-cell-control")) return;
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
        isBooleanKeyboardActivation(keyboardEvent) &&
        row[`__boolean_interactive_${colNumber - 1}`] === true
      ) {
        const value = row[`__boolean_value_${colNumber - 1}`];
        if (typeof value !== "boolean") {
          throw new Error("interactive boolean cell is missing its value");
        }
        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();
        toggleBooleanLiteralAt(row.__absoluteRowNumber, colNumber - 1, value);
        return;
      }

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
    [mode, isActiveSheetBlocked, activeSheet, colIndexLookup, rowData, headerRowCount, sheetColCount, applyHeaderSelection, focusHeaderOverlayCell, setKeyboardSelection, selectedCell, toggleBooleanLiteralAt],
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
      if (mode !== "table" || isActiveSheetBlocked) return false;
      if (!isGridApiAlive(gridApiRef.current)) return false;

      const displayedRowIndex = absoluteRowToDisplayedIndex.get(rAbs);
      if (displayedRowIndex == null) return false;

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
      return true;
    },
    [mode, isActiveSheetBlocked, resolveAbsoluteRowPath, absoluteRowToDisplayedIndex, isGridApiAlive],
  );

  useEffect(() => {
    const pending = pendingBodyFocusRef.current;
    if (!pending) return;
    if (performance.now() > pending.expiresAt) {
      pendingBodyFocusRef.current = null;
      return;
    }
    if (!absoluteRowToDisplayedIndex.has(pending.rAbs)) return;
    pendingBodyFocusRef.current = null;
    focusBodyCellAt(pending.rAbs, pending.cAbs);
  }, [absoluteRowToDisplayedIndex, focusBodyCellAt]);

  const focusSelectedBodyCell = useCallback(() => {
    if (mode !== "table" || isActiveSheetBlocked) return;
    if (!selectedCell || selectedCell.area !== "body") return;
    if (!isGridApiAlive(gridApiRef.current)) return;
    const displayedRowIndex = absoluteRowToDisplayedIndex.get(selectedCell.logical.rAbs);
    if (displayedRowIndex == null) return;
    suppressCellFocusSelectionUntilRef.current = performance.now() + 320;
    gridApiRef.current.setFocusedCell(displayedRowIndex, selectedCell.colId);
  }, [mode, isActiveSheetBlocked, selectedCell, absoluteRowToDisplayedIndex, isGridApiAlive]);

  const scheduleColumnIntoView = useCallback((colIndex: number) => {
    if (!Number.isInteger(colIndex) || colIndex < 0) {
      throw new Error("column visibility target requires a non-negative integer column index");
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!isGridApiAlive(gridApiRef.current)) return;
        gridApiRef.current.ensureColumnVisible(toColFieldId(colIndex), "end");
        scheduleGridMetricsSync(gridApiRef.current);
      });
    });
  }, [isGridApiAlive, scheduleGridMetricsSync]);

  const queueAppendRowAnchorScroll = useCallback((
    sheetName: string,
    previousScrollTop: number,
    previousScrollHeight: number,
    focusTarget: { rAbs: number; colId: string } | null,
  ) => {
    if (!sheetName) {
      throw new Error("append row anchor requires a sheet name");
    }
    if (!Number.isFinite(previousScrollTop) || previousScrollTop < 0) {
      throw new Error("append row anchor requires a non-negative previous scroll top");
    }
    if (!Number.isFinite(previousScrollHeight) || previousScrollHeight < 0) {
      throw new Error("append row anchor requires a non-negative previous scroll height");
    }
    pendingAppendRowAnchorScrollRef.current = {
      sheetName,
      previousScrollTop,
      previousScrollHeight,
      attemptsRemaining: 12,
      settleFramesRemaining: 3,
      focusTarget,
      focusApplied: false,
    };
    scheduleAppendRowAnchorScrollFlush();
  }, [scheduleAppendRowAnchorScrollFlush]);

  useLayoutEffect(() => {
    if (!applyPendingAppendRowAnchorScroll()) return;
    scheduleGridMetricsSync(gridApiRef.current);
  }, [rowData.length, applyPendingAppendRowAnchorScroll, scheduleGridMetricsSync]);

  const scheduleAppendColumnAnchorScroll = useCallback((sheetName: string, expectedColumnCount: number) => {
    if (!sheetName) {
      throw new Error("append column anchor requires a sheet name");
    }
    if (!Number.isInteger(expectedColumnCount) || expectedColumnCount <= 0) {
      throw new Error("append column anchor requires a positive expected column count");
    }
    if (appendColumnAnchorRafRef.current != null) {
      window.cancelAnimationFrame(appendColumnAnchorRafRef.current);
    }
    pendingAppendColumnAnchorScrollRef.current = {
      sheetName,
      expectedColumnCount,
      attemptsRemaining: 30,
      settleFramesRemaining: 3,
    };
    const tick = () => {
      appendColumnAnchorRafRef.current = null;
      const pending = pendingAppendColumnAnchorScrollRef.current;
      if (!pending) return;
      const applied = applyPendingAppendColumnAnchorScroll();
      const latestPending = pendingAppendColumnAnchorScrollRef.current;
      if (!latestPending) return;
      if (applied) {
        latestPending.settleFramesRemaining -= 1;
      } else {
        latestPending.attemptsRemaining -= 1;
      }
      if (
        (applied && latestPending.settleFramesRemaining <= 0) ||
        (!applied && latestPending.attemptsRemaining <= 0)
      ) {
        pendingAppendColumnAnchorScrollRef.current = null;
        return;
      }
      appendColumnAnchorRafRef.current = window.requestAnimationFrame(tick);
    };
    appendColumnAnchorRafRef.current = window.requestAnimationFrame(tick);
  }, [applyPendingAppendColumnAnchorScroll]);

  const stopAxisAutoPan = useCallback(() => {
    if (axisAutoPanRafRef.current != null) {
      window.cancelAnimationFrame(axisAutoPanRafRef.current);
      axisAutoPanRafRef.current = null;
    }
    axisDragPointRef.current = null;
  }, []);

  const clearAxisDragSession = useCallback(() => {
    const session = axisDragSessionRef.current;
    if (session?.captureTarget.hasPointerCapture(session.pointerId)) {
      session.captureTarget.releasePointerCapture(session.pointerId);
    }
    const selectionSession = axisSelectionDragSessionRef.current;
    if (selectionSession?.captureTarget.hasPointerCapture(selectionSession.pointerId)) {
      selectionSession.captureTarget.releasePointerCapture(selectionSession.pointerId);
    }
    axisDragCleanupRef.current?.();
    axisDragCleanupRef.current = null;
    axisDragSessionRef.current = null;
    axisSelectionDragSessionRef.current = null;
    stopAxisAutoPan();
    setAxisDropIndicator(null);
    setAxisDragPreview(null);
  }, [stopAxisAutoPan]);

  useEffect(() => {
    return () => clearAxisDragSession();
  }, [clearAxisDragSession]);

  useEffect(() => {
    const hasAxisGesture = () => axisDragSessionRef.current !== null || axisSelectionDragSessionRef.current !== null;
    const blockNativeAxisDrag = (event: DragEvent) => {
      if (!hasAxisGesture()) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "drop" || event.type === "dragend") {
        clearAxisDragSession();
      }
    };
    window.addEventListener("dragstart", blockNativeAxisDrag, true);
    window.addEventListener("dragover", blockNativeAxisDrag, true);
    window.addEventListener("drop", blockNativeAxisDrag, true);
    window.addEventListener("dragend", blockNativeAxisDrag, true);
    return () => {
      window.removeEventListener("dragstart", blockNativeAxisDrag, true);
      window.removeEventListener("dragover", blockNativeAxisDrag, true);
      window.removeEventListener("drop", blockNativeAxisDrag, true);
      window.removeEventListener("dragend", blockNativeAxisDrag, true);
    };
  }, [clearAxisDragSession]);

  useEffect(() => {
    clearAxisDragSession();
  }, [activeSheet, mode, isActiveSheetBlocked, clearAxisDragSession]);

  const updateAxisDropIndicator = useCallback((session: AxisDragSession, clientX: number, clientY: number): AxisDropValidation | null => {
    const root = gridWrapRef.current;
    const gridRect = root?.getBoundingClientRect();
    if (!root || !gridRect) return null;

    if (session.axis === "column") {
      const horizontalViewport = queryGridHorizontalViewport(root);
      const columnViewport = {
        pinnedWidth: pinnedHeaderWidth,
        scrollLeft: horizontalViewport?.scrollLeft ?? 0,
      };
      const boundary = resolveColumnDropBoundaryInViewport(clientX - gridRect.left, columnMetrics, columnViewport);
      if (!boundary) return null;
      const validation = validateColumnMoveDrop(
        session.source,
        boundary.gapIndex,
        headerColCount,
        sheetColCount,
      );
      const nextIndicator: AxisDropIndicator = {
        axis: "column",
        state: validation.ok
          ? validation.mapping.kind === "noop"
            ? "noop"
            : "valid"
          : "invalid",
        left: columnTrackXToViewportX(boundary.position, columnViewport) - AXIS_DROP_INDICATOR_THICKNESS_PX / 2,
        top: 0,
        width: AXIS_DROP_INDICATOR_THICKNESS_PX,
        height: Math.max(gridRect.height, headerOverlayHeight + rowIndexTrackHeight),
        reason: validation.ok ? undefined : validation.reason,
      };
      setAxisDropIndicator((current) => (axisDropIndicatorEqual(current, nextIndicator) ? current : nextIndicator));
      return validation;
    }

    const bodyViewport = session.source.area === "body" ? queryGridBodyViewport(root) : null;
    const currentBodyScrollTop = bodyViewport?.scrollTop ?? projectedGridScrollSnapshot.top;
    const boundary = session.source.area === "header"
      ? resolveHeaderRowDropBoundary(clientY - gridRect.top, headerIndexMetrics)
      : rowTrackRef.current
        ? resolveBodyRowDropBoundary(
          clientY - rowTrackRef.current.getBoundingClientRect().top,
          rowIndexMetrics,
          rowData,
          currentSheetRowStructure,
        )
        : null;
    if (!boundary) return null;
    const validation = validateRowMoveDrop(
      session.source,
      boundary.gapIndex,
      headerRowCount,
      sheetRowCount,
      currentSheetRowStructure,
    );
    const nextIndicator: AxisDropIndicator = {
      axis: "row",
      state: validation.ok
        ? validation.mapping.kind === "noop"
          ? "noop"
          : "valid"
        : "invalid",
      left: 0,
      top: (
        session.source.area === "header"
          ? boundary.position
          : bodyRowTrackYToViewportY(boundary.position, headerOverlayHeight, currentBodyScrollTop)
      ) - AXIS_DROP_INDICATOR_THICKNESS_PX / 2,
      width: Math.max(gridRect.width, columnMetrics.reduce((max, metric) => Math.max(max, metric.left + metric.width), 0)),
      height: AXIS_DROP_INDICATOR_THICKNESS_PX,
      reason: validation.ok ? undefined : validation.reason,
    };
    setAxisDropIndicator((current) => (axisDropIndicatorEqual(current, nextIndicator) ? current : nextIndicator));
    return validation;
  }, [
    columnMetrics,
    currentSheetRowStructure,
    headerColCount,
    headerIndexMetrics,
    headerOverlayHeight,
    headerRowCount,
    projectedGridScrollSnapshot.top,
    pinnedHeaderWidth,
    rowData,
    rowIndexMetrics,
    rowIndexTrackHeight,
    sheetColCount,
    sheetRowCount,
  ]);

  const applyAxisHorizontalAutoPan = useCallback((clientX: number): boolean => {
    const root = gridWrapRef.current;
    if (!root) return false;
    const horizontalViewport = queryGridHorizontalViewport(root);
    const centerViewport = root.querySelector<HTMLElement>(".ag-center-cols-viewport") ?? horizontalViewport;
    const viewportRect = centerViewport?.getBoundingClientRect();
    if (!horizontalViewport || !viewportRect) return false;
    const delta = computeAxisAutoPanDelta({
      pointerPosition: clientX,
      viewportStart: viewportRect.left,
      viewportEnd: viewportRect.right,
      scrollPosition: horizontalViewport.scrollLeft,
      scrollSize: horizontalViewport.scrollWidth,
      viewportSize: horizontalViewport.clientWidth,
      edgeSize: AXIS_RAIL_AUTO_PAN_EDGE_PX,
      maxDelta: AXIS_RAIL_AUTO_PAN_MAX_DELTA_PX,
      scrollBoundaryInset: AXIS_RAIL_AUTO_PAN_BOUNDARY_INSET_PX,
    });
    if (Math.abs(delta) <= 0.5) return false;
    horizontalViewport.scrollLeft += delta;
    return true;
  }, []);

  const applyAxisBodyVerticalAutoPan = useCallback((clientY: number): boolean => {
    const root = gridWrapRef.current;
    if (!root) return false;
    const bodyViewport = queryGridBodyViewport(root);
    const viewportRect = bodyViewport?.getBoundingClientRect();
    if (!bodyViewport || !viewportRect) return false;
    const delta = computeAxisAutoPanDelta({
      pointerPosition: clientY,
      viewportStart: viewportRect.top,
      viewportEnd: viewportRect.bottom,
      scrollPosition: bodyViewport.scrollTop,
      scrollSize: bodyViewport.scrollHeight,
      viewportSize: bodyViewport.clientHeight,
      edgeSize: AXIS_RAIL_AUTO_PAN_EDGE_PX,
      maxDelta: AXIS_RAIL_AUTO_PAN_MAX_DELTA_PX,
      scrollBoundaryInset: AXIS_RAIL_AUTO_PAN_BOUNDARY_INSET_PX,
    });
    if (Math.abs(delta) <= 0.5) return false;
    bodyViewport.scrollTop += delta;
    return true;
  }, []);

  const commitAxisDragSession = useCallback((session: AxisDragSession, validation: AxisDropValidation | null) => {
    clearAxisDragSession();
    if (!validation?.ok || validation.mapping.kind === "noop") return;
    if (!activeSheet) {
      throw new Error("axis move requires an active sheet");
    }
    if (session.sheetName !== activeSheet) {
      throw new Error("axis move session sheet changed before commit");
    }
    if (session.axis === "column") {
      startColumnTransition("insert");
      moveColumns(activeSheet, session.source.colIds, validation.mapping.targetGapIndex);
      setSelection({
        kind: "column",
        colIndex: validation.mapping.targetGapIndex,
        anchorColIndex: validation.mapping.targetGapIndex,
        colStart: validation.mapping.targetGapIndex,
        colEnd: validation.mapping.targetGapIndex + session.source.sourceCount - 1,
      });
      setFormulaInputMode("read");
      return;
    }
    const nextRowNumber = validation.mapping.targetGapIndex + 1;
    if (session.source.area === "body") {
      startRowTransition("insert", nextRowNumber);
    }
    moveRows(activeSheet, session.source.rowIds, validation.mapping.targetGapIndex);
    setSelection({
      kind: "row",
      area: session.source.area,
      rowNumber: nextRowNumber,
      anchorRowNumber: nextRowNumber,
      rowStart: nextRowNumber,
      rowEnd: nextRowNumber + session.source.sourceCount - 1,
    });
    setFormulaInputMode("read");
  }, [
    activeSheet,
    clearAxisDragSession,
    moveColumns,
    moveRows,
    startColumnTransition,
    startRowTransition,
  ]);

  const beginAxisDragSession = useCallback((initialSession: AxisDragSession) => {
    clearAxisDragSession();
    axisDragSessionRef.current = initialSession;
    const tickAxisAutoPan = () => {
      axisAutoPanRafRef.current = null;
      const session = axisDragSessionRef.current;
      const point = axisDragPointRef.current;
      if (!session?.active || !point) return;
      const didScroll =
        session.axis === "column"
          ? applyAxisHorizontalAutoPan(point.clientX)
          : session.source.area === "body"
            ? applyAxisBodyVerticalAutoPan(point.clientY)
            : false;
      if (!didScroll) return;
      const validation = updateAxisDropIndicator(session, point.clientX, point.clientY);
      session.lastValidation = validation;
      axisAutoPanRafRef.current = window.requestAnimationFrame(tickAxisAutoPan);
    };
    const ensureAxisAutoPan = () => {
      if (axisAutoPanRafRef.current != null) return;
      axisAutoPanRafRef.current = window.requestAnimationFrame(tickAxisAutoPan);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const session = axisDragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      const moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (!session.active && moved < AXIS_RAIL_DRAG_THRESHOLD_PX) return;
      if (!session.active) {
        session.active = true;
        setAxisDragPreview(axisDragPreviewFromSession(session));
        suppressRailClickForCurrentGesture();
        closeRailMenu();
        setFormulaInputMode("read");
        setFormulaBarSnapshot(null);
      }
      event.preventDefault();
      axisDragPointRef.current = { clientX: event.clientX, clientY: event.clientY };
      const validation = updateAxisDropIndicator(session, event.clientX, event.clientY);
      session.lastValidation = validation;
      ensureAxisAutoPan();
    };
    const handlePointerUp = (event: PointerEvent) => {
      const session = axisDragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      const validation = session.active
        ? updateAxisDropIndicator(session, event.clientX, event.clientY) ?? session.lastValidation
        : null;
      if (session.active) {
        suppressRailClickForCurrentGesture();
      }
      commitAxisDragSession(session, validation);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      const session = axisDragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      if (session.active) {
        suppressRailClickForCurrentGesture();
      }
      clearAxisDragSession();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      suppressRailClickForCurrentGesture();
      clearAxisDragSession();
    };
    const handleWindowBlur = () => {
      const session = axisDragSessionRef.current;
      if (session?.active) {
        suppressRailClickForCurrentGesture();
      }
      clearAxisDragSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      handleWindowBlur();
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    axisDragCleanupRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    applyAxisBodyVerticalAutoPan,
    applyAxisHorizontalAutoPan,
    clearAxisDragSession,
    closeRailMenu,
    commitAxisDragSession,
    suppressRailClickForCurrentGesture,
    updateAxisDropIndicator,
  ]);

  const updateAxisSelectionDrag = useCallback((session: AxisSelectionDragSession, clientX: number, clientY: number): boolean => {
    const root = gridWrapRef.current;
    const gridRect = root?.getBoundingClientRect();
    if (!root || !gridRect) return false;

    if (session.axis === "column") {
      if (sheetColCount <= headerColCount) return false;
      const horizontalViewport = queryGridHorizontalViewport(root);
      const currentColIndex = resolveColumnIndexInViewport(
        clientX - gridRect.left,
        columnMetrics,
        {
          pinnedWidth: pinnedHeaderWidth,
          scrollLeft: horizontalViewport?.scrollLeft ?? 0,
        },
      );
      if (currentColIndex == null) return false;
      const colIndex = Math.max(headerColCount, Math.min(sheetColCount - 1, currentColIndex));
      const colStart = Math.min(session.anchorColIndex, colIndex);
      const colEnd = Math.max(session.anchorColIndex, colIndex);
      setSelection((current) => (
        axisColumnSelectionEqual(current, colIndex, session.anchorColIndex, colStart, colEnd)
          ? current
          : {
              kind: "column",
              colIndex,
              anchorColIndex: session.anchorColIndex,
              colStart,
              colEnd,
            }
      ));
      return true;
    }

    const rowNumber = session.area === "header"
      ? resolveHeaderRowNumberAtTrackY(clientY - gridRect.top, headerIndexMetrics)
      : rowTrackRef.current
        ? resolveBodyRowNumberAtTrackY(clientY - rowTrackRef.current.getBoundingClientRect().top, rowIndexMetrics)
        : null;
    if (rowNumber == null) return false;
    const clampedRowNumber = session.area === "header"
      ? Math.max(1, Math.min(headerRowCount, rowNumber))
      : Math.max(headerRowCount + 1, Math.min(sheetRowCount, rowNumber));
    const rowStart = Math.min(session.anchorRowNumber, clampedRowNumber);
    const rowEnd = Math.max(session.anchorRowNumber, clampedRowNumber);
    setSelection((current) => (
      axisRowSelectionEqual(current, session.area, clampedRowNumber, session.anchorRowNumber, rowStart, rowEnd)
        ? current
        : {
            kind: "row",
            area: session.area,
            rowNumber: clampedRowNumber,
            anchorRowNumber: session.anchorRowNumber,
            rowStart,
            rowEnd,
          }
    ));
    return true;
  }, [
    columnMetrics,
    headerColCount,
    headerIndexMetrics,
    headerRowCount,
    pinnedHeaderWidth,
    rowIndexMetrics,
    sheetColCount,
    sheetRowCount,
  ]);

  const beginAxisSelectionDragSession = useCallback((initialSession: AxisSelectionDragSession) => {
    clearAxisDragSession();
    axisSelectionDragSessionRef.current = initialSession;
    const tickAxisAutoPan = () => {
      axisAutoPanRafRef.current = null;
      const session = axisSelectionDragSessionRef.current;
      const point = axisDragPointRef.current;
      if (!session?.active || !point) return;
      const didScroll =
        session.axis === "column"
          ? applyAxisHorizontalAutoPan(point.clientX)
          : session.area === "body"
            ? applyAxisBodyVerticalAutoPan(point.clientY)
            : false;
      if (!didScroll) return;
      updateAxisSelectionDrag(session, point.clientX, point.clientY);
      axisAutoPanRafRef.current = window.requestAnimationFrame(tickAxisAutoPan);
    };
    const ensureAxisAutoPan = () => {
      if (axisAutoPanRafRef.current != null) return;
      axisAutoPanRafRef.current = window.requestAnimationFrame(tickAxisAutoPan);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const session = axisSelectionDragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      const moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (!session.active && moved < AXIS_RAIL_DRAG_THRESHOLD_PX) return;
      if (!session.active) {
        session.active = true;
        suppressRailClickForCurrentGesture();
        closeRailMenu();
        setFormulaInputMode("read");
        setFormulaBarSnapshot(null);
      }
      event.preventDefault();
      axisDragPointRef.current = { clientX: event.clientX, clientY: event.clientY };
      updateAxisSelectionDrag(session, event.clientX, event.clientY);
      ensureAxisAutoPan();
    };
    const handlePointerUp = (event: PointerEvent) => {
      const session = axisSelectionDragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      if (session.active) {
        suppressRailClickForCurrentGesture();
        updateAxisSelectionDrag(session, event.clientX, event.clientY);
      }
      clearAxisDragSession();
    };
    const handlePointerCancel = (event: PointerEvent) => {
      const session = axisSelectionDragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      if (session.active) {
        suppressRailClickForCurrentGesture();
      }
      clearAxisDragSession();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      suppressRailClickForCurrentGesture();
      clearAxisDragSession();
    };
    const handleWindowBlur = () => {
      const session = axisSelectionDragSessionRef.current;
      if (session?.active) {
        suppressRailClickForCurrentGesture();
      }
      clearAxisDragSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      handleWindowBlur();
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    axisDragCleanupRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    applyAxisBodyVerticalAutoPan,
    applyAxisHorizontalAutoPan,
    clearAxisDragSession,
    closeRailMenu,
    suppressRailClickForCurrentGesture,
    updateAxisSelectionDrag,
  ]);

  const handleColumnRailPointerDown = useCallback((colIndex: number, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || mode === "source" || isActiveSheetBlocked) return;
    event.preventDefault();
    const canStartMove = canStartColumnRailMoveDrag(colIndex, selectedColumnAxisSelection, event);
    if (!canStartMove) {
      if (!canStartColumnRailSelectionDrag(colIndex, headerColCount, sheetColCount, selectedColumnAxisSelection, event)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      beginAxisSelectionDragSession({
        axis: "column",
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        anchorColIndex: colIndex,
      });
      return;
    }
    if (!activeSheet) {
      throw new Error("column rail drag requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("column rail drag requires current sheet state");
    }
    const source = resolveColumnDragSource(colIndex, headerColCount, currentSheetState.colIds, selectedColumnAxisSelection);
    if (!source.ok) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginAxisDragSession({
      axis: "column",
      sheetName: activeSheet,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      source,
      lastValidation: null,
    });
  }, [
    activeSheet,
    beginAxisDragSession,
    beginAxisSelectionDragSession,
    currentSheetState,
    headerColCount,
    isActiveSheetBlocked,
    mode,
    selectedColumnAxisSelection,
    sheetColCount,
  ]);

  const handleRowRailPointerDown = useCallback((rowNumber: number, area: "header" | "body", event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || mode === "source" || isActiveSheetBlocked) return;
    event.preventDefault();
    const canStartMove = canStartRowRailMoveDrag(rowNumber, area, selectedRowAxisSelection, event);
    if (!canStartMove) {
      if (!canStartRowRailSelectionDrag(rowNumber, area, headerRowCount, sheetRowCount, selectedRowAxisSelection, event)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      beginAxisSelectionDragSession({
        axis: "row",
        area,
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        anchorRowNumber: rowNumber,
      });
      return;
    }
    if (!activeSheet) {
      throw new Error("row rail drag requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("row rail drag requires current sheet state");
    }
    const source = resolveRowDragSource(
      rowNumber,
      area,
      headerRowCount,
      currentSheetState.rowIds,
      currentSheetRowStructure,
      selectedRowAxisSelection,
    );
    if (!source.ok) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginAxisDragSession({
      axis: "row",
      sheetName: activeSheet,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      source,
      lastValidation: null,
    });
  }, [
    activeSheet,
    beginAxisDragSession,
    beginAxisSelectionDragSession,
    currentSheetRowStructure,
    currentSheetState,
    headerRowCount,
    isActiveSheetBlocked,
    mode,
    selectedRowAxisSelection,
    sheetRowCount,
  ]);

  useEffect(() => {
    if (mode !== "table" || isActiveSheetBlocked) return;
    if (!isRangeSelection || !selectedCell || selectedCell.area !== "body") return;
    if (!isGridApiAlive(gridApiRef.current)) return;

    const displayedRowIndex = absoluteRowToDisplayedIndex.get(selectedCell.logical.rAbs);
    if (displayedRowIndex == null) return;

    suppressCellFocusSelectionUntilRef.current = performance.now() + 320;
    const frame = window.requestAnimationFrame(() => {
      if (!isGridApiAlive(gridApiRef.current)) return;
      gridApiRef.current.setFocusedCell(displayedRowIndex, selectedCell.colId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode, isActiveSheetBlocked, isRangeSelection, selectedCell, absoluteRowToDisplayedIndex, isGridApiAlive]);

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
      ? axisSelectionView != null
        ? "visible"
        : selectedColumnIndex != null
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
    projectedGridScrollSnapshot.hasVerticalOverlap ? "has-scroll-y" : "",
    projectedGridScrollSnapshot.hasHorizontalOverlap ? "has-scroll-x" : "",
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
  const gridInstanceKey = useMemo(
    () => (currentSheetState ? resolveGridInstanceKey(currentSheetState.sheetId, sheetColCount, headerColCount, headerRowCount) : null),
    [currentSheetState, sheetColCount, headerColCount, headerRowCount],
  );
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
    const trimmedName = nextName.trim();
    if (trimmedName.length === 0) {
      return "Sheet name cannot be empty.";
    }
    if (sheetNames.some((name) => name !== sheetName && name === trimmedName)) {
      return `A sheet named "${trimmedName}" already exists.`;
    }
    try {
      renameSheet(sheetName, nextName);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [renameSheet, sheetNames]);
  const handleInsertSheet = useCallback(() => {
    insertSheet();
  }, [insertSheet]);
  const handleMoveSheet = useCallback((sheetName: string, targetGapIndex: number) => {
    moveSheet(sheetName, targetGapIndex);
  }, [moveSheet]);
  const handleDeleteSheet = useCallback(async (sheetName: string) => {
    if (!docState) {
      throw new Error("cannot delete sheet without an active document state");
    }
    if (docState.sheets.length <= 1) return;
    const confirmed = await requestConfirmation({
      title: "Delete sheet?",
      body: (
        <>
          <p>This removes the sheet from the document. You can restore it with undo.</p>
          <p className="app-modal-target">{sheetName}</p>
        </>
      ),
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteSheet(sheetName);
  }, [deleteSheet, docState, requestConfirmation]);
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

  const prepareForPersistence = useCallback(() => {
    if (formulaInputMode === "edit") handleCommitFormulaInput(formulaDraftInput);
  }, [formulaInputMode, formulaDraftInput, handleCommitFormulaInput]);
  const { fileName, fileStatus, handleOpenFile, handleSaveFile, handleSaveFileAs } = useFileSessionController({
    mode, revision, sourceText, docState, undo, redo, requestConfirmation, prepareForPersistence,
    hasPendingCellEdit: formulaInputMode === "edit",
  });

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

  const {
    handleSetCellLocalFormat, handleSetCellLocalStyle, handleSetColumnDefaultFormat,
    handleSetColumnDefaultStyle, handleSetRowDefaultFormat, handleSetRowDefaultStyle,
  } = useDisplayFormatCommands({ activeSheet, selectedCell, headerRowCount, headerColCount, setFormulaInputMode });

  const {
    handleInsertRow, handleAppendBodyRows, handleDuplicateRow, handleDeleteRow,
    handleConvertRowsToHeader, handleConvertRowsToBody, maxHeaderRowCount, handleSetHeaderRowCount,
    handleInsertColumn, handleAppendDataColumns, handleDuplicateColumn, handleDeleteColumn,
  } = useSheetStructureCommands({
    currentSheet, currentSheetState, currentSheetRowStructure, sheetColCount, headerRowCount,
    headerColCount, headerSemanticLabelPaths, expandRowPath, activeSheet, selectedCell, selection,
    defaultBodyRailColIndex, startRowTransition, startColumnTransition, closeRailMenu,
    setSelectedColumnIndex, setSelectedCell, setFormulaInputMode, focusHeaderOverlayCell,
    focusBodyCellAt, gridWrapRef, queueAppendRowAnchorScroll, requestConfirmation,
    clearActiveSelection, scheduleColumnIntoView, scheduleAppendColumnAnchorScroll,
  });

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
    <SheetSearchContext.Provider value={sheetSearch}>
    <div className="page">
      <div className={mode === "source" ? "app-window source-mode" : "app-window"}>
        <AppChrome
          titlePlacement={window.ordinateDesktop ? "native" : "toolbar"}
          mode={mode}
          fileName={fileName}
          fileStatus={fileStatus.label}
          fileStatusTone={fileStatus.tone}
          activeSheet={activeSheet}
          sheetNames={sheetNames}
          sheetHealthByName={sheetHealthByName}
          setActiveSheet={setActiveSheet}
          onInsertSheet={handleInsertSheet}
          onDeleteSheet={handleDeleteSheet}
          onMoveSheet={handleMoveSheet}
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
          canUndo={canUndo}
          canRedo={canRedo}
          undoLabel={undoLabel}
          redoLabel={redoLabel}
          onUndo={undo}
          onRedo={redo}
          onOpenFile={handleOpenFile}
          onSaveFile={handleSaveFile}
          onSaveFileAs={handleSaveFileAs}
          onEnterSourceMode={enterSourceMode}
          onExitSourceMode={exitSourceMode}
          onTooltipEnter={showTooltip}
          onTooltipLeave={clearTooltip}
          onTooltipSuppress={suppressTooltipForTarget}
          onTooltipRelease={releaseTooltipForTarget}
          onTabMouseEnter={handleTabMouseEnter}
          onTabMouseLeave={clearTooltip}
        />

        <SearchPanel />
        <FileSessionNotices />

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
                frozenColumnCount={frozenColumnCount}
                showGridHeader={showGridHeader}
                pinnedHeaderWidth={pinnedHeaderWidth}
                rowIndexTrackHeight={rowIndexTrackHeight}
                viewportSnapshot={projectedGridScrollSnapshot}
                indexRailsPhase={chromeVisibilityPhase}
                handleIndexRailsHoverChange={handleIndexRailsHoverChange}
                rowIndexMetrics={rowIndexMetrics}
                rowTrackRef={rowTrackRef}
                gridWrapRef={gridWrapRef}
                rowData={rowData}
                columnDefs={columnDefs}
                gridInstanceKey={gridInstanceKey ?? ""}
                selectedCell={selectedCell}
                selectedRange={selectedRange}
                isRangeSelection={isRangeSelection}
                selectedColumnIndex={selectedColumnIndex}
                columnHasLocalConfig={columnHasLocalConfig}
                suppressAgHeaderFocus={Boolean(suppressAgHeaderFocus)}
                overlayOwnsGridHeader={headerOverlayRows > 0}
                showSelectionRing={mode === "table" && !isActiveSheetBlocked && Boolean(selectedCell)}
                formulaReferenceOverlays={formulaReferenceOverlays}
                onFormulaReferenceOverlaySelect={setActiveReferenceTokenId}
                isSelectionRingTransitioning={isSelectionRingTransitioning}
                handleHeaderOverlaySelect={handleHeaderOverlaySelect}
                handleHeaderOverlayDoubleClick={handleHeaderOverlayDoubleClick}
                handleHeaderOverlayKeyDown={handleHeaderOverlayKeyDown}
                handleHeaderHorizontalWheel={handleHeaderHorizontalWheel}
                handleColumnRailSelect={handleColumnRailSelect}
                handleColumnRailPointerDown={handleColumnRailPointerDown}
                handleColumnRailMenuOpen={handleColumnRailMenuOpen}
                handleRowRailSelect={handleRowRailSelect}
                handleRowRailPointerDown={handleRowRailPointerDown}
                handleRowRailMenuOpen={handleRowRailMenuOpen}
                quickAddDisabled={mode !== "table" || isActiveSheetBlocked}
                onQuickAddRows={handleAppendBodyRows}
                onQuickAddColumns={handleAppendDataColumns}
                axisDropIndicator={axisDropIndicator}
                axisDragPreview={axisDragPreview}
                axisSelection={axisSelectionView}
                handleGridReady={handleGridReady}
                handleFirstDataRendered={handleFirstDataRendered}
                handleModelUpdated={handleModelUpdated}
                handleGridSizeChanged={handleGridSizeChanged}
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
        onDuplicateColumn={handleDuplicateColumn}
        onDeleteColumn={handleDeleteColumn}
        onDuplicateRow={handleDuplicateRow}
        onConvertRowsToHeader={handleConvertRowsToHeader}
        onConvertRowsToBody={handleConvertRowsToBody}
        onSetColumnDefaultFormat={handleSetColumnDefaultFormat}
        onSetColumnDefaultStyle={handleSetColumnDefaultStyle}
        onSetRowDefaultFormat={handleSetRowDefaultFormat}
        onSetRowDefaultStyle={handleSetRowDefaultStyle}
        tooltip={tooltip}
      />
      {confirmationDialog}
    </div>
    </SheetSearchContext.Provider>
  );
}
