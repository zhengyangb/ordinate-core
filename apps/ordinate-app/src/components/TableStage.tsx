import type { CSSProperties, MutableRefObject } from "react";

import { AgGridReact } from "ag-grid-react";
import { type ColDef, type FirstDataRenderedEvent, type GridReadyEvent, type ModelUpdatedEvent, themeQuartz } from "ag-grid-community";

import type { GridRow, RowIndexMetric } from "../types/ui";

type TableStageProps = {
  tableStageClassName: string;
  tableStageStyle: CSSProperties;
  gridTemplateColumns: string;
  renderedColumnCount: number;
  rowIndexStripHeight: number;
  rowIndexTrackHeight: number;
  rowIndexMetrics: RowIndexMetric[];
  columnTrackRef: MutableRefObject<HTMLDivElement | null>;
  rowTrackRef: MutableRefObject<HTMLDivElement | null>;
  gridWrapRef: MutableRefObject<HTMLDivElement | null>;
  rowData: GridRow[];
  columnDefs: ColDef<GridRow>[];
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
  rowIndexStripHeight,
  rowIndexTrackHeight,
  rowIndexMetrics,
  columnTrackRef,
  rowTrackRef,
  gridWrapRef,
  rowData,
  columnDefs,
  handleGridReady,
  handleFirstDataRendered,
  handleModelUpdated,
  handleCellFocused,
}: TableStageProps) {
  return (
    <div className={tableStageClassName} style={tableStageStyle}>
      <div className="table-corner">
        <button className="corner-button" type="button" tabIndex={-1} aria-label="Corner placeholder">
          <span className="corner-dot" />
        </button>
      </div>

      <div className="column-index-strip">
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

      <div
        className="row-index-strip"
        aria-hidden="true"
        style={rowIndexStripHeight > 0 ? { height: `${rowIndexStripHeight}px` } : undefined}
      >
        <div className="row-index-spacer" />
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

      <div className="grid-shell">
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
