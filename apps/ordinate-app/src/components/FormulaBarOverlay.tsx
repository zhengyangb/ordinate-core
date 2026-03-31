import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ChromeVisibilityPhase, FormulaBarData } from "../types/ui";

type FormatMenuKey = "general" | "integer" | "decimal" | "scientific" | "percent";

type ParsedFormatMeta = {
  key: FormatMenuKey;
  sign: "default" | "plus" | "parentheses";
  zeroPad: boolean;
  width: number | null;
  grouping: boolean;
  precision: number | null;
  raw: string | null;
};

type LocalAlignState = "auto" | "left" | "center" | "right";
type LocalWeightState = "auto" | "bold" | "normal";
type LocalColorState = "auto" | "red" | "green" | "blue";

type ParsedStyleMeta = {
  align: LocalAlignState;
  weight: LocalWeightState;
  color: LocalColorState;
  raw: string | null;
};

type FormatOption = {
  key: FormatMenuKey;
  label: string;
  icon: JSX.Element;
};

function MenuIcon({ children }: { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function FormatGlyph() {
  return (
    <MenuIcon>
      <path d="M3.8 5.4h12.4M3.8 10h12.4M3.8 14.6h12.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <circle cx="7.1" cy="5.4" r="1.35" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12.7" cy="10" r="1.35" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="9.3" cy="14.6" r="1.35" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </MenuIcon>
  );
}

function StyleGlyph() {
  return (
    <MenuIcon>
      <path d="M6.2 14.1 9.8 5.8l3.9 8.3M7.3 11.7h5.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
      <path d="M5.6 16.2h8.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" opacity="0.92" />
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

function GeneralGlyph() {
  return (
    <MenuIcon>
      <circle cx="10" cy="10" r="5.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.4 10h5.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
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

const FORMAT_OPTIONS: FormatOption[] = [
  { key: "general", label: "General", icon: <GeneralGlyph /> },
  { key: "integer", label: "Integer", icon: <IntegerGlyph /> },
  { key: "decimal", label: "Decimal", icon: <DecimalGlyph /> },
  { key: "scientific", label: "Scientific", icon: <ScientificGlyph /> },
  { key: "percent", label: "Percent", icon: <PercentGlyph /> },
];

function parseFormatMeta(raw: string | null | undefined): ParsedFormatMeta {
  const text = (raw ?? "").trim();
  if (!text) {
    return {
      key: "general",
      sign: "default",
      zeroPad: false,
      width: null,
      grouping: false,
      precision: null,
      raw: null,
    };
  }

  let i = 0;
  let sign: ParsedFormatMeta["sign"] = "default";
  if (text.startsWith("()")) {
    sign = "parentheses";
    i += 2;
  } else if (text.startsWith("+")) {
    sign = "plus";
    i += 1;
  }

  let zeroPad = false;
  if (text[i] === "0") {
    zeroPad = true;
    i += 1;
  }

  let width: number | null = null;
  let widthStart = i;
  while (i < text.length && /\d/.test(text[i])) i += 1;
  if (i > widthStart) {
    width = Number(text.slice(widthStart, i));
  }

  let grouping = false;
  if (text[i] === ",") {
    grouping = true;
    i += 1;
  }

  let precision: number | null = null;
  if (text[i] === ".") {
    i += 1;
    const precisionStart = i;
    while (i < text.length && /\d/.test(text[i])) i += 1;
    if (i > precisionStart) {
      precision = Number(text.slice(precisionStart, i));
    }
  }

  let key: FormatMenuKey = "general";
  const typeToken = text[i];
  if (typeToken === "d") key = "integer";
  if (typeToken === "f") key = "decimal";
  if (typeToken === "e") key = "scientific";
  if (typeToken === "%") key = "percent";

  return {
    key,
    sign,
    zeroPad,
    width,
    grouping,
    precision,
    raw: text,
  };
}

function parseStyleMeta(raw: string | null | undefined): ParsedStyleMeta {
  const text = (raw ?? "").trim();
  if (!text) {
    return {
      align: "auto",
      weight: "auto",
      color: "auto",
      raw: null,
    };
  }

  let align: LocalAlignState = "auto";
  let weight: LocalWeightState = "auto";
  let color: LocalColorState = "auto";

  for (const token of text.split(",").map((part) => part.trim()).filter(Boolean)) {
    if (token === "<" || token === "align=left") align = "left";
    if (token === "^" || token === "align=center") align = "center";
    if (token === ">" || token === "align=right") align = "right";
    if (token === "bold" || token === "weight=bold") weight = "bold";
    if (token === "normal" || token === "weight=normal") weight = "normal";
    if (token === "red" || token === "color=red") color = "red";
    if (token === "green" || token === "color=green") color = "green";
    if (token === "blue" || token === "color=blue") color = "blue";
  }

  return {
    align,
    weight,
    color,
    raw: text,
  };
}

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
  const [menuPanelKey, setMenuPanelKey] = useState<FormatMenuKey>("general");
  const [formatMenuPosition, setFormatMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const formatButtonRef = useRef<HTMLButtonElement | null>(null);
  const formatMenuRef = useRef<HTMLDivElement | null>(null);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [styleMenuPosition, setStyleMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const styleButtonRef = useRef<HTMLButtonElement | null>(null);
  const styleMenuRef = useRef<HTMLDivElement | null>(null);

  const parsedFormat = useMemo(
    () => parseFormatMeta(formulaBarSnapshot?.displayFormatRaw),
    [formulaBarSnapshot?.displayFormatRaw],
  );
  const parsedCellFormat = useMemo(
    () => parseFormatMeta(formulaBarSnapshot?.cellFormatRaw),
    [formulaBarSnapshot?.cellFormatRaw],
  );
  const parsedCellStyle = useMemo(
    () => parseStyleMeta(formulaBarSnapshot?.cellStyleRaw),
    [formulaBarSnapshot?.cellStyleRaw],
  );
  const hasCellFormatOverride = Boolean(formulaBarSnapshot?.hasCellFormatOverride);
  const hasCellStyleOverride = Boolean(formulaBarSnapshot?.hasCellStyleOverride);

  useEffect(() => {
    setMenuPanelKey(hasCellFormatOverride ? parsedCellFormat.key : parsedFormat.key);
  }, [hasCellFormatOverride, parsedCellFormat.key, parsedFormat.key, formulaBarSnapshot?.primaryAddress]);

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

  const selectedOption = FORMAT_OPTIONS.find((option) => option.key === parsedFormat.key) ?? FORMAT_OPTIONS[0];
  const inspectedOption = FORMAT_OPTIONS.find((option) => option.key === menuPanelKey) ?? selectedOption;
  const overrideOption = FORMAT_OPTIONS.find((option) => option.key === parsedCellFormat.key) ?? FORMAT_OPTIONS[0];

  const formatFields: Array<{ label: string; value: string; isDefault: boolean }> = [
    {
      label: "Precision",
      value: parsedCellFormat.precision == null ? "Default" : `${parsedCellFormat.precision}`,
      isDefault: parsedCellFormat.precision == null,
    },
    {
      label: "Grouping",
      value: parsedCellFormat.grouping ? "On" : "Default",
      isDefault: !parsedCellFormat.grouping,
    },
    {
      label: "Sign",
      value:
        parsedCellFormat.sign === "default"
          ? "Default"
          : parsedCellFormat.sign === "plus"
            ? "Plus"
            : "Parentheses",
      isDefault: parsedCellFormat.sign === "default",
    },
    {
      label: "Width",
      value: parsedCellFormat.width == null ? "Default" : `${parsedCellFormat.width}`,
      isDefault: parsedCellFormat.width == null,
    },
    {
      label: "Zero Pad",
      value: parsedCellFormat.zeroPad ? "On" : "Default",
      isDefault: !parsedCellFormat.zeroPad,
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
                className={formatMenuOpen ? "formula-format-button active" : "formula-format-button"}
                type="button"
                aria-label="Format options"
                aria-haspopup="menu"
                aria-expanded={formatMenuOpen}
                onMouseEnter={(event) => {
                  if (!formatMenuOpen) onTooltipEnter("Format options", event.currentTarget);
                }}
                onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                onFocus={(event) => {
                  if (!formatMenuOpen) onTooltipEnter("Format options", event.currentTarget);
                }}
                onBlur={(event) => onTooltipRelease(event.currentTarget)}
                onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                onClick={() => {
                  setStyleMenuOpen(false);
                  setMenuPanelKey(hasCellFormatOverride ? parsedCellFormat.key : parsedFormat.key);
                  setFormatMenuOpen((open) => !open);
                }}
              >
                <span
                  className={hasCellFormatOverride ? "formula-format-icon has-cell-format" : "formula-format-icon"}
                >
                  <FormatGlyph />
                </span>
              </button>
            </div>
            <div className="formula-style-control">
              <button
                ref={styleButtonRef}
                className={styleMenuOpen ? "formula-style-button active" : "formula-style-button"}
                type="button"
                aria-label="Style options"
                aria-haspopup="menu"
                aria-expanded={styleMenuOpen}
                onMouseEnter={(event) => {
                  if (!styleMenuOpen) onTooltipEnter("Style options", event.currentTarget);
                }}
                onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                onFocus={(event) => {
                  if (!styleMenuOpen) onTooltipEnter("Style options", event.currentTarget);
                }}
                onBlur={(event) => onTooltipRelease(event.currentTarget)}
                onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                onClick={() => {
                  setFormatMenuOpen(false);
                  setStyleMenuOpen((open) => !open);
                }}
              >
                <span className={hasCellStyleOverride ? "formula-style-icon has-cell-style" : "formula-style-icon"}>
                  <StyleGlyph />
                </span>
              </button>
            </div>
            {formulaBarSnapshot.displaySource ? <span className="formula-meta-chip">{`source:${formulaBarSnapshot.displaySource}`}</span> : null}
            {formulaBarSnapshot.displayErrors?.length
              ? formulaBarSnapshot.displayErrors.map((issue, index) => (
                  <span
                    key={`display-error-${index}`}
                    className="formula-meta-chip is-warning"
                    onMouseEnter={(event) => onTooltipEnter(issue, event.currentTarget)}
                    onMouseLeave={onTooltipLeave}
                  >
                    {issue}
                  </span>
                ))
              : null}
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
          <div className="formula-format-menu-list">
            {FORMAT_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={[
                  "formula-format-option",
                  parsedFormat.key === option.key ? "is-selected" : "",
                  hasCellFormatOverride && parsedCellFormat.key === option.key ? "is-override" : "",
                  menuPanelKey === option.key ? "is-inspecting" : "",
                ].join(" ").trim()}
                type="button"
                role="menuitemradio"
                aria-checked={parsedFormat.key === option.key}
                onClick={() => setMenuPanelKey(option.key)}
              >
                <span className="formula-format-option-icon">{option.icon}</span>
                <span>{option.label}</span>
              </button>
            ))}
            {!hasCellFormatOverride ? (
              <div className="formula-format-menu-hint">
                Using inherited format from {formulaBarSnapshot.displaySource === "column" ? "column default" : "sheet default"}.
              </div>
            ) : null}
          </div>
          {hasCellFormatOverride ? (
            <div className="formula-format-menu-panel">
              <div className="formula-format-panel-title">{inspectedOption.label}</div>
              <div className="formula-format-summary">
                <div className="formula-format-summary-row">
                  <span className="formula-format-summary-label">Effective</span>
                  <span className="formula-format-summary-value">{selectedOption.label}</span>
                </div>
                <div className="formula-format-summary-row">
                  <span className="formula-format-summary-label">Cell Override</span>
                  <span className="formula-format-summary-value">{overrideOption.label}</span>
                </div>
              </div>
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
                      parsedCellStyle.weight === option.key ? "is-selected" : "",
                      option.key === "bold" ? "is-weight-bold" : "",
                      option.key === "normal" ? "is-weight-regular" : "",
                    ].join(" ").trim()}
                    aria-pressed={parsedCellStyle.weight === option.key}
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
                    className={parsedCellStyle.align === option.key ? "formula-style-segment is-selected" : "formula-style-segment"}
                    aria-pressed={parsedCellStyle.align === option.key}
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
                    className={parsedCellStyle.color === option.key ? "formula-style-segment is-selected" : "formula-style-segment"}
                    aria-pressed={parsedCellStyle.color === option.key}
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
