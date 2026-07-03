import { useCallback, useMemo, useRef, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";

import { AgGridReact } from "ag-grid-react";
import {
  type ColDef,
  type ColGroupDef,
  type CellMouseDownEvent,
  type FirstDataRenderedEvent,
  type GridSizeChangedEvent,
  type GridReadyEvent,
  type ModelUpdatedEvent,
  themeQuartz,
} from "ag-grid-community";

import { shouldAnimateTableStructure } from "../config/motion";
import type { AxisDragPreview, AxisDropIndicator, AxisSelectionView, ChromeVisibilityPhase, ColumnMetric, GridRow, HeaderIndexMetric, HeaderOverlayCell, RowIndexMetric, SelectedCell } from "../types/ui";
import {
  bodyRowTrackYToViewportY,
  clipColumnTrackSpanToCenterLayer,
  projectColumnTrackSpanToViewport,
  resolveColumnTrackSpan,
} from "../utils/gridGeometry";

type FormulaReferenceOverlay = {
  tokenId: string;
  colorIndex: number;
  active: boolean;
};

type TableStageProps = {
  tableStageClassName: string;
  tableStageStyle: CSSProperties;
  columnMetrics: ColumnMetric[];
  headerIndexMetrics: HeaderIndexMetric[];
  headerIndexTrackHeight: number;
  headerOverlayHeight: number;
  headerOverlayCells: HeaderOverlayCell[];
  headerColCount: number;
  showGridHeader: boolean;
  pinnedHeaderWidth: number;
  rowIndexTrackHeight: number;
  bodyScrollTop: number;
  bodyScrollLeft: number;
  indexRailsPhase: ChromeVisibilityPhase;
  handleIndexRailsHoverChange: (hovering: boolean) => void;
  rowIndexMetrics: RowIndexMetric[];
  columnTrackRef: MutableRefObject<HTMLDivElement | null>;
  axisColumnSelectionTrackRef: MutableRefObject<HTMLDivElement | null>;
  headerCenterTrackRef: MutableRefObject<HTMLDivElement | null>;
  rowTrackRef: MutableRefObject<HTMLDivElement | null>;
  gridWrapRef: MutableRefObject<HTMLDivElement | null>;
  rowData: GridRow[];
  columnDefs: Array<ColDef<GridRow> | ColGroupDef<GridRow>>;
  selectedCell: SelectedCell | null;
  selectedColumnIndex: number | null;
  columnHasLocalConfig: boolean[];
  showSelectionRing: boolean;
  selectionRingRef: MutableRefObject<HTMLDivElement | null>;
  selectionRangeRef: MutableRefObject<HTMLDivElement | null>;
  formulaReferenceOverlayLayerRef: MutableRefObject<HTMLDivElement | null>;
  formulaReferenceOverlays: FormulaReferenceOverlay[];
  onFormulaReferenceOverlaySelect: (tokenId: string) => void;
  isSelectionRingTransitioning: boolean;
  suppressAgHeaderFocus: boolean;
  overlayOwnsGridHeader: boolean;
  handleHeaderOverlaySelect: (rowNumber: number, colIndex: number, event?: ReactPointerEvent<HTMLElement>) => void;
  handleHeaderOverlayDoubleClick: (rowNumber: number, colIndex: number) => void;
  handleHeaderOverlayKeyDown: (event: KeyboardEvent, rowNumber: number, colIndex: number) => void;
  handleColumnRailSelect: (colIndex: number, event?: { shiftKey: boolean }) => void;
  handleColumnRailPointerDown: (colIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  handleColumnRailMenuOpen: (colIndex: number, anchorEl: HTMLElement) => void;
  handleRowRailSelect: (rowNumber: number, area: "header" | "body", event?: { shiftKey: boolean }) => void;
  handleRowRailPointerDown: (rowNumber: number, area: "header" | "body", event: ReactPointerEvent<HTMLElement>) => void;
  handleRowRailMenuOpen: (rowNumber: number, area: "header" | "body", anchorEl: HTMLElement) => void;
  axisDropIndicator: AxisDropIndicator | null;
  axisDragPreview: AxisDragPreview | null;
  axisSelection: AxisSelectionView | null;
  handleGridReady: (event: GridReadyEvent<GridRow>) => void;
  handleFirstDataRendered: (event: FirstDataRenderedEvent<GridRow>) => void;
  handleModelUpdated: (event: ModelUpdatedEvent<GridRow>) => void;
  handleGridSizeChanged: (event: GridSizeChangedEvent<GridRow>) => void;
  handleCellFocused: (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => void;
  handleCellMouseDown: (event: CellMouseDownEvent<GridRow>) => void;
  handleCellDoubleClicked: (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => void;
  handleCellKeyDown: (event: {
    rowIndex: number | null;
    column?: string | { getColId(): string } | null;
    event?: Event | null;
  }) => void;
};

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

function ColumnConfigGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2 3.1h8M2 6h8M2 8.9h8" />
      <circle cx="4" cy="3.1" r="1" />
      <circle cx="7.5" cy="6" r="1" />
      <circle cx="5.6" cy="8.9" r="1" />
    </svg>
  );
}

export default function TableStage({
  tableStageClassName,
  tableStageStyle,
  columnMetrics,
  headerIndexMetrics,
  headerIndexTrackHeight,
  headerOverlayHeight,
  headerOverlayCells,
  headerColCount,
  showGridHeader,
  pinnedHeaderWidth,
  rowIndexTrackHeight,
  bodyScrollTop,
  bodyScrollLeft,
  indexRailsPhase,
  handleIndexRailsHoverChange,
  rowIndexMetrics,
  columnTrackRef,
  axisColumnSelectionTrackRef,
  headerCenterTrackRef,
  rowTrackRef,
  gridWrapRef,
  rowData,
  columnDefs,
  selectedCell,
  selectedColumnIndex,
  columnHasLocalConfig,
  showSelectionRing,
  selectionRingRef,
  selectionRangeRef,
  formulaReferenceOverlayLayerRef,
  formulaReferenceOverlays,
  onFormulaReferenceOverlaySelect,
  isSelectionRingTransitioning,
  suppressAgHeaderFocus,
  overlayOwnsGridHeader,
  handleHeaderOverlaySelect,
  handleHeaderOverlayDoubleClick,
  handleHeaderOverlayKeyDown,
  handleColumnRailSelect,
  handleColumnRailPointerDown,
  handleColumnRailMenuOpen,
  handleRowRailSelect,
  handleRowRailPointerDown,
  handleRowRailMenuOpen,
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
  const animateTableStructure = shouldAnimateTableStructure();
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
  const pinnedOverlayCells = headerOverlayCells.filter((cell) => cell.endCol < headerColCount);
  const centerOverlayCells = headerOverlayCells.filter((cell) => cell.startCol >= headerColCount);
  const columnTrackWidth = columnMetrics.length === 0 ? 0 : Math.max(...columnMetrics.map((metric) => metric.left + metric.width));
  const centerTrackWidth = Math.max(0, columnTrackWidth - pinnedHeaderWidth);
  const pinnedColumnMetrics = columnMetrics.filter((metric) => metric.colIndex < headerColCount);
  const centerColumnMetrics = columnMetrics.filter((metric) => metric.colIndex >= headerColCount);
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
  const isRowAxisSelected = (rowNumber: number, area: "header" | "body") =>
    axisSelection?.axis === "row" &&
    axisSelection.area === area &&
    rowNumber >= axisSelection.rowStart &&
    rowNumber <= axisSelection.rowEnd;
  const isRowAxisSelectionInvalid = (area: "header" | "body") =>
    axisSelection?.axis === "row" && axisSelection.area === area && !axisSelection.draggable;
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
    axisSelection?.axis === "row" && axisSelection.area === "body"
      ? rowIndexMetrics.filter((row) => row.number >= axisSelection.rowStart && row.number <= axisSelection.rowEnd)
      : [];
  const bodyRowSelectionBand =
    bodyRowSelectionRows.length > 0 && axisSelection?.axis === "row" && axisSelection.area === "body"
      ? {
          top: bodyRowTrackYToViewportY(Math.min(...bodyRowSelectionRows.map((row) => row.top)), headerOverlayHeight, bodyScrollTop),
          bottom: bodyRowTrackYToViewportY(Math.max(...bodyRowSelectionRows.map((row) => row.top + row.height)), headerOverlayHeight, bodyScrollTop),
          rowCount: axisSelection.rowCount,
          draggable: axisSelection.draggable,
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
          const projectedSpan = projectColumnTrackSpanToViewport(span, { pinnedWidth: pinnedHeaderWidth, scrollLeft: bodyScrollLeft });
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
    const className = [
      "column-index-cell",
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
          aria-label={`Select column ${letters}`}
        >
          <span className="column-index-label">
            <span className="column-index-primary">{letters}</span>
            <sup className="column-index-secondary" aria-hidden="true">
              {colNumber}
            </sup>
          </span>
          {hasLocalConfig ? (
            <span className="column-index-config-badge" aria-hidden="true">
              <ColumnConfigGlyph />
            </span>
          ) : null}
        </button>
      </div>
    );
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
        axisSelection.area === "header" &&
        cell.rowNumber >= axisSelection.rowStart &&
        cell.rowNumber <= axisSelection.rowEnd);
    const className = [
      "header-matrix-cell",
      selectedSlot >= 0 ? "has-slot-selection" : "",
      isAxisSelected ? "is-axis-selected" : "",
      isAxisSelected && axisSelection?.axis === "row" && !axisSelection.draggable ? "is-axis-selection-invalid" : "",
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
        <span>{cell.label}</span>
      </button>
    );
  };

  return (
    <div className={tableStageClassName} style={tableStageStyle}>
      <div
        className={`table-corner ${railsPhaseClass}`}
        onMouseEnter={() => handleIndexRailsHoverChange(true)}
        onMouseLeave={() => handleIndexRailsHoverChange(false)}
      />

      <div
        className={`column-index-strip ${railsPhaseClass}`}
        onMouseEnter={() => handleIndexRailsHoverChange(true)}
        onMouseLeave={() => handleIndexRailsHoverChange(false)}
      >
        <div
          className="column-index-track"
          style={columnTrackWidth > 0 ? { width: `${columnTrackWidth}px` } : undefined}
          aria-hidden="true"
        >
          {pinnedColumnMetrics.map((metric) => renderColumnRailCell(metric, metric.left, true))}
          <div
            className="column-index-center-track"
            style={{
              left: `${pinnedHeaderWidth}px`,
              width: `${centerTrackWidth}px`,
            }}
          >
            <div ref={columnTrackRef} className="column-index-center-scroll-layer">
              {centerColumnMetrics.map((metric) => renderColumnRailCell(metric, metric.left - pinnedHeaderWidth, false))}
            </div>
          </div>
        </div>
      </div>

      <div
        className={`row-index-strip ${railsPhaseClass}`}
        onMouseEnter={() => handleIndexRailsHoverChange(true)}
        onMouseLeave={() => handleIndexRailsHoverChange(false)}
      >
        <div className="row-index-shell">
          <div
            className={headerIndexMetrics.length > 0 ? "row-index-header-track" : "row-index-header-track is-empty"}
            style={headerIndexTrackHeight > 0 ? { height: `${headerIndexTrackHeight}px` } : undefined}
          >
              {headerIndexMetrics.map((row) => (
                <button
                  key={`row-index-header-${row.number}`}
                className={[
                  "row-index-cell",
                  "is-header",
                  selectedRowNumber === row.number ? "is-active" : "",
                  isRowAxisSelected(row.number, "header") ? "is-axis-selected" : "",
                  isRowAxisSelected(row.number, "header") && isRowAxisSelectionInvalid("header") ? "is-axis-selection-invalid" : "",
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
              ))}
          </div>
          <div className="row-index-viewport">
            <div
              ref={rowTrackRef}
              className="row-index-track"
              style={rowIndexTrackHeight > 0 ? { height: `${rowIndexTrackHeight}px` } : undefined}
            >
              {rowIndexMetrics.map((row) => (
                <div
                  key={`row-index-${row.rowKey}`}
                  className={
                    [
                      "row-index-cell",
                      selectedRowNumber === row.number ? "is-active" : "",
                      isRowAxisSelected(row.number, "body") ? "is-axis-selected" : "",
                      isRowAxisSelected(row.number, "body") && isRowAxisSelectionInvalid("body") ? "is-axis-selection-invalid" : "",
                      isRowDragPreview(row.number, "body") ? "is-axis-drag-source" : "",
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
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    onPointerDown={(event) => handleRowRailPointerDown(row.number, "body", event)}
                    onClick={(event) => handleRowRailSelect(row.number, "body", event)}
                  >
                    {row.number}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-shell">
        {axisColumnSelectionBand ? (
          <div
            className="axis-column-selection-viewport"
            style={{
              left: `${pinnedHeaderWidth}px`,
              width: `${centerTrackWidth}px`,
            }}
            aria-hidden="true"
          >
            <div
              ref={axisColumnSelectionTrackRef}
              className="axis-column-selection-scroll-layer"
              style={centerTrackWidth > 0 ? { width: `${centerTrackWidth}px` } : undefined}
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
              bodyRowSelectionBand.draggable ? "" : "is-invalid",
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
        {showSelectionRing ? (
          <>
            <div ref={selectionRangeRef} className="persistent-range-selection is-hidden" aria-hidden="true" />
            <div ref={formulaReferenceOverlayLayerRef} className="formula-reference-overlay-layer">
              {formulaReferenceOverlays.map((overlay) => (
                <button
                  key={overlay.tokenId}
                  className={overlay.active ? "formula-reference-range is-hidden is-active" : "formula-reference-range is-hidden"}
                  data-token-id={overlay.tokenId}
                  data-color-index={overlay.colorIndex}
                  type="button"
                  aria-label="Select formula reference"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onFormulaReferenceOverlaySelect(overlay.tokenId);
                  }}
                />
              ))}
            </div>
            <div
              ref={selectionRingRef}
              className={
                isSelectionRingTransitioning && animateTableStructure
                  ? "persistent-selection-ring is-hidden is-structural-transition"
                  : "persistent-selection-ring is-hidden"
              }
              aria-hidden="true"
            />
          </>
        ) : null}
        {headerOverlayHeight > 0 ? (
          <>
            <div
              className="header-matrix-base header-matrix-base--center"
              style={
                {
                  height: `${headerOverlayHeight}px`,
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
                  left: `${Math.max(0, pinnedHeaderWidth)}px`,
                  width: `${centerTrackWidth}px`,
                  "--header-overlay-pinned-width": `${Math.max(0, pinnedHeaderWidth)}px`,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <div
                ref={headerCenterTrackRef}
                className="header-matrix-center-scroll-layer"
                style={centerTrackWidth > 0 ? { width: `${centerTrackWidth}px` } : undefined}
              >
                {centerOverlayCells.map((cell) => renderOverlayCell(cell, pinnedHeaderWidth))}
              </div>
            </div>
            <div
              className="header-matrix-overlay header-matrix-overlay--pinned"
              style={{ height: `${headerOverlayHeight}px` }}
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
          ref={gridWrapRef}
        >
          <AgGridReact<GridRow>
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
            suppressMovableColumns
            suppressDragLeaveHidesColumns
            suppressColumnVirtualisation
            suppressContextMenu
            theme={themeQuartz}
            onGridReady={handleGridReady}
            onFirstDataRendered={handleFirstDataRendered}
            onModelUpdated={handleModelUpdated}
            onGridSizeChanged={handleGridSizeChanged}
            onCellFocused={handleCellFocused}
            onCellMouseDown={handleCellMouseDown}
            onCellDoubleClicked={handleCellDoubleClicked}
            onCellKeyDown={handleCellKeyDown}
            rowClassRules={rowClassRules}
          />
        </div>
      </div>
    </div>
  );
}
