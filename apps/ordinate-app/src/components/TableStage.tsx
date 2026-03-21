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

import type { ChromeVisibilityPhase, GridRow, HeaderIndexMetric, HeaderOverlayCell, RowIndexMetric } from "../types/ui";

type TableStageProps = {
  tableStageClassName: string;
  tableStageStyle: CSSProperties;
  gridTemplateColumns: string;
  renderedColumnCount: number;
  headerIndexMetrics: HeaderIndexMetric[];
  headerIndexTrackHeight: number;
  headerOverlayHeight: number;
  headerOverlayCells: HeaderOverlayCell[];
  rowIndexTrackHeight: number;
  indexRailsPhase: ChromeVisibilityPhase;
  rowIndexMetrics: RowIndexMetric[];
  columnTrackRef: MutableRefObject<HTMLDivElement | null>;
  rowTrackRef: MutableRefObject<HTMLDivElement | null>;
  gridWrapRef: MutableRefObject<HTMLDivElement | null>;
  rowData: GridRow[];
  columnDefs: Array<ColDef<GridRow> | ColGroupDef<GridRow>>;
  handleHeaderOverlaySelect: (clientX: number, rowNumber: number) => void;
  handleGridReady: (event: GridReadyEvent<GridRow>) => void;
  handleFirstDataRendered: (event: FirstDataRenderedEvent<GridRow>) => void;
  handleModelUpdated: (event: ModelUpdatedEvent<GridRow>) => void;
  handleCellFocused: (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => void;
};

export default function TableStage({
  tableStageClassName,
  tableStageStyle,
  gridTemplateColumns,
  renderedColumnCount,
  headerIndexMetrics,
  headerIndexTrackHeight,
  headerOverlayHeight,
  headerOverlayCells,
  rowIndexTrackHeight,
  indexRailsPhase,
  rowIndexMetrics,
  columnTrackRef,
  rowTrackRef,
  gridWrapRef,
  rowData,
  columnDefs,
  handleHeaderOverlaySelect,
  handleGridReady,
  handleFirstDataRendered,
  handleModelUpdated,
  handleCellFocused,
}: TableStageProps) {
  const railsPhaseClass = `index-rail index-rail--${indexRailsPhase}`;

  return (
    <div className={tableStageClassName} style={tableStageStyle}>
      <div className={`table-corner ${railsPhaseClass}`}>
        <button className="corner-button" type="button" tabIndex={-1} aria-label="Corner placeholder">
          <span className="corner-dot" />
        </button>
      </div>

      <div className={`column-index-strip ${railsPhaseClass}`}>
        <div
          ref={columnTrackRef}
          className="column-index-track"
          style={{ gridTemplateColumns }}
          aria-hidden="true"
        >
          {Array.from({ length: renderedColumnCount }, (_, index) => (
            <div key={`column-index-${index + 1}`} className="column-index-cell">
              {index + 1}
            </div>
          ))}
        </div>
      </div>

      <div className={`row-index-strip ${railsPhaseClass}`} aria-hidden="true">
        <div className="row-index-shell">
          <div
            className={headerIndexMetrics.length > 0 ? "row-index-header-track" : "row-index-header-track is-empty"}
            style={headerIndexTrackHeight > 0 ? { height: `${headerIndexTrackHeight}px` } : undefined}
          >
            {headerIndexMetrics.map((row) => (
              <div
                key={`row-index-header-${row.number}`}
                className="row-index-cell is-header"
                style={{
                  top: `${row.top}px`,
                  height: `${row.height}px`,
                }}
              >
                {row.number}
              </div>
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
                  key={`row-index-${row.rowPath}`}
                  className="row-index-cell"
                  style={{
                    top: `${row.top}px`,
                    height: `${row.height}px`,
                  }}
                >
                  {row.number}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-shell">
        {headerOverlayHeight > 0 ? (
          <div
            className="header-matrix-overlay"
            style={{ height: `${headerOverlayHeight}px` }}
            aria-hidden="true"
          >
            {headerOverlayCells.map((cell) => (
              <button
                key={cell.key}
                className="header-matrix-cell"
                type="button"
                style={{
                  left: `${cell.left}px`,
                  top: `${cell.top}px`,
                  width: `${cell.width}px`,
                  height: `${cell.height}px`,
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleHeaderOverlaySelect(event.clientX, cell.rowNumber);
                }}
                title={cell.label}
              >
                <span>{cell.label}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid-wrap" ref={gridWrapRef}>
          <AgGridReact<GridRow>
            rowData={rowData}
            columnDefs={columnDefs}
            animateRows
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
