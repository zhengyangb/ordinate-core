import { useId, useState } from "react";
import ModalShell from "../components/ModalShell";
import { SegmentedChoice } from "../components/SegmentedChoice";
import { createCellDisplayFormatter } from "./temporalDisplay";
import type { Preferences } from "./preferences";
import "./settings.css";

const PAGES = [
  { value: "appearance", label: "Appearance" },
  { value: "datetime", label: "Date & time" },
  { value: "advanced", label: "Advanced" },
] as const;
type SettingsPage = typeof PAGES[number]["value"];
type SettingsProps = {
  preferences: Preferences; systemLocale: string; update: (patch: Partial<Preferences>) => void; onClose: () => void; titleId?: string;
  showAgentDiagnostics: boolean; onOpenAgentLogs: () => Promise<void>;
};

export function SettingsContent({ preferences, systemLocale, update, onClose, titleId, page, onPageChange, showAgentDiagnostics, onOpenAgentLogs }: SettingsProps & {
  page: SettingsPage; onPageChange: (page: SettingsPage) => void;
}) {
  const id = useId();
  const [logsError, setLogsError] = useState("");
  const pages = showAgentDiagnostics ? PAGES : PAGES.slice(0, 2);
  const format = createCellDisplayFormatter(preferences.dateTimeDisplay, systemLocale);
  return <div className="app-modal-content settings-content">
    <aside className="settings-sidebar">
      <h2 id={titleId}>Settings</h2>
      <div className="settings-tabs" role="tablist" aria-label="Settings categories" aria-orientation="vertical">
        {pages.map((item, index) => <button key={item.value} type="button" role="tab" id={`${id}-tab-${item.value}`}
          aria-controls={`${id}-panel-${item.value}`} aria-selected={page === item.value} tabIndex={page === item.value ? 0 : -1}
          onClick={() => onPageChange(item.value)} onKeyDown={event => {
            if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? pages.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + pages.length) % pages.length;
            onPageChange(pages[next].value);
            event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button")[next].focus();
          }}>{item.label}</button>)}
      </div>
    </aside>
    <div className="settings-main">
      <div className="settings-panels">
        <section className="settings-panel" role="tabpanel" id={`${id}-panel-appearance`} aria-labelledby={`${id}-tab-appearance`} hidden={page !== "appearance"} tabIndex={0}>
          <header className="settings-page-heading"><h3>Appearance</h3><p>Choose how Ordinate looks.</p></header>
          <div className="settings-field">
            <h4>Theme</h4>
            <SegmentedChoice label="Appearance" value={preferences.appearance}
              options={[{ value: "auto", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={appearance => update({ appearance })} />
          </div>
          <div className="settings-field">
            <h4>Table width</h4>
            <SegmentedChoice label="Automatic table width" value={preferences.columnWidthMode}
              options={[{ value: "standard", label: "Standard" }, { value: "wide", label: "Wide" }]} onChange={columnWidthMode => update({ columnWidthMode })} />
            <p className="settings-caption">Standard keeps columns compact and wraps long headings. Wide gives headings and text more room.</p>
          </div>
          <div className="settings-appearance-preview" role="img" aria-label="Current appearance preview">
            <div className="settings-preview-chrome" aria-hidden="true"><span>ordinate</span><span className="settings-preview-tools"><i /><i /><i /></span></div>
            <div className="settings-preview-sheet" aria-hidden="true">
              <table><thead><tr><th>Item</th><th>2025</th><th>2026</th></tr></thead><tbody>
                <tr><th>Revenue</th><td>120</td><td>140</td></tr>
                <tr><th>Cost</th><td>80</td><td>95</td></tr>
                <tr><th>Total</th><td>40</td><td>45</td></tr>
              </tbody></table>
            </div>
          </div>
        </section>
        <section className="settings-panel" role="tabpanel" id={`${id}-panel-datetime`} aria-labelledby={`${id}-tab-datetime`} hidden={page !== "datetime"} tabIndex={0}>
          <header className="settings-page-heading"><h3>Date & time</h3><p>Choose how automatic formats are displayed.</p></header>
          <div className="settings-field">
            <h4>Display format</h4>
            <SegmentedChoice label="Date and time display" value={preferences.dateTimeDisplay}
              options={[{ value: "locale", label: "Regional" }, { value: "iso", label: "ISO" }]} onChange={dateTimeDisplay => update({ dateTimeDisplay })} />
          </div>
          <div className="settings-system-region"><span>Region</span><span>Automatic <span className="settings-region-detail">· System</span></span></div>
          <dl className="settings-preview" aria-label="Display preview">
            {[
              ["Date", format({ kind: "date", value: "2026-06-07", isOffsetQualified: false }, null)],
              ["Time", format({ kind: "time", value: "14:35:27", isOffsetQualified: false }, null)],
              ["Duration", format({ kind: "duration", value: "PT27H30M" }, null)],
            ].map(([label, text]) => <div key={label}><dt>{label}</dt><dd title={text}>{text}</dd></div>)}
          </dl>
          <p className="settings-caption">Custom formats stay unchanged.</p>
        </section>
        {showAgentDiagnostics && <section className="settings-panel" role="tabpanel" id={`${id}-panel-advanced`} aria-labelledby={`${id}-tab-advanced`} hidden={page !== "advanced"} tabIndex={0}>
          <header className="settings-page-heading"><h3>Advanced</h3><p>Assistant diagnostics.</p></header>
          <div className="settings-field">
            <h4>Assistant diagnostics</h4>
            <SegmentedChoice label="Assistant diagnostics level" value={preferences.agentDiagnosticLevel}
              options={[{ value: "off", label: "Off" }, { value: "timing", label: "Timing" }, { value: "trace", label: "Trace" }, { value: "debug", label: "Debug" }]}
              onChange={agentDiagnosticLevel => update({ agentDiagnosticLevel })} />
            <p className="settings-caption">Timing records item durations and tokens. Trace adds command types and working-copy line changes. Debug also records commands and tool and CLI output (up to 32 KB each), which may contain workbook text, paths, or secrets.</p>
            <p className="settings-caption">Logs stay on this Mac; only the last five requests are kept. Chat messages and reasoning text are not saved.</p>
            {preferences.agentDiagnosticLevel === "debug" && <p className="settings-diagnostic-warning">Debug is sensitive. Review the log before sharing it.</p>}
          </div>
          <button type="button" className="settings-open-logs" onClick={() => { setLogsError(""); void onOpenAgentLogs().catch(error => setLogsError(String(error))); }}>Show logs…</button>
          {logsError && <p role="alert" className="settings-caption">{logsError}</p>}
        </section>}
      </div>
      <footer className="app-modal-actions settings-actions"><button type="button" className="app-modal-action primary" onClick={onClose}>Done</button></footer>
    </div>
  </div>;
}

export function SettingsDialog({ open, onClose, ...props }: { open: boolean } & SettingsProps) {
  const titleId = useId();
  const [page, setPage] = useState<SettingsPage>("appearance");
  return <ModalShell open={open} titleId={titleId} onClose={onClose} className="settings-dialog">
    <SettingsContent {...props} titleId={titleId} onClose={onClose} page={page} onPageChange={setPage} />
  </ModalShell>;
}
