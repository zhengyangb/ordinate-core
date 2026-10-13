import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExampleDialog } from "./ExampleDialog";
import type { Example } from "./onlineModel";

vi.mock("../components/ModalShell", () => ({ default: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div> }));
const noop = () => {};
const examples: Example[] = [
  { id: "guide", file: "guide.ord", title: "Getting started", category: "Essentials", featured: true, description: "Change an input.", sheets: 6, preview: {headers: ["Input", "Value"], rows: [["Revenue", "12,000,000"]]} },
  { id: "report", file: "report.ord", title: "Company report", category: "Business", description: "Explore the model.", sheets: 4, preview: {headers: ["Item", "2026"], rows: [["Revenue", "12,000,000"]]} },
];

describe("examples dialog", () => {
  const render = (busy: string | null = null) => renderToStaticMarkup(<ExampleDialog examples={examples} busy={busy} error={null} onClose={noop} onOpen={noop} onBlank={noop} onOpenFile={noop} />);
  it("features the guide above models without a separate branding or Continue screen", () => {
    const html = render();
    expect(html.indexOf('aria-label="Open Getting started"')).toBeLessThan(html.indexOf('aria-label="Open Company report"'));
    expect(html).not.toMatch(/Continue editing|Online|>Essentials</);
    expect(html).toContain('aria-label="Close examples"');
    expect(html).toContain('aria-label="Example category"');
    expect(html).toContain('app-modal-action primary');
  });
  it("disables file and example actions during a single in-flight opening", () => {
    const html = render("guide");
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/online-featured[^>]*disabled/);
    expect(html).toMatch(/app-modal-action primary[^>]*disabled/);
    expect(html).toMatch(/app-modal-action secondary[^>]*disabled/);
  });
  it("keeps blank and open-file actions available while local examples load", () => {
    const html = renderToStaticMarkup(<ExampleDialog examples={[]} loading busy={null} error={null}
      onClose={noop} onOpen={noop} onBlank={noop} onOpenFile={noop} />);
    expect(html).toContain('role="status">Loading examples…');
    expect(html).toContain('Blank document</button>');
    expect(html).toContain('Open file…</button>');
  });
});
