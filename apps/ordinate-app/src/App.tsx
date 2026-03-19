import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type FirstDataRenderedEvent,
  type GridApi,
  type GridReadyEvent,
  type ModelUpdatedEvent,
} from "ag-grid-community";

import { type RuntimeValue } from "@ordinate/core";
import AppChrome from "./components/AppChrome";
import FormulaBarOverlay from "./components/FormulaBarOverlay";
import OverlayPortals from "./components/OverlayPortals";
import TableStage from "./components/TableStage";
import { AutoIcon, MoonIcon, SunIcon, TOOLBAR_ITEMS } from "./icons/uiIcons";
import { useEditorStore } from "./store/editorStore";
import type {
  FloatingMenuPosition,
  FormulaBarData,
  GridRow,
  RowIndexMetric,
  SelectedCell,
  TabTooltip,
  ThemeMenuPosition,
  ThemeMode,
} from "./types/ui";
import {
  compactColLabel,
  isVisiblePath,
  leafLabel,
  rowHeaderLabel,
  runtimeKindLabel,
  runtimeValueToText,
  shouldHideFirstDataColumn,
  splitPath,
} from "./utils/sheetView";

import "ag-grid-community/styles/ag-grid.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const LABEL_COLUMN_WIDTH = 280;
const DATA_COLUMN_MIN_WIDTH = 132;
const GRID_HEADER_HEIGHT = 40;
const GRID_ROW_HEIGHT = 38;
const FORMULA_BAR_SAFE_SPACE = 136;
const THEME_STORAGE_KEY = "ordinate-theme-mode";

function resolveInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialThemeMode);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [themeMenuPosition, setThemeMenuPosition] = useState<ThemeMenuPosition>({ top: 0, left: 0 });
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolMenuPosition, setToolMenuPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0 });
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const [tabTooltip, setTabTooltip] = useState<TabTooltip | null>(null);
  const [hasVerticalOverlap, setHasVerticalOverlap] = useState(false);
  const [hasHorizontalOverlap, setHasHorizontalOverlap] = useState(false);
  const [rowIndexMetrics, setRowIndexMetrics] = useState<RowIndexMetric[]>([]);
  const [rowIndexTrackHeight, setRowIndexTrackHeight] = useState(0);

  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const columnTrackRef = useRef<HTMLDivElement | null>(null);
  const rowTrackRef = useRef<HTMLDivElement | null>(null);
  const gridApiRef = useRef<GridApi<GridRow> | null>(null);
  const themeControlRef = useRef<HTMLDivElement | null>(null);
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolButtonRef = useRef<HTMLButtonElement | null>(null);

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
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!themeMenuOpen) return;

    const updatePosition = () => {
      const button = themeButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 148;
      setThemeMenuPosition({
        top: rect.bottom + 8,
        left: Math.max(12, rect.right - menuWidth),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [themeMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;

    const updatePosition = () => {
      const button = toolButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 168;
      setToolMenuPosition({
        top: rect.bottom + 8,
        left: Math.max(12, rect.right - menuWidth),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [toolMenuOpen]);

  useEffect(() => {
    const dismissTooltip = () => setTabTooltip(null);
    window.addEventListener("resize", dismissTooltip);
    window.addEventListener("scroll", dismissTooltip, true);
    return () => {
      window.removeEventListener("resize", dismissTooltip);
      window.removeEventListener("scroll", dismissTooltip, true);
    };
  }, []);

  const handleTabMouseEnter = useCallback((sheetName: string, target: HTMLButtonElement) => {
    if (target.scrollWidth <= target.clientWidth + 1) {
      setTabTooltip(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    setTabTooltip({
      text: sheetName,
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2,
    });
  }, []);

  const syncRowIndexMetrics = useCallback((api: GridApi<GridRow> | null) => {
    if (!api) {
      setRowIndexMetrics([]);
      setRowIndexTrackHeight(0);
      return;
    }

    const nextMetrics: RowIndexMetric[] = [];
    let maxBottom = 0;

    for (let index = 0; index < api.getDisplayedRowCount(); index += 1) {
      const rowNode = api.getDisplayedRowAtIndex(index);
      if (!rowNode?.data) continue;

      const top = rowNode.rowTop ?? index * GRID_ROW_HEIGHT;
      const height = rowNode.rowHeight ?? GRID_ROW_HEIGHT;
      maxBottom = Math.max(maxBottom, top + height);

      nextMetrics.push({
        rowPath: rowNode.data.__rowPath,
        number: rowNode.data.__rowNumber,
        top,
        height,
      });
    }

    setRowIndexMetrics(nextMetrics);
    setRowIndexTrackHeight(maxBottom);
  }, []);

  const handleGridReady = useCallback(
    (event: GridReadyEvent<GridRow>) => {
      gridApiRef.current = event.api;
      syncRowIndexMetrics(event.api);
    },
    [syncRowIndexMetrics],
  );

  const handleFirstDataRendered = useCallback(
    (event: FirstDataRenderedEvent<GridRow>) => {
      syncRowIndexMetrics(event.api);
    },
    [syncRowIndexMetrics],
  );

  const handleModelUpdated = useCallback(
    (event: ModelUpdatedEvent<GridRow>) => {
      syncRowIndexMetrics(event.api);
    },
    [syncRowIndexMetrics],
  );

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
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      setTabTooltip(null);
      if (!target?.closest(".theme-control") && !target?.closest(".theme-menu")) {
        setThemeMenuOpen(false);
      }
      if (!target?.closest(".tool-overflow-control") && !target?.closest(".tool-menu")) {
        setToolMenuOpen(false);
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
      if (mode === "source") return;
      if (!selectedCell) return;
      clearActiveSelection();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, selectedCell, clearActiveSelection, themeMenuOpen, toolMenuOpen]);

  useEffect(() => {
    if (mode === "source") return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!selectedCell) return;
      const interactiveRoot = target?.closest(
        ".ag-cell, .ag-header-cell, .ag-header-group-cell, .formula-bar, .source-button, .theme-control, .theme-menu, .tool-overflow-control, .tool-menu, .sheet-tab, textarea",
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
    return evaluation.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [evaluation, activeSheet]);

  const currentSheetState = useMemo(() => {
    if (!docState || !activeSheet) return null;
    return docState.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [docState, activeSheet]);

  const hiddenFirstDataColumn = useMemo(() => (currentSheet ? shouldHideFirstDataColumn(currentSheet) : false), [currentSheet]);

  const visibleDataColumns = useMemo(() => {
    if (!currentSheet) return [];
    return currentSheet.colLabels
      .map((colLabel, colIndex) => ({ colLabel, colIndex }))
      .filter(({ colIndex }) => !(hiddenFirstDataColumn && colIndex === 0));
  }, [currentSheet, hiddenFirstDataColumn]);

  const renderedColumnCount = 1 + visibleDataColumns.length;
  const gridTemplateColumns = useMemo(
    () => `${LABEL_COLUMN_WIDTH}px repeat(${visibleDataColumns.length}, minmax(${DATA_COLUMN_MIN_WIDTH}px, 1fr))`,
    [visibleDataColumns.length],
  );

  const columnDefs: ColDef<GridRow>[] = useMemo(() => {
    if (!currentSheet) return [];

    return [
      {
        field: "__label",
        headerName: rowHeaderLabel(currentSheet),
        pinned: "left",
        width: LABEL_COLUMN_WIDTH,
        suppressMovable: true,
        headerClass: "line-item-header",
        cellClass: "line-item-cell",
        cellRenderer: (params: { data?: GridRow }) => {
          const data = params.data;
          if (!data) return null;

          const showToggle = data.__hasChildren;
          const showSpacer = !showToggle && data.__depth > 0;
          const paddingLeft = Math.max(0, data.__depth - 1) * 12;
          const isCollapsed = data.__collapsed;
          const leadingSlot = showToggle ? (
            <button
              className={isCollapsed ? "tree-toggle is-collapsed" : "tree-toggle"}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleCollapse(data.__rowPath);
              }}
              aria-label={isCollapsed ? "Expand section" : "Collapse section"}
              title={isCollapsed ? "Expand" : "Collapse"}
            >
              <svg className="tree-toggle-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path d="M4 2.5 8.5 6 4 9.5Z" fill="currentColor" />
              </svg>
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
        minWidth: DATA_COLUMN_MIN_WIDTH,
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
          __rowNumber: rowIndex + 1,
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

  const rowIndexLookup = useMemo(() => {
    const map = new Map<string, number>();
    rowData.forEach((row) => map.set(row.__rowPath, row.__rowNumber));
    return map;
  }, [rowData]);

  useEffect(() => {
    if (mode === "source") return;
    syncRowIndexMetrics(gridApiRef.current);
  }, [mode, rowData, syncRowIndexMetrics]);

  const colIndexLookup = useMemo(() => {
    const map = new Map<string, number>();
    map.set("__label", 1);
    visibleDataColumns.forEach(({ colIndex }, index) => {
      map.set(`c_${colIndex}`, index + 2);
    });
    return map;
  }, [visibleDataColumns]);

  useEffect(() => {
    if (mode === "source") return;
    const root = gridWrapRef.current;
    const columnTrack = columnTrackRef.current;
    const rowTrack = rowTrackRef.current;
    if (!root || !columnTrack || !rowTrack) return;

    const verticalViewport =
      root.querySelector<HTMLElement>(".ag-body-viewport.ag-layout-normal") ??
      root.querySelector<HTMLElement>(".ag-body-viewport");
    const horizontalViewport =
      root.querySelector<HTMLElement>(".ag-body-horizontal-scroll-viewport") ??
      root.querySelector<HTMLElement>(".ag-center-cols-viewport");

    const syncScroll = () => {
      const top = verticalViewport?.scrollTop ?? 0;
      const left = horizontalViewport?.scrollLeft ?? 0;
      rowTrack.style.transform = `translateY(${-top}px)`;
      columnTrack.style.transform = `translateX(${-left}px)`;
      const nextVertical = top > 0.5;
      const nextHorizontal = left > 0.5;
      setHasVerticalOverlap((current) => (current === nextVertical ? current : nextVertical));
      setHasHorizontalOverlap((current) => (current === nextHorizontal ? current : nextHorizontal));
    };

    syncScroll();
    verticalViewport?.addEventListener("scroll", syncScroll);
    horizontalViewport?.addEventListener("scroll", syncScroll);
    window.addEventListener("resize", syncScroll);

    return () => {
      verticalViewport?.removeEventListener("scroll", syncScroll);
      horizontalViewport?.removeEventListener("scroll", syncScroll);
      window.removeEventListener("resize", syncScroll);
    };
  }, [mode, activeSheet, rowData.length, renderedColumnCount]);

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

    const rowNumber = rowIndexLookup.get(selectedCell.rowPath);
    const colNumber = colIndexLookup.get(selectedCell.colId);
    if (!rowNumber || !colNumber) return null;

    const rAbs = currentSheetState.bodyStart + rowRel;
    const rowLeaf = leafLabel(selectedCell.rowPath);

    if (selectedCell.colId === "__label") {
      const rawCell = hiddenFirstDataColumn ? currentSheetState.cells[rAbs]?.[0] : null;
      const rawText = rawCell?.text?.trim() ? rawCell.text : rowLeaf;
      return {
        primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
        secondaryAddress: `${rowHeaderLabel(currentSheet)} / ${rowLeaf}`,
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
      primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
      secondaryAddress: `${currentSheet.colLabels[colIndex]} / ${rowLeaf}`,
      chip,
      displayText: runtimeValue ? runtimeValueToText(runtimeValue) : "",
      sourceText: sourceText.length > 0 ? sourceText : "(blank)",
    };
  }, [currentSheet, currentSheetState, hiddenFirstDataColumn, selectedCell, rowIndexLookup, colIndexLookup]);

  useEffect(() => {
    if (formulaBarData) {
      setFormulaBarSnapshot(formulaBarData);
      return;
    }

    const timeout = window.setTimeout(() => setFormulaBarSnapshot(null), 180);
    return () => window.clearTimeout(timeout);
  }, [formulaBarData]);

  const rowIndexStripHeight = rowIndexTrackHeight + GRID_HEADER_HEIGHT;
  const themeButtonLabel = themeMode === "auto" ? "Automatic appearance" : themeMode === "light" ? "Light mode" : "Dark mode";
  const themeButtonIcon = themeMode === "auto" ? <AutoIcon /> : themeMode === "light" ? <SunIcon /> : <MoonIcon />;

  const visibleToolCount = viewportWidth < 720 ? 3 : viewportWidth < 860 ? 4 : viewportWidth < 1040 ? 5 : TOOLBAR_ITEMS.length;
  const visibleTools = TOOLBAR_ITEMS.slice(0, visibleToolCount);
  const overflowTools = TOOLBAR_ITEMS.slice(visibleToolCount);

  const tableStageClassName = [
    "table-stage",
    hasVerticalOverlap ? "has-scroll-y" : "",
    hasHorizontalOverlap ? "has-scroll-x" : "",
  ]
    .join(" ")
    .trim();

  const tableStageStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--formula-bar-safe-space": `${FORMULA_BAR_SAFE_SPACE}px`,
      }) as CSSProperties,
    [],
  );

  return (
    <div className="page">
      <div className={mode === "source" ? "app-window source-mode" : "app-window"}>
        <AppChrome
          mode={mode}
          activeSheet={activeSheet}
          sheetNames={evaluation?.sheets.map((sheet) => sheet.name) ?? []}
          setActiveSheet={setActiveSheet}
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
          onEnterSourceMode={enterSourceMode}
          onExitSourceMode={exitSourceMode}
          onTabMouseEnter={handleTabMouseEnter}
          onTabMouseLeave={() => setTabTooltip(null)}
        />

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
          <section className="workspace-shell">
            {currentSheet ? (
              <TableStage
                tableStageClassName={tableStageClassName}
                tableStageStyle={tableStageStyle}
                gridTemplateColumns={gridTemplateColumns}
                renderedColumnCount={renderedColumnCount}
                rowIndexStripHeight={rowIndexStripHeight}
                rowIndexTrackHeight={rowIndexTrackHeight}
                rowIndexMetrics={rowIndexMetrics}
                columnTrackRef={columnTrackRef}
                rowTrackRef={rowTrackRef}
                gridWrapRef={gridWrapRef}
                rowData={rowData}
                columnDefs={columnDefs}
                handleGridReady={handleGridReady}
                handleFirstDataRendered={handleFirstDataRendered}
                handleModelUpdated={handleModelUpdated}
                handleCellFocused={handleCellFocused}
              />
            ) : (
              <div className="empty-state">
                <h3>No sheet selected</h3>
                <p>Pick a sheet from the tab strip or return to source mode to inspect the document.</p>
              </div>
            )}
          </section>
        )}
      </div>

      <FormulaBarOverlay mode={mode} formulaBarData={formulaBarData} formulaBarSnapshot={formulaBarSnapshot} />

      <OverlayPortals
        themeMenuOpen={themeMenuOpen}
        themeMenuPosition={themeMenuPosition}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        setThemeMenuOpen={setThemeMenuOpen}
        toolMenuOpen={toolMenuOpen}
        toolMenuPosition={toolMenuPosition}
        overflowTools={overflowTools}
        tabTooltip={tabTooltip}
      />
    </div>
  );
}
