import { createPortal } from "react-dom";
import type { ReactNode } from "react";

import { AutoIcon, MoonIcon, SunIcon } from "../icons/uiIcons";
import type { FloatingMenuPosition, FloatingTooltip, ThemeMenuPosition, ThemeMode, ToolSpec } from "../types/ui";

type OverlayPortalsProps = {
  themeMenuOpen: boolean;
  themeMenuPosition: ThemeMenuPosition;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeMenuOpen: (open: boolean) => void;
  toolMenuOpen: boolean;
  toolMenuPosition: FloatingMenuPosition;
  overflowTools: ToolSpec[];
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
  tooltip,
}: OverlayPortalsProps) {
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
