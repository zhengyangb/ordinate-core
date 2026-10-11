import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentProcessSummary } from "./AgentProcessSummary";

describe("assistant process summary", () => {
  it("offers a labeled process control alongside a completed turn's status", () => {
    const html = renderToStaticMarkup(<AgentProcessSummary onOpenLink={() => {}} group={{ firstIndex: 1, turnIndex: 0, statusIndex: 4, updates: [
      { index: 1, message: { role: "assistant", itemId: "a", text: "Read the workbook", phase: "commentary" } },
      { index: 2, message: { role: "assistant", itemId: "b", text: "Checked the totals", phase: "commentary" } },
    ] }} />);
    expect(html).toContain('aria-label="Show 2 process updates"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="agent-process-dot"');
    expect(html).toContain("View process");
    expect(html).toContain("Read the workbook");
    expect(html).toContain("Checked the totals");
  });
});
