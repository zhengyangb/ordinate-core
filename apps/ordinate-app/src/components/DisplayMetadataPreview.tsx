import { useEffect, useState, type ReactNode } from "react";

import type {
  FormatLocalKey,
  FormatLocalOptions,
  FormatPreviewContext,
  NumericFormatLocalKey,
  NumericFormatLocalOptions,
  StyleLocalView,
  TemporalFormatLocalKey,
  TemporalFormatLocalOptions,
} from "../types/ui";
import {
  defaultNumericFormatOptions,
  defaultTemporalFormatOptions,
  formatFamilyForKey,
  isNumericFormatKey,
  isTemporalFormatKey,
  resolveFormatPreview,
  TEMPORAL_FORMAT_PRESETS,
  temporalFormatErrorMessage,
  validateTemporalFormatPattern,
  type TemporalFormatPreset,
} from "../utils/formatDisplay";

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
  if (option === "temporal") {
    return (
      <MenuIcon>
        <path d="M5.2 6.4h9.6M6.5 4.2v3.1M13.5 4.2v3.1M5.4 6.2v9.2h9.2V6.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
        <path d="M7.5 10h2.4M7.5 12.7h4.9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" opacity="0.9" />
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
  { key: "temporal", label: "Date & Time" },
];

type FormatMenuEntry =
  | { kind: "section"; label: string }
  | { kind: "option"; key: FormatLocalKey; label: string };

const FORMAT_MENU_ENTRIES: FormatMenuEntry[] = [
  { kind: "option", key: "auto", label: "Auto" },
  { kind: "section", label: "Number" },
  { kind: "option", key: "integer", label: "Integer" },
  { kind: "option", key: "decimal", label: "Decimal" },
  { kind: "option", key: "scientific", label: "Scientific" },
  { kind: "option", key: "percent", label: "Percent" },
  { kind: "section", label: "Time" },
  { kind: "option", key: "temporal", label: "Date & Time" },
];

type FormatPreviewPanelProps = {
  localFormatKey: FormatLocalKey;
  localFormatOptions: FormatLocalOptions | null;
  effectiveFormatKey?: FormatLocalKey;
  effectiveFormatOptions?: FormatLocalOptions | null;
  inheritedFormatKey?: FormatLocalKey;
  inheritedFormatOptions?: FormatLocalOptions | null;
  formatSource?: "cell" | "row" | "column" | "default";
  inspectedKey: FormatLocalKey;
  previewContext?: FormatPreviewContext | null;
  onInspectKey?: (key: FormatLocalKey) => void;
  onChange?: (key: FormatLocalKey, options: FormatLocalOptions | null) => void;
  onRequestClose?: () => void;
};

type FormatMenuListProps = Pick<
  FormatPreviewPanelProps,
  "localFormatKey" | "localFormatOptions" | "inspectedKey" | "onInspectKey" | "onChange"
>;

type FormatDetailPanelProps = Pick<
  FormatPreviewPanelProps,
  | "localFormatKey"
  | "localFormatOptions"
  | "effectiveFormatKey"
  | "effectiveFormatOptions"
  | "inheritedFormatKey"
  | "inheritedFormatOptions"
  | "formatSource"
  | "inspectedKey"
  | "previewContext"
  | "onInspectKey"
  | "onChange"
  | "onRequestClose"
>;

const DEFAULT_PRECISION = 2;
const DEFAULT_WIDTH = 1;

function effectiveOptionsForFormatKey(key: FormatLocalKey, options: FormatLocalOptions | null): FormatLocalOptions | null {
  if (key === "auto") return null;
  if (isTemporalFormatKey(key)) {
    if (options?.kind === "temporal") return options;
    return defaultTemporalFormatOptions(key);
  }
  return {
    ...defaultNumericFormatOptions(key),
    ...(options?.kind === "numeric" ? options : {}),
    precision: key === "integer" ? null : options?.kind === "numeric" ? options.precision : defaultNumericFormatOptions(key).precision,
  };
}

function formatSupportsPrecision(key: FormatLocalKey): boolean {
  return key === "decimal" || key === "scientific" || key === "percent";
}

function formatSupportsGrouping(key: FormatLocalKey): boolean {
  return key === "integer" || key === "decimal" || key === "percent";
}

function switchFormatOptions(
  nextKey: Exclude<FormatLocalKey, "auto">,
  currentKey: FormatLocalKey,
  currentOptions: FormatLocalOptions | null,
): FormatLocalOptions {
  if (isTemporalFormatKey(nextKey)) {
    if (currentKey === nextKey && currentOptions?.kind === "temporal") return currentOptions;
    return defaultTemporalFormatOptions(nextKey);
  }
  const next = defaultNumericFormatOptions(nextKey);
  if (!currentOptions || currentOptions.kind !== "numeric" || currentKey === "auto") {
    return next;
  }
  next.sign = currentOptions.sign;
  next.padWidth = currentOptions.padWidth;
  if (formatSupportsGrouping(nextKey) && formatSupportsGrouping(currentKey)) {
    next.grouping = currentOptions.grouping;
  }
  if (formatSupportsPrecision(nextKey) && formatSupportsPrecision(currentKey)) {
    next.precision = currentOptions.precision;
  }
  return next;
}

function clampNumber(value: number, min: number): number {
  return Math.max(min, value);
}

export function FormatMenuList({
  localFormatKey,
  localFormatOptions,
  inspectedKey,
  onInspectKey,
  onChange,
}: FormatMenuListProps) {
  return (
    <div className="formula-format-menu-list">
      {FORMAT_MENU_ENTRIES.map((entry) => {
        if (entry.kind === "section") {
          return <div key={entry.label} className="formula-format-section-label">{entry.label}</div>;
        }
        return (
          <button
            key={entry.key}
            className={[
              "formula-format-option",
              localFormatKey === entry.key ? "is-selected" : "",
              inspectedKey === entry.key ? "is-inspecting" : "",
            ].join(" ").trim()}
            type="button"
            role="menuitemradio"
            aria-checked={localFormatKey === entry.key}
            onClick={() => {
              onInspectKey?.(entry.key);
              if (!onChange) return;
              if (entry.key === "auto") {
                onChange("auto", null);
                return;
              }
              onChange(entry.key, switchFormatOptions(entry.key, localFormatKey, localFormatOptions));
            }}
          >
            <span className="formula-format-option-icon"><FormatOptionGlyph option={entry.key} /></span>
            <span>{entry.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function FormatDetailPanel({
  localFormatKey,
  localFormatOptions,
  effectiveFormatKey = "auto",
  effectiveFormatOptions = null,
  inheritedFormatKey = "auto",
  inheritedFormatOptions = null,
  formatSource = "default",
  inspectedKey,
  previewContext,
  onInspectKey,
  onChange,
  onRequestClose,
}: FormatDetailPanelProps) {
  const activeKey = inspectedKey;
  const previewOptions =
    activeKey === "auto"
      ? null
      : activeKey === localFormatKey
        ? localFormatOptions
        : switchFormatOptions(activeKey, localFormatKey, localFormatOptions);
  const panelOptions = effectiveOptionsForFormatKey(activeKey, previewOptions);
  const panelFamily = formatFamilyForKey(activeKey);
  const hasInheritedAutoDetail = activeKey === "auto" && effectiveFormatKey !== "auto" && Boolean(effectiveFormatOptions);
  const hasOptionDetail = (activeKey !== "auto" && Boolean(panelOptions)) || hasInheritedAutoDetail;
  const isEditable = Boolean(onChange);
  const temporalOptions = panelOptions?.kind === "temporal" ? panelOptions : null;
  const [customPatternDraft, setCustomPatternDraft] = useState(temporalOptions?.pattern ?? "");

  useEffect(() => {
    if (temporalOptions) {
      setCustomPatternDraft(temporalOptions.pattern);
    }
  }, [activeKey, temporalOptions?.pattern]);

  const commitFormatChange = (nextKey: FormatLocalKey, nextOptions: FormatLocalOptions | null) => {
    onInspectKey?.(nextKey);
    onChange?.(nextKey, nextOptions);
  };

  const updateNumericOptions = (patch: Partial<NumericFormatLocalOptions>) => {
    if (activeKey === "auto") {
      throw new Error("format field edit requires a concrete format key");
    }
    if (!isNumericFormatKey(activeKey)) {
      throw new Error("numeric format field edit requires a numeric format key");
    }
    const base = effectiveOptionsForFormatKey(activeKey, panelOptions);
    if (!base || base.kind !== "numeric") {
      throw new Error("expected numeric format options");
    }
    const next: NumericFormatLocalOptions = {
      ...base,
      ...patch,
    };
    if (activeKey === "integer") {
      next.precision = null;
    }
    commitFormatChange(activeKey, next);
  };

  if (!hasOptionDetail) {
    return null;
  }

  return (
    <div className="formula-format-menu-panel">
      {activeKey === "auto" && effectiveFormatKey !== "auto" && effectiveFormatOptions ? (
        <AutoFormatPanel
          effectiveKey={effectiveFormatKey}
          effectiveOptions={effectiveFormatOptions}
          inheritedKey={inheritedFormatKey}
          inheritedOptions={inheritedFormatOptions}
          formatSource={formatSource}
          previewContext={previewContext}
        />
      ) : null}
      {panelFamily === "number" && isNumericFormatKey(activeKey) && panelOptions?.kind === "numeric" ? (
        <NumberFormatPanel
          activeKey={activeKey}
          options={panelOptions}
          preview={resolveFormatPreview(activeKey, panelOptions, previewContext)}
          isEditable={isEditable}
          updateOptions={updateNumericOptions}
        />
      ) : null}
      {panelFamily === "temporal" && activeKey === "temporal" && temporalOptions ? (
        <TemporalFormatPanel
          activeKey={activeKey}
          options={temporalOptions}
          presets={TEMPORAL_FORMAT_PRESETS}
          customPatternDraft={customPatternDraft}
          setCustomPatternDraft={setCustomPatternDraft}
          previewContext={previewContext}
          isEditable={isEditable}
          onCommit={commitFormatChange}
          onRequestClose={onRequestClose}
        />
      ) : null}
    </div>
  );
}

export function FormatPreviewPanel(props: FormatPreviewPanelProps) {
  const hasDetailPanel = props.inspectedKey !== "auto";
  return (
    <div className={[
      "formula-format-layout",
      hasDetailPanel ? "has-detail-panel" : "list-only",
    ].join(" ")}>
      <FormatMenuList
        localFormatKey={props.localFormatKey}
        localFormatOptions={props.localFormatOptions}
        inspectedKey={props.inspectedKey}
        onInspectKey={props.onInspectKey}
        onChange={props.onChange}
      />
      <FormatDetailPanel {...props} />
    </div>
  );
}

function AutoFormatPanel({
  effectiveKey,
  effectiveOptions,
  inheritedKey,
  inheritedOptions,
  formatSource,
  previewContext,
}: {
  effectiveKey: Exclude<FormatLocalKey, "auto">;
  effectiveOptions: FormatLocalOptions;
  inheritedKey: FormatLocalKey;
  inheritedOptions: FormatLocalOptions | null;
  formatSource: "cell" | "row" | "column" | "default";
  previewContext: FormatPreviewContext | null | undefined;
}) {
  const inheritedConcreteKey = inheritedKey === "auto" ? null : inheritedKey;
  const inheritedFormatName = inheritedConcreteKey ? formatLabelForKey(inheritedConcreteKey) : null;
  const effectiveName = formatLabelForKey(effectiveKey);
  const preview = resolveFormatPreview(effectiveKey, effectiveOptions, previewContext);
  const sourceLabel = formatSourceLabel(formatSource);
  const valueKind = formatPreviewValueKind(previewContext);
  return (
    <>
      <div className="formula-format-panel-head">
        <span className="formula-format-panel-title">Auto</span>
        <span className="formula-format-current">{preview.sourceLabel}: <strong>{preview.text}</strong></span>
      </div>
      <div className="formula-format-auto-panel">
        <div className="formula-format-auto-row">
          <span className="formula-format-auto-label">Source</span>
          <span className="formula-format-auto-value">{sourceLabel}</span>
        </div>
        <div className="formula-format-auto-row">
          <span className="formula-format-auto-label">Format</span>
          <span className="formula-format-auto-value">{effectiveName}</span>
        </div>
        {effectiveOptions.kind === "temporal" ? (
          <div className="formula-format-auto-row">
            <span className="formula-format-auto-label">Pattern</span>
            <span className="formula-format-auto-value is-mono">{effectiveOptions.pattern}</span>
          </div>
        ) : null}
        {effectiveOptions.kind === "numeric" ? (
          <div className="formula-format-auto-row">
            <span className="formula-format-auto-label">Options</span>
            <span className="formula-format-auto-value">{numericFormatSummary(effectiveOptions)}</span>
          </div>
        ) : null}
        <div className="formula-format-auto-row">
          <span className="formula-format-auto-label">Value</span>
          <span className="formula-format-auto-value">{valueKind}</span>
        </div>
        {inheritedFormatName && inheritedOptions ? (
          <div className="formula-format-auto-note">
            This cell has no local format override. Auto is using the inherited {inheritedFormatName} format.
          </div>
        ) : null}
      </div>
    </>
  );
}

function NumberFormatPanel({
  activeKey,
  options,
  preview,
  isEditable,
  updateOptions,
}: {
  activeKey: NumericFormatLocalKey;
  options: NumericFormatLocalOptions;
  preview: ReturnType<typeof resolveFormatPreview>;
  isEditable: boolean;
  updateOptions: (patch: Partial<NumericFormatLocalOptions>) => void;
}) {
  return (
    <>
      <div className="formula-format-panel-head">
        <span className="formula-format-panel-title">{formatLabelForKey(activeKey)}</span>
        <span className="formula-format-current">{preview.sourceLabel}: <strong>{preview.text}</strong></span>
      </div>
            <div className="formula-format-field-list">
              {formatSupportsPrecision(activeKey) ? (
                <div className="formula-style-row">
                  <span className="formula-style-row-label">Precision</span>
                  <div className="formula-format-stepper">
                    <button
                      type="button"
                      className={options.precision == null ? "formula-style-segment is-selected" : "formula-style-segment"}
                      aria-pressed={options.precision == null}
                      disabled={!isEditable}
                      onClick={() => updateOptions({ precision: null })}
                    >
                      Auto
                    </button>
                    <button
                      type="button"
                      className="formula-format-stepper-button"
                      disabled={!isEditable || options.precision == null}
                      onClick={() => updateOptions({ precision: clampNumber((options.precision ?? DEFAULT_PRECISION) - 1, 0) })}
                    >
                      −
                    </button>
                    <span className={options.precision == null ? "formula-format-stepper-value is-default" : "formula-format-stepper-value"}>
                      {options.precision == null ? "Auto" : options.precision}
                    </span>
                    <button
                      type="button"
                      className="formula-format-stepper-button"
                      disabled={!isEditable}
                      onClick={() => updateOptions({ precision: options.precision == null ? DEFAULT_PRECISION : options.precision + 1 })}
                    >
                      +
                    </button>
                  </div>
                </div>
              ) : null}
              {formatSupportsGrouping(activeKey) ? (
                <div className="formula-style-row">
                  <span className="formula-style-row-label">Grouping</span>
                  <div className="formula-style-segmented" role="group" aria-label="Grouping option">
                    {[
                      { key: "auto", label: "Auto" },
                      { key: "on", label: "On" },
                    ].map((option) => {
                      const selected = option.key === "auto" ? !options.grouping : options.grouping;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          className={selected ? "formula-style-segment is-selected" : "formula-style-segment"}
                          aria-pressed={selected}
                          disabled={!isEditable}
                          onClick={() => updateOptions({ grouping: option.key === "on" })}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="formula-style-row">
                <span className="formula-style-row-label">Sign</span>
                <div className="formula-style-segmented" role="group" aria-label="Sign option">
                  {[
                    { key: "default", label: "Auto" },
                    { key: "plus", label: "Plus" },
                    { key: "parentheses", label: "Paren" },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={options.sign === option.key ? "formula-style-segment is-selected" : "formula-style-segment"}
                      aria-pressed={options.sign === option.key}
                      disabled={!isEditable}
                      onClick={() => updateOptions({ sign: option.key as NumericFormatLocalOptions["sign"] })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="formula-style-row">
                <span className="formula-style-row-label">Width</span>
                <div className="formula-format-stepper">
                  <button
                    type="button"
                    className={options.padWidth == null ? "formula-style-segment is-selected" : "formula-style-segment"}
                    aria-pressed={options.padWidth == null}
                    disabled={!isEditable}
                    onClick={() => updateOptions({ padWidth: null })}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    className="formula-format-stepper-button"
                    disabled={!isEditable || options.padWidth == null || options.padWidth <= 0}
                    onClick={() => updateOptions({ padWidth: clampNumber((options.padWidth ?? DEFAULT_WIDTH) - 1, 0) })}
                  >
                    −
                  </button>
                  <span className={options.padWidth == null ? "formula-format-stepper-value is-default" : "formula-format-stepper-value"}>
                    {options.padWidth == null ? "Auto" : options.padWidth}
                  </span>
                  <button
                    type="button"
                    className="formula-format-stepper-button"
                    disabled={!isEditable}
                    onClick={() => updateOptions({ padWidth: options.padWidth == null ? DEFAULT_WIDTH : options.padWidth + 1 })}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
    </>
  );
}

function TemporalFormatPanel({
  activeKey,
  options,
  presets,
  customPatternDraft,
  setCustomPatternDraft,
  previewContext,
  isEditable,
  onCommit,
  onRequestClose,
}: {
  activeKey: TemporalFormatLocalKey;
  options: TemporalFormatLocalOptions;
  presets: TemporalFormatPreset[];
  customPatternDraft: string;
  setCustomPatternDraft: (value: string) => void;
  previewContext: FormatPreviewContext | null | undefined;
  isEditable: boolean;
  onCommit: (key: FormatLocalKey, options: FormatLocalOptions | null) => void;
  onRequestClose?: () => void;
}) {
  const headerPreview = resolveFormatPreview(activeKey, options, previewContext);
  const validation = customPatternDraft.trim().length > 0
    ? validateTemporalFormatPattern(customPatternDraft.trim())
    : { issue: { code: "empty_format_spec", context: {} } };
  const customIssue = "issue" in validation ? validation.issue : null;
  const customPreview = customIssue
    ? null
    : resolveFormatPreview(activeKey, { kind: "temporal", pattern: customPatternDraft.trim(), preset: null }, previewContext);

  const commitCustomPattern = (value: string): boolean => {
    const nextPattern = value.trim();
    if (!isEditable || nextPattern.length === 0) return false;
    const parsed = validateTemporalFormatPattern(nextPattern);
    if ("issue" in parsed) return false;
    const preset = TEMPORAL_FORMAT_PRESETS.find((candidate) => candidate.pattern === nextPattern);
    onCommit(activeKey, { kind: "temporal", pattern: nextPattern, preset: preset?.id ?? null });
    return true;
  };

  const updateCustomPattern = (value: string) => {
    setCustomPatternDraft(value);
    commitCustomPattern(value);
  };

  return (
    <>
      <div className="formula-format-panel-head">
        <span className="formula-format-panel-title">{formatLabelForKey(activeKey)}</span>
        <span className="formula-format-current">{headerPreview.sourceLabel}: <strong>{headerPreview.text}</strong></span>
      </div>
      <div className="formula-format-preset-grid" role="group" aria-label={`${formatLabelForKey(activeKey)} presets`}>
        {(["dateTime", "duration"] as const).map((group) => {
          const groupPresets = presets.filter((preset) => preset.group === group);
          if (groupPresets.length === 0) return null;
          return (
            <div key={group} className="formula-format-preset-section">
              <div className="formula-format-preset-section-label">{group === "dateTime" ? "Date and time" : "Duration"}</div>
              <div className="formula-format-preset-section-grid">
                {groupPresets.map((preset) => {
                  const presetOptions: TemporalFormatLocalOptions = { kind: "temporal", pattern: preset.pattern, preset: preset.id };
                  const preview = resolveFormatPreview(activeKey, presetOptions, previewContext);
                  const selected = options.pattern === preset.pattern;
                  const isWide = preset.id === "date-time" || preset.id === "date-time-seconds";
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={[
                        "formula-format-preset",
                        selected ? "is-selected" : "",
                        isWide ? "is-wide" : "",
                      ].join(" ").trim()}
                      aria-pressed={selected}
                      disabled={!isEditable}
                      onClick={() => {
                        setCustomPatternDraft(preset.pattern);
                        onCommit(activeKey, presetOptions);
                      }}
                    >
                      <span className="formula-format-preset-preview">{preview.text}</span>
                      <span className="formula-format-preset-pattern">{preset.pattern}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="formula-format-custom">
        <label className="formula-format-custom-label" htmlFor={`format-custom-${activeKey}`}>
          Custom format
        </label>
        <input
          id={`format-custom-${activeKey}`}
          className={customIssue ? "formula-format-custom-input has-error" : "formula-format-custom-input"}
          value={customPatternDraft}
          disabled={!isEditable}
          spellCheck={false}
          onChange={(event) => updateCustomPattern(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.stopPropagation();
            if (commitCustomPattern(customPatternDraft)) {
              onRequestClose?.();
            }
          }}
        />
        <div className={customIssue ? "formula-format-custom-preview has-error" : "formula-format-custom-preview"}>
          {customIssue ? temporalFormatErrorMessage(customIssue) : `Preview: ${customPreview?.text ?? ""}`}
        </div>
      </div>
    </>
  );
}

function formatLabelForKey(key: Exclude<FormatLocalKey, "auto">): string {
  if (key === "temporal") return "Date & Time";
  return FORMAT_LOCAL_OPTIONS.find((option) => option.key === key)?.label ?? key;
}

function formatSourceLabel(source: "cell" | "row" | "column" | "default"): string {
  if (source === "column") return "Column format";
  if (source === "row") return "Row format";
  if (source === "cell") return "Cell format";
  return "Default format";
}

function formatPreviewValueKind(context: FormatPreviewContext | null | undefined): string {
  const kind = context?.value?.kind;
  if (!kind) return "Sample";
  if (kind === "datetime") return "Datetime";
  if (kind === "duration") return "Duration";
  if (kind === "date") return "Date";
  if (kind === "time") return "Time";
  if (kind === "number") return "Number";
  if (kind === "boolean") return "Boolean";
  if (kind === "blank" || kind === "null") return "Blank";
  if (kind === "string") return "Text";
  return kind;
}

function numericFormatSummary(options: NumericFormatLocalOptions): string {
  const parts = [
    options.grouping ? "grouped" : "ungrouped",
    options.precision == null ? "auto precision" : `${options.precision} decimals`,
    options.sign === "default" ? "default sign" : options.sign === "plus" ? "plus sign" : "parentheses",
  ];
  if (options.padWidth != null) parts.push(`width ${options.padWidth}`);
  return parts.join(" · ");
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
              disabled={!onChange}
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
              disabled={!onChange}
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
              disabled={!onChange}
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
