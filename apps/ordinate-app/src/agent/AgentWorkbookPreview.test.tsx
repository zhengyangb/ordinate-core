import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentWorkbookPreview } from "./AgentWorkbookPreview";

describe("assistant working copy preview", () => {
  it("uses the editor's shared grid and header instead of a second table renderer", () => {
    const markup = renderToStaticMarkup(<AgentWorkbookPreview
      text={'# Sheet\n| Item | Value |\n| --- | --- |\n| Total | = @["Missing", _] |'}
      initialSheet="Sheet"
      displayCell={(value) => value?.kind === "error" ? "#ERROR" : ""}
      columnWidthMode="standard"
      locale="en-US"
      onTooltipEnter={() => {}}
      onTooltipLeave={() => {}}
      onTooltipSuppress={() => {}}
      onTooltipRelease={() => {}}
    />);

    expect(markup).toContain("agent-preview-grid");
    expect(markup).toContain("agent-preview-header");
    expect(markup).not.toContain("agent-preview-table");
    expect(markup).not.toContain("#ERROR");
    expect(markup).not.toContain("agent-preview-formula");
  });
});
