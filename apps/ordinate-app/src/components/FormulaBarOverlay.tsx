import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { UiLocale } from "../i18n/messages";
import {
  classifyDisplayMetadataIssue,
  formatDisplayMetadataErrorMessage,
  getDisplayMetadataErrorLabel,
} from "../i18n/displayMetadata";
import { FormatPreviewPanel, StylePreviewPanel } from "./DisplayMetadataPreview";
import type { ChromeVisibilityPhase, FormatLocalKey, FormulaBarData, StyleLocalView } from "../types/ui";
import { selectionDebugLog } from "../utils/selectionDebug";

function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function FormatGlyph({ warning = false }: { warning?: boolean }) {
  return (
    <MenuIcon>
      <path d="M3.8 5.4h12.4M3.8 10h12.4M3.8 14.6h12.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <circle cx="7.1" cy="5.4" r="1.35" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12.7" cy="10" r="1.35" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="9.3" cy="14.6" r="1.35" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {warning ? (
        <g className="menu-icon-warning-badge">
          <path className="menu-icon-warning-triangle" d="M17.15 14.75 21.05 20.95h-7.8z" />
          <path className="menu-icon-warning-mark" d="M17.15 16.6v2.22" />
          <circle className="menu-icon-warning-dot" cx="17.15" cy="19.55" r="0.36" />
        </g>
      ) : null}
    </MenuIcon>
  );
}

function StyleGlyph({ warning = false }: { warning?: boolean }) {
  return (
    <MenuIcon>
      <path d="M6.2 14.1 9.8 5.8l3.9 8.3M7.3 11.7h5.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
      <path d="M5.6 16.2h8.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" opacity="0.92" />
      {warning ? (
        <g className="menu-icon-warning-badge">
          <path className="menu-icon-warning-triangle" d="M17.15 14.75 21.05 20.95h-7.8z" />
          <path className="menu-icon-warning-mark" d="M17.15 16.6v2.22" />
          <circle className="menu-icon-warning-dot" cx="17.15" cy="19.55" r="0.36" />
        </g>
      ) : null}
    </MenuIcon>
  );
}

function BannerWarningGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 2.4 18 16.2a1 1 0 0 1-.87 1.4H2.87A1 1 0 0 1 2 16.2L10 2.4z" fill="currentColor" />
      <path d="M10 7.1v5.2M10 14.9h.01" fill="none" stroke="var(--sheet-surface)" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

type FormulaBarOverlayProps = {
  locale: UiLocale;
  mode: "table" | "source";
  phase: ChromeVisibilityPhase;
  formulaBarSnapshot: FormulaBarData | null;
  inputMode: "read" | "edit";
  isInputEditable: boolean;
  areDisplayControlsEditable: boolean;
  onRequestEdit: () => void;
  onCancelEdit: () => void;
  onCommitInput: (nextInput: string) => void;
  canApplyToSelection: boolean;
  onApplyToSelection: (nextInput: string) => void;
  onSetLocalFormat: (key: FormatLocalKey, options: FormulaBarData["formatLocalOptions"]) => void;
  onSetLocalStyle: <Axis extends keyof StyleLocalView>(axis: Axis, value: StyleLocalView[Axis]) => void;
  onDismiss: () => void;
  onTooltipEnter: (text: string, target: HTMLElement, delayMs?: number) => void;
  onTooltipLeave: () => void;
  onTooltipSuppress: (target: HTMLElement) => void;
  onTooltipRelease: (target: HTMLElement) => void;
};

export default function FormulaBarOverlay({
  locale,
  mode,
  phase,
  formulaBarSnapshot,
  inputMode,
  isInputEditable,
  areDisplayControlsEditable,
  onRequestEdit,
  onCancelEdit,
  onCommitInput,
  canApplyToSelection,
  onApplyToSelection,
  onSetLocalFormat,
  onSetLocalStyle,
  onDismiss,
  onTooltipEnter,
  onTooltipLeave,
  onTooltipSuppress,
  onTooltipRelease,
}: FormulaBarOverlayProps) {
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [menuPanelKey, setMenuPanelKey] = useState<FormatLocalKey>("auto");
  const [formatMenuPosition, setFormatMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const formatButtonRef = useRef<HTMLButtonElement | null>(null);
  const formatMenuRef = useRef<HTMLDivElement | null>(null);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [styleMenuPosition, setStyleMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const styleButtonRef = useRef<HTMLButtonElement | null>(null);
  const styleMenuRef = useRef<HTMLDivElement | null>(null);
  const [draftInput, setDraftInput] = useState("");
  const [isComposingInput, setIsComposingInput] = useState(false);
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const isEditingInput = inputMode === "edit";

  useEffect(() => {
    if (areDisplayControlsEditable) return;
    setFormatMenuOpen(false);
    setStyleMenuOpen(false);
  }, [areDisplayControlsEditable]);

  const localFormatKey = formulaBarSnapshot?.formatLocalKey ?? "auto";
  const localFormatOptions = formulaBarSnapshot?.formatLocalOptions ?? null;
  const chipText = formulaBarSnapshot?.chip ?? "";
  const localStyle: StyleLocalView = formulaBarSnapshot?.styleLocal ?? {
    align: "auto",
    weight: "auto",
    color: "auto",
  };
  const hasCellFormatOverride = localFormatKey !== "auto";
  const hasCellStyleOverride =
    localStyle.align !== "auto" || localStyle.weight !== "auto" || localStyle.color !== "auto";
  const displayErrors = formulaBarSnapshot?.displayErrors ?? [];
  const formatErrors = displayErrors.filter((issue) => classifyDisplayMetadataIssue(issue) !== "style");
  const styleErrors = displayErrors.filter((issue) => classifyDisplayMetadataIssue(issue) !== "format");
  const hasFormatDisplayError = formatErrors.length > 0;
  const hasStyleDisplayError = styleErrors.length > 0;

  useEffect(() => {
    if (!formulaBarSnapshot) {
      setDraftInput("");
      setIsComposingInput(false);
      return;
    }
    setDraftInput(formulaBarSnapshot.inputText);
    setIsComposingInput(false);
  }, [formulaBarSnapshot?.primaryAddress, formulaBarSnapshot?.inputText]);

  useEffect(() => {
    setMenuPanelKey(localFormatKey);
  }, [localFormatKey, formulaBarSnapshot?.primaryAddress]);

  useEffect(() => {
    if (!isEditingInput) return;
    const input = sourceInputRef.current;
    if (!input) return;
    input.focus();
    const cursor = input.value.length;
    input.setSelectionRange(cursor, cursor);
    const raf = window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(cursor, cursor);
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [isEditingInput]);

  useEffect(() => {
    if (!formatMenuOpen) return;
    let rafId: number | null = null;
    const updatePosition = () => {
      const button = formatButtonRef.current;
      const menu = formatMenuRef.current;
      if (!button || !menu) return;
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const margin = 12;
      const preferredTop = buttonRect.top - menuRect.height - 8;
      const fallbackTop = buttonRect.bottom + 8;
      const unclampedTop = preferredTop >= margin ? preferredTop : fallbackTop;
      const top = Math.max(margin, Math.min(unclampedTop, window.innerHeight - menuRect.height - margin));
      const preferredLeft = buttonRect.right - menuRect.width;
      const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - menuRect.width - margin));
      setFormatMenuPosition((current) => {
        if (Math.abs(current.top - top) < 0.5 && Math.abs(current.left - left) < 0.5) {
          return current;
        }
        return { top, left };
      });
    };
    const schedule = () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updatePosition();
      });
    };
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [formatMenuOpen]);

  useEffect(() => {
    if (!styleMenuOpen) return;
    let rafId: number | null = null;
    const updatePosition = () => {
      const button = styleButtonRef.current;
      const menu = styleMenuRef.current;
      if (!button || !menu) return;
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const margin = 12;
      const preferredTop = buttonRect.top - menuRect.height - 8;
      const fallbackTop = buttonRect.bottom + 8;
      const unclampedTop = preferredTop >= margin ? preferredTop : fallbackTop;
      const top = Math.max(margin, Math.min(unclampedTop, window.innerHeight - menuRect.height - margin));
      const preferredLeft = buttonRect.right - menuRect.width;
      const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - menuRect.width - margin));
      setStyleMenuPosition((current) => {
        if (Math.abs(current.top - top) < 0.5 && Math.abs(current.left - left) < 0.5) {
          return current;
        }
        return { top, left };
      });
    };
    const schedule = () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updatePosition();
      });
    };
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [styleMenuOpen]);

  useEffect(() => {
    if (!formatMenuOpen && !styleMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(".formula-format-control") ||
        target?.closest(".formula-format-menu") ||
        target?.closest(".formula-style-control") ||
        target?.closest(".formula-style-menu")
      ) {
        return;
      }
      setFormatMenuOpen(false);
      setStyleMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFormatMenuOpen(false);
        setStyleMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [formatMenuOpen, styleMenuOpen]);

  useEffect(() => {
    if (mode !== "table" || phase !== "visible" || !formulaBarSnapshot) {
      setFormatMenuOpen(false);
      setStyleMenuOpen(false);
      setIsComposingInput(false);
    }
  }, [mode, phase, formulaBarSnapshot]);

  const beginEditInput = () => {
    if (!isInputEditable || !formulaBarSnapshot) return;
    setFormatMenuOpen(false);
    setStyleMenuOpen(false);
    onRequestEdit();
    selectionDebugLog("formula beginEditInput");
  };

  const cancelEditInput = () => {
    setDraftInput(formulaBarSnapshot?.inputText ?? "");
    setIsComposingInput(false);
    onCancelEdit();
  };

  const commitEditInput = () => {
    if (!formulaBarSnapshot) return;
    if (!isInputEditable) {
      setIsComposingInput(false);
      onCancelEdit();
      return;
    }
    if (isComposingInput) return;
    if (draftInput === formulaBarSnapshot.inputText) {
      setIsComposingInput(false);
      onCancelEdit();
      selectionDebugLog("formula commitEditInput noop");
      return;
    }
    selectionDebugLog("formula commitEditInput apply", { draftInput });
    onCommitInput(draftInput);
    setIsComposingInput(false);
  };

  const applyInputToSelection = () => {
    if (!formulaBarSnapshot || !isInputEditable || !canApplyToSelection || isComposingInput) return;
    selectionDebugLog("formula applyToSelection", { draftInput });
    onApplyToSelection(inputMode === "edit" ? draftInput : formulaBarSnapshot.inputText);
    setIsComposingInput(false);
  };

  if (mode !== "table" || phase === "hidden" || !formulaBarSnapshot) return null;

  return (
    <>
      <aside
        className={`formula-bar-shell formula-bar-shell--${phase}`}
        aria-live="polite"
        aria-hidden={formulaBarSnapshot ? undefined : true}
      >
        <div className="formula-bar">
          <div className="formula-meta-stack">
            <div className="formula-bar-meta">
              <span className="formula-address">{formulaBarSnapshot.primaryAddress}</span>
              <span className="formula-subaddress">{formulaBarSnapshot.secondaryAddress}</span>
            </div>
            <div className="formula-meta-lower">
              <span className="formula-chip-slot">
                <span className="formula-chip formula-chip--inline" title={chipText}>{chipText}</span>
              </span>
              <div className="formula-display-meta" aria-label="Display metadata">
                <div className="formula-format-control">
                  <button
                    ref={formatButtonRef}
                    className={[
                      "formula-format-button",
                      formatMenuOpen ? "active" : "",
                      hasFormatDisplayError ? "is-warning" : "",
                      !areDisplayControlsEditable ? "is-disabled" : "",
                    ].join(" ").trim()}
                    type="button"
                    aria-label="Format options"
                    aria-haspopup="menu"
                    aria-expanded={formatMenuOpen}
                    disabled={!areDisplayControlsEditable}
                    onMouseEnter={(event) => {
                      if (areDisplayControlsEditable && !formatMenuOpen) onTooltipEnter(hasFormatDisplayError ? getDisplayMetadataErrorLabel(locale, formatErrors[0]) : "Format options", event.currentTarget);
                    }}
                    onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                    onFocus={(event) => {
                      if (areDisplayControlsEditable && !formatMenuOpen) onTooltipEnter(hasFormatDisplayError ? getDisplayMetadataErrorLabel(locale, formatErrors[0]) : "Format options", event.currentTarget);
                    }}
                    onBlur={(event) => onTooltipRelease(event.currentTarget)}
                    onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                    onClick={() => {
                      if (!areDisplayControlsEditable) return;
                      setStyleMenuOpen(false);
                      setMenuPanelKey(localFormatKey);
                      setFormatMenuOpen((open) => !open);
                    }}
                  >
                    <span
                      className={[
                        "formula-format-icon",
                        hasCellFormatOverride ? "has-cell-format" : "",
                        hasFormatDisplayError ? "has-display-error" : "",
                      ].join(" ").trim()}
                    >
                      <FormatGlyph warning={hasFormatDisplayError} />
                    </span>
                  </button>
                </div>
                <div className="formula-style-control">
                  <button
                    ref={styleButtonRef}
                    className={[
                      "formula-style-button",
                      styleMenuOpen ? "active" : "",
                      hasStyleDisplayError ? "is-warning" : "",
                      !areDisplayControlsEditable ? "is-disabled" : "",
                    ].join(" ").trim()}
                    type="button"
                    aria-label="Style options"
                      aria-haspopup="menu"
                      aria-expanded={styleMenuOpen}
                      disabled={!areDisplayControlsEditable}
                      onMouseEnter={(event) => {
                      if (areDisplayControlsEditable && !styleMenuOpen) onTooltipEnter(hasStyleDisplayError ? getDisplayMetadataErrorLabel(locale, styleErrors[0]) : "Style options", event.currentTarget);
                    }}
                    onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                    onFocus={(event) => {
                      if (areDisplayControlsEditable && !styleMenuOpen) onTooltipEnter(hasStyleDisplayError ? getDisplayMetadataErrorLabel(locale, styleErrors[0]) : "Style options", event.currentTarget);
                    }}
                    onBlur={(event) => onTooltipRelease(event.currentTarget)}
                    onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                    onClick={() => {
                      if (!areDisplayControlsEditable) return;
                      setFormatMenuOpen(false);
                      setStyleMenuOpen((open) => !open);
                    }}
                  >
                    <span
                      className={[
                        "formula-style-icon",
                        hasCellStyleOverride ? "has-cell-style" : "",
                        hasStyleDisplayError ? "has-display-error" : "",
                      ].join(" ").trim()}
                    >
                      <StyleGlyph warning={hasStyleDisplayError} />
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="formula-source-row">
            {isEditingInput ? (
              <input
                ref={sourceInputRef}
                className="formula-source formula-source-input is-editing"
                value={draftInput}
                spellCheck={false}
                onChange={(event) => setDraftInput(event.target.value)}
                onCompositionStart={() => setIsComposingInput(true)}
                onCompositionEnd={() => setIsComposingInput(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.metaKey || event.ctrlKey) {
                      applyInputToSelection();
                      return;
                    }
                    commitEditInput();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelEditInput();
                  }
                }}
                aria-label="Edit selected cell input"
              />
            ) : (
              <button
                className={isInputEditable ? "formula-source formula-source-button is-editable is-read" : "formula-source formula-source-button is-read"}
                type="button"
                onClick={beginEditInput}
                onMouseEnter={(event) => {
                  if (isInputEditable) onTooltipEnter("Edit cell input", event.currentTarget);
                }}
                onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                onFocus={(event) => {
                  if (isInputEditable) onTooltipEnter("Edit cell input", event.currentTarget);
                }}
                onBlur={(event) => onTooltipRelease(event.currentTarget)}
                onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                aria-label={isInputEditable ? "Edit selected cell input" : "Cell input (read-only)"}
              >
                {formulaBarSnapshot.inputText.length > 0 ? formulaBarSnapshot.inputText : "(blank)"}
              </button>
            )}
            <button
              className="formula-dismiss-button"
              type="button"
              aria-label={isEditingInput ? "Apply cell input" : "Done"}
              onMouseEnter={(event) => onTooltipEnter(isEditingInput ? "Apply cell input" : "Done", event.currentTarget)}
              onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
              onFocus={(event) => onTooltipEnter(isEditingInput ? "Apply cell input" : "Done", event.currentTarget)}
              onBlur={(event) => onTooltipRelease(event.currentTarget)}
              onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
              onClick={() => {
                setFormatMenuOpen(false);
                setStyleMenuOpen(false);
                if (isEditingInput) {
                  commitEditInput();
                  return;
                }
                onDismiss();
              }}
            >
              <span className="formula-dismiss-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M5 10.4 8.4 13.7 15 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                </svg>
              </span>
            </button>
            {canApplyToSelection ? (
              <button
                className="formula-apply-selection-button"
                type="button"
                aria-label="Apply to selection"
                onMouseEnter={(event) => onTooltipEnter("Apply to selection", event.currentTarget)}
                onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                onFocus={(event) => onTooltipEnter("Apply to selection", event.currentTarget)}
                onBlur={(event) => onTooltipRelease(event.currentTarget)}
                onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                onClick={() => {
                  setFormatMenuOpen(false);
                  setStyleMenuOpen(false);
                  applyInputToSelection();
                }}
              >
                Apply to selection
              </button>
            ) : null}
          </div>
        </div>
      </aside>
      {createPortal(
        <div
          ref={formatMenuRef}
          className={[
            "formula-format-menu",
            formatMenuOpen ? "open" : "",
            localFormatKey !== "auto" ? "has-detail-panel" : "list-only",
          ].join(" ").trim()}
          role="menu"
          aria-hidden={!formatMenuOpen}
          style={{
            top: `${formatMenuPosition.top}px`,
            left: `${formatMenuPosition.left}px`,
          }}
        >
          {hasFormatDisplayError ? (
            <div className="formula-menu-error-banner formula-menu-error-banner--full" role="status" aria-live="polite">
                <span className="formula-menu-error-icon"><BannerWarningGlyph /></span>
                <span className="formula-menu-error-copy">
                <span className="formula-menu-error-title">{getDisplayMetadataErrorLabel(locale, formatErrors[0])}</span>
                <span className="formula-menu-error-detail">{formatDisplayMetadataErrorMessage(locale, formatErrors[0])}</span>
                {formatErrors.length > 1 ? (
                  <span className="formula-menu-error-more">{`+${formatErrors.length - 1} more`}</span>
                ) : null}
              </span>
            </div>
          ) : null}
          <FormatPreviewPanel
            localFormatKey={localFormatKey}
            localFormatOptions={localFormatOptions}
            inspectedKey={menuPanelKey}
            onInspectKey={setMenuPanelKey}
            onChange={areDisplayControlsEditable ? (key, options) => onSetLocalFormat(key, options) : undefined}
          />
        </div>,
        document.body,
      )}
      {createPortal(
        <div
          ref={styleMenuRef}
          className={styleMenuOpen ? "formula-style-menu open" : "formula-style-menu"}
          role="menu"
          aria-hidden={!styleMenuOpen}
          style={{
            top: `${styleMenuPosition.top}px`,
            left: `${styleMenuPosition.left}px`,
          }}
        >
          <>
            {hasStyleDisplayError ? (
              <div className="formula-menu-error-banner" role="status" aria-live="polite">
                <span className="formula-menu-error-icon"><BannerWarningGlyph /></span>
                <span className="formula-menu-error-copy">
                  <span className="formula-menu-error-title">{getDisplayMetadataErrorLabel(locale, styleErrors[0])}</span>
                  <span className="formula-menu-error-detail">{formatDisplayMetadataErrorMessage(locale, styleErrors[0])}</span>
                  {styleErrors.length > 1 ? (
                    <span className="formula-menu-error-more">{`+${styleErrors.length - 1} more`}</span>
                  ) : null}
                </span>
              </div>
            ) : null}
            <StylePreviewPanel
              styleLocal={localStyle}
              onChange={areDisplayControlsEditable ? onSetLocalStyle : undefined}
            />
          </>
        </div>,
        document.body,
      )}
    </>
  );
}
