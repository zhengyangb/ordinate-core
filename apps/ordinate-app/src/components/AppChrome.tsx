import type { ReactNode, RefObject, SetStateAction } from "react";

import { CodeIcon, MoreIcon, PlusIcon } from "../icons/uiIcons";
import type { SheetHealth, ToolSpec } from "../types/ui";

type AppChromeProps = {
  mode: "table" | "source";
  activeSheet: string | null;
  sheetNames: string[];
  sheetHealthByName: Record<string, SheetHealth>;
  setActiveSheet: (name: string) => void;
  visibleTools: ToolSpec[];
  overflowTools: ToolSpec[];
  toolMenuOpen: boolean;
  setToolMenuOpen: (value: SetStateAction<boolean>) => void;
  themeMenuOpen: boolean;
  setThemeMenuOpen: (value: SetStateAction<boolean>) => void;
  themeButtonLabel: string;
  themeButtonIcon: ReactNode;
  themeControlRef: RefObject<HTMLDivElement>;
  themeButtonRef: RefObject<HTMLButtonElement>;
  toolButtonRef: RefObject<HTMLButtonElement>;
  onEnterSourceMode: () => void;
  onExitSourceMode: () => void;
  onTabMouseEnter: (sheetName: string, target: HTMLButtonElement) => void;
  onTabMouseLeave: () => void;
};

export default function AppChrome({
  mode,
  activeSheet,
  sheetNames,
  sheetHealthByName,
  setActiveSheet,
  visibleTools,
  overflowTools,
  toolMenuOpen,
  setToolMenuOpen,
  themeMenuOpen,
  setThemeMenuOpen,
  themeButtonLabel,
  themeButtonIcon,
  themeControlRef,
  themeButtonRef,
  toolButtonRef,
  onEnterSourceMode,
  onExitSourceMode,
  onTabMouseEnter,
  onTabMouseLeave,
}: AppChromeProps) {
  return (
    <header className={mode === "source" ? "app-chrome source-mode" : "app-chrome"}>
      <div className="topbar">
        <div className="brand-lockup">
          <span className="brand-name">Ordinate</span>
        </div>

        <nav className="toolbar-tools" aria-label="Placeholder toolbar">
          {visibleTools.map((item) => (
            <button
              key={item.label}
              className="tool-button"
              type="button"
              tabIndex={-1}
              aria-label={item.label}
              title={item.label}
            >
              <span className="tool-icon">{item.icon}</span>
            </button>
          ))}
          {overflowTools.length > 0 ? (
            <div className="tool-overflow-control">
              <button
                ref={toolButtonRef}
                className={toolMenuOpen ? "tool-button tool-more-button active" : "tool-button tool-more-button"}
                type="button"
                onClick={() => setToolMenuOpen((open) => !open)}
                aria-label="More tools"
                title="More tools"
                aria-haspopup="menu"
                aria-expanded={toolMenuOpen}
              >
                <span className="tool-icon">
                  <MoreIcon />
                </span>
              </button>
            </div>
          ) : null}
        </nav>

        <div className="toolbar-actions">
          <div className="theme-control" ref={themeControlRef}>
            <button
              className={themeMenuOpen ? "tool-button theme-button active" : "tool-button theme-button"}
              type="button"
              onClick={() => setThemeMenuOpen((open) => !open)}
              ref={themeButtonRef}
              title={themeButtonLabel}
              aria-label={themeButtonLabel}
              aria-haspopup="menu"
              aria-expanded={themeMenuOpen}
            >
              <span className="tool-icon">{themeButtonIcon}</span>
            </button>
          </div>

          <button
            className={mode === "source" ? "tool-button source-button active" : "tool-button source-button"}
            onClick={mode === "source" ? onExitSourceMode : onEnterSourceMode}
            title={mode === "source" ? "Return to table view" : "Open source mode"}
            aria-label={mode === "source" ? "Return to table view" : "Open source mode"}
          >
            <span className="tool-icon">
              <CodeIcon />
            </span>
          </button>
        </div>
      </div>

      <div className="sheetbar-shell" aria-hidden={mode === "source"}>
        <div className="sheetbar">
          <button className="sheet-add" type="button" aria-label="Add sheet placeholder" tabIndex={-1}>
            <PlusIcon />
          </button>
          <div className="sheet-tabs" role="tablist" aria-label="Sheets">
            {sheetNames.map((sheetName) => (
              <button
                key={sheetName}
                className={
                  sheetName === activeSheet
                    ? `sheet-tab active${sheetHealthByName[sheetName] === "invalid" ? " invalid" : ""}`
                    : `sheet-tab${sheetHealthByName[sheetName] === "invalid" ? " invalid" : ""}`
                }
                onClick={() => setActiveSheet(sheetName)}
                type="button"
                tabIndex={mode === "source" ? -1 : 0}
                onMouseEnter={(event) => onTabMouseEnter(sheetName, event.currentTarget)}
                onMouseLeave={onTabMouseLeave}
                onFocus={(event) => onTabMouseEnter(sheetName, event.currentTarget)}
                onBlur={onTabMouseLeave}
                aria-invalid={sheetHealthByName[sheetName] === "invalid"}
              >
                <span className="sheet-tab-label">{sheetName}</span>
                {sheetHealthByName[sheetName] === "invalid" ? (
                  <span className="sheet-tab-alert" aria-hidden="true" title="Sheet has parse/validation issues">
                    !
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
