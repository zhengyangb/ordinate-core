import { useRef, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";

import { AgGridReact } from "ag-grid-react";
import {
  type ColDef,
  type ColGroupDef,
  type CellMouseDownEvent,
  type FirstDataRenderedEvent,
  type GridReadyEvent,
  type ModelUpdatedEvent,
  themeQuartz,
} from "ag-grid-community";

import { shouldAnimateTableStructure } from "../config/motion";
import type { ChromeVisibilityPhase, ColumnMetric, GridRow, HeaderIndexMetric, HeaderOverlayCell, RowIndexMetric, SelectedCell } from "../types/ui";

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
  indexRailsPhase: ChromeVisibilityPhase;
  handleIndexRailsHoverChange: (hovering: boolean) => void;
  rowIndexMetrics: RowIndexMetric[];
  columnTrackRef: MutableRefObject<HTMLDivElement | null>;
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
  handleColumnRailSelect: (colIndex: number) => void;
  handleColumnRailMenuOpen: (colIndex: number, anchorEl: HTMLElement) => void;
  handleRowRailSelect: (rowNumber: number, area: "header" | "body") => void;
  handleRowRailMenuOpen: (rowNumber: number, area: "header" | "body", anchorEl: HTMLElement) => void;
  handleGridReady: (event: GridReadyEvent<GridRow>) => void;
  handleFirstDataRendered: (event: FirstDataRenderedEvent<GridRow>) => void;
  handleModelUpdated: (event: ModelUpdatedEvent<GridRow>) => void;
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
  indexRailsPhase,
  handleIndexRailsHoverChange,
  rowIndexMetrics,
  columnTrackRef,
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
  handleColumnRailMenuOpen,
  handleRowRailSelect,
  handleRowRailMenuOpen,
  handleGridReady,
  handleFirstDataRendered,
  handleModelUpdated,
  handleCellFocused,
  handleCellMouseDown,
  handleCellDoubleClicked,
  handleCellKeyDown,
}: TableStageProps) {
  const animateTableStructure = shouldAnimateTableStructure();
  const railsPhaseClass = `index-rail index-rail--${indexRailsPhase}`;
  const selectedRowNumber = selectedCell?.logical.rAbs ?? null;
  const activeColumnIndex = selectedColumnIndex ?? selectedCell?.logical.cAbs ?? null;
  const pinnedOverlayCells = headerOverlayCells.filter((cell) => cell.endCol < headerColCount);
  const centerOverlayCells = headerOverlayCells.filter((cell) => cell.startCol >= headerColCount);
  const columnTrackWidth = columnMetrics.length === 0 ? 0 : Math.max(...columnMetrics.map((metric) => metric.left + metric.width));
  const centerTrackWidth = Math.max(0, columnTrackWidth - pinnedHeaderWidth);
  const pinnedColumnMetrics = columnMetrics.filter((metric) => metric.colIndex < headerColCount);
  const centerColumnMetrics = columnMetrics.filter((metric) => metric.colIndex >= headerColCount);

  const renderColumnRailCell = (metric: ColumnMetric, left: number, pinned: boolean) => {
    const colNumber = metric.colIndex + 1;
    const isActive = activeColumnIndex === metric.colIndex;
    const letters = toColumnLetters(colNumber);
    const hasLocalConfig = columnHasLocalConfig[metric.colIndex] === true;
    return (
      <div
        key={`column-index-${colNumber}`}
        className={isActive ? `column-index-cell${pinned ? " is-pinned" : ""} is-active` : `column-index-cell${pinned ? " is-pinned" : ""}`}
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
          onClick={() => handleColumnRailSelect(metric.colIndex)}
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
        className={selectedSlot >= 0 ? "header-matrix-cell has-slot-selection" : "header-matrix-cell"}
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
                className={selectedRowNumber === row.number ? "row-index-cell is-header is-active" : "row-index-cell is-header"}
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
                onClick={() => handleRowRailSelect(row.number, "header")}
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
                    selectedRowNumber === row.number
                      ? "row-index-cell is-active"
                      : "row-index-cell"
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
                  <button type="button" className="row-index-main" onClick={() => handleRowRailSelect(row.number, "body")}>
                    {row.number}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-shell">
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
            defaultColDef={{
              editable: false,
              sortable: false,
              filter: false,
              resizable: false,
              suppressMovable: true,
            }}
            getRowId={(params) => params.data.__rowKey}
            suppressMovableColumns
            suppressDragLeaveHidesColumns
            suppressColumnVirtualisation
            suppressContextMenu
            theme={themeQuartz}
            onGridReady={handleGridReady}
            onFirstDataRendered={handleFirstDataRendered}
            onModelUpdated={handleModelUpdated}
            onCellFocused={handleCellFocused}
            onCellMouseDown={handleCellMouseDown}
            onCellDoubleClicked={handleCellDoubleClicked}
            onCellKeyDown={handleCellKeyDown}
            rowClassRules={{
              "group-row": (params) => Boolean(params.data?.__hasChildren),
            }}
          />
        </div>
      </div>
    </div>
  );
}
