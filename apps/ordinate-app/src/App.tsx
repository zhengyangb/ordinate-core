import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef, themeQuartz } from "ag-grid-community";

import { type RuntimeValue, type SheetEvaluation } from "@ordinate/core";
import { useEditorStore } from "./store/editorStore";

import "ag-grid-community/styles/ag-grid.css";

ModuleRegistry.registerModules([AllCommunityModule]);

type GridRow = {
  __rowPath: string;
  __label: string;
  __depth: number;
  __hasChildren: boolean;
  __isSection: boolean;
  __collapsed: boolean;
  [key: string]: string | number | boolean;
};

type SelectedCell = {
  rowPath: string;
  colId: string;
};

type FormulaBarData = {
  address: string;
  chip: string;
  displayText: string;
  sourceText: string;
};

function runtimeValueToText(value: RuntimeValue): string {
  switch (value.kind) {
    case "number":
      return String(value.value ?? "");
    case "string":
      return String(value.value ?? "");
    case "boolean":
      return value.value ? "true" : "false";
    case "blank":
      return "";
    case "null":
      return "null";
    case "error":
      return "#ERROR";
    default:
      return String(value.value ?? "");
  }
}

function runtimeKindLabel(value: RuntimeValue | null | undefined): string {
  switch (value?.kind) {
    case "number":
      return "Number";
    case "string":
      return "Text";
    case "boolean":
      return "Boolean";
    case "blank":
      return "Blank";
    case "null":
      return "Null";
    case "error":
      return "Error";
    default:
      return "Value";
  }
}

function splitPath(path: string): string[] {
  return path.split(".").filter((part) => part.length > 0);
}

function leafLabel(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? path;
}

function compactColLabel(label: string): string {
  const parts = splitPath(label);
  if (parts.length <= 1) return label;
  return parts.slice(-2).join(" / ");
}

function isVisiblePath(path: string, collapsed: Set<string>): boolean {
  const parts = splitPath(path);
  let current = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = current ? `${current}.${parts[i]}` : parts[i];
    if (collapsed.has(current)) {
      return false;
    }
  }
  return true;
}

function normalizeLabel(text: string): string {
  return text.replace(/^\[|\]$/g, "").trim().toLowerCase();
}

function shouldHideFirstDataColumn(sheet: SheetEvaluation): boolean {
  if (sheet.colLabels.length === 0 || sheet.values.length === 0) {
    return false;
  }

  let comparableRows = 0;
  let matchedRows = 0;

  for (let i = 0; i < sheet.values.length; i += 1) {
    const rowPath = sheet.rowPaths[i] ?? "";
    const rawValue = runtimeValueToText(sheet.values[i]?.[0] as RuntimeValue);
    if (!rowPath || rawValue.length === 0) continue;
    comparableRows += 1;
    if (normalizeLabel(rawValue) === normalizeLabel(leafLabel(rowPath))) {
      matchedRows += 1;
    }
  }

  return comparableRows > 0 && matchedRows / comparableRows >= 0.7;
}

function rowHeaderLabel(sheet: SheetEvaluation): string {
  if (sheet.colLabels.length === 0) {
    return "Line Item";
  }
  return shouldHideFirstDataColumn(sheet) ? sheet.colLabels[0] ?? "Line Item" : "Line Item";
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M7.25 5.75 3.5 9.5l3.75 3.75M12.75 5.75 16.5 9.5l-3.75 3.75M11.1 4.5 8.9 14.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M3.75 4.5h12.5v11h-12.5zM3.75 8.25h12.5M8 4.5v11M12 4.5v11"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function App() {
  const {
    mode,
    sourceText,
    docState,
    evaluation,
    activeSheet,
    error,
    setSourceText,
    setActiveSheet,
    enterSourceMode,
    exitSourceMode,
  } = useEditorStore();

  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [formulaBarSnapshot, setFormulaBarSnapshot] = useState<FormulaBarData | null>(null);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);

  const clearActiveSelection = useCallback(() => {
    setSelectedCell(null);
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
  }, [activeSheet, mode]);

  useEffect(() => {
    const root = gridWrapRef.current;
    if (!root || mode === "source") return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const headerCell = target?.closest<HTMLElement>(".ag-header-cell, .ag-header-group-cell");
      if (!headerCell) return;
      setSelectedCell(null);
      headerCell.tabIndex = 0;
      requestAnimationFrame(() => headerCell.focus());
    };

    root.addEventListener("mousedown", handlePointerDown);
    return () => root.removeEventListener("mousedown", handlePointerDown);
  }, [mode, activeSheet]);

  useEffect(() => {
    if (mode === "source") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!selectedCell) return;
      clearActiveSelection();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, selectedCell, clearActiveSelection]);

  useEffect(() => {
    if (mode === "source") return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!selectedCell) return;
      const target = event.target as HTMLElement | null;
      const interactiveRoot = target?.closest(
        ".ag-cell, .ag-header-cell, .ag-header-group-cell, .formula-bar, .mode-button, .tab, textarea",
      );
      if (interactiveRoot) return;
      clearActiveSelection();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [mode, selectedCell, clearActiveSelection]);

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

  const currentSheet = useMemo(() => {
    if (!evaluation || !activeSheet) return null;
    return evaluation.sheets.find((s) => s.name === activeSheet) ?? null;
  }, [evaluation, activeSheet]);

  const currentSheetState = useMemo(() => {
    if (!docState || !activeSheet) return null;
    return docState.sheets.find((s) => s.name === activeSheet) ?? null;
  }, [docState, activeSheet]);

  const hiddenFirstDataColumn = useMemo(
    () => (currentSheet ? shouldHideFirstDataColumn(currentSheet) : false),
    [currentSheet],
  );

  const visibleDataColumns = useMemo(() => {
    if (!currentSheet) return [];
    return currentSheet.colLabels
      .map((colLabel, colIndex) => ({ colLabel, colIndex }))
      .filter(({ colIndex }) => !(hiddenFirstDataColumn && colIndex === 0));
  }, [currentSheet, hiddenFirstDataColumn]);

  const columnDefs: ColDef<GridRow>[] = useMemo(() => {
    if (!currentSheet) return [];

    return [
      {
        field: "__label",
        headerName: rowHeaderLabel(currentSheet),
        pinned: "left",
        width: 300,
        suppressMovable: true,
        headerClass: "line-item-header",
        cellClass: "line-item-cell",
        cellRenderer: (params: { data?: GridRow }) => {
          const data = params.data;
          if (!data) return null;

          const showToggle = data.__hasChildren;
          const showSpacer = !showToggle && data.__depth > 0;
          const paddingLeft = Math.max(0, data.__depth - 1) * 14;
          const isCollapsed = data.__collapsed;
          const leadingSlot = showToggle ? (
            <button
              className="tree-toggle"
              onClick={(event) => {
                event.stopPropagation();
                toggleCollapse(data.__rowPath);
              }}
              aria-label={isCollapsed ? "Expand section" : "Collapse section"}
              title={isCollapsed ? "Expand" : "Collapse"}
            >
              {isCollapsed ? ">" : "v"}
            </button>
          ) : showSpacer ? (
            <span className="tree-spacer" />
          ) : (
            <span className="tree-inline-pad" aria-hidden="true" />
          );

          return (
            <div className="tree-cell" style={{ paddingLeft }}>
              {leadingSlot}
              <span className={data.__hasChildren ? "tree-label section" : "tree-label"}>{data.__label}</span>
            </div>
          );
        },
      },
      ...visibleDataColumns.map(({ colLabel, colIndex }) => ({
        field: `c_${colIndex}`,
        headerName: compactColLabel(colLabel),
        headerTooltip: colLabel,
        minWidth: 120,
        flex: 1,
        suppressMovable: true,
        cellClass: (params: { data?: GridRow }) => {
          const kind = params.data?.[`__kind_${colIndex}`];
          const classes = ["data-cell"];
          if (kind === "number") classes.push("is-numeric");
          if (kind === "error") classes.push("is-error");
          if (kind === "blank") classes.push("is-blank");
          return classes.join(" ");
        },
      })),
    ];
  }, [currentSheet, toggleCollapse, visibleDataColumns]);

  const rowData: GridRow[] = useMemo(() => {
    if (!currentSheet) return [];

    return currentSheet.values
      .map((row, rowIndex) => {
        const rowPath = currentSheet.rowPaths[rowIndex] ?? `R${rowIndex + 1}`;
        const depth = Math.max(0, splitPath(rowPath).length - 1);
        const hasChildren = currentSheet.rowPaths.some(
          (candidate) => candidate !== rowPath && candidate.startsWith(`${rowPath}.`),
        );

        const item: GridRow = {
          __rowPath: rowPath,
          __label: leafLabel(rowPath),
          __depth: depth,
          __hasChildren: hasChildren,
          __isSection: hasChildren,
          __collapsed: collapsedPaths.has(rowPath),
        };

        visibleDataColumns.forEach(({ colIndex }) => {
          const value = row[colIndex] as RuntimeValue;
          item[`c_${colIndex}`] = runtimeValueToText(value);
          item[`__kind_${colIndex}`] = value.kind;
        });

        return item;
      })
      .filter((row) => isVisiblePath(row.__rowPath, collapsedPaths));
  }, [currentSheet, collapsedPaths, visibleDataColumns]);

  const handleCellFocused = useCallback(
    (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => {
      if (event.rowIndex == null || !event.column) {
        setSelectedCell(null);
        return;
      }

      const row = rowData[event.rowIndex];
      if (!row) {
        setSelectedCell(null);
        return;
      }

      const colId = typeof event.column === "string" ? event.column : event.column.getColId();
      setSelectedCell({
        rowPath: row.__rowPath,
        colId,
      });
    },
    [rowData],
  );

  const formulaBarData = useMemo<FormulaBarData | null>(() => {
    if (!currentSheet || !currentSheetState || !selectedCell) return null;

    const rowRel = currentSheet.rowPaths.indexOf(selectedCell.rowPath);
    if (rowRel < 0) return null;

    const rAbs = currentSheetState.bodyStart + rowRel;
    const rowLeaf = leafLabel(selectedCell.rowPath);

    if (selectedCell.colId === "__label") {
      const rawCell = hiddenFirstDataColumn ? currentSheetState.cells[rAbs]?.[0] : null;
      const rawText = rawCell?.text?.trim() ? rawCell.text : rowLeaf;
      return {
        address: `${rowHeaderLabel(currentSheet)} · ${rowLeaf}`,
        chip: "Label",
        displayText: rowLeaf,
        sourceText: rawText,
      };
    }

    if (!selectedCell.colId.startsWith("c_")) return null;

    const colIndex = Number(selectedCell.colId.slice(2));
    if (!Number.isFinite(colIndex) || colIndex < 0 || colIndex >= currentSheet.colLabels.length) {
      return null;
    }

    const runtimeValue = currentSheet.values[rowRel]?.[colIndex] as RuntimeValue | undefined;
    const rawCell = currentSheetState.cells[rAbs]?.[colIndex];
    const sourceText = rawCell?.text ?? runtimeValueToText(runtimeValue ?? { kind: "blank", value: null });
    const chip = rawCell?.parsed.kind === "formula" ? "Formula" : runtimeKindLabel(runtimeValue);

    return {
      address: `${currentSheet.colLabels[colIndex]} · ${rowLeaf}`,
      chip,
      displayText: runtimeValue ? runtimeValueToText(runtimeValue) : "",
      sourceText: sourceText.length > 0 ? sourceText : "(blank)",
    };
  }, [currentSheet, currentSheetState, hiddenFirstDataColumn, selectedCell]);

  useEffect(() => {
    if (formulaBarData) {
      setFormulaBarSnapshot(formulaBarData);
      return;
    }

    const timeout = window.setTimeout(() => setFormulaBarSnapshot(null), 180);
    return () => window.clearTimeout(timeout);
  }, [formulaBarData]);

  return (
    <div className="page">
      <header className="toolbar">
        <div className="toolbar-main">
          <div className="brand">
            <h1>Ordinate</h1>
          </div>

          <div className="sheet-tabs toolbar-tabs">
            {evaluation?.sheets.map((sheet) => (
              <button
                key={sheet.name}
                className={sheet.name === activeSheet ? "tab active" : "tab"}
                onClick={() => setActiveSheet(sheet.name)}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        </div>

        <div className="actions">
          <button
            className={mode === "source" ? "mode-button active" : "mode-button"}
            onClick={mode === "source" ? exitSourceMode : enterSourceMode}
          >
            <span className="mode-button-icon">{mode === "source" ? <TableIcon /> : <CodeIcon />}</span>
            <span>{mode === "source" ? "Table View" : "Source Code"}</span>
          </button>
        </div>
      </header>

      {error ? (
        <div className="error" role="alert">
          <strong>Source has parse or evaluation issues.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {mode === "source" ? (
        <section className="source-panel">
          <textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)} spellCheck={false} />
        </section>
      ) : (
        <section className="render-panel">
          <div className="grid-wrap" ref={gridWrapRef}>
            {currentSheet ? (
              <AgGridReact<GridRow>
                rowData={rowData}
                columnDefs={columnDefs}
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
                onCellFocused={handleCellFocused}
                rowClassRules={{
                  "section-row": (params) => Boolean(params.data?.__isSection),
                }}
              />
            ) : (
              <div className="empty-state">
                <h3>No sheet selected</h3>
                <p>Pick a sheet from the tab strip or return to source mode to inspect the document.</p>
              </div>
            )}
          </div>
          {formulaBarSnapshot ? (
            <aside
              className={formulaBarData ? "formula-bar-shell is-visible" : "formula-bar-shell is-hiding"}
              aria-live="polite"
              aria-hidden={formulaBarData ? undefined : true}
            >
              <div className="formula-bar">
                <div className="formula-bar-meta">
                  <span className="formula-chip fx">fx</span>
                  <span className="formula-address">{formulaBarSnapshot.address}</span>
                  <span className="formula-chip">{formulaBarSnapshot.chip}</span>
                  <span className="formula-value-preview">{formulaBarSnapshot.displayText || " "}</span>
                </div>
                <div className="formula-source" title={formulaBarSnapshot.sourceText}>
                  {formulaBarSnapshot.sourceText}
                </div>
              </div>
            </aside>
          ) : null}
        </section>
      )}
    </div>
  );
}
