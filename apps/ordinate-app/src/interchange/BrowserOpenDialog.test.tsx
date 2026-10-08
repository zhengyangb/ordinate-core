import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BrowserOpenDialog } from "./BrowserOpenDialog";

vi.mock("../components/ModalShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const noop = () => {};
const props = { onOpenDocument: noop, onImport: noop, onClose: noop };

describe("browser Open choices", () => {
  it("offers local Open and Import without a dead link action in Raw", () => {
    const markup = renderToStaticMarkup(<BrowserOpenDialog {...props} />);
    expect(markup).toContain("Open Ordinate document…");
    expect(markup).toContain("Import spreadsheet…");
    expect(markup).not.toContain("Open from link");
    expect(markup.match(/<button /g)).toHaveLength(3);
  });
  it("places Online's link choice alongside local Open, before Import", () => {
    const markup = renderToStaticMarkup(<BrowserOpenDialog {...props} onOpenLink={noop} />);
    expect(markup.indexOf("Open from link…")).toBeGreaterThan(markup.indexOf("Open Ordinate document…"));
    expect(markup.indexOf("Open from link…")).toBeLessThan(markup.indexOf("Import spreadsheet…"));
    expect(markup).toContain(".ord · from a URL");
    expect(markup.match(/<button /g)).toHaveLength(4);
  });
});
