import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode } from "react";

import { AutoIcon, MoonIcon, SunIcon } from "../icons/uiIcons";
import { FormatOptionGlyph, FormatPreviewPanel, StylePreviewPanel } from "./DisplayMetadataPreview";
import type {
  ColumnRailMenuView,
  FloatingMenuPosition,
  FloatingTooltip,
  ThemeMenuPosition,
  ThemeMode,
  ToolSpec,
} from "../types/ui";

function StyleRowGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M6.2 14.1 9.8 5.8l3.9 8.3M7.3 11.7h5.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
      <path d="M5.6 16.2h8.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" opacity="0.92" />
    </svg>
  );
}

type OverlayPortalsProps = {
  themeMenuOpen: boolean;
  themeMenuPosition: ThemeMenuPosition;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeMenuOpen: (open: boolean) => void;
  toolMenuOpen: boolean;
  toolMenuPosition: FloatingMenuPosition;
  overflowTools: ToolSpec[];
  columnRailMenuOpen: boolean;
  columnRailMenuPosition: FloatingMenuPosition;
  columnRailMenu: ColumnRailMenuView | null;
  tooltip: FloatingTooltip | null;
};

export default function OverlayPortals({
  themeMenuOpen,
  themeMenuPosition,
  themeMode,
  setThemeMode,
  setThemeMenuOpen,
  toolMenuOpen,
  toolMenuPosition,
  overflowTools,
  columnRailMenuOpen,
  columnRailMenuPosition,
  columnRailMenu,
  tooltip,
}: OverlayPortalsProps) {
  const [columnMenuPanel, setColumnMenuPanel] = useState<"format" | "style">("format");
  const [columnFormatInspectKey, setColumnFormatInspectKey] = useState<ColumnRailMenuView["formatLocalKey"]>("auto");

  useEffect(() => {
    if (!columnRailMenuOpen || !columnRailMenu) return;
    const hasFormatLocal = columnRailMenu.formatLocalKey !== "auto";
    const hasStyleLocal =
      columnRailMenu.styleLocal.align !== "auto" ||
      columnRailMenu.styleLocal.weight !== "auto" ||
      columnRailMenu.styleLocal.color !== "auto";
    setColumnMenuPanel(hasFormatLocal || !hasStyleLocal ? "format" : "style");
    setColumnFormatInspectKey(columnRailMenu.formatLocalKey);
  }, [columnRailMenuOpen, columnRailMenu?.colIndex, columnRailMenu?.formatLocalKey, columnRailMenu?.styleLocal.align, columnRailMenu?.styleLocal.weight, columnRailMenu?.styleLocal.color]);

  return (
    <>
      {createPortal(
        <div
          className={themeMenuOpen ? "theme-menu open" : "theme-menu"}
          role="menu"
          aria-hidden={!themeMenuOpen}
          style={{ top: `${themeMenuPosition.top}px`, left: `${themeMenuPosition.left}px` }}
        >
          {(
            [
              { mode: "auto", label: "Auto", icon: <AutoIcon /> },
              { mode: "light", label: "Light", icon: <SunIcon /> },
              { mode: "dark", label: "Dark", icon: <MoonIcon /> },
            ] satisfies Array<{ mode: ThemeMode; label: string; icon: ReactNode }>
          ).map((option) => (
            <button
              key={option.mode}
              className={themeMode === option.mode ? "theme-option active" : "theme-option"}
              type="button"
              role="menuitemradio"
              aria-checked={themeMode === option.mode}
              onClick={() => {
                setThemeMode(option.mode);
                setThemeMenuOpen(false);
              }}
            >
              <span className="tool-icon">{option.icon}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}

      {createPortal(
        <div
          className={toolMenuOpen ? "tool-menu open" : "tool-menu"}
          role="menu"
          aria-hidden={!toolMenuOpen}
          style={{ top: `${toolMenuPosition.top}px`, left: `${toolMenuPosition.left}px` }}
        >
          {overflowTools.map((item) => (
            <button key={item.label} className="tool-menu-option" type="button" role="menuitem" tabIndex={toolMenuOpen ? 0 : -1}>
              <span className="tool-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}

      {createPortal(
        <div
          className={columnRailMenuOpen ? "column-rail-menu open" : "column-rail-menu"}
          role="menu"
          aria-hidden={!columnRailMenuOpen}
          style={{ top: `${columnRailMenuPosition.top}px`, left: `${columnRailMenuPosition.left}px` }}
        >
          {columnRailMenu ? (
            <>
              <div className="column-rail-menu-head">
                <span className="column-rail-menu-title">
                  <span>{`Column ${columnRailMenu.colLabel}`}</span>
                  <sup className="column-rail-menu-title-index" aria-hidden="true">
                    {columnRailMenu.colIndex + 1}
                  </sup>
                </span>
              </div>
              <div className="column-rail-menu-body column-rail-menu-body--two-pane">
                <div className="column-rail-menu-nav" role="tablist" aria-label="Column metadata views">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={columnMenuPanel === "format"}
                    className={columnMenuPanel === "format" ? "column-rail-menu-nav-item is-active" : "column-rail-menu-nav-item"}
                    onClick={() => setColumnMenuPanel("format")}
                  >
                    <span className="column-rail-menu-row-icon"><FormatOptionGlyph option="decimal" /></span>
                    <span>Format</span>
                    {columnRailMenu.formatLocalKey !== "auto" ? <span className="column-rail-menu-nav-mark" aria-hidden="true" /> : null}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={columnMenuPanel === "style"}
                    className={columnMenuPanel === "style" ? "column-rail-menu-nav-item is-active" : "column-rail-menu-nav-item"}
                    onClick={() => setColumnMenuPanel("style")}
                  >
                    <span className="column-rail-menu-row-icon"><StyleRowGlyph /></span>
                    <span>Style</span>
                    {columnRailMenu.styleLocal.align !== "auto" || columnRailMenu.styleLocal.weight !== "auto" || columnRailMenu.styleLocal.color !== "auto" ? (
                      <span className="column-rail-menu-nav-mark" aria-hidden="true" />
                    ) : null}
                  </button>
                </div>
                <div className="column-rail-menu-panel">
                  {columnMenuPanel === "format" ? (
                    <FormatPreviewPanel
                      localFormatKey={columnRailMenu.formatLocalKey}
                      localFormatOptions={columnRailMenu.formatLocalOptions}
                      inspectedKey={columnFormatInspectKey}
                      onInspectKey={setColumnFormatInspectKey}
                    />
                  ) : (
                    <StylePreviewPanel styleLocal={columnRailMenu.styleLocal} />
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>,
        document.body,
      )}

      {createPortal(
        <div
          className={tooltip ? "floating-tooltip visible" : "floating-tooltip"}
          data-placement={tooltip?.placement ?? "below"}
          data-alignment={tooltip?.alignment ?? "center"}
          role="tooltip"
          aria-hidden={!tooltip}
          style={{
            top: `${tooltip?.top ?? 0}px`,
            left: `${tooltip?.left ?? 0}px`,
          }}
        >
          {tooltip?.text ?? ""}
        </div>,
        document.body,
      )}
    </>
  );
}
