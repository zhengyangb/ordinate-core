import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule, ModuleRegistry, themeQuartz,
  type ColDef, type ColGroupDef, type CellDoubleClickedEvent, type CellMouseDownEvent,
  type FirstDataRenderedEvent, type GridApi, type GridReadyEvent, type GridSizeChangedEvent,
  type ModelUpdatedEvent, type TabToNextCellParams, type CellPosition,
} from "ag-grid-community";
import { useCallback, useMemo } from "react";
import type { GridRow } from "../types/ui";

ModuleRegistry.registerModules([AllCommunityModule]);

type BaseProps = {
  rowData: GridRow[];
  columnDefs: Array<ColDef<GridRow> | ColGroupDef<GridRow>>;
};

type EditorProps = BaseProps & {
  mode: "editor";
  animateRows: boolean;
  onGridReady: (event: GridReadyEvent<GridRow>) => void;
  onFirstDataRendered: (event: FirstDataRenderedEvent<GridRow>) => void;
  onModelUpdated: (event: ModelUpdatedEvent<GridRow>) => void;
  onGridSizeChanged: (event: GridSizeChangedEvent<GridRow>) => void;
  onCellFocused: (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => void;
  onCellMouseDown: (event: CellMouseDownEvent<GridRow>) => void;
  onCellDoubleClicked: (event: CellDoubleClickedEvent<GridRow>) => void;
  onCellKeyDown: (event: { rowIndex: number | null; column?: string | { getColId(): string } | null; event?: Event | null }) => void;
  tabToNextCell: (params: TabToNextCellParams<GridRow>) => boolean | CellPosition;
};

type PreviewProps = BaseProps & {
  mode: "preview";
  onCellSelected: (rowIndex: number, columnId: string) => void;
  onColumnsChanged: (api: GridApi<GridRow>) => void;
};

const keepConfiguredPinning = () => [];

/** Shared sheet cell renderer; only the surrounding editor chrome is interactive. */
export function SheetGrid(props: EditorProps | PreviewProps) {
  const defaultColDef = useMemo<ColDef<GridRow>>(() => ({
    editable: false, sortable: false, filter: false, resizable: false, suppressMovable: true,
    minWidth: 1,
  }), []);
  const getRowId = useCallback((params: { data: GridRow }) => params.data.__rowKey, []);
  const rowClassRules = useMemo(() => ({
    "group-row": (params: { data?: GridRow }) => Boolean(params.data?.__hasChildren),
  }), []);

  return <AgGridReact<GridRow>
    rowData={props.rowData}
    columnDefs={props.columnDefs}
    animateRows={props.mode === "editor" && props.animateRows}
    headerHeight={0}
    groupHeaderHeight={0}
    defaultColDef={defaultColDef}
    getRowId={getRowId}
    suppressScrollOnNewData
    suppressMovableColumns
    suppressDragLeaveHidesColumns
    suppressColumnVirtualisation
    processUnpinnedColumns={keepConfiguredPinning}
    suppressContextMenu
    theme={themeQuartz}
    domLayout={props.mode === "preview" ? "autoHeight" : "normal"}
    onGridReady={props.mode === "editor" ? props.onGridReady : event => props.onColumnsChanged(event.api)}
    onFirstDataRendered={props.mode === "editor" ? props.onFirstDataRendered : event => props.onColumnsChanged(event.api)}
    onModelUpdated={props.mode === "editor" ? props.onModelUpdated : event => props.onColumnsChanged(event.api)}
    onGridSizeChanged={props.mode === "editor" ? props.onGridSizeChanged : event => props.onColumnsChanged(event.api)}
    onDisplayedColumnsChanged={props.mode === "preview" ? event => props.onColumnsChanged(event.api) : undefined}
    onColumnResized={props.mode === "preview" ? event => props.onColumnsChanged(event.api) : undefined}
    onCellFocused={props.mode === "editor" ? props.onCellFocused : undefined}
    onCellMouseDown={props.mode === "editor" ? props.onCellMouseDown : undefined}
    onCellDoubleClicked={props.mode === "editor" ? props.onCellDoubleClicked : undefined}
    onCellKeyDown={props.mode === "editor" ? props.onCellKeyDown : undefined}
    tabToNextCell={props.mode === "editor" ? props.tabToNextCell : undefined}
    onCellClicked={props.mode === "preview" ? event => {
      if (event.rowIndex !== null) props.onCellSelected(event.rowIndex, event.column.getColId());
    } : undefined}
    rowClassRules={rowClassRules}
  />;
}
