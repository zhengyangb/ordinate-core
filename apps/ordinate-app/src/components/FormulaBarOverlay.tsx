import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ChromeVisibilityPhase, FormulaBarData } from "../types/ui";

type FormatMenuKey = "auto" | "integer" | "decimal" | "scientific" | "percent";

type FormatOption = {
  key: FormatMenuKey;
  label: string;
  icon: JSX.Element;
};

function classifyDisplayIssue(issue: string): "format" | "style" | "generic" {
  const normalized = issue.trim().toLowerCase();
  if (normalized.includes("style") || normalized.startsWith("unsupported_style_item")) {
    return "style";
  }
  if (
    normalized.includes("format")
    || normalized.includes("zero_padding")
    || normalized.includes("precision")
    || normalized.includes("grouping")
  ) {
    return "format";
  }
  return "generic";
}

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

function AlignLeftGlyph() {
  return (
    <MenuIcon>
      <path d="M4.8 6.2h10.2M4.8 9.4h7.6M4.8 12.6h10.2M4.8 15.8h6.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </MenuIcon>
  );
}

function AlignCenterGlyph() {
  return (
    <MenuIcon>
      <path d="M4.9 6.2h10.2M6.5 9.4h7M4.9 12.6h10.2M6.8 15.8h6.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </MenuIcon>
  );
}

function AlignRightGlyph() {
  return (
    <MenuIcon>
      <path d="M5 6.2h10.2M7.6 9.4h7.6M5 12.6h10.2M8.9 15.8H15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </MenuIcon>
  );
}

function AutoGlyph() {
  return (
    <MenuIcon>
      <path d="M10 4.6v2.2M10 13.2v2.2M4.6 10h2.2M13.2 10h2.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      <path d="m6.2 6.2 1.55 1.55m4.5 4.5 1.55 1.55m0-7.6-1.55 1.55m-4.5 4.5-1.55 1.55" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" />
    </MenuIcon>
  );
}

function IntegerGlyph() {
  return (
    <MenuIcon>
      <path d="M5.1 14.5h9.8M6.2 5.5h7.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M8.2 8.2h3.6M8.2 11h3.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" opacity="0.86" />
    </MenuIcon>
  );
}

function DecimalGlyph() {
  return (
    <MenuIcon>
      <path d="M4.8 10h10.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <circle cx="7.2" cy="13.6" r="1.1" fill="currentColor" />
      <circle cx="10.1" cy="13.6" r="1.1" fill="currentColor" opacity="0.82" />
      <circle cx="13" cy="13.6" r="1.1" fill="currentColor" opacity="0.62" />
    </MenuIcon>
  );
}

function ScientificGlyph() {
  return (
    <MenuIcon>
      <path d="M5.4 6.4h4.3M5.4 13.6h4.3M7.5 6.4v7.2M11.8 8.1h2.8M13.2 6.7v2.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="m11.9 13.2 3.3-3.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </MenuIcon>
  );
}

function PercentGlyph() {
  return (
    <MenuIcon>
      <path d="M5.4 14.6 14.6 5.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <circle cx="6.6" cy="6.8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13.4" cy="13.2" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
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

const FORMAT_OPTIONS: FormatOption[] = [
  { key: "auto", label: "Auto", icon: <AutoGlyph /> },
  { key: "integer", label: "Integer", icon: <IntegerGlyph /> },
  { key: "decimal", label: "Decimal", icon: <DecimalGlyph /> },
  { key: "scientific", label: "Scientific", icon: <ScientificGlyph /> },
  { key: "percent", label: "Percent", icon: <PercentGlyph /> },
];

type FormulaBarOverlayProps = {
  mode: "table" | "source";
  phase: ChromeVisibilityPhase;
  formulaBarData: FormulaBarData | null;
  formulaBarSnapshot: FormulaBarData | null;
  onTooltipEnter: (text: string, target: HTMLElement, delayMs?: number) => void;
  onTooltipLeave: () => void;
  onTooltipSuppress: (target: HTMLElement) => void;
  onTooltipRelease: (target: HTMLElement) => void;
};

export default function FormulaBarOverlay({
  mode,
  phase,
  formulaBarData,
  formulaBarSnapshot,
  onTooltipEnter,
  onTooltipLeave,
  onTooltipSuppress,
  onTooltipRelease,
}: FormulaBarOverlayProps) {
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [menuPanelKey, setMenuPanelKey] = useState<FormatMenuKey>("auto");
  const [formatMenuPosition, setFormatMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const formatButtonRef = useRef<HTMLButtonElement | null>(null);
  const formatMenuRef = useRef<HTMLDivElement | null>(null);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [styleMenuPosition, setStyleMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const styleButtonRef = useRef<HTMLButtonElement | null>(null);
  const styleMenuRef = useRef<HTMLDivElement | null>(null);

  const localFormatKey = formulaBarSnapshot?.formatLocalKey ?? "auto";
  const localFormatOptions = formulaBarSnapshot?.formatLocalOptions ?? null;
  const localStyle = formulaBarSnapshot?.styleLocal ?? {
    align: "auto",
    weight: "auto",
    color: "auto",
  };
  const hasCellFormatOverride = localFormatKey !== "auto";
  const hasCellStyleOverride =
    localStyle.align !== "auto" || localStyle.weight !== "auto" || localStyle.color !== "auto";
  const displayErrors = formulaBarSnapshot?.displayErrors ?? [];
  const formatErrors = displayErrors.filter((issue) => {
    const kind = classifyDisplayIssue(issue);
    return kind === "format" || kind === "generic";
  });
  const styleErrors = displayErrors.filter((issue) => {
    const kind = classifyDisplayIssue(issue);
    return kind === "style" || kind === "generic";
  });
  const hasFormatDisplayError = formatErrors.length > 0;
  const hasStyleDisplayError = styleErrors.length > 0;

  useEffect(() => {
    setMenuPanelKey(localFormatKey);
  }, [localFormatKey, formulaBarSnapshot?.primaryAddress]);

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
    }
  }, [mode, phase, formulaBarSnapshot]);

  if (mode !== "table" || phase === "hidden" || !formulaBarSnapshot) return null;

  const selectedOption = FORMAT_OPTIONS.find((option) => option.key === localFormatKey) ?? FORMAT_OPTIONS[0];
  const inspectedOption = FORMAT_OPTIONS.find((option) => option.key === menuPanelKey) ?? selectedOption;

  const formatFields: Array<{ label: string; value: string; isDefault: boolean }> = [
    {
      label: "Precision",
      value: localFormatOptions?.precision == null ? "Auto" : `${localFormatOptions.precision}`,
      isDefault: localFormatOptions?.precision == null,
    },
    {
      label: "Grouping",
      value: localFormatOptions?.grouping ? "On" : "Auto",
      isDefault: !localFormatOptions?.grouping,
    },
    {
      label: "Sign",
      value:
        localFormatOptions?.sign === "default" || localFormatOptions == null
          ? "Auto"
          : localFormatOptions.sign === "plus"
            ? "Plus"
            : "Parentheses",
      isDefault: localFormatOptions?.sign == null || localFormatOptions.sign === "default",
    },
    {
      label: "Width",
      value: localFormatOptions?.width == null ? "Auto" : `${localFormatOptions.width}`,
      isDefault: localFormatOptions?.width == null,
    },
    {
      label: "Zero Pad",
      value: localFormatOptions?.zeroPad ? "On" : "Auto",
      isDefault: !localFormatOptions?.zeroPad,
    },
  ];

  return (
    <>
      <aside
        className={`formula-bar-shell formula-bar-shell--${phase}`}
        aria-live="polite"
        aria-hidden={formulaBarData ? undefined : true}
      >
        <div className="formula-bar">
          <div className="formula-bar-meta">
            <span className="formula-chip fx">=</span>
            <span className="formula-address">{formulaBarSnapshot.primaryAddress}</span>
            <span className="formula-subaddress">{formulaBarSnapshot.secondaryAddress}</span>
            <span className="formula-chip">{formulaBarSnapshot.chip}</span>
            <span className="formula-value-preview">{formulaBarSnapshot.displayText || " "}</span>
          </div>
          <div className="formula-source">
            {formulaBarSnapshot.editableSourceText}
          </div>
          <div className="formula-display-meta" aria-label="Display metadata">
            <div className="formula-format-control">
              <button
                ref={formatButtonRef}
                className={[
                  "formula-format-button",
                  formatMenuOpen ? "active" : "",
                  hasFormatDisplayError ? "is-warning" : "",
                ].join(" ").trim()}
                type="button"
                aria-label="Format options"
                aria-haspopup="menu"
                aria-expanded={formatMenuOpen}
                onMouseEnter={(event) => {
                  if (!formatMenuOpen) onTooltipEnter(hasFormatDisplayError ? "Format metadata error" : "Format options", event.currentTarget);
                }}
                onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                onFocus={(event) => {
                  if (!formatMenuOpen) onTooltipEnter(hasFormatDisplayError ? "Format metadata error" : "Format options", event.currentTarget);
                }}
                onBlur={(event) => onTooltipRelease(event.currentTarget)}
                onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                onClick={() => {
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
                ].join(" ").trim()}
                type="button"
                aria-label="Style options"
                aria-haspopup="menu"
                aria-expanded={styleMenuOpen}
                onMouseEnter={(event) => {
                  if (!styleMenuOpen) onTooltipEnter(hasStyleDisplayError ? "Style metadata error" : "Style options", event.currentTarget);
                }}
                onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                onFocus={(event) => {
                  if (!styleMenuOpen) onTooltipEnter(hasStyleDisplayError ? "Style metadata error" : "Style options", event.currentTarget);
                }}
                onBlur={(event) => onTooltipRelease(event.currentTarget)}
                onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                onClick={() => {
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
            {formulaBarSnapshot.displaySource ? <span className="formula-meta-chip">{`source:${formulaBarSnapshot.displaySource}`}</span> : null}
          </div>
        </div>
      </aside>
      {createPortal(
        <div
          ref={formatMenuRef}
          className={formatMenuOpen ? "formula-format-menu open" : "formula-format-menu"}
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
                <span className="formula-menu-error-title">Format metadata error</span>
                <span className="formula-menu-error-detail">{formatErrors[0]}</span>
                {formatErrors.length > 1 ? (
                  <span className="formula-menu-error-more">{`+${formatErrors.length - 1} more`}</span>
                ) : null}
              </span>
            </div>
          ) : null}
          <div className="formula-format-menu-list">
            {FORMAT_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={[
                  "formula-format-option",
                  localFormatKey === option.key ? "is-selected" : "",
                  menuPanelKey === option.key ? "is-inspecting" : "",
                ].join(" ").trim()}
                type="button"
                role="menuitemradio"
                aria-checked={localFormatKey === option.key}
                onClick={() => setMenuPanelKey(option.key)}
              >
                <span className="formula-format-option-icon">{option.icon}</span>
                <span>{option.label}</span>
              </button>
            ))}
            {!hasCellFormatOverride ? (
              <div className="formula-format-menu-hint">
                Using inherited format from {formulaBarSnapshot.displaySource === "column" ? "the column" : "the sheet"}.
              </div>
            ) : null}
          </div>
          {hasCellFormatOverride ? (
            <div className="formula-format-menu-panel">
              <div className="formula-format-panel-title">{inspectedOption.label}</div>
              <div className="formula-format-field-list">
                {formatFields.map((field) => (
                  <div key={field.label} className="formula-format-field">
                    <span className="formula-format-field-label">{field.label}</span>
                    <span className={field.isDefault ? "formula-format-field-value is-default" : "formula-format-field-value"}>
                      {field.value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="formula-format-panel-footnote">Read-only preview</div>
            </div>
          ) : null}
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
          <div className="formula-style-menu-panel">
            {hasStyleDisplayError ? (
              <div className="formula-menu-error-banner" role="status" aria-live="polite">
                <span className="formula-menu-error-icon"><BannerWarningGlyph /></span>
                <span className="formula-menu-error-copy">
                  <span className="formula-menu-error-title">Style metadata error</span>
                  <span className="formula-menu-error-detail">{styleErrors[0]}</span>
                  {styleErrors.length > 1 ? (
                    <span className="formula-menu-error-more">{`+${styleErrors.length - 1} more`}</span>
                  ) : null}
                </span>
              </div>
            ) : null}
            <div className="formula-style-row">
              <span className="formula-style-row-label">Weight</span>
              <div className="formula-style-segmented" role="group" aria-label="Weight override">
                {[
                  { key: "auto", label: "Auto" },
                  { key: "bold", label: "Bold" },
                  { key: "normal", label: "Regular" },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={[
                      "formula-style-segment",
                      localStyle.weight === option.key ? "is-selected" : "",
                      option.key === "bold" ? "is-weight-bold" : "",
                      option.key === "normal" ? "is-weight-regular" : "",
                    ].join(" ").trim()}
                    aria-pressed={localStyle.weight === option.key}
                    onClick={(event) => event.preventDefault()}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="formula-style-row">
              <span className="formula-style-row-label">Align</span>
              <div className="formula-style-segmented" role="group" aria-label="Alignment override">
                {[
                  { key: "auto", label: "Auto", icon: null },
                  { key: "left", label: "Left", icon: <AlignLeftGlyph /> },
                  { key: "center", label: "Center", icon: <AlignCenterGlyph /> },
                  { key: "right", label: "Right", icon: <AlignRightGlyph /> },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={localStyle.align === option.key ? "formula-style-segment is-selected" : "formula-style-segment"}
                    aria-pressed={localStyle.align === option.key}
                    onClick={(event) => event.preventDefault()}
                  >
                    {option.icon ? <span className="formula-style-segment-icon">{option.icon}</span> : option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="formula-style-row">
              <span className="formula-style-row-label">Color</span>
              <div className="formula-style-segmented" role="group" aria-label="Color override">
                {[
                  { key: "auto", label: "Auto", tone: null },
                  { key: "red", label: "Red", tone: "red" },
                  { key: "green", label: "Green", tone: "green" },
                  { key: "blue", label: "Blue", tone: "blue" },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={localStyle.color === option.key ? "formula-style-segment is-selected" : "formula-style-segment"}
                    aria-pressed={localStyle.color === option.key}
                    onClick={(event) => event.preventDefault()}
                  >
                    {option.tone ? (
                      <>
                        <span className={`formula-style-swatch tone-${option.tone}`} />
                        <span>{option.label}</span>
                      </>
                    ) : (
                      option.label
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
