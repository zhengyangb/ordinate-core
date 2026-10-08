import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";

import { AgGridReact } from "ag-grid-react";
import { createPortal } from "react-dom";
import { SearchText } from "../search/SheetSearch";
import {
  type ColDef,
  type ColGroupDef,
  type CellDoubleClickedEvent,
  type CellMouseDownEvent,
  type FirstDataRenderedEvent,
  type GridSizeChangedEvent,
  type GridReadyEvent,
  type ModelUpdatedEvent,
  type TabToNextCellParams,
  themeQuartz,
} from "ag-grid-community";

import { shouldAnimateTableStructure } from "../config/motion";
import { rowSelectionRegion } from "../utils/selectionModel";
import type { AxisDragPreview, AxisDropIndicator, AxisSelectionView, ChromeVisibilityPhase, ColumnMetric, GridRow, HeaderIndexMetric, HeaderOverlayCell, Rect, RowIndexMetric, SelectedCell } from "../types/ui";
import {
  bodyRowTrackYToViewportY,
  clipColumnTrackSpanToCenterLayer,
  projectAppendColumnSlotToViewport,
  projectColumnTrackSpanToViewport,
  projectTableLayerGeometry,
  resolveColumnCenterTrackWidth,
  resolveAppendRowSlot,
  resolveColumnTrackSpan,
  resolveRailTrackEdgeState,
  type GridScrollSnapshot,
} from "../utils/gridGeometry";
import { computeQuickAddDragCount, hasQuickAddDragThreshold, type QuickAddAxis } from "../utils/quickAddControls";
import { APPEND_AXIS_SLOT_GAP, APPEND_COLUMN_WIDTH, APPEND_ROW_SLOT_HEIGHT, GRID_ROW_HEIGHT } from "../utils/appHelpers";
import { projectSelectionOverlayFragments, type SelectionOverlayFragment, type SelectionOverlayPlane } from "../utils/selectionRing";
import { FillHandle, FillOptions } from "../fill/FillHandle";
import { QuickAddButton } from "./QuickAddButton";
import { EMPTY_COLUMN_WIDTH } from "../utils/columnLayout";
import { readGridBodyOverlayHosts, type GridBodyOverlayHosts } from "../grid/bodyOverlayHosts";
import { waitForInitialGridLayout } from "../grid/initialGridLayout";
import { tabToNextBodyCell } from "../grid/tabNavigation";
import type { FillHandleController } from "../fill/useFillHandle";

type FormulaReferenceOverlay = {
  tokenId: string;
  rect: Rect;
  colorIndex: number;
  active: boolean;
};

const keepConfiguredPinning = () => [];

type TableStageProps = {
  columnRailHost: HTMLDivElement;
  afterTableNote: import("react").ReactNode;
  afterTableNoteHeight: number;
  editingAfterTableNote: boolean;
  onTableWidth: (width: number) => void;
  onLayoutReady: () => void;
  tableStageClassName: string;
  tableStageStyle: CSSProperties;
  columnMetrics: ColumnMetric[];
  headerIndexMetrics: HeaderIndexMetric[];
  headerIndexTrackHeight: number;
  headerOverlayHeight: number;
  headerOverlayCells: HeaderOverlayCell[];
  frozenColumnCount: number;
  showGridHeader: boolean;
  pinnedHeaderWidth: number;
  rowIndexTrackHeight: number;
  viewportSnapshot: GridScrollSnapshot;
  indexRailsPhase: ChromeVisibilityPhase;
  handleIndexRailsHoverChange: (hovering: boolean) => void;
  rowIndexMetrics: RowIndexMetric[];
  rowTrackRef: MutableRefObject<HTMLDivElement | null>;
  onGridRootChange: (root: HTMLDivElement | null) => void;
  rowData: GridRow[];
  columnDefs: Array<ColDef<GridRow> | ColGroupDef<GridRow>>;
  gridInstanceKey: string;
  selectedCell: SelectedCell | null;
  selectedRange: Rect | null;
  fill: FillHandleController;
  isRangeSelection: boolean;
  selectedColumnIndex: number | null;
  columnHasLocalConfig: boolean[];
  rowHasLocalConfig: boolean[];
  showSelectionRing: boolean;
  formulaReferenceOverlays: FormulaReferenceOverlay[];
  onFormulaReferenceOverlaySelect: (tokenId: string) => void;
  isSelectionRingTransitioning: boolean;
  suppressAgHeaderFocus: boolean;
  overlayOwnsGridHeader: boolean;
  handleHeaderOverlaySelect: (rowNumber: number, colIndex: number, event?: ReactPointerEvent<HTMLElement>) => void;
  handleHeaderOverlayDoubleClick: (rowNumber: number, colIndex: number) => void;
  handleHeaderOverlayKeyDown: (event: KeyboardEvent, rowNumber: number, colIndex: number) => void;
  handleHeaderHorizontalWheel: (event: ReactWheelEvent<HTMLElement>) => void;
  handleColumnRailSelect: (colIndex: number, event?: { shiftKey: boolean }) => void;
  handleColumnRailPointerDown: (colIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  handleColumnRailMenuOpen: (colIndex: number, anchorEl: HTMLElement) => void;
  handleRowRailSelect: (rowNumber: number, area: "header" | "body", event?: { shiftKey: boolean }) => void;
  handleRowRailPointerDown: (rowNumber: number, area: "header" | "body", event: ReactPointerEvent<HTMLElement>) => void;
  handleRowRailMenuOpen: (rowNumber: number, area: "header" | "body", anchorEl: HTMLElement) => void;
  quickAddDisabled: boolean;
  onAppendBodyRows: (count: number, focusColumnIndex?: number) => void;
  onQuickAddColumns: (count: number) => void;
  axisDropIndicator: AxisDropIndicator | null;
  axisDragPreview: AxisDragPreview | null;
  axisSelection: AxisSelectionView | null;
  handleGridReady: (event: GridReadyEvent<GridRow>) => void;
  handleFirstDataRendered: (event: FirstDataRenderedEvent<GridRow>) => void;
  handleModelUpdated: (event: ModelUpdatedEvent<GridRow>) => void;
  handleGridSizeChanged: (event: GridSizeChangedEvent<GridRow>) => void;
  handleCellFocused: (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => void;
  handleCellMouseDown: (event: CellMouseDownEvent<GridRow>) => void;
  handleCellDoubleClicked: (event: CellDoubleClickedEvent<GridRow>) => void;
  handleCellKeyDown: (event: {
    rowIndex: number | null;
    column?: string | { getColId(): string } | null;
    event?: Event | null;
  }) => void;
};

type QuickAddDragSession = {
  axis: QuickAddAxis;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
};

function overlayFragmentStyle(fragment: SelectionOverlayFragment): CSSProperties {
  return {
    left: `${fragment.left}px`,
    top: `${fragment.top}px`,
    width: `${fragment.width}px`,
    height: `${fragment.height}px`,
  };
}

function toColumnLetters(colNumber: number): string {
  let n = Math.max(1, Math.trunc(colNumber));
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export default function TableStage({
  columnRailHost,
  afterTableNote,
  afterTableNoteHeight,
  editingAfterTableNote,
  onTableWidth,
  onLayoutReady,
  tableStageClassName,
  tableStageStyle,
  columnMetrics,
  headerIndexMetrics,
  headerIndexTrackHeight,
  headerOverlayHeight,
  headerOverlayCells,
  frozenColumnCount,
  showGridHeader,
  pinnedHeaderWidth,
  rowIndexTrackHeight,
  viewportSnapshot,
  indexRailsPhase,
  handleIndexRailsHoverChange,
  rowIndexMetrics,
  rowTrackRef,
  onGridRootChange,
  rowData,
  columnDefs,
  gridInstanceKey,
  selectedCell,
  selectedRange,
  fill,
  isRangeSelection,
  selectedColumnIndex,
  columnHasLocalConfig,
  rowHasLocalConfig,
  showSelectionRing,
  formulaReferenceOverlays,
  onFormulaReferenceOverlaySelect,
  isSelectionRingTransitioning,
  suppressAgHeaderFocus,
  overlayOwnsGridHeader,
  handleHeaderOverlaySelect,
  handleHeaderOverlayDoubleClick,
  handleHeaderOverlayKeyDown,
  handleHeaderHorizontalWheel,
  handleColumnRailSelect,
  handleColumnRailPointerDown,
  handleColumnRailMenuOpen,
  handleRowRailSelect,
  handleRowRailPointerDown,
  handleRowRailMenuOpen,
  quickAddDisabled,
  onAppendBodyRows,
  onQuickAddColumns,
  axisDropIndicator,
  axisDragPreview,
  axisSelection,
  handleGridReady,
  handleFirstDataRendered,
  handleModelUpdated,
  handleGridSizeChanged,
  handleCellFocused,
  handleCellMouseDown,
  handleCellDoubleClicked,
  handleCellKeyDown,
}: TableStageProps) {
  const handleTabToNextCell = useCallback((params: TabToNextCellParams<GridRow>) =>
    tabToNextBodyCell(params, !quickAddDisabled, onAppendBodyRows),
  [quickAddDisabled, onAppendBodyRows]);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const noteFooterRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!editingAfterTableNote) return;
    // Notes are outside the row model; reveal them through the native viewport
    // which also owns their live vertical offset.
    const frame = requestAnimationFrame(() => {
      const footer = noteFooterRef.current;
      const viewport = gridWrapRef.current?.querySelector<HTMLElement>('.ag-body-viewport');
      if (!footer || !viewport) return;
      const bounds = footer.getBoundingClientRect();
      const visible = viewport.getBoundingClientRect();
      if (bounds.bottom > visible.bottom) viewport.scrollTop += bounds.bottom - visible.bottom + 16;
      else if (bounds.top < visible.top) viewport.scrollTop += bounds.top - visible.top;
    });
    return () => cancelAnimationFrame(frame);
  }, [afterTableNoteHeight, editingAfterTableNote]);
  const mountGridRoot = useCallback((root: HTMLDivElement | null) => {
    gridWrapRef.current = root;
    onGridRootChange(root);
  }, [onGridRootChange]);
  const [quickAddPreview, setQuickAddPreview] = useState<{ axis: QuickAddAxis; count: number } | null>(null);
  const quickAddDragSessionRef = useRef<QuickAddDragSession | null>(null);
  const quickAddPointerCommitRef = useRef<{ axis: QuickAddAxis } | null>(null);
  const animateTableStructure = shouldAnimateTableStructure();
  const previewColumnWidth = EMPTY_COLUMN_WIDTH;
  const [readyGridKey, setReadyGridKey] = useState<string | null>(null);
  const layoutReady = readyGridKey === gridInstanceKey;
  useEffect(() => {
    if (layoutReady) onLayoutReady();
  }, [layoutReady, onLayoutReady]);
  const initialLayoutCleanup = useRef<(() => void) | null>(null);
  const expectedViewportRef = useRef({ centerViewportWidth: viewportSnapshot.centerViewportWidth, pinnedWidth: pinnedHeaderWidth });
  useLayoutEffect(() => {
    expectedViewportRef.current = { centerViewportWidth: viewportSnapshot.centerViewportWidth, pinnedWidth: pinnedHeaderWidth };
  }, [viewportSnapshot.centerViewportWidth, pinnedHeaderWidth]);
  useLayoutEffect(() => {
    setReadyGridKey(null);
    return () => initialLayoutCleanup.current?.();
  }, [gridInstanceKey]);
  const trackInitialLayout = useCallback(() => {
    initialLayoutCleanup.current?.();
    const root = gridWrapRef.current;
    if (!root) throw new Error("rendered grid requires a root for initial layout");
    initialLayoutCleanup.current = waitForInitialGridLayout(root, () => expectedViewportRef.current, () => setReadyGridKey(gridInstanceKey));
  }, [gridInstanceKey]);
  const onFirstDataRendered = useCallback((event: FirstDataRenderedEvent<GridRow>) => {
    handleFirstDataRendered(event);
    trackInitialLayout();
  }, [trackInitialLayout, handleFirstDataRendered]);
  const [bodyOverlayHosts, setBodyOverlayHosts] = useState<{
    gridKey: string; hosts: GridBodyOverlayHosts;
  } | null>(null);
  const onGridReady = useCallback((event: GridReadyEvent<GridRow>) => {
    const root = gridWrapRef.current;
    if (!root) throw new Error("ready grid requires a root for body overlays");
    setBodyOverlayHosts({ gridKey: gridInstanceKey, hosts: readGridBodyOverlayHosts(root) });
    handleGridReady(event);
    if (rowData.length === 0) trackInitialLayout();
  }, [gridInstanceKey, handleGridReady, rowData.length, trackInitialLayout]);
  const {
    top: bodyScrollTop,
    left: bodyScrollLeft,
    centerViewportWidth,
    bodyViewportHeight,
  } = viewportSnapshot;
  const resolvedTableStageStyle = useMemo<CSSProperties>(
    () =>
      ({
        ...tableStageStyle,
        "--sheet-note-after-height": `${afterTableNoteHeight}px`,
        "--axis-append-column-scroll-extent": `${APPEND_AXIS_SLOT_GAP + APPEND_COLUMN_WIDTH}px`,
        "--axis-append-row-scroll-extent": `${APPEND_AXIS_SLOT_GAP + APPEND_ROW_SLOT_HEIGHT}px`,
        "--quick-add-row-size": `${GRID_ROW_HEIGHT}px`,
        "--quick-add-column-size": `${previewColumnWidth}px`,
      }) as CSSProperties,
    [tableStageStyle, previewColumnWidth, afterTableNoteHeight],
  );
  const railsPhaseClass = `index-rail index-rail--${indexRailsPhase}`;
  const defaultColDef = useMemo<ColDef<GridRow>>(() => ({
    editable: false,
    sortable: false,
    filter: false,
    resizable: false,
    suppressMovable: true,
  }), []);
  const getRowId = useCallback((params: { data: GridRow }) => params.data.__rowKey, []);
  const rowClassRules = useMemo(() => ({
    "group-row": (params: { data?: GridRow }) => Boolean(params.data?.__hasChildren),
  }), []);
  const selectedRowNumber = selectedCell?.logical.rAbs ?? null;
  const activeColumnIndex = selectedColumnIndex ?? selectedCell?.logical.cAbs ?? null;
  const pinnedOverlayCells = headerOverlayCells.filter((cell) => cell.endCol < frozenColumnCount);
  const centerOverlayCells = headerOverlayCells.filter((cell) => cell.startCol >= frozenColumnCount);
  const appendRowSlot = resolveAppendRowSlot(rowIndexTrackHeight, APPEND_ROW_SLOT_HEIGHT, APPEND_AXIS_SLOT_GAP);
  const centerTrackWidth = resolveColumnCenterTrackWidth(columnMetrics, pinnedHeaderWidth);
  const appendColumnGeometry = {
    centerTrackWidth,
    centerViewportWidth,
    scrollLeft: bodyScrollLeft,
    slotSize: APPEND_COLUMN_WIDTH,
    gap: APPEND_AXIS_SLOT_GAP,
  };
  const appendColumnSlot = projectAppendColumnSlotToViewport({
    ...appendColumnGeometry,
    scrollLeft: bodyScrollLeft,
  });
  const tableGeometry = projectTableLayerGeometry({
    pinnedWidth: pinnedHeaderWidth,
    centerTrackWidth,
    centerViewportWidth,
    scrollLeft: bodyScrollLeft,
    headerTrackHeight: headerOverlayHeight,
    bodyTrackHeight: rowIndexTrackHeight,
    bodyViewportHeight,
    bodyScrollTop,
  });
  const tableFootprint = tableGeometry.footprint;
  useLayoutEffect(() => onTableWidth(tableFootprint.width), [tableFootprint.width, onTableWidth]);
  const centerTrackStyle = {
    width: `${centerTrackWidth}px`,
    transform: "translate3d(var(--grid-center-track-offset-x), 0, 0)",
  };
  const bodyTrackStyle = {
    height: `${appendRowSlot.bottom}px`,
    transform: "translate3d(0, var(--grid-body-track-offset-y), 0)",
  };
  const overlayProjectionBase = useMemo(() => ({
    headerRowCount: headerIndexMetrics.length,
    headerColCount: frozenColumnCount,
    pinnedWidth: pinnedHeaderWidth,
    columnMetrics,
    headerIndexMetrics,
    rowIndexMetrics,
  }), [headerIndexMetrics, frozenColumnCount, pinnedHeaderWidth, columnMetrics, rowIndexMetrics]);
  const selectionRingFragments = useMemo(() => selectedCell?.area === "body"
    ? projectSelectionOverlayFragments({
        ...overlayProjectionBase,
        range: {
          rowStart: selectedCell.logical.rAbs,
          rowEnd: selectedCell.logical.rAbs,
          colStart: selectedCell.logical.cAbs,
          colEnd: selectedCell.logical.cAbs,
        },
      })
    : [], [overlayProjectionBase, selectedCell]);
  const rangeSelectionFragments = useMemo(() => selectedRange && isRangeSelection
    ? projectSelectionOverlayFragments({ ...overlayProjectionBase, range: selectedRange })
    : [], [overlayProjectionBase, selectedRange, isRangeSelection]);
  const fillFragments = fill.preview ? projectSelectionOverlayFragments({ ...overlayProjectionBase, range: fill.preview }) : [];
  const fillFeedbackFragments = fill.feedback ? projectSelectionOverlayFragments({ ...overlayProjectionBase, range: fill.feedback.target }) : [];
  const fillCorner = fill.available && selectedRange ? projectSelectionOverlayFragments({ ...overlayProjectionBase, range: {
    rowStart: selectedRange.rowEnd, rowEnd: selectedRange.rowEnd, colStart: selectedRange.colEnd, colEnd: selectedRange.colEnd,
  } })[0] : null;
  const referenceFragments = useMemo(() => formulaReferenceOverlays.flatMap((reference) =>
    projectSelectionOverlayFragments({ ...overlayProjectionBase, range: reference.rect }).map((fragment, index) => ({
      ...fragment,
      fragmentKey: `${reference.tokenId}:${index}`,
      tokenId: reference.tokenId,
      colorIndex: reference.colorIndex,
      active: reference.active,
    })),
  ), [overlayProjectionBase, formulaReferenceOverlays]);
  const overlayPlaneStyles: Record<SelectionOverlayPlane, CSSProperties> = {
    "header-pinned": { left: 0, top: 0, width: pinnedHeaderWidth, height: headerOverlayHeight },
    "header-center": { left: pinnedHeaderWidth, top: 0, width: centerViewportWidth, height: headerOverlayHeight },
    "body-pinned": { inset: 0 },
    "body-center": { inset: 0 },
  };
  const overlayPlanes: SelectionOverlayPlane[] = [
    "body-center",
    "body-pinned",
    "header-center",
    "header-pinned",
  ];
  const pinnedColumnMetrics = columnMetrics.filter((metric) => metric.colIndex < frozenColumnCount);
  const centerColumnMetrics = columnMetrics.filter((metric) => metric.colIndex >= frozenColumnCount);
  const isColumnDragPreview = (colIndex: number) =>
    axisDragPreview?.axis === "column" &&
    colIndex >= axisDragPreview.colStart &&
    colIndex <= axisDragPreview.colEnd;
  const isColumnAxisSelected = (colIndex: number) =>
    axisSelection?.axis === "column" &&
    colIndex >= axisSelection.colStart &&
    colIndex <= axisSelection.colEnd;
  const isRowDragPreview = (rowNumber: number, area: "header" | "body") =>
    axisDragPreview?.axis === "row" &&
    axisDragPreview.area === area &&
    rowNumber >= axisDragPreview.rowStart &&
    rowNumber <= axisDragPreview.rowEnd;
  const isRowAxisSelected = (rowNumber: number) =>
    axisSelection?.axis === "row" &&
    rowNumber >= axisSelection.rowStart &&
    rowNumber <= axisSelection.rowEnd;
  const isRowAxisSelectionInvalid = (area: "header" | "body") =>
    axisSelection?.axis === "row" && rowSelectionRegion(axisSelection, headerIndexMetrics.length) === area && !axisSelection.draggable;
  const bodyRowDragPreviewRows =
    axisDragPreview?.axis === "row" && axisDragPreview.area === "body"
      ? rowIndexMetrics.filter((row) => row.number >= axisDragPreview.rowStart && row.number <= axisDragPreview.rowEnd)
      : [];
  const bodyRowDragPreviewBand =
    bodyRowDragPreviewRows.length > 0 && axisDragPreview?.axis === "row" && axisDragPreview.area === "body"
      ? {
          top: bodyRowTrackYToViewportY(Math.min(...bodyRowDragPreviewRows.map((row) => row.top)), headerOverlayHeight, bodyScrollTop),
          bottom: bodyRowTrackYToViewportY(Math.max(...bodyRowDragPreviewRows.map((row) => row.top + row.height)), headerOverlayHeight, bodyScrollTop),
          rowCount: axisDragPreview.rowCount,
        }
      : null;
  const bodyRowSelectionRows =
    axisSelection?.axis === "row"
      ? rowIndexMetrics.filter((row) => row.number >= axisSelection.rowStart && row.number <= axisSelection.rowEnd)
      : [];
  const bodyRowSelectionBand =
    bodyRowSelectionRows.length > 0 && axisSelection?.axis === "row"
      ? {
          top: bodyRowTrackYToViewportY(Math.min(...bodyRowSelectionRows.map((row) => row.top)), headerOverlayHeight, bodyScrollTop),
          bottom: bodyRowTrackYToViewportY(Math.max(...bodyRowSelectionRows.map((row) => row.top + row.height)), headerOverlayHeight, bodyScrollTop),
          rowCount: axisSelection.rowCount,
          invalid: isRowAxisSelectionInvalid("body"),
        }
      : null;
  const axisColumnSelectionBand =
    axisSelection?.axis === "column"
      ? (() => {
          const span = resolveColumnTrackSpan(columnMetrics, axisSelection.colStart, axisSelection.colEnd);
          return span ? clipColumnTrackSpanToCenterLayer(span, pinnedHeaderWidth) : null;
        })()
      : null;
  const axisDragCountBadge =
    axisDragPreview?.axis === "column"
      ? (() => {
          const span = resolveColumnTrackSpan(columnMetrics, axisDragPreview.colStart, axisDragPreview.colEnd);
          if (!span) return null;
          const projectedSpan = projectColumnTrackSpanToViewport(span, {
            pinnedWidth: pinnedHeaderWidth,
            scrollLeft: bodyScrollLeft,
          });
          const count = axisDragPreview.colEnd - axisDragPreview.colStart + 1;
          return {
            axis: "column" as const,
            label: `${count} ${count === 1 ? "column" : "columns"}`,
            left: projectedSpan.center,
            top: Math.max(8, Math.min(headerOverlayHeight - 28, 16)),
          };
        })()
      : axisDragPreview?.axis === "row"
        ? (() => {
            const draggedRows =
              axisDragPreview.area === "header"
                ? headerIndexMetrics.filter(
                    (row) => row.number >= axisDragPreview.rowStart && row.number <= axisDragPreview.rowEnd,
                  )
                : rowIndexMetrics.filter((row) => row.number >= axisDragPreview.rowStart && row.number <= axisDragPreview.rowEnd);
            if (draggedRows.length === 0) return null;
            const top = axisDragPreview.area === "body"
              ? bodyRowTrackYToViewportY(Math.min(...draggedRows.map((row) => row.top)), headerOverlayHeight, bodyScrollTop)
              : Math.min(...draggedRows.map((row) => row.top));
            const bottom = axisDragPreview.area === "body"
              ? bodyRowTrackYToViewportY(Math.max(...draggedRows.map((row) => row.top + row.height)), headerOverlayHeight, bodyScrollTop)
              : Math.max(...draggedRows.map((row) => row.top + row.height));
            return {
              axis: "row" as const,
              label: `${axisDragPreview.rowCount} ${axisDragPreview.rowCount === 1 ? "row" : "rows"}`,
              left: Math.max(14, pinnedHeaderWidth + 12),
              top: top + (bottom - top) / 2,
            };
          })()
        : null;

  const renderColumnRailCell = (metric: ColumnMetric, left: number, pinned: boolean) => {
    const colNumber = metric.colIndex + 1;
    const isActive = activeColumnIndex === metric.colIndex;
    const isSelected = isColumnAxisSelected(metric.colIndex);
    const isDragSource = isColumnDragPreview(metric.colIndex);
    const letters = toColumnLetters(colNumber);
    const hasLocalConfig = columnHasLocalConfig[metric.colIndex] === true;
    const edge = resolveRailTrackEdgeState(metric.colIndex, columnMetrics.length);
    const className = [
      "column-index-cell",
      edge.isOrigin ? "is-origin" : "",
      edge.isTerminal ? "is-terminal" : "",
      pinned ? "is-pinned" : "",
      isActive ? "is-active" : "",
      isSelected ? "is-axis-selected" : "",
      isDragSource ? "is-axis-drag-source" : "",
    ].filter(Boolean).join(" ");
    return (
      <div
        key={`column-index-${colNumber}`}
        className={className}
        style={{
          left: `${left}px`,
          width: `${metric.width}px`,
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleColumnRailMenuOpen(metric.colIndex, event.currentTarget);
        }}
      >
        <button
          className="column-index-main"
          type="button"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => handleColumnRailPointerDown(metric.colIndex, event)}
          onClick={(event) => handleColumnRailSelect(metric.colIndex, event)}
          aria-label={`Select column ${letters}${hasLocalConfig ? ", custom formatting" : ""}`}
        >
          <span className="column-index-label axis-format-label" data-formatted={hasLocalConfig || undefined}>
            <span className="column-index-primary">{letters}</span>
            <sub className="column-index-secondary" aria-hidden="true">
              {colNumber}
            </sub>
          </span>
        </button>
      </div>
    );
  };

  const renderAppendColumnChromeSlot = () => {
    if (quickAddDisabled || !appendColumnSlot) return null;
    return (
      <div
        className={`column-index-append-slot ${railsPhaseClass}`}
        style={{
          left: `${pinnedHeaderWidth + appendColumnSlot.left}px`,
          width: `${appendColumnSlot.width}px`,
        }}
        onMouseEnter={() => handleIndexRailsHoverChange(true)}
        onMouseLeave={() => handleIndexRailsHoverChange(false)}
        onPointerEnter={() => handleIndexRailsHoverChange(true)}
        onPointerLeave={() => handleIndexRailsHoverChange(false)}
      >
        <QuickAddButton
          axis="column"
          count={quickAddPreview?.axis === "column" ? quickAddPreview.count : null}
          className="axis-quick-add axis-quick-add--column"
          type="button"
          aria-label="Add column"
          onPointerDown={(event) => beginQuickAddDrag("column", event)}
          onPointerMove={updateQuickAddDrag}
          onPointerUp={finishQuickAddDrag}
          onPointerCancel={cancelQuickAddDrag}
          onClick={(event) => handleQuickAddClick("column", event)}
        />
      </div>
    );
  };

  const markQuickAddPointerCommit = useCallback((axis: QuickAddAxis) => {
    quickAddPointerCommitRef.current = {
      axis,
    };
  }, []);

  const commitQuickAddCount = useCallback((axis: QuickAddAxis, count: number, suppressNativeClick: boolean) => {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("quick add commit requires a non-negative integer count");
    }
    quickAddDragSessionRef.current = null;
    if (suppressNativeClick) markQuickAddPointerCommit(axis);
    setQuickAddPreview(null);
    if (count === 0) return;
    if (axis === "row") {
      onAppendBodyRows(count);
    } else {
      onQuickAddColumns(count);
    }
  }, [markQuickAddPointerCommit, onAppendBodyRows, onQuickAddColumns]);

  const commitQuickAddDrag = useCallback((session: QuickAddDragSession, currentX: number, currentY: number) => {
    if (!session.active) {
      throw new Error("quick add drag cannot commit before crossing the drag threshold");
    }
    const count = computeQuickAddDragCount({
      axis: session.axis,
      startX: session.startX,
      startY: session.startY,
      currentX,
      currentY,
    });
    commitQuickAddCount(session.axis, count, true);
  }, [commitQuickAddCount]);

  const cancelActiveQuickAddDrag = useCallback(() => {
    const session = quickAddDragSessionRef.current;
    if (session) markQuickAddPointerCommit(session.axis);
    quickAddDragSessionRef.current = null;
    setQuickAddPreview(null);
  }, [markQuickAddPointerCommit]);

  const updateActiveQuickAddDrag = useCallback((session: QuickAddDragSession, currentX: number, currentY: number) => {
    const active =
      session.active ||
      hasQuickAddDragThreshold({
        axis: session.axis,
        startX: session.startX,
        startY: session.startY,
        currentX,
        currentY,
      });
    if (!active) return false;
    if (!session.active) {
      quickAddDragSessionRef.current = { ...session, active: true };
    }
    const count = computeQuickAddDragCount({
      axis: session.axis,
      startX: session.startX,
      startY: session.startY,
      currentX,
      currentY,
    });
    setQuickAddPreview((current) =>
      current?.axis === session.axis && current.count === count ? current : { axis: session.axis, count },
    );
    return true;
  }, []);

  const finishQuickAddDragSession = useCallback((session: QuickAddDragSession, currentX: number, currentY: number) => {
    const active = session.active || updateActiveQuickAddDrag(session, currentX, currentY);
    if (!active) {
      commitQuickAddCount(session.axis, 1, true);
      return true;
    }
    const activeSession = quickAddDragSessionRef.current;
    if (!activeSession || activeSession.pointerId !== session.pointerId) {
      throw new Error("quick add drag session disappeared before commit");
    }
    commitQuickAddDrag(activeSession, currentX, currentY);
    return true;
  }, [commitQuickAddCount, commitQuickAddDrag, updateActiveQuickAddDrag]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const session = quickAddDragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (updateActiveQuickAddDrag(session, event.clientX, event.clientY)) {
        event.preventDefault();
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      const session = quickAddDragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (finishQuickAddDragSession(session, event.clientX, event.clientY)) {
        event.preventDefault();
      }
    };
    const handlePointerCancel = (event: PointerEvent) => {
      const session = quickAddDragSessionRef.current;
      if (session && session.pointerId !== event.pointerId) return;
      cancelActiveQuickAddDrag();
    };
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !quickAddDragSessionRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelActiveQuickAddDrag();
    };
    window.addEventListener("keydown", handleEscape, true);
    window.addEventListener("blur", cancelActiveQuickAddDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("blur", cancelActiveQuickAddDrag);
    };
  }, [cancelActiveQuickAddDrag, finishQuickAddDragSession, updateActiveQuickAddDrag]);

  const beginQuickAddDrag = (axis: QuickAddAxis, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (quickAddDisabled || event.button !== 0) return;
    quickAddPointerCommitRef.current = null;
    quickAddDragSessionRef.current = {
      axis,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateQuickAddDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = quickAddDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (updateActiveQuickAddDrag(session, event.clientX, event.clientY)) {
      event.preventDefault();
    }
  };

  const finishQuickAddDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = quickAddDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (finishQuickAddDragSession(session, event.clientX, event.clientY)) {
      event.preventDefault();
    }
  };

  const cancelQuickAddDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = quickAddDragSessionRef.current;
    if (session && session.pointerId !== event.pointerId) return;
    cancelActiveQuickAddDrag();
  };

  const handleQuickAddClick = (axis: QuickAddAxis, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (quickAddDisabled) return;
    const recentPointerCommit = quickAddPointerCommitRef.current;
    if (
      event.detail > 0 &&
      recentPointerCommit?.axis === axis
    ) {
      return;
    }
    const session = quickAddDragSessionRef.current;
    if (session && session.axis !== axis) {
      throw new Error(`quick add click axis mismatch: expected ${session.axis}, got ${axis}`);
    }
    commitQuickAddCount(axis, 1, false);
  };

  const renderOverlayCell = (cell: HeaderOverlayCell, leftOffset = 0) => {
    const span = Math.max(1, cell.endCol - cell.startCol + 1);
    const selectedSlot =
      selectedCell?.area === "header" &&
      selectedCell.logical.rAbs === cell.rowNumber &&
      selectedCell.logical.cAbs >= cell.startCol &&
      selectedCell.logical.cAbs <= cell.endCol
        ? selectedCell.logical.cAbs - cell.startCol
        : -1;
    const isDragSource =
      (axisDragPreview?.axis === "column" &&
        cell.endCol >= axisDragPreview.colStart &&
        cell.startCol <= axisDragPreview.colEnd) ||
      (axisDragPreview?.axis === "row" &&
        axisDragPreview.area === "header" &&
        cell.rowNumber >= axisDragPreview.rowStart &&
        cell.rowNumber <= axisDragPreview.rowEnd);
    const isAxisSelected =
      (axisSelection?.axis === "column" &&
        cell.endCol >= axisSelection.colStart &&
        cell.startCol <= axisSelection.colEnd) ||
      (axisSelection?.axis === "row" &&
        cell.rowNumber >= axisSelection.rowStart &&
        cell.rowNumber <= axisSelection.rowEnd);
    const className = [
      "header-matrix-cell",
      selectedSlot >= 0 ? "has-slot-selection" : "",
      isAxisSelected ? "is-axis-selected" : "",
      isAxisSelected && isRowAxisSelectionInvalid("header") ? "is-axis-selection-invalid" : "",
      isDragSource ? "is-axis-drag-source" : "",
    ].filter(Boolean).join(" ");
    const style: CSSProperties & {
      "--overlay-slot-count"?: string;
      "--overlay-slot-index"?: string;
    } = {
      left: `${cell.left - leftOffset}px`,
      top: `${cell.top}px`,
      width: `${cell.width}px`,
      height: `${cell.height}px`,
    };
    if (selectedSlot >= 0) {
      style["--overlay-slot-count"] = String(span);
      style["--overlay-slot-index"] = String(selectedSlot);
    }

    return (
      <button
        key={cell.key}
        className={className}
        data-row-number={cell.rowNumber}
        data-start-col={cell.startCol}
        data-end-col={cell.endCol}
        type="button"
        style={style}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const target = event.currentTarget;
          const rect = target.getBoundingClientRect();
          const localX = Math.min(Math.max(0, event.clientX - rect.left), Math.max(0, rect.width - 1));
          const ratio = rect.width > 0 ? localX / rect.width : 0;
          const slot = Math.min(span - 1, Math.floor(ratio * span));
          const colIndex = cell.startCol + slot;
          handleHeaderOverlaySelect(cell.rowNumber, colIndex, event);
          requestAnimationFrame(() => target.focus());
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const target = event.currentTarget;
          const rect = target.getBoundingClientRect();
          const localX = Math.min(Math.max(0, event.clientX - rect.left), Math.max(0, rect.width - 1));
          const ratio = rect.width > 0 ? localX / rect.width : 0;
          const slot = Math.min(span - 1, Math.floor(ratio * span));
          handleHeaderOverlayDoubleClick(cell.rowNumber, cell.startCol + slot);
        }}
        onKeyDown={(event) => {
          const spanSize = Math.max(1, cell.endCol - cell.startCol + 1);
          const selectedColIndex = selectedSlot >= 0 ? cell.startCol + selectedSlot : cell.startCol + spanSize - 1;
          handleHeaderOverlayKeyDown(event.nativeEvent, cell.rowNumber, selectedColIndex);
        }}
      >
        <span><SearchText row={cell.rowNumber} col={cell.startCol} text={cell.label} /></span>
      </button>
    );
  };

  return (
    <div className={tableStageClassName} style={resolvedTableStageStyle} data-layout-ready={layoutReady}>
      {createPortal(<div className="note-column-rail" style={resolvedTableStageStyle}>
      <div
        className={`table-corner ${railsPhaseClass}`}
        onMouseEnter={() => handleIndexRailsHoverChange(true)}
        onMouseLeave={() => handleIndexRailsHoverChange(false)}
      />

      <div
        className={`column-index-strip ${railsPhaseClass}`}
        onMouseEnter={() => handleIndexRailsHoverChange(true)}
        onMouseLeave={() => handleIndexRailsHoverChange(false)}
        onWheel={handleHeaderHorizontalWheel}
      >
        <div
          className="column-index-track"
          aria-hidden="true"
        >
          {tableFootprint.width > 0 ? (
            <>
              <div
                className="column-index-pill"
                style={{ width: `${tableFootprint.width}px` }}
              />
              <div
                className={
                  tableFootprint.columnEndVisible
                    ? "index-rail-outline index-rail-outline--column"
                    : "index-rail-outline index-rail-outline--column is-open-end"
                }
                style={{ width: `${tableFootprint.width}px` }}
              />
            </>
          ) : null}
          {pinnedHeaderWidth > 0 ? (
            <div
              className="column-index-pinned-track"
              style={{ width: `${pinnedHeaderWidth}px` }}
            >
              {pinnedColumnMetrics.map((metric) => renderColumnRailCell(metric, metric.left, true))}
            </div>
          ) : null}
          {pinnedHeaderWidth > 0 ? (
            <div
              className="column-index-frozen-boundary"
              style={{ left: `${pinnedHeaderWidth}px` }}
              aria-hidden="true"
            />
          ) : null}
          <div
            className="column-index-center-track"
            style={{
              left: `${tableGeometry.centerViewport.left}px`,
              width: `${tableGeometry.centerViewport.width}px`,
            }}
          >
            <div
              className="column-index-center-scroll-layer"
              style={centerTrackStyle}
            >
              {centerColumnMetrics.map((metric) => renderColumnRailCell(metric, metric.left - pinnedHeaderWidth, false))}
            </div>
          </div>
        </div>
        {renderAppendColumnChromeSlot()}
      </div>
      </div>, columnRailHost)}

      <div
        className={`row-index-strip ${railsPhaseClass}`}
        onMouseEnter={() => handleIndexRailsHoverChange(true)}
        onMouseLeave={() => handleIndexRailsHoverChange(false)}
      >
        <div className="row-index-shell">
          {tableFootprint.height > 0 ? (
            <>
              <div
                className="row-index-pill"
                style={{ height: `${tableFootprint.height}px` }}
              />
              <div
                className={
                  tableFootprint.rowEndVisible
                    ? "index-rail-outline index-rail-outline--row"
                    : "index-rail-outline index-rail-outline--row is-open-end"
                }
                style={{ height: `${tableFootprint.height}px` }}
              />
            </>
          ) : null}
          <div
            className={headerIndexMetrics.length > 0 ? "row-index-header-track" : "row-index-header-track is-empty"}
            style={headerIndexTrackHeight > 0 ? { height: `${headerIndexTrackHeight}px` } : undefined}
          >
              {headerIndexMetrics.map((row, rowIndex) => {
                const edge = resolveRailTrackEdgeState(
                  rowIndex,
                  headerIndexMetrics.length + rowIndexMetrics.length,
                );
                return (
                <button
                  key={`row-index-header-${row.number}`}
                className={[
                  "row-index-cell",
                  "is-header",
                  edge.isOrigin ? "is-origin" : "",
                  selectedRowNumber === row.number ? "is-active" : "",
                  isRowAxisSelected(row.number) ? "is-axis-selected" : "",
                  isRowAxisSelected(row.number) && isRowAxisSelectionInvalid("header") ? "is-axis-selection-invalid" : "",
                  isRowDragPreview(row.number, "header") ? "is-axis-drag-source" : "",
                ].filter(Boolean).join(" ")}
                style={{
                  top: `${row.top}px`,
                  height: `${row.height}px`,
                }}
                type="button"
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleRowRailMenuOpen(row.number, "header", event.currentTarget);
                }}
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) => handleRowRailPointerDown(row.number, "header", event)}
                onClick={(event) => handleRowRailSelect(row.number, "header", event)}
                >
                  {row.number}
                </button>
                );
              })}
          </div>
          <div className="row-index-viewport">
            <div
              ref={rowTrackRef}
              className="row-index-track"
              style={bodyTrackStyle}
            >
              {rowIndexMetrics.map((row, rowIndex) => {
                const edge = resolveRailTrackEdgeState(
                  headerIndexMetrics.length + rowIndex,
                  headerIndexMetrics.length + rowIndexMetrics.length,
                );
                return (
                <div
                  key={`row-index-${row.rowKey}`}
                  className={
                    [
                      "row-index-cell",
                      edge.isOrigin ? "is-origin" : "",
                      selectedRowNumber === row.number ? "is-active" : "",
                      isRowAxisSelected(row.number) ? "is-axis-selected" : "",
                      isRowAxisSelected(row.number) && isRowAxisSelectionInvalid("body") ? "is-axis-selection-invalid" : "",
                      isRowDragPreview(row.number, "body") ? "is-axis-drag-source" : "",
                      edge.isTerminal ? "is-track-end" : "",
                    ].filter(Boolean).join(" ")
                  }
                  style={{
                    top: `${row.top}px`,
                    height: `${row.height}px`,
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleRowRailMenuOpen(row.number, "body", event.currentTarget);
                  }}
                >
                  <button
                    type="button"
                    className="row-index-main"
                    aria-label={`Select row ${row.number}${rowHasLocalConfig[row.number - 1] ? ", custom formatting" : ""}`}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    onPointerDown={(event) => handleRowRailPointerDown(row.number, "body", event)}
                    onClick={(event) => handleRowRailSelect(row.number, "body", event)}
                  >
                    <span className="axis-format-label" data-formatted={rowHasLocalConfig[row.number - 1] || undefined}>{row.number}</span>
                  </button>
                </div>
                );
              })}
              {!quickAddDisabled ? (
                <div
                  className="row-index-cell row-index-append-cell"
                  style={{
                    top: `${appendRowSlot.top}px`,
                    height: `${appendRowSlot.height}px`,
                  }}
                >
                  <QuickAddButton
                    axis="row"
                    count={quickAddPreview?.axis === "row" ? quickAddPreview.count : null}
                    className="axis-quick-add axis-quick-add--row"
                    type="button"
                    aria-label="Add row"
                    onPointerDown={(event) => beginQuickAddDrag("row", event)}
                    onPointerMove={updateQuickAddDrag}
                    onPointerUp={finishQuickAddDrag}
                    onPointerCancel={cancelQuickAddDrag}
                    onClick={(event) => handleQuickAddClick("row", event)}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-shell">
        {tableFootprint.height > 0 ? (
          <div
            className="table-leading-boundary-line"
            style={{ height: `${tableFootprint.height}px` }}
            aria-hidden="true"
          />
        ) : null}
        {axisColumnSelectionBand ? (
          <div
            className="axis-column-selection-viewport"
            style={{
              left: `${tableGeometry.centerViewport.left}px`,
              width: `${tableGeometry.centerViewport.width}px`,
              height: `${Math.max(0, tableFootprint.height)}px`,
            }}
            aria-hidden="true"
          >
            <div
              className="axis-column-selection-scroll-layer"
              style={centerTrackStyle}
            >
              <div
                className="axis-column-selection-preview"
                style={{
                  left: `${axisColumnSelectionBand.left}px`,
                  width: `${axisColumnSelectionBand.width}px`,
                }}
              />
            </div>
          </div>
        ) : null}
        {bodyRowSelectionBand ? (
          <div
            className={[
              "axis-row-selection-preview",
              bodyRowSelectionBand.invalid ? "is-invalid" : "",
            ].filter(Boolean).join(" ")}
            data-row-count={bodyRowSelectionBand.rowCount}
            style={{
              top: `${bodyRowSelectionBand.top}px`,
              height: `${bodyRowSelectionBand.bottom - bodyRowSelectionBand.top}px`,
            }}
            aria-hidden="true"
          />
        ) : null}
        {bodyRowDragPreviewBand ? (
          <div
            className="axis-row-drag-preview"
            data-row-count={bodyRowDragPreviewBand.rowCount}
            style={{
              top: `${bodyRowDragPreviewBand.top}px`,
              height: `${bodyRowDragPreviewBand.bottom - bodyRowDragPreviewBand.top}px`,
            }}
            aria-hidden="true"
          />
        ) : null}
        {axisDragCountBadge ? (
          <div
            className={`axis-drag-count-badge axis-drag-count-badge--${axisDragCountBadge.axis}`}
            style={{
              left: `${axisDragCountBadge.left}px`,
              top: `${axisDragCountBadge.top}px`,
            }}
            aria-hidden="true"
          >
            {axisDragCountBadge.label}
          </div>
        ) : null}
        {quickAddPreview && quickAddPreview.count > 0 ? (
          <div className="quick-add-ghost-viewport" aria-hidden="true">
            <div className={`quick-add-ghost quick-add-ghost--${quickAddPreview.axis}`} style={quickAddPreview.axis === "row" ? {
              top: headerOverlayHeight + rowIndexTrackHeight - bodyScrollTop,
              left: 0, width: tableFootprint.width, height: quickAddPreview.count * GRID_ROW_HEIGHT,
            } : {
              top: 0, left: pinnedHeaderWidth + centerTrackWidth - bodyScrollLeft,
              width: quickAddPreview.count * previewColumnWidth, height: tableFootprint.height,
            }} />
          </div>
        ) : null}
        {axisDropIndicator ? (
          <div
            className={[
              "axis-drop-indicator",
              `axis-drop-indicator--${axisDropIndicator.axis}`,
              `is-${axisDropIndicator.state}`,
            ].join(" ")}
            style={{
              left: `${axisDropIndicator.left}px`,
              top: `${axisDropIndicator.top}px`,
              width: `${axisDropIndicator.width}px`,
              height: `${axisDropIndicator.height}px`,
            }}
            aria-hidden="true"
          />
        ) : null}
        {showSelectionRing || referenceFragments.length > 0 || fillFeedbackFragments.length > 0 ? (
          <div className="table-overlay-geometry">
            {overlayPlanes.map((plane) => {
              const planeSelectionFragments = selectionRingFragments.filter((fragment) => fragment.plane === plane);
              const planeRangeFragments = rangeSelectionFragments.filter((fragment) => fragment.plane === plane);
              const planeReferenceFragments = referenceFragments.filter((fragment) => fragment.plane === plane);
              const planeFillFragments = fillFragments.filter(fragment => fragment.plane === plane);
              const planeFeedbackFragments = fillFeedbackFragments.filter(fragment => fragment.plane === plane);
              if (
                planeSelectionFragments.length === 0 &&
                planeRangeFragments.length === 0 &&
                planeReferenceFragments.length === 0 && planeFillFragments.length === 0 && planeFeedbackFragments.length === 0 && fillCorner?.plane !== plane
              ) {
                return null;
              }
              const isBody = plane.startsWith("body");
              const overlay = (
                <div
                  key={plane}
                  className={`table-overlay-plane table-overlay-plane--${plane}${isBody ? " is-native-track" : ""}`}
                  style={overlayPlaneStyles[plane]}
                >
                  <div
                    className={[
                      "table-overlay-track",
                      !isBody && plane.endsWith("center") ? "is-center-track" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {planeRangeFragments.map((fragment, index) => (
                      <div
                        key={`range:${plane}:${index}`}
                        className="persistent-range-selection"
                        style={overlayFragmentStyle(fragment)}
                        aria-hidden="true"
                      />
                    ))}
                    {planeReferenceFragments.map((fragment) => (
                      <button
                        key={fragment.fragmentKey}
                        className={[
                          "formula-reference-range",
                          fragment.active ? "is-active" : "",
                        ].filter(Boolean).join(" ")}
                        style={overlayFragmentStyle(fragment)}
                        data-token-id={fragment.tokenId}
                        data-color-index={fragment.colorIndex}
                        type="button"
                        aria-label="Select formula reference"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onFormulaReferenceOverlaySelect(fragment.tokenId);
                        }}
                      />
                    ))}
                    {planeSelectionFragments.map((fragment, index) => (
                      <div
                        key={`focus:${plane}:${index}`}
                        className={[
                          "persistent-selection-ring",
                          isSelectionRingTransitioning && animateTableStructure ? "is-structural-transition" : "",
                        ].filter(Boolean).join(" ")}
                        style={overlayFragmentStyle(fragment)}
                        aria-hidden="true"
                      />
                    ))}
                    {planeFillFragments.map((fragment, index) => <div key={`fill:${index}`} className="fill-preview" style={overlayFragmentStyle(fragment)} aria-hidden="true" />)}
                    {fill.feedback && planeFeedbackFragments.map((fragment, index) => <div
                      key={`fill-feedback:${fill.feedback!.id}:${index}`}
                      className="fill-feedback" data-direction={fill.feedback!.direction}
                      style={overlayFragmentStyle(fragment)} aria-hidden="true"
                      onAnimationEnd={() => fill.finishFeedback(fill.feedback!.id)}
                    ><span /></div>)}
                    {fillCorner?.plane === plane ? <FillHandle fill={fill} corner={fillCorner} /> : null}
                  </div>
                </div>
              );
              if (!isBody) return overlay;
              // The browser moves body overlays with the cells themselves.
              // No JS scroll transform or React frame is involved in tracking.
              if (bodyOverlayHosts?.gridKey !== gridInstanceKey) return null;
              return createPortal(overlay, bodyOverlayHosts.hosts[plane === "body-pinned" ? "pinned" : "center"], plane);
            })}
          </div>
        ) : null}
        <FillOptions fill={fill} />
        {headerOverlayHeight > 0 ? (
          <>
            <div
              className="table-frozen-row-shadow"
              style={{ height: `${headerOverlayHeight}px`, width: `${tableFootprint.width}px` }}
              aria-hidden="true"
            />
            <div
              className="header-matrix-base header-matrix-base--center"
              style={
                {
                  height: `${headerOverlayHeight}px`,
                  width: `${tableFootprint.width}px`,
                  "--header-overlay-pinned-width": `${Math.max(0, pinnedHeaderWidth)}px`,
                } as CSSProperties
              }
              aria-hidden="true"
            />
            <div
              className="header-matrix-base header-matrix-base--pinned"
              style={{
                height: `${headerOverlayHeight}px`,
                width: `${Math.max(0, pinnedHeaderWidth)}px`,
              }}
              aria-hidden="true"
            />
            <div
              className="header-matrix-overlay header-matrix-overlay--center"
              style={
                {
                  height: `${headerOverlayHeight}px`,
                  left: `${tableGeometry.centerViewport.left}px`,
                  width: `${tableGeometry.centerViewport.width}px`,
                  "--header-overlay-pinned-width": `${Math.max(0, pinnedHeaderWidth)}px`,
                } as CSSProperties
              }
              aria-hidden="true"
              onWheel={handleHeaderHorizontalWheel}
            >
              <div
                className="header-matrix-center-scroll-layer"
                style={centerTrackStyle}
              >
                {centerOverlayCells.map((cell) => renderOverlayCell(cell, pinnedHeaderWidth))}
              </div>
            </div>
            <div
              className="header-matrix-overlay header-matrix-overlay--pinned"
              style={{
                height: `${headerOverlayHeight}px`,
                width: `${Math.max(0, pinnedHeaderWidth)}px`,
              }}
              aria-hidden="true"
            >
              {pinnedOverlayCells.map((cell) => renderOverlayCell(cell))}
            </div>
          </>
        ) : null}
        <div
          className={
            suppressAgHeaderFocus
              ? overlayOwnsGridHeader
                ? "grid-wrap suppress-cell-focus-ring suppress-header-focus overlay-owned-header"
                : "grid-wrap suppress-cell-focus-ring suppress-header-focus"
              : overlayOwnsGridHeader
                ? "grid-wrap suppress-cell-focus-ring overlay-owned-header"
                : "grid-wrap suppress-cell-focus-ring"
          }
          ref={mountGridRoot}
          data-has-header={showGridHeader}
        >
          <AgGridReact<GridRow>
            key={gridInstanceKey}
            rowData={rowData}
            columnDefs={columnDefs}
            animateRows={animateTableStructure}
            // Header layout contract:
            // - the visible spreadsheet header is fully owned by our overlay
            // - `.grid-wrap` reserves that vertical space with padding-top
            // - AG Grid's native header must stay at 0 height, otherwise
            //   header space gets counted twice and body rows are pushed down
            headerHeight={0}
            groupHeaderHeight={0}
            defaultColDef={defaultColDef}
            getRowId={getRowId}
            suppressScrollOnNewData
            suppressMovableColumns
            suppressDragLeaveHidesColumns
            suppressColumnVirtualisation
            // Pinning is owned by our shared viewport geometry, including overlays.
            processUnpinnedColumns={keepConfiguredPinning}
            suppressContextMenu
            theme={themeQuartz}
            onGridReady={onGridReady}
            onFirstDataRendered={onFirstDataRendered}
            onModelUpdated={handleModelUpdated}
            onGridSizeChanged={handleGridSizeChanged}
            onCellFocused={handleCellFocused}
            onCellMouseDown={handleCellMouseDown}
            onCellDoubleClicked={handleCellDoubleClicked}
            onCellKeyDown={handleCellKeyDown}
            tabToNextCell={handleTabToNextCell}
            rowClassRules={rowClassRules}
          />
        </div>
        {tableFootprint.trailingCanvas ? (
          <div
            className="table-trailing-canvas-mask"
            style={{
              left: `${tableFootprint.trailingCanvas.left}px`,
              width: `${tableFootprint.trailingCanvas.width}px`,
              height: `${tableFootprint.height}px`,
            }}
            aria-hidden="true"
          />
        ) : null}
        <div ref={noteFooterRef} className="sheet-note-footer" style={{ top: headerOverlayHeight + rowIndexTrackHeight }}>
          {afterTableNote}
        </div>
      </div>
    </div>
  );
}
