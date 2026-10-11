import { useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { SearchButton, SheetSearchContext } from "../search/SheetSearch";
import { ApplicationMenu, type ApplicationMenuGroup } from "./ApplicationMenu";
import { InfoDialog } from "./InfoDialog";
import { MacDownloadButton } from "./MacDownloadButton";
import type { OnlineChrome } from "../platform/experience";
import { ChoiceMenu } from "./ChoiceMenu";
import { FORMATS, type ExportFormat } from "../interchange/contracts";

import { ChevronLeftIcon, ChevronRightIcon, CodeIcon, ExportIcon, NewDocumentIcon, OpenIcon, SheetSetupIcon, SettingsIcon, SparklesIcon, PlusIcon, RedoIcon, SaveAsIcon, SaveIcon, UndoIcon } from "../icons/uiIcons";
import { MenuDivider, MenuGroup, MenuHead, MenuOption, MenuSurface, MenuTitle } from "./MenuSurface";
import type { SheetHealth } from "../types/ui";
import {
  computeSheetDropIndicator,
  computeSheetMoveTargetGapIndex,
  computeSheetTabScrollState,
  computeSheetTabAutoScrollDelta,
  SHEET_DRAG_START_THRESHOLD_PX,
  type SheetTabRect,
  type SheetTabScrollState,
} from "../utils/sheetTabs";

export type FileStatusTone = "neutral" | "dirty" | "saving" | "warning" | "error";

type AppChromeProps = {
  online?: OnlineChrome;
  onImportFile?: () => void;
  titlePlacement?: "toolbar" | "native";
  mode: "table" | "source";
  agentOpen: boolean;
  agentPreviewActive: boolean;
  agentDebugMode?: boolean;
  onToggleAgent: () => void;
  fileName: string;
  fileStatus: string;
  fileStatusTone: FileStatusTone;
  activeSheet: string | null;
  sheetNames: string[];
  sheetHealthByName: Record<string, SheetHealth>;
  setActiveSheet: (name: string) => void;
  onInsertSheet: () => void;
  onDeleteSheet: (sheetName: string) => Promise<void> | void;
  onMoveSheet: (sheetName: string, targetGapIndex: number) => void;
  onRenameSheet: (sheetName: string, nextName: string) => string | null;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  sheetSetupOpen: boolean;
  sheetSetupButtonRef: RefObject<HTMLButtonElement>;
  onToggleSheetSetup: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onOpenFile: () => void;
  onPrintFile: () => void;
  onExportFile: () => void;
  exportMenuOpen: boolean;
  onExportMenuOpenChange: (open: boolean) => void;
  onExportFormat: (format: ExportFormat) => void;
  onNewFile: () => void;
  onSaveFile: () => void;
  onSaveFileAs: () => void;
  onEnterSourceMode: () => void;
  onExitSourceMode: () => void;
  onTooltipEnter: (text: string, target: HTMLElement, delayMs?: number) => void;
  onTooltipLeave: () => void;
  onTooltipSuppress: (target: HTMLElement) => void;
  onTooltipRelease: (target: HTMLElement) => void;
  onTabMouseEnter: (sheetName: string, target: HTMLButtonElement) => void;
  onTabMouseLeave: () => void;
};

type SheetMenuState = {
  sheetName: string;
  top: number;
  left: number;
};

type SheetRenameErrorState = {
  sheetName: string;
  message: string;
  top: number;
  left: number;
};

type SheetDragSession = {
  pointerId: number;
  sheetName: string;
  sourceIndex: number;
  startX: number;
  active: boolean;
};

type SheetDragView = {
  sheetName: string;
  targetGapIndex: number;
  indicatorLeft: number;
};

function SheetRenameGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m5.2 13.7 1 1 6.8-6.8-1-1-6.8 6.8Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.25" />
      <path d="m11.2 6.2 1.5-1.5 1 1-1.5 1.5M4.8 16.1h9.9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" />
    </svg>
  );
}

function SheetMoveLeftGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M8.4 6.2 4.6 10l3.8 3.8M5.1 10h10.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.45" />
    </svg>
  );
}

function SheetMoveRightGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m11.6 6.2 3.8 3.8-3.8 3.8M4.6 10h10.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.45" />
    </svg>
  );
}

function SheetDeleteGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.3 5.2h9.4M7.6 5.2l.4-1h4l.4 1M7 7.1v6.4M10 7.1v6.4M13 7.1v6.4M6.2 5.2l.4 10h6.8l.4-10" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" />
    </svg>
  );
}

function clampMenuPosition(target: DOMRect): { top: number; left: number } {
  return {
    top: Math.min(target.bottom + 8, window.innerHeight - 48),
    left: Math.min(Math.max(12, target.left), window.innerWidth - 220),
  };
}

function positionSheetRenameError(target: DOMRect): { top: number; left: number } {
  const width = 260;
  return {
    top: Math.min(target.bottom + 7, window.innerHeight - 48),
    left: Math.min(Math.max(12, target.left + target.width / 2 - width / 2), window.innerWidth - width - 12),
  };
}

export default function AppChrome({
  online,
  onImportFile,
  titlePlacement = "toolbar",
  mode,
  agentOpen,
  agentPreviewActive,
  agentDebugMode = false,
  onToggleAgent,
  fileName,
  fileStatus,
  fileStatusTone,
  activeSheet,
  sheetNames,
  sheetHealthByName,
  setActiveSheet,
  onInsertSheet,
  onDeleteSheet,
  onMoveSheet,
  onRenameSheet,
  settingsOpen,
  onOpenSettings,
  sheetSetupOpen,
  sheetSetupButtonRef,
  onToggleSheetSetup,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  onOpenFile,
  onPrintFile,
  onExportFile,
  exportMenuOpen,
  onExportMenuOpenChange,
  onExportFormat,
  onNewFile,
  onSaveFile,
  onSaveFileAs,
  onEnterSourceMode,
  onExitSourceMode,
  onTooltipEnter,
  onTooltipLeave,
  onTooltipSuppress,
  onTooltipRelease,
  onTabMouseEnter,
  onTabMouseLeave,
}: AppChromeProps) {
  const search = useContext(SheetSearchContext);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [renamingSheet, setRenamingSheet] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<SheetRenameErrorState | null>(null);
  const [sheetMenu, setSheetMenu] = useState<SheetMenuState | null>(null);
  const [sheetDragView, setSheetDragView] = useState<SheetDragView | null>(null);
  const [sheetTabScrollState, setSheetTabScrollState] = useState<SheetTabScrollState>({
    canScrollLeft: false,
    canScrollRight: false,
  });
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const sheetTabsViewportRef = useRef<HTMLDivElement | null>(null);
  const sheetMenuRef = useRef<HTMLDivElement | null>(null);
  const sheetTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const sheetDragSessionRef = useRef<SheetDragSession | null>(null);
  const sheetDragViewRef = useRef<SheetDragView | null>(null);
  const suppressClickSheetRef = useRef<string | null>(null);
  const latestSheetDragXRef = useRef<number | null>(null);
  const sheetDragAutoScrollRafRef = useRef<number | null>(null);

  const refreshSheetTabScrollState = useCallback(() => {
    const viewport = sheetTabsViewportRef.current;
    if (!viewport) {
      setSheetTabScrollState({ canScrollLeft: false, canScrollRight: false });
      return;
    }
    const nextState = computeSheetTabScrollState({
      scrollLeft: viewport.scrollLeft,
      clientWidth: viewport.clientWidth,
      scrollWidth: viewport.scrollWidth,
    });
    setSheetTabScrollState((current) =>
      current.canScrollLeft === nextState.canScrollLeft && current.canScrollRight === nextState.canScrollRight
        ? current
        : nextState,
    );
  }, []);

  useEffect(() => {
    if (!renamingSheet) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
    window.requestAnimationFrame(() => {
      input.select();
    });
  }, [renamingSheet]);

  useEffect(() => {
    if (mode === "source" && renamingSheet) {
      setRenamingSheet(null);
      setRenameValue("");
      setRenameError(null);
    }
  }, [mode, renamingSheet]);

  useEffect(() => {
    const activeTab = activeSheet ? sheetTabRefs.current.get(activeSheet) : null;
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    window.requestAnimationFrame(refreshSheetTabScrollState);
  }, [activeSheet, sheetNames, refreshSheetTabScrollState]);

  useEffect(() => {
    const viewport = sheetTabsViewportRef.current;
    if (!viewport) return undefined;
    refreshSheetTabScrollState();
    const handleScroll = () => refreshSheetTabScrollState();
    const handleWheel = (event: WheelEvent) => {
      // Preserve browser zoom gestures and native scrolling when all tabs fit.
      if (event.ctrlKey || event.metaKey || viewport.scrollWidth <= viewport.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientWidth : 1;
      event.preventDefault();
      viewport.scrollLeft += delta * unit;
    };
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    const observer = new ResizeObserver(() => refreshSheetTabScrollState());
    observer.observe(viewport);
    const tabs = viewport.firstElementChild;
    if (tabs) observer.observe(tabs);
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
      viewport.removeEventListener("wheel", handleWheel);
      observer.disconnect();
    };
  }, [refreshSheetTabScrollState, sheetNames]);

  const scrollSheetTabs = useCallback((direction: "left" | "right") => {
    const viewport = sheetTabsViewportRef.current;
    if (!viewport) throw new Error("sheet tab scroll requires a sheet tab viewport");
    const distance = Math.max(120, Math.floor(viewport.clientWidth * 0.72));
    viewport.scrollBy({
      left: direction === "left" ? -distance : distance,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    if (!sheetMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && sheetMenuRef.current?.contains(target)) return;
      setSheetMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSheetMenu(null);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [sheetMenu]);

  const stopSheetDragAutoScroll = useCallback(() => {
    if (sheetDragAutoScrollRafRef.current === null) return;
    window.cancelAnimationFrame(sheetDragAutoScrollRafRef.current);
    sheetDragAutoScrollRafRef.current = null;
  }, []);

  const collectSheetTabRects = useCallback((): SheetTabRect[] => {
    return sheetNames.map((sheetName) => {
      const tab = sheetTabRefs.current.get(sheetName);
      if (!tab) throw new Error(`missing sheet tab ref for '${sheetName}'`);
      const rect = tab.getBoundingClientRect();
      return { sheetName, left: rect.left, right: rect.right };
    });
  }, [sheetNames]);

  const updateSheetDragView = useCallback((pointerX: number, session: SheetDragSession) => {
    const viewport = sheetTabsViewportRef.current;
    if (!viewport) throw new Error("sheet drag requires a sheet tab viewport");
    const indicator = computeSheetDropIndicator(pointerX, session.sourceIndex, collectSheetTabRects());
    const viewportRect = viewport.getBoundingClientRect();
    const nextView = {
      sheetName: session.sheetName,
      targetGapIndex: indicator.targetGapIndex,
      indicatorLeft: indicator.left - viewportRect.left,
    };
    sheetDragViewRef.current = nextView;
    setSheetDragView(nextView);
  }, [collectSheetTabRects]);

  const runSheetDragAutoScroll = useCallback(() => {
    sheetDragAutoScrollRafRef.current = null;
    const session = sheetDragSessionRef.current;
    const pointerX = latestSheetDragXRef.current;
    const viewport = sheetTabsViewportRef.current;
    if (!session?.active || pointerX === null || !viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const delta = computeSheetTabAutoScrollDelta({
      pointerX,
      viewportLeft: viewportRect.left,
      viewportRight: viewportRect.right,
      scrollLeft: viewport.scrollLeft,
      maxScrollLeft,
    });
    if (delta !== 0) {
      viewport.scrollLeft += delta;
      updateSheetDragView(pointerX, session);
    }
    sheetDragAutoScrollRafRef.current = window.requestAnimationFrame(runSheetDragAutoScroll);
  }, [updateSheetDragView]);

  const startSheetDragAutoScroll = useCallback(() => {
    if (sheetDragAutoScrollRafRef.current !== null) return;
    sheetDragAutoScrollRafRef.current = window.requestAnimationFrame(runSheetDragAutoScroll);
  }, [runSheetDragAutoScroll]);

  const cancelSheetDrag = useCallback(() => {
    sheetDragSessionRef.current = null;
    sheetDragViewRef.current = null;
    latestSheetDragXRef.current = null;
    setSheetDragView(null);
    stopSheetDragAutoScroll();
  }, [stopSheetDragAutoScroll]);

  useEffect(() => {
    if (mode === "source") {
      cancelSheetDrag();
      setSheetMenu(null);
    }
  }, [mode, cancelSheetDrag]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && sheetDragSessionRef.current) {
        event.preventDefault();
        cancelSheetDrag();
      }
    };
    const handleBlur = () => cancelSheetDrag();
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, [cancelSheetDrag]);

  const startRename = (sheetName: string) => {
    if (mode !== "table") return;
    setSheetMenu(null);
    setRenameError(null);
    setActiveSheet(sheetName);
    setRenamingSheet(sheetName);
    setRenameValue(sheetName);
  };

  const cancelRename = () => {
    setRenamingSheet(null);
    setRenameValue("");
    setRenameError(null);
  };

  const commitRename = () => {
    if (!renamingSheet) return;
    const nextName = renameValue.trim();
    if (nextName === renamingSheet) {
      cancelRename();
      return;
    }
    const error = onRenameSheet(renamingSheet, nextName);
    if (error) {
      const tab = sheetTabRefs.current.get(renamingSheet);
      if (!tab) throw new Error(`missing sheet tab ref for '${renamingSheet}'`);
      setRenameError({
        sheetName: renamingSheet,
        message: error,
        ...positionSheetRenameError(tab.getBoundingClientRect()),
      });
      window.requestAnimationFrame(() => {
        renameInputRef.current?.focus();
      });
      return;
    }
    cancelRename();
  };

  const tabClassName = (sheetName: string): string => {
    const health = sheetHealthByName[sheetName] ?? "ok";
    const classes = ["sheet-tab"];
    if (sheetName === activeSheet) classes.push("active");
    if (sheetName === renamingSheet) classes.push("renaming");
    if (sheetDragView?.sheetName === sheetName) classes.push("dragging");
    if (health === "invalid") classes.push("invalid");
    return classes.join(" ");
  };

  const openSheetMenu = (sheetName: string, target: HTMLElement) => {
    if (mode !== "table") return;
    setActiveSheet(sheetName);
    setSheetMenu({ sheetName, ...clampMenuPosition(target.getBoundingClientRect()) });
  };

  const moveSheetLeft = (sheetName: string) => {
    const sourceIndex = sheetNames.indexOf(sheetName);
    if (sourceIndex <= 0) return;
    onMoveSheet(sheetName, computeSheetMoveTargetGapIndex(sourceIndex, sourceIndex - 1));
    setSheetMenu(null);
  };

  const moveSheetRight = (sheetName: string) => {
    const sourceIndex = sheetNames.indexOf(sheetName);
    if (sourceIndex < 0 || sourceIndex >= sheetNames.length - 1) return;
    onMoveSheet(sheetName, computeSheetMoveTargetGapIndex(sourceIndex, sourceIndex + 2));
    setSheetMenu(null);
  };

  const handleSheetPointerDown = (sheetName: string, sheetIndex: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (mode !== "table" || event.button !== 0 || sheetName === renamingSheet) return;
    sheetDragSessionRef.current = {
      pointerId: event.pointerId,
      sheetName,
      sourceIndex: sheetIndex,
      startX: event.clientX,
      active: false,
    };
    latestSheetDragXRef.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSheetPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sheetDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    latestSheetDragXRef.current = event.clientX;
    if (!session.active) {
      if (Math.abs(event.clientX - session.startX) < SHEET_DRAG_START_THRESHOLD_PX) return;
      session.active = true;
      setSheetMenu(null);
      suppressClickSheetRef.current = session.sheetName;
      startSheetDragAutoScroll();
    }
    event.preventDefault();
    updateSheetDragView(event.clientX, session);
  };

  const finishSheetPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sheetDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const view = sheetDragViewRef.current;
    cancelSheetDrag();
    if (!session.active || !view) return;
    event.preventDefault();
    if (view.targetGapIndex !== session.sourceIndex) {
      onMoveSheet(session.sheetName, view.targetGapIndex);
    }
  };

  const sheetMenuIndex = sheetMenu ? sheetNames.indexOf(sheetMenu.sheetName) : -1;
  const showSheetTabScrollControls = sheetTabScrollState.canScrollLeft || sheetTabScrollState.canScrollRight;
  const hasNativeTitle = titlePlacement === "native";
  const documentTitle = !hasNativeTitle && (
    <div className="app-title" aria-label="Current file" title={`${fileName} — ${fileStatus}`}>
      <span className="app-title-name">{fileName}</span>
    </div>
  );
  const fileError = fileStatusTone === "error" ? fileStatus : null;
  const openFileTooltip = fileError ? `Open file · ${fileError}` : "Open file";
  const saveTooltip = "Save file";
  const saveAsTooltip = "Save as";
  const exportTooltip = "Export a copy";
  const applicationGroups: ApplicationMenuGroup[] = [
    { label: "File", items: [
      { label: "New document", run: onNewFile, disabled: agentPreviewActive, icon: <NewDocumentIcon /> },
      ...(online ? [{ label: "Examples…", run: online.showExamples }, ...(online.resetExample ? [{ label: "Reset example…", run: online.resetExample }] : [])] : []),
      { label: "Open…", run: onOpenFile, disabled: agentPreviewActive, icon: <OpenIcon /> },
      ...(online ? [{ label: "Open from link…", run: online.openFromLink }] : []),
      { label: "Save", run: onSaveFile, icon: <SaveIcon /> },
      { label: "Save as…", run: onSaveFileAs, icon: <SaveAsIcon /> },
      ...(onImportFile ? [{ label: "Import spreadsheet…", run: onImportFile, disabled: agentPreviewActive }] : []),
      ...Object.entries(FORMATS).map(([format, info]) => ({ label: `Export ${info.label}…`, run: () => onExportFormat(format as ExportFormat), icon: <ExportIcon /> })),
      { label: "Print…", run: onPrintFile, disabled: !activeSheet },
    ] },
    { label: "Edit", items: [
      { label: "Undo", run: onUndo, disabled: agentPreviewActive || mode !== "table" || !canUndo, icon: <UndoIcon /> },
      { label: "Redo", run: onRedo, disabled: agentPreviewActive || mode !== "table" || !canRedo, icon: <RedoIcon /> },
      { label: "Settings…", run: onOpenSettings, icon: <SettingsIcon /> },
    ] },
    { label: "View", items: [
      ...(search ? [{ label: "Find in document…", run: search.show, disabled: !search.enabled }] : []),
      { label: mode === "table" ? "Source mode" : "Table view", run: mode === "table" ? onEnterSourceMode : onExitSourceMode, disabled: agentPreviewActive, icon: <CodeIcon /> },
      { label: "Sheet setup…", run: onToggleSheetSetup, disabled: agentPreviewActive || mode !== "table" || !activeSheet, icon: <SheetSetupIcon /> },
    ] },
    { label: "Help", items: [
      ...(online ? [{ label: "Get Mac app…", run: online.downloadMac }] : []),
      { label: "About Ordinate", run: () => setAboutOpen(true) },
    ] },
  ];

  return (
    <header className={mode === "source" ? "app-chrome source-mode" : "app-chrome"}>
      <div className="topbar">
        <div className="brand-lockup">
          {hasNativeTitle ? <span className="brand-name">ordinate</span> : <ApplicationMenu groups={applicationGroups} />}
        </div>
        {documentTitle}

        <nav className="toolbar-tools" aria-label="Toolbar">
          <div className="toolbar-group toolbar-group--file" role="group" aria-label="File">
          {hasNativeTitle && <button
            className="tool-button file-command-button"
            type="button"
            disabled={agentPreviewActive}
            onClick={onNewFile}
            aria-label="New document"
            onMouseEnter={(event) => onTooltipEnter("New document in tab", event.currentTarget)}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => onTooltipEnter("New document in tab", event.currentTarget)}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          >
            <span className="tool-icon"><NewDocumentIcon /></span>
          </button>}
          <button
            className="tool-button file-command-button"
            type="button"
            disabled={agentPreviewActive}
            onClick={onOpenFile}
            aria-label="Open file"
            aria-describedby={fileError ? "file-error-status" : undefined}
            onMouseEnter={(event) => onTooltipEnter(openFileTooltip, event.currentTarget)}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => onTooltipEnter(openFileTooltip, event.currentTarget)}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          >
            <span className="tool-icon">
              <OpenIcon />
            </span>
            {fileError ? <span className="file-error-indicator" role="status" id="file-error-status" aria-label={fileError} title={fileError} /> : null}
          </button>

          {!hasNativeTitle && <>
          <button
            className="tool-button file-command-button"
            type="button"
            onClick={onSaveFile}
            aria-label={saveTooltip}
            onMouseEnter={(event) => onTooltipEnter(saveTooltip, event.currentTarget)}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => onTooltipEnter(saveTooltip, event.currentTarget)}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          >
            <span className="tool-icon">
              <SaveIcon />
            </span>
          </button>

          <button
            className="tool-button file-command-button"
            type="button"
            onClick={onSaveFileAs}
            aria-label={saveAsTooltip}
            onMouseEnter={(event) => onTooltipEnter(saveAsTooltip, event.currentTarget)}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => onTooltipEnter(saveAsTooltip, event.currentTarget)}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          >
            <span className="tool-icon">
              <SaveAsIcon />
            </span>
          </button>
          </>}
          <ChoiceMenu open={exportMenuOpen} onOpenChange={open => open ? onExportFile() : onExportMenuOpenChange(false)}
            onChoose={onExportFormat} label="Export format" portal
            options={Object.entries(FORMATS).map(([value, format]) => ({ value: value as ExportFormat, label: format.label, detail: `.${value}` }))}
            buttonProps={{ className: `tool-button file-command-button${exportMenuOpen ? " active" : ""}`, "aria-label": exportTooltip,
              onMouseEnter: event => { if (!exportMenuOpen) onTooltipEnter(exportTooltip, event.currentTarget); },
              onMouseLeave: event => onTooltipRelease(event.currentTarget),
              onFocus: event => { if (!exportMenuOpen) onTooltipEnter(exportTooltip, event.currentTarget); },
              onBlur: event => onTooltipRelease(event.currentTarget),
              onMouseDown: event => onTooltipSuppress(event.currentTarget),
              children: <span className="tool-icon"><ExportIcon /></span>,
            }} />
          </div>

          <div className="toolbar-group toolbar-group--document" role="group" aria-label="Document">
          <button
            ref={sheetSetupButtonRef}
            className={sheetSetupOpen ? "tool-button sheet-setup-button active" : "tool-button sheet-setup-button"}
            type="button"
            disabled={agentPreviewActive || mode !== "table" || !activeSheet}
            onClick={onToggleSheetSetup}
            aria-label="Sheet setup"
            aria-haspopup="menu"
            aria-expanded={sheetSetupOpen}
            onMouseEnter={(event) => onTooltipEnter("Sheet setup", event.currentTarget)}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => {
              if (!sheetSetupOpen) onTooltipEnter("Sheet setup", event.currentTarget);
            }}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          >
            <span className="tool-icon">
              <SheetSetupIcon />
            </span>
          </button>
          </div>

          <div className="toolbar-group toolbar-group--history" role="group" aria-label="History">
          <button
            className="tool-button history-button"
            type="button"
            disabled={agentPreviewActive || mode !== "table" || !canUndo}
            onClick={onUndo}
            aria-label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
            title={undoLabel ? `Undo ${undoLabel}` : "Undo"}
            onMouseEnter={(event) => onTooltipEnter(undoLabel ? `Undo ${undoLabel}` : "Undo", event.currentTarget)}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => onTooltipEnter(undoLabel ? `Undo ${undoLabel}` : "Undo", event.currentTarget)}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          >
            <span className="tool-icon">
              <UndoIcon />
            </span>
          </button>

          <button
            className="tool-button history-button"
            type="button"
            disabled={agentPreviewActive || mode !== "table" || !canRedo}
            onClick={onRedo}
            aria-label={redoLabel ? `Redo ${redoLabel}` : "Redo"}
            title={redoLabel ? `Redo ${redoLabel}` : "Redo"}
            onMouseEnter={(event) => onTooltipEnter(redoLabel ? `Redo ${redoLabel}` : "Redo", event.currentTarget)}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => onTooltipEnter(redoLabel ? `Redo ${redoLabel}` : "Redo", event.currentTarget)}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          >
            <span className="tool-icon">
              <RedoIcon />
            </span>
          </button>
          </div>

          <div className="toolbar-group toolbar-group--preferences" role="group" aria-label="Preferences">
          <button
            className="tool-button settings-button"
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onMouseEnter={(event) => { if (!settingsOpen) onTooltipEnter("Settings", event.currentTarget); }}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => { if (!settingsOpen) onTooltipEnter("Settings", event.currentTarget); }}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          >
            <span className="tool-icon"><SettingsIcon /></span>
          </button>
          </div>
        </nav>

        {online?.isMac && <MacDownloadButton onClick={online.downloadMac} />}
        <div className="toolbar-actions">
          <SearchButton />
          {!online && <button
            className={agentOpen ? "tool-button agent-button active" : "tool-button agent-button"}
            type="button"
            disabled={agentPreviewActive}
            onClick={onToggleAgent}
            aria-label={agentOpen ? (agentDebugMode ? "Close assistant simulator" : "Close AI assistant") : (agentDebugMode ? "Open assistant simulator" : "Open AI assistant")}
            aria-expanded={agentOpen}
            aria-controls="ordinate-agent-panel"
            onMouseEnter={(event) => onTooltipEnter(agentDebugMode ? "Assistant simulator" : "AI assistant", event.currentTarget)}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => onTooltipEnter(agentDebugMode ? "Assistant simulator" : "AI assistant", event.currentTarget)}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          ><span className="tool-icon"><SparklesIcon /></span></button>}
          <button
            className={mode === "source" ? "tool-button source-button active" : "tool-button source-button"}
            disabled={agentPreviewActive}
            onClick={mode === "source" ? onExitSourceMode : onEnterSourceMode}
            aria-label={mode === "source" ? "Return to table view" : "Open source mode"}
            onMouseEnter={(event) => onTooltipEnter(mode === "source" ? "Return to table view" : "Open source mode", event.currentTarget)}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => onTooltipEnter(mode === "source" ? "Return to table view" : "Open source mode", event.currentTarget)}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          >
            <span className="tool-icon">
              <CodeIcon />
            </span>
          </button>
        </div>
      </div>

      <div className="sheetbar-shell" aria-hidden={mode === "source"}>
        <div className="sheetbar">
          {showSheetTabScrollControls ? (
            <button
              className="sheet-scroll-button sheet-scroll-button--left"
              type="button"
              aria-label="Scroll sheets left"
              disabled={mode !== "table" || !sheetTabScrollState.canScrollLeft}
              tabIndex={mode === "source" ? -1 : 0}
              onClick={() => scrollSheetTabs("left")}
              onMouseEnter={(event) => onTooltipEnter("Scroll sheets left", event.currentTarget)}
              onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
              onFocus={(event) => onTooltipEnter("Scroll sheets left", event.currentTarget)}
              onBlur={(event) => onTooltipRelease(event.currentTarget)}
              onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
            >
              <ChevronLeftIcon />
            </button>
          ) : null}
          <div
            className={[
              "sheet-tabs-viewport",
              sheetTabScrollState.canScrollLeft ? "can-fade-left" : "",
              sheetTabScrollState.canScrollRight ? "can-fade-right" : "",
            ].filter(Boolean).join(" ")}
            ref={sheetTabsViewportRef}
          >
            <div className="sheet-tabs" role="tablist" aria-label="Sheets">
            {sheetNames.map((sheetName, sheetIndex) => (
              <button
                key={sheetName}
                ref={(node) => {
                  if (node) sheetTabRefs.current.set(sheetName, node);
                  else sheetTabRefs.current.delete(sheetName);
                }}
                className={tabClassName(sheetName)}
                onClick={(event) => {
                  if (suppressClickSheetRef.current === sheetName) {
                    suppressClickSheetRef.current = null;
                    event.preventDefault();
                    return;
                  }
                  onTooltipSuppress(event.currentTarget);
                  setActiveSheet(sheetName);
                }}
                onDoubleClick={() => startRename(sheetName)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openSheetMenu(sheetName, event.currentTarget);
                }}
                onPointerDown={(event) => {
                  onTooltipSuppress(event.currentTarget);
                  handleSheetPointerDown(sheetName, sheetIndex, event);
                }}
                onPointerMove={handleSheetPointerMove}
                onPointerUp={finishSheetPointerDrag}
                onPointerCancel={cancelSheetDrag}
                type="button"
                role="tab"
                tabIndex={mode === "source" ? -1 : 0}
                aria-selected={sheetName === activeSheet}
                onMouseEnter={(event) => {
                  if (sheetName !== renamingSheet) onTabMouseEnter(sheetName, event.currentTarget);
                }}
                onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                onFocus={(event) => {
                  if (sheetName !== renamingSheet) onTabMouseEnter(sheetName, event.currentTarget);
                }}
                onBlur={(event) => {
                  // Pointer dismissal lasts until leave; keyboard dismissal lasts
                  // until blur so a later keyboard visit can reveal the full title.
                  if (event.currentTarget.matches(":hover")) onTabMouseLeave();
                  else onTooltipRelease(event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (event.key === "F2") {
                    event.preventDefault();
                    startRename(sheetName);
                    return;
                  }
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    event.preventDefault();
                    openSheetMenu(sheetName, event.currentTarget);
                  }
                }}
                aria-invalid={sheetHealthByName[sheetName] === "invalid"}
                aria-label={sheetName}
              >
                {sheetName === renamingSheet ? (
                  <input
                    ref={renameInputRef}
                    className="sheet-tab-rename-input"
                    value={renameValue}
                    aria-invalid={renameError?.sheetName === sheetName}
                    aria-describedby={renameError?.sheetName === sheetName ? "sheet-tab-rename-error" : undefined}
                    spellCheck={false}
                    onChange={(event) => {
                      setRenameValue(event.target.value);
                      if (renameError) setRenameError(null);
                    }}
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={commitRename}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename();
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    aria-label={`Rename ${sheetName}`}
                  />
                ) : (
                  <span className="sheet-tab-label">{sheetName}</span>
                )}
                {sheetHealthByName[sheetName] !== "ok" ? (
                  <span
                    className="sheet-tab-alert invalid"
                    aria-hidden="true"
                  >
                    ×
                  </span>
                ) : null}
              </button>
            ))}
              {sheetDragView ? (
                <div className="sheet-tab-drop-indicator" style={{ left: sheetDragView.indicatorLeft }} aria-hidden="true" />
              ) : null}
            </div>
          </div>
          {showSheetTabScrollControls ? (
            <button
              className="sheet-scroll-button sheet-scroll-button--right"
              type="button"
              aria-label="Scroll sheets right"
              disabled={mode !== "table" || !sheetTabScrollState.canScrollRight}
              tabIndex={mode === "source" ? -1 : 0}
              onClick={() => scrollSheetTabs("right")}
              onMouseEnter={(event) => onTooltipEnter("Scroll sheets right", event.currentTarget)}
              onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
              onFocus={(event) => onTooltipEnter("Scroll sheets right", event.currentTarget)}
              onBlur={(event) => onTooltipRelease(event.currentTarget)}
              onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
            >
              <ChevronRightIcon />
            </button>
          ) : null}
          <button
            className="sheet-add"
            type="button"
            aria-label="Add sheet"
            disabled={mode !== "table"}
            tabIndex={mode === "source" ? -1 : 0}
            onClick={onInsertSheet}
            onMouseEnter={(event) => onTooltipEnter("Add sheet", event.currentTarget)}
            onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
            onFocus={(event) => onTooltipEnter("Add sheet", event.currentTarget)}
            onBlur={(event) => onTooltipRelease(event.currentTarget)}
            onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
          >
            <PlusIcon />
          </button>
          {createPortal(
            <MenuSurface
              open={sheetMenu !== null}
              className="sheet-tab-menu"
              innerRef={sheetMenuRef}
              style={sheetMenu ? { top: sheetMenu.top, left: sheetMenu.left } : undefined}
            >
              {sheetMenu ? (
                <>
                  <MenuHead className="sheet-tab-menu-head">
                    <MenuTitle>{sheetMenu.sheetName}</MenuTitle>
                  </MenuHead>
                  <MenuGroup>
                    <MenuOption icon={<SheetRenameGlyph />} onClick={() => startRename(sheetMenu.sheetName)}>
                      Rename
                    </MenuOption>
                    <MenuOption
                      icon={<SheetMoveLeftGlyph />}
                      disabled={sheetMenuIndex <= 0}
                      onClick={() => moveSheetLeft(sheetMenu.sheetName)}
                    >
                      Move Left
                    </MenuOption>
                    <MenuOption
                      icon={<SheetMoveRightGlyph />}
                      disabled={sheetMenuIndex < 0 || sheetMenuIndex >= sheetNames.length - 1}
                      onClick={() => moveSheetRight(sheetMenu.sheetName)}
                    >
                      Move Right
                    </MenuOption>
                    <MenuDivider />
                    <MenuOption
                      icon={<SheetDeleteGlyph />}
                      tone="danger"
                      disabled={sheetNames.length <= 1}
                      onClick={() => {
                        const sheetName = sheetMenu.sheetName;
                        setSheetMenu(null);
                        void onDeleteSheet(sheetName);
                      }}
                    >
                      Delete
                    </MenuOption>
                  </MenuGroup>
                </>
              ) : null}
            </MenuSurface>,
            document.body,
          )}
          {renameError ? createPortal(
            <div
              id="sheet-tab-rename-error"
              className="sheet-tab-rename-error"
              role="alert"
              style={{ top: renameError.top, left: renameError.left }}
            >
              {renameError.message}
            </div>,
            document.body,
          ) : null}
        </div>
      </div>
      {aboutOpen && <InfoDialog title="Ordinate" onClose={() => setAboutOpen(false)}><p>Structured tables, formulas and notes.</p></InfoDialog>}
    </header>
  );
}
