import { useEffect, useRef, useState, type ReactNode, type RefObject, type SetStateAction } from "react";

import { CodeIcon, MoreIcon, PlusIcon } from "../icons/uiIcons";
import type { SheetHealth, ToolSpec } from "../types/ui";

type AppChromeProps = {
  mode: "table" | "source";
  activeSheet: string | null;
  sheetNames: string[];
  sheetHealthByName: Record<string, SheetHealth>;
  setActiveSheet: (name: string) => void;
  onRenameSheet: (sheetName: string, nextName: string) => string | null;
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
  onTooltipEnter: (text: string, target: HTMLElement, delayMs?: number) => void;
  onTooltipLeave: () => void;
  onTooltipSuppress: (target: HTMLElement) => void;
  onTooltipRelease: (target: HTMLElement) => void;
  onTabMouseEnter: (sheetName: string, target: HTMLButtonElement) => void;
  onTabMouseLeave: () => void;
};

export default function AppChrome({
  mode,
  activeSheet,
  sheetNames,
  sheetHealthByName,
  setActiveSheet,
  onRenameSheet,
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
  onTooltipEnter,
  onTooltipLeave,
  onTooltipSuppress,
  onTooltipRelease,
  onTabMouseEnter,
  onTabMouseLeave,
}: AppChromeProps) {
  const [renamingSheet, setRenamingSheet] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

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
    }
  }, [mode, renamingSheet]);

  const startRename = (sheetName: string) => {
    if (mode !== "table") return;
    setActiveSheet(sheetName);
    setRenamingSheet(sheetName);
    setRenameValue(sheetName);
  };

  const cancelRename = () => {
    setRenamingSheet(null);
    setRenameValue("");
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
      cancelRename();
      return;
    }
    cancelRename();
  };

  const tabClassName = (sheetName: string): string => {
    const health = sheetHealthByName[sheetName] ?? "ok";
    const classes = ["sheet-tab"];
    if (sheetName === activeSheet) classes.push("active");
    if (sheetName === renamingSheet) classes.push("renaming");
    if (health === "invalid") classes.push("invalid");
    return classes.join(" ");
  };

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
              onMouseEnter={(event) => onTooltipEnter(item.label, event.currentTarget)}
              onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
              onFocus={(event) => onTooltipEnter(item.label, event.currentTarget)}
              onBlur={(event) => onTooltipRelease(event.currentTarget)}
              onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
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
                aria-haspopup="menu"
                aria-expanded={toolMenuOpen}
                onMouseEnter={(event) => onTooltipEnter("More tools", event.currentTarget)}
                onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                onFocus={(event) => {
                  if (!toolMenuOpen) onTooltipEnter("More tools", event.currentTarget);
                }}
                onBlur={(event) => onTooltipRelease(event.currentTarget)}
                onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
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
              aria-label={themeButtonLabel}
              aria-haspopup="menu"
              aria-expanded={themeMenuOpen}
              onMouseEnter={(event) => onTooltipEnter(themeButtonLabel, event.currentTarget)}
              onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
              onFocus={(event) => {
                if (!themeMenuOpen) onTooltipEnter(themeButtonLabel, event.currentTarget);
              }}
              onBlur={(event) => onTooltipRelease(event.currentTarget)}
              onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
            >
              <span className="tool-icon">{themeButtonIcon}</span>
            </button>
          </div>

          <button
            className={mode === "source" ? "tool-button source-button active" : "tool-button source-button"}
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
          <button className="sheet-add" type="button" aria-label="Add sheet placeholder" tabIndex={-1}>
            <PlusIcon />
          </button>
          <div className="sheet-tabs" role="tablist" aria-label="Sheets">
            {sheetNames.map((sheetName) => (
              <button
                key={sheetName}
                className={tabClassName(sheetName)}
                onClick={() => setActiveSheet(sheetName)}
                onDoubleClick={() => startRename(sheetName)}
                type="button"
                tabIndex={mode === "source" ? -1 : 0}
                onMouseEnter={(event) => {
                  if (sheetName !== renamingSheet) onTabMouseEnter(sheetName, event.currentTarget);
                }}
                onMouseLeave={() => {
                  if (sheetName !== renamingSheet) onTabMouseLeave();
                }}
                onFocus={(event) => {
                  if (sheetName !== renamingSheet) onTabMouseEnter(sheetName, event.currentTarget);
                }}
                onBlur={() => {
                  if (sheetName !== renamingSheet) onTabMouseLeave();
                }}
                onKeyDown={(event) => {
                  if (event.key === "F2") {
                    event.preventDefault();
                    startRename(sheetName);
                  }
                }}
                aria-invalid={sheetHealthByName[sheetName] === "invalid"}
              >
                {sheetName === renamingSheet ? (
                  <input
                    ref={renameInputRef}
                    className="sheet-tab-rename-input"
                    value={renameValue}
                    spellCheck={false}
                    onChange={(event) => setRenameValue(event.target.value)}
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
          </div>
        </div>
      </div>
    </header>
  );
}
