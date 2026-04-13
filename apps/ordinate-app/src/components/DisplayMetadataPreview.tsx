import type { ReactNode } from "react";

import type { FormatLocalKey, FormatLocalOptions, StyleLocalView } from "../types/ui";

function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function FormatOptionGlyph({ option }: { option: FormatLocalKey }) {
  if (option === "auto") {
    return (
      <MenuIcon>
        <path d="M10 4.6v2.2M10 13.2v2.2M4.6 10h2.2M13.2 10h2.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
        <path d="m6.2 6.2 1.55 1.55m4.5 4.5 1.55 1.55m0-7.6-1.55 1.55m-4.5 4.5-1.55 1.55" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
        <circle cx="10" cy="10" r="1.6" fill="currentColor" />
      </MenuIcon>
    );
  }
  if (option === "integer") {
    return (
      <MenuIcon>
        <path d="M5.1 14.5h9.8M6.2 5.5h7.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
        <path d="M8.2 8.2h3.6M8.2 11h3.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" opacity="0.86" />
      </MenuIcon>
    );
  }
  if (option === "decimal") {
    return (
      <MenuIcon>
        <path d="M4.8 10h10.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
        <circle cx="7.2" cy="13.6" r="1.1" fill="currentColor" />
        <circle cx="10.1" cy="13.6" r="1.1" fill="currentColor" opacity="0.82" />
        <circle cx="13" cy="13.6" r="1.1" fill="currentColor" opacity="0.62" />
      </MenuIcon>
    );
  }
  if (option === "scientific") {
    return (
      <MenuIcon>
        <path d="M5.4 6.4h4.3M5.4 13.6h4.3M7.5 6.4v7.2M11.8 8.1h2.8M13.2 6.7v2.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
        <path d="m11.9 13.2 3.3-3.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      </MenuIcon>
    );
  }
  return (
    <MenuIcon>
      <path d="M5.4 14.6 14.6 5.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <circle cx="6.6" cy="6.8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13.4" cy="13.2" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </MenuIcon>
  );
}

export function AlignGlyph({ align }: { align: "left" | "center" | "right" }) {
  if (align === "left") {
    return (
      <MenuIcon>
        <path d="M4.8 6.2h10.2M4.8 9.4h7.6M4.8 12.6h10.2M4.8 15.8h6.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      </MenuIcon>
    );
  }
  if (align === "center") {
    return (
      <MenuIcon>
        <path d="M4.9 6.2h10.2M6.5 9.4h7M4.9 12.6h10.2M6.8 15.8h6.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      </MenuIcon>
    );
  }
  return (
    <MenuIcon>
      <path d="M5 6.2h10.2M7.6 9.4h7.6M5 12.6h10.2M8.9 15.8H15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </MenuIcon>
  );
}

export const FORMAT_LOCAL_OPTIONS: Array<{ key: FormatLocalKey; label: string }> = [
  { key: "auto", label: "Auto" },
  { key: "integer", label: "Integer" },
  { key: "decimal", label: "Decimal" },
  { key: "scientific", label: "Scientific" },
  { key: "percent", label: "Percent" },
];

type FormatPreviewPanelProps = {
  localFormatKey: FormatLocalKey;
  localFormatOptions: FormatLocalOptions | null;
  inspectedKey: FormatLocalKey;
  onInspectKey?: (key: FormatLocalKey) => void;
};

export function FormatPreviewPanel({
  localFormatKey,
  localFormatOptions,
  inspectedKey,
  onInspectKey,
}: FormatPreviewPanelProps) {
  const hasOverride = localFormatKey !== "auto";
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
      <div className="formula-format-menu-list">
        {FORMAT_LOCAL_OPTIONS.map((option) => (
          <button
            key={option.key}
            className={[
              "formula-format-option",
              localFormatKey === option.key ? "is-selected" : "",
              inspectedKey === option.key ? "is-inspecting" : "",
            ].join(" ").trim()}
            type="button"
            role="menuitemradio"
            aria-checked={localFormatKey === option.key}
            onClick={() => onInspectKey?.(option.key)}
          >
            <span className="formula-format-option-icon"><FormatOptionGlyph option={option.key} /></span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>
      {hasOverride ? (
        <div className="formula-format-menu-panel">
          <div className="formula-format-panel-title">
            {FORMAT_LOCAL_OPTIONS.find((option) => option.key === inspectedKey)?.label ?? "Auto"}
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
    </>
  );
}

type StylePreviewPanelProps = {
  styleLocal: StyleLocalView;
  onChange?: <Axis extends keyof StyleLocalView>(axis: Axis, value: StyleLocalView[Axis]) => void;
};

export function StylePreviewPanel({ styleLocal, onChange }: StylePreviewPanelProps) {
  return (
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
                styleLocal.weight === option.key ? "is-selected" : "",
                option.key === "bold" ? "is-weight-bold" : "",
                option.key === "normal" ? "is-weight-regular" : "",
              ].join(" ").trim()}
              aria-pressed={styleLocal.weight === option.key}
              onClick={(event) => {
                event.preventDefault();
                onChange?.("weight", option.key as StyleLocalView["weight"]);
              }}
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
            { key: "left", label: "Left", icon: <AlignGlyph align="left" /> },
            { key: "center", label: "Center", icon: <AlignGlyph align="center" /> },
            { key: "right", label: "Right", icon: <AlignGlyph align="right" /> },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              className={styleLocal.align === option.key ? "formula-style-segment is-selected" : "formula-style-segment"}
              aria-pressed={styleLocal.align === option.key}
              onClick={(event) => {
                event.preventDefault();
                onChange?.("align", option.key as StyleLocalView["align"]);
              }}
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
              className={[
                "formula-style-segment",
                styleLocal.color === option.key ? "is-selected" : "",
                option.tone ? `is-tone-${option.tone}` : "",
              ].join(" ").trim()}
              aria-pressed={styleLocal.color === option.key}
              onClick={(event) => {
                event.preventDefault();
                onChange?.("color", option.key as StyleLocalView["color"]);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
