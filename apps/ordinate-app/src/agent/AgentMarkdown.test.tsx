import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMarkdown } from "./AgentMarkdown";

describe("assistant Markdown", () => {
  const render = (text: string) => renderToStaticMarkup(<AgentMarkdown text={text} onOpenLink={() => {}} />);

  it("renders lists, inline code, and web links", () => {
    const html = render("- Use `SUM`\n- [Guide](https://example.com/guide)");
    expect(html).toContain("<ul>");
    expect(html).toContain("<code>SUM</code>");
    expect(html).toContain('href="https://example.com/guide"');
  });

  it("does not execute raw HTML or expose unsafe links", () => {
    const html = render("<script>alert(1)</script> [bad](javascript:alert(1)) ![remote](https://example.com/track.png)");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("href=\"javascript:");
    expect(html).not.toContain("<img");
  });

  it("does not offer scratch-workspace file citations as downloadable artifacts", () => {
    const html = render('Result: :codex-file-citation{path="/tmp/ordinate-agent-test/Workbook.ord" artifact_kind="workbook" purpose="output"}');
    expect(html).toContain("Temporary working copy; see the editor for the result");
    expect(html).not.toContain("codex-file-citation");
    expect(html).not.toContain("/tmp/ordinate-agent-test");
  });
});
