import type { CSSProperties, MutableRefObject } from "react";

import { AgGridReact } from "ag-grid-react";
import {
  type ColDef,
  type ColGroupDef,
  type FirstDataRenderedEvent,
  type GridReadyEvent,
  type ModelUpdatedEvent,
  themeQuartz,
} from "ag-grid-community";

import type { ChromeVisibilityPhase, ColumnMetric, GridRow, HeaderIndexMetric, HeaderOverlayCell, RowIndexMetric, SelectedCell } from "../types/ui";

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
  rowIndexMetrics: RowIndexMetric[];
  columnTrackRef: MutableRefObject<HTMLDivElement | null>;
  rowTrackRef: MutableRefObject<HTMLDivElement | null>;
  gridWrapRef: MutableRefObject<HTMLDivElement | null>;
  rowData: GridRow[];
  columnDefs: Array<ColDef<GridRow> | ColGroupDef<GridRow>>;
  selectedCell: SelectedCell | null;
  selectedColumnIndex: number | null;
  columnHasLocalConfig: boolean[];
  suppressAgHeaderFocus: boolean;
  handleHeaderOverlaySelect: (rowNumber: number, colIndex: number) => void;
  handleColumnRailSelect: (colIndex: number) => void;
  handleColumnRailMenuOpen: (colIndex: number, anchorEl: HTMLElement) => void;
  handleRowRailSelect: (rowNumber: number, rowPath: string | null) => void;
  handleGridReady: (event: GridReadyEvent<GridRow>) => void;
  handleFirstDataRendered: (event: FirstDataRenderedEvent<GridRow>) => void;
  handleModelUpdated: (event: ModelUpdatedEvent<GridRow>) => void;
  handleCellFocused: (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => void;
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
  rowIndexMetrics,
  columnTrackRef,
  rowTrackRef,
  gridWrapRef,
  rowData,
  columnDefs,
  selectedCell,
  selectedColumnIndex,
  columnHasLocalConfig,
  suppressAgHeaderFocus,
  handleHeaderOverlaySelect,
  handleColumnRailSelect,
  handleColumnRailMenuOpen,
  handleRowRailSelect,
  handleGridReady,
  handleFirstDataRendered,
  handleModelUpdated,
  handleCellFocused,
}: TableStageProps) {
  const railsPhaseClass = `index-rail index-rail--${indexRailsPhase}`;
  const selectedRowNumber = selectedCell?.logical.rAbs ?? null;
  const pinnedOverlayCells = headerOverlayCells.filter((cell) => cell.endCol < headerColCount);
  const centerOverlayCells = headerOverlayCells.filter((cell) => cell.startCol >= headerColCount);
  const columnTrackWidth = columnMetrics.length === 0 ? 0 : Math.max(...columnMetrics.map((metric) => metric.left + metric.width));
  const centerTrackWidth = Math.max(0, columnTrackWidth - pinnedHeaderWidth);
  const pinnedColumnMetrics = columnMetrics.filter((metric) => metric.colIndex < headerColCount);
  const centerColumnMetrics = columnMetrics.filter((metric) => metric.colIndex >= headerColCount);

  const renderColumnRailCell = (metric: ColumnMetric, left: number, pinned: boolean) => {
    const colNumber = metric.colIndex + 1;
    const isActive = selectedColumnIndex === metric.colIndex;
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
      >
        <span className="column-index-left-pad" aria-hidden="true" />
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
        <button
          className="column-index-menu-trigger"
          type="button"
          aria-label={`Open column ${letters} menu`}
          onClick={(event) => {
            event.stopPropagation();
            handleColumnRailMenuOpen(metric.colIndex, event.currentTarget);
          }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M3.2 4.6 6 7.4l2.8-2.8" />
          </svg>
        </button>
      </div>
    );
  };

  const renderOverlayCell = (cell: HeaderOverlayCell) => {
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
      left: `${cell.left}px`,
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
        type="button"
        style={style}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const target = event.currentTarget;
          const rect = target.getBoundingClientRect();
          const localX = Math.min(Math.max(0, event.clientX - rect.left), Math.max(0, rect.width - 1));
          const ratio = rect.width > 0 ? localX / rect.width : 0;
          const slot = Math.min(span - 1, Math.floor(ratio * span));
          const colIndex = cell.startCol + slot;
          handleHeaderOverlaySelect(cell.rowNumber, colIndex);
        }}
      >
        <span>{cell.label}</span>
      </button>
    );
  };

  return (
    <div className={tableStageClassName} style={tableStageStyle}>
      <div className={`table-corner ${railsPhaseClass}`}>
        <button className="corner-button" type="button" tabIndex={-1} aria-label="Corner placeholder">
          <span className="corner-dot" />
        </button>
      </div>

      <div className={`column-index-strip ${railsPhaseClass}`}>
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

      <div className={`row-index-strip ${railsPhaseClass}`} aria-hidden="true">
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
                onClick={() => handleRowRailSelect(row.number, null)}
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
                <button
                  key={`row-index-${row.rowPath}`}
                  className={selectedRowNumber === row.number ? "row-index-cell is-active" : "row-index-cell"}
                  style={{
                    top: `${row.top}px`,
                    height: `${row.height}px`,
                  }}
                  type="button"
                  onClick={() => handleRowRailSelect(row.number, row.rowPath)}
                >
                  {row.number}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-shell">
        {headerOverlayHeight > 0 ? (
          <>
            <div
              className="header-matrix-overlay header-matrix-overlay--center"
              style={
                {
                  height: `${headerOverlayHeight}px`,
                  "--header-overlay-pinned-width": `${Math.max(0, pinnedHeaderWidth)}px`,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              {centerOverlayCells.map(renderOverlayCell)}
            </div>
            <div
              className="header-matrix-overlay header-matrix-overlay--pinned"
              style={{ height: `${headerOverlayHeight}px` }}
              aria-hidden="true"
            >
              {pinnedOverlayCells.map(renderOverlayCell)}
            </div>
          </>
        ) : null}
        <div className={suppressAgHeaderFocus ? "grid-wrap suppress-header-focus" : "grid-wrap"} ref={gridWrapRef}>
          <AgGridReact<GridRow>
            rowData={rowData}
            columnDefs={columnDefs}
            animateRows
            headerHeight={showGridHeader ? undefined : 0}
            groupHeaderHeight={showGridHeader ? undefined : 0}
            defaultColDef={{
              editable: false,
              sortable: false,
              filter: false,
              resizable: false,
              suppressMovable: true,
            }}
            getRowId={(params) => params.data.__rowPath}
            suppressMovableColumns
            suppressDragLeaveHidesColumns
            suppressColumnVirtualisation
            suppressContextMenu
            theme={themeQuartz}
            onGridReady={handleGridReady}
            onFirstDataRendered={handleFirstDataRendered}
            onModelUpdated={handleModelUpdated}
            onCellFocused={handleCellFocused}
            rowClassRules={{
              "section-row": (params) => Boolean(params.data?.__isSection),
            }}
          />
        </div>
      </div>
    </div>
  );
}
