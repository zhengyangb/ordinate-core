import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridApi } from "ag-grid-community";
import { DocumentState, resolveDocumentPresentation } from "@ordinate/core";
import FormulaBarOverlay from "../components/FormulaBarOverlay";
import { HeaderMatrixCell } from "../components/HeaderMatrixCell";
import { SheetGrid } from "../components/SheetGrid";
import { createAgGridAdapter } from "../grid/agGridAdapter";
import type { UiLocale } from "../i18n/messages";
import type { CellDisplayFormatter } from "../preferences/temporalDisplay";
import type { ColumnWidthMode } from "../preferences/preferences";
import { NoteContent } from "../notes/NoteContent";
import { readNote } from "../notes/noteModel";
import { columnMetricsEqual, toColFieldId } from "../utils/appHelpers";
import { buildHeaderOverlayCells } from "../utils/headerOverlayCells";
import { buildFormulaBarData } from "../utils/formulaBarData";
import { useGridColumnDefs } from "../hooks/useGridColumnDefs";
import { useSheetViewModel } from "../hooks/useSheetViewModel";
import type { ColumnMetric, GridRow, HeaderOverlayCell } from "../types/ui";
import { appendPreviewBursts, previewAnchorKeys, previewBurstsAtCell, previewChanges, type PreviewBurst } from "./previewDiff";
import "./agentPreview.css";

type Selection = { row: number; column: number };

function SparkBurst() {
  return <span className="agent-preview-sparkles" aria-hidden="true"><span>✦</span><span>✦</span><span>✦</span><span>✦</span></span>;
}

type AgentWorkbookPreviewProps = {
  text: string;
  initialSheet: string | null;
  displayCell: CellDisplayFormatter;
  columnWidthMode: ColumnWidthMode;
  locale: UiLocale;
  onTooltipEnter: (text: string, target: HTMLElement, delayMs?: number) => void;
  onTooltipLeave: () => void;
  onTooltipSuppress: (target: HTMLElement) => void;
  onTooltipRelease: (target: HTMLElement) => void;
};

function rejectPreviewEdit(): never {
  throw new Error("The assistant working copy is read-only");
}

export function AgentWorkbookPreview({ text, initialSheet, displayCell, columnWidthMode, locale, onTooltipEnter, onTooltipLeave, onTooltipSuppress, onTooltipRelease }: AgentWorkbookPreviewProps) {
  const document = useMemo(() => DocumentState.fromText(text), [text]);
  const evaluation = useMemo(() => document.evaluate(), [document]);
  const presentation = useMemo(() => resolveDocumentPresentation(document, evaluation), [document, evaluation]);
  const previous = useRef<DocumentState | null>(null);
  const [bursts, setBursts] = useState<PreviewBurst[]>([]);
  const nextBurstId = useRef(0);
  const [selectedSheet, setSelectedSheet] = useState(initialSheet ?? document.sheets[0]?.name ?? "");
  const userSelectedSheet = useRef(false);
  const [selectedCell, setSelectedCell] = useState<Selection | null>(null);
  const [measuredColumns, setMeasuredColumns] = useState<{ key: string; columns: ColumnMetric[] } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const gridRoot = useRef<HTMLDivElement>(null);
  const gridAdapter = useMemo(() => createAgGridAdapter(), []);

  useEffect(() => {
    const old = previous.current;
    previous.current = document;
    if (!old) return;
    const nextChanges = previewChanges(old, document);
    if (nextChanges.length) {
      const firstId = nextBurstId.current;
      nextBurstId.current += nextChanges.length;
      const now = performance.now();
      setBursts(active => appendPreviewBursts(active, nextChanges, now, firstId));
    }
    if (!userSelectedSheet.current) {
      const added = document.sheets.find(sheet => !old.sheets.some(item => item.name === sheet.name));
      if (added) setSelectedSheet(added.name);
    }
  }, [document]);

  useEffect(() => {
    if (!bursts.length) return;
    const nextExpiry = Math.min(...bursts.map(burst => burst.expiresAt));
    const timer = window.setTimeout(() => {
      const now = performance.now();
      setBursts(active => active.filter(burst => burst.expiresAt > now));
    }, Math.max(0, nextExpiry - performance.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [bursts]);

  useEffect(() => {
    if (document.sheets.some(sheet => sheet.name === selectedSheet)) return;
    setSelectedSheet(document.sheets[0]?.name ?? "");
    setSelectedCell(null);
  }, [document, selectedSheet]);

  const model = useSheetViewModel({
    docState: document, evaluation, presentation, activeSheet: selectedSheet, sheetIssuesByName: {},
    displayCell, columnWidthMode,
  });
  const layoutKey = JSON.stringify([selectedSheet, model.columnLayouts.map(layout => layout.width)]);
  const columnMetrics = measuredColumns?.key === layoutKey ? measuredColumns.columns : [];
  const sheet = model.currentSheetState;
  const values = model.currentSheet;
  const shown = model.currentSheetPresentation;
  const anchors = sheet ? previewAnchorKeys(sheet) : null;
  const beforeNote = sheet ? readNote(sheet, "beforeTable") : null;
  const afterNote = sheet ? readNote(sheet, "afterTable") : null;
  const renderCellAdornment = useCallback((row: { __absoluteRowNumber: number }, column: number) =>
    anchors?.rows[row.__absoluteRowNumber - 1] === undefined ? null
      : previewBurstsAtCell(bursts, selectedSheet, anchors, row.__absoluteRowNumber - 1, column)
        .map(burst => <SparkBurst key={burst.id} />), [anchors, bursts, selectedSheet]);
  const columnDefs = useGridColumnDefs({
    currentSheet: values, currentSheetState: sheet, sheetColCount: model.sheetColCount,
    headerColCount: model.headerColCount, headerRowCount: model.headerRowCount,
    frozenColumnCount: 0, columnLayouts: model.columnLayouts,
    headerLeafLabels: model.headerLeafLabels, headerSemanticLabels: model.headerSemanticLabels,
    toggleCollapse: model.toggleCollapse, uiLocale: locale,
    showTooltip: onTooltipEnter, clearTooltip: onTooltipLeave,
    selectedColumnAxisSelection: null, axisColumnDragPreview: null,
    activateBooleanLiteralAt: rejectPreviewEdit, formulaPointPickActive: true,
    renderCellAdornment, revision: 0,
  });
  const colIndexLookup = useMemo(() => new Map(
    model.columnLayouts.map((_, index) => [toColFieldId(index), index + 1]),
  ), [model.columnLayouts]);
  const syncColumnMetrics = useCallback((api: GridApi<GridRow>) => {
    const next = gridAdapter.collectColumnMetrics(gridRoot.current, api, colIndexLookup, model.sheetColCount);
    setMeasuredColumns(current => current?.key === layoutKey && columnMetricsEqual(current.columns, next)
      ? current : { key: layoutKey, columns: next });
  }, [gridAdapter, colIndexLookup, model.sheetColCount, layoutKey]);
  const headerCells = useMemo<HeaderOverlayCell[]>(() => {
    if (columnMetrics.length !== model.sheetColCount) return [];
    return buildHeaderOverlayCells(columnMetrics, model.headerMatrix, model.headerColCount);
  }, [columnMetrics, model.sheetColCount, model.headerMatrix, model.headerColCount]);
  const tableWidth = columnMetrics.length === model.sheetColCount && columnMetrics.length > 0
    ? Math.max(...columnMetrics.map(metric => metric.left + metric.width))
    : model.columnLayouts.reduce((sum, layout) => sum + layout.width, 0);
  const formulaBarData = buildFormulaBarData({
    currentSheet: values ?? null,
    currentSheetState: sheet ?? null,
    currentSheetPresentation: shown ?? null,
    selectedCell: selectedCell && sheet ? {
      area: selectedCell.row < sheet.bodyStart ? "header" : "body",
      logical: { rAbs: selectedCell.row + 1, cAbs: selectedCell.column },
      colId: toColFieldId(selectedCell.column),
      rowPath: model.currentSheetRowStructure[selectedCell.row - sheet.bodyStart]?.rowPath ?? null,
    } : null,
    isActiveSheetBlocked: false,
    sheetColCount: sheet?.cells[0]?.length ?? 0,
    headerColCount: sheet?.headerColCount ?? 0,
    headerSemanticLabelPaths: model.headerSemanticLabelPaths,
  });

  return <section className="agent-live-preview" aria-label="Assistant working workbook" aria-readonly="true">
    <nav className="agent-preview-tabs" role="tablist" aria-label="Working copy sheets">
      {document.sheets.map(item => <button key={item.name} type="button" role="tab" aria-selected={item.name === selectedSheet}
        className={item.name === selectedSheet ? "is-active" : ""} onClick={() => {
          setSelectedSheet(item.name); setSelectedCell(null); userSelectedSheet.current = true;
          viewport.current?.scrollTo({ top: 0, left: 0 });
        }}>{item.name}</button>)}
    </nav>
    <div className="agent-preview-viewport" ref={viewport}>
      {sheet && <div className="agent-preview-document">
        {beforeNote?.note && beforeNote.markdown && <div className="agent-preview-note"><h2>{sheet.name}</h2><NoteContent note={beforeNote.note} /></div>}
        <div className="agent-preview-sheet" style={{ width: tableWidth }}>
          {model.headerRowCount > 0 && <div className="agent-preview-header" style={{ height: model.headerOverlayHeight }}>
            {headerCells.map(cell => <HeaderMatrixCell key={cell.key} cell={cell}
              style={{ left: cell.left, top: cell.top, width: cell.width, height: cell.height }}
              onClick={() => setSelectedCell({ row: cell.rowNumber - 1, column: cell.startCol })} />)}
          </div>}
          <div className="grid-wrap agent-preview-grid" ref={gridRoot} data-has-header={model.headerRowCount > 0}>
            <SheetGrid mode="preview" rowData={model.rowData} columnDefs={columnDefs}
              onColumnsChanged={syncColumnMetrics}
              onCellSelected={(rowIndex, columnId) => {
                const match = /^col_(\d+)$/.exec(columnId);
                if (!match) throw new Error(`Unexpected assistant preview column: ${columnId}`);
                const row = model.rowData[rowIndex];
                if (!row) throw new Error(`Unexpected assistant preview row: ${rowIndex}`);
                setSelectedCell({ row: row.__absoluteRowNumber - 1, column: Number(match[1]) });
              }} />
          </div>
        </div>
        {afterNote?.note && afterNote.markdown && <div className="agent-preview-note"><NoteContent note={afterNote.note} /></div>}
      </div>}
    </div>
    <FormulaBarOverlay
      locale={locale} mode="table" phase="visible" formulaBarSnapshot={formulaBarData} selectedRange={null}
      inputMode="read" isInputEditable={false} areDisplayControlsEditable={false}
      onRequestEdit={rejectPreviewEdit} onCancelEdit={rejectPreviewEdit} onCommitInput={rejectPreviewEdit}
      onDraftInputChange={rejectPreviewEdit} pointReferenceRequest={null} referenceViews={[]}
      activeReferenceTokenId={null} onActiveReferenceTokenChange={rejectPreviewEdit}
      onCancelPointPick={rejectPreviewEdit} canApplyToSelection={false} onApplyToSelection={rejectPreviewEdit}
      onSetLocalFormat={rejectPreviewEdit} onSetLocalStyle={rejectPreviewEdit}
      onDismiss={() => setSelectedCell(null)} onTooltipEnter={onTooltipEnter} onTooltipLeave={onTooltipLeave}
      onTooltipSuppress={onTooltipSuppress} onTooltipRelease={onTooltipRelease}
    />
  </section>;
}
