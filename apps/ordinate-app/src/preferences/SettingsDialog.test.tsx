import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsContent } from "./SettingsDialog";
import { DEFAULT_PREFERENCES } from "./preferences";

describe("compact settings content", () => {
  const render = (dateTimeDisplay: "locale" | "iso", page: "appearance" | "datetime" | "advanced" = "datetime", desktop = false) => renderToStaticMarkup(<SettingsContent preferences={{ ...DEFAULT_PREFERENCES, dateTimeDisplay }} systemLocale="en-US" update={() => {}} onClose={() => {}} page={page} onPageChange={() => {}} showAgentDiagnostics={desktop} onOpenAgentLogs={async () => {}} />);
  it("uses keyboard-accessible shared choices, live examples and no language control", () => {
    const html = render("locale");
    expect(html).toContain('role="radiogroup" aria-label="Date and time display"');
    expect(html).toContain('role="radio" aria-checked="true" tabindex="0">Regional');
    expect(html).toContain('role="radio" aria-checked="true" tabindex="0">System');
    expect(html).toContain('class="settings-system-region"');
    expect(html).not.toContain('aria-label="Region"');
    expect(html).toContain('6/7/2026');
    expect(html).not.toMatch(/checkbox|Language/);
  });
  it("retains the automatic system region row in both display modes", () => {
    const html = render("iso");
    expect(html).toContain('class="settings-system-region"');
    expect(html).toContain('Automatic');
    expect(html).not.toContain('aria-label="Region"');
    expect(html).toContain('2026-06-07');
    expect(html).toContain('PT27H30M');
  });
  it("connects the two vertical tabs to panels and hides the inactive page", () => {
    const html = render("locale", "appearance");
    expect(html).toContain('role="tablist" aria-label="Settings categories" aria-orientation="vertical"');
    expect(html).toMatch(/aria-selected="true" tabindex="0">Appearance/);
    expect(html).toMatch(/aria-selected="false" tabindex="-1">Date &amp; time/);
    expect(html).toMatch(/role="tabpanel"[^>]+panel-datetime[^>]+hidden=""/);
    expect(html).toContain('aria-label="Current appearance preview"');
    expect(html).toContain('role="radiogroup" aria-label="Automatic table width"');
    expect(html).toContain('role="radio" aria-checked="true" tabindex="0">Standard');
    expect(html).toContain('role="radio" aria-checked="false" tabindex="-1">Wide');
  });
  it("keeps one dialog frame across settings pages", () => {
    for (const page of ["appearance", "datetime", "advanced"] as const) {
      expect(render("locale", page, true)).toContain('class="app-modal-content settings-content"');
    }
  });
  it("offers opt-in diagnostics only in desktop advanced settings", () => {
    expect(render("locale")).not.toContain("Assistant diagnostics level");
    const html = render("locale", "advanced", true);
    expect(html).not.toContain("Assistant reasoning effort");
    expect(html).toContain('role="radiogroup" aria-label="Assistant diagnostics level"');
    expect(html).toContain("Trace adds command types and working-copy line changes");
    expect(html).toContain("Debug also records commands and tool and CLI output");
    expect(html).toContain("Show logs…");
    expect(html).toContain('role="radio" aria-checked="true" tabindex="0">Off');
  });
});
