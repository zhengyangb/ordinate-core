import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsContent } from "./SettingsDialog";
import { DEFAULT_PREFERENCES } from "./preferences";

describe("compact settings content", () => {
  const render = (dateTimeDisplay: "locale" | "iso", page: "appearance" | "datetime" = "datetime") => renderToStaticMarkup(<SettingsContent preferences={{ ...DEFAULT_PREFERENCES, dateTimeDisplay }} systemLocale="en-US" update={() => {}} onClose={() => {}} page={page} onPageChange={() => {}} />);
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
  });
});
