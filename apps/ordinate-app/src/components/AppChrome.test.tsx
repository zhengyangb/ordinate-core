import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppChrome from "./AppChrome";

// Floating menus are outside this title-layout test; do not mount their portals.
vi.mock("react-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-dom")>(), createPortal: () => null,
}));
beforeEach(() => vi.stubGlobal("document", { body: {} }));
afterEach(() => vi.unstubAllGlobals());

const noop = () => {};
const props: ComponentProps<typeof AppChrome> = {
  mode: "table", fileName: "Quarterly Report.ord", fileStatus: "Saved", fileStatusTone: "neutral",
  activeSheet: "Sheet", sheetNames: ["Sheet"], sheetHealthByName: {},
  setActiveSheet: noop, onInsertSheet: noop, onDeleteSheet: noop, onMoveSheet: noop, onRenameSheet: () => null,
  settingsOpen: false, onOpenSettings: noop,
  sheetSetupOpen: false, sheetSetupButtonRef: createRef(), onToggleSheetSetup: noop,
  canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, onUndo: noop, onRedo: noop,
  onNewFile: noop, onOpenFile: noop, onPrintFile: noop, onExportFile: noop, onSaveFile: noop, onSaveFileAs: noop, onEnterSourceMode: noop, onExitSourceMode: noop,
  exportMenuOpen: false, onExportMenuOpenChange: noop, onExportFormat: noop,
  onTooltipEnter: noop, onTooltipLeave: noop, onTooltipSuppress: noop, onTooltipRelease: noop,
  onTabMouseEnter: noop, onTabMouseLeave: noop,
};

describe("host-specific document title placement", () => {
  it("adds a browser menu without duplicating the native menu", () => {
    const markup = renderToStaticMarkup(<AppChrome {...props} />);
    const trigger = markup.match(/<button[^>]*aria-label="Ordinate menu"[^>]*>(.*?)<\/button>/)?.[1];
    expect(trigger).toBe('<span class="brand-name">ordinate</span>');
    expect(markup).toContain('aria-haspopup="menu" aria-expanded="false"');
    expect(renderToStaticMarkup(<AppChrome {...props} titlePlacement="native" />)).not.toContain('aria-label="Ordinate menu"');
  });
  it("limits the Mac shortcut to the online Mac experience", () => {
    const online = { showExamples: noop, openFromLink: noop, downloadMac: noop, isMac: true };
    const markup = renderToStaticMarkup(<AppChrome {...props} online={online} />);
    expect(markup).toContain('aria-label="Get Mac app"');
    expect(markup.indexOf('aria-label="Get Mac app"')).toBeGreaterThan(markup.indexOf('aria-label="Settings"'));
    expect(markup.indexOf('aria-label="Get Mac app"')).toBeLessThan(markup.indexOf('class="toolbar-actions"'));
    expect(renderToStaticMarkup(<AppChrome {...props} />)).not.toContain('aria-label="Get Mac app"');
    expect(renderToStaticMarkup(<AppChrome {...props} online={{ ...online, isMac: false }} />)).not.toContain('aria-label="Get Mac app"');
  });
  it("keeps the browser title and branding in their original toolbar position", () => {
    const markup = renderToStaticMarkup(<AppChrome {...props} />);
    expect(markup).not.toContain('class="desktop-titlebar"');
    expect(markup).not.toContain('class="app-title-icon"');
    expect(markup.indexOf('class="brand-lockup"')).toBeGreaterThan(markup.indexOf('class="topbar"'));
    expect(markup.indexOf('aria-label="Current file"')).toBeGreaterThan(markup.indexOf('class="topbar"'));
    expect(markup.indexOf('aria-label="Current file"')).toBeLessThan(markup.indexOf('aria-label="Toolbar"'));
    expect(markup).toContain('aria-label="Save file"');
    expect(markup).toContain('aria-label="Settings" aria-haspopup="dialog"');
    expect(markup.indexOf('aria-label="Settings"')).toBeGreaterThan(markup.indexOf('aria-label="Redo"'));
    expect(markup.indexOf('aria-label="Settings"')).toBeLessThan(markup.indexOf('class="toolbar-actions"'));
    expect(markup).toContain('class="toolbar-group toolbar-group--preferences"');
    expect(markup).not.toContain('settings-button active');
    expect(markup).not.toContain('theme-control');
    expect(markup).toContain('aria-label="Save as"');
    expect(markup).not.toContain('aria-label="New document"');
    expect(markup).toContain('aria-label="Export a copy"');
    expect(markup).not.toContain('aria-label="Import spreadsheet"');
  });

  it.each(["table", "source"] as const)("leaves the title to macOS and keeps only branding in %s mode", (mode) => {
    const markup = renderToStaticMarkup(<AppChrome {...props} titlePlacement="native" mode={mode} />);
    expect(markup).not.toContain('class="desktop-titlebar"');
    expect(markup).not.toContain('class="app-title-icon"');
    expect(markup).toContain('class="brand-lockup"');
    expect(markup).toContain('>ordinate</span>');
    expect(markup).not.toContain('Quarterly Report.ord');
    expect(markup).not.toContain('aria-label="File status"');
    expect(markup).not.toContain('Saved');
    expect(markup).toContain('aria-label="Open file"');
    expect(markup.indexOf('aria-label="Settings"')).toBeGreaterThan(markup.indexOf('aria-label="Redo"'));
    expect(markup.indexOf('aria-label="Settings"')).toBeLessThan(markup.indexOf('class="toolbar-actions"'));
    expect(markup).toContain('aria-label="New document"');
    expect(markup).toContain('aria-label="Export a copy"');
    expect(markup).not.toContain('aria-label="Import spreadsheet"');
    expect(markup).not.toContain('aria-label="Save file"');
    expect(markup).not.toContain('aria-label="Save as"');
  });

  it("keeps error status visible without duplicating a native filename", () => {
    const name = "Very long report name with <special> characters.ord";
    const markup = renderToStaticMarkup(<AppChrome {...props} titlePlacement="native" fileName={name} fileStatus="Conflict" fileStatusTone="error" />);
    expect(markup).not.toContain('Very long report name');
    expect(markup).toContain('title="Conflict"');
    expect(markup).toContain('file-error-indicator');
    expect(markup).toContain('aria-describedby="file-error-status"');
  });

  it.each(["Saved", "Saving...", "Draft saved", "Local draft", "Edited"])("keeps native toolbar markup identical for routine status: %s", (fileStatus) => {
    const baseline = renderToStaticMarkup(<AppChrome {...props} titlePlacement="native" />);
    const markup = renderToStaticMarkup(<AppChrome {...props} titlePlacement="native" fileStatus={fileStatus} fileStatusTone="warning" />);
    expect(markup).toBe(baseline);
  });

  it("keeps web filename but removes routine status text from the layout", () => {
    const markup = renderToStaticMarkup(<AppChrome {...props} fileStatus="Draft saved" />);
    expect(markup).toContain('>Quarterly Report.ord</span>');
    expect(markup).not.toContain('>Draft saved<');
    expect(markup).not.toContain('app-title-status');
  });
});
