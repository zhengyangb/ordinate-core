import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSessionMenu } from "./AgentSessionMenu";
import { createAgentConversation } from "./agentConversations";

describe("assistant session menu", () => {
  const conversation = createAgentConversation();
  const base = { open: true, onOpenChange: () => {}, conversations: [conversation], activeSessionId: conversation.id,
    onSelect: () => {}, onNew: () => {}, disabled: false, usagePending: false, hasStartedTurn: true, accountEmail: null };

  it("places token details in the session menu without a collapsible section", () => {
    const html = renderToStaticMarkup(<AgentSessionMenu {...base} debugMode={false} tokenUsage={{
      turn: { input: 90, output: 10, cachedInput: 20, total: 100 }, session: { input: 180, output: 20, total: 200 },
    }} />);
    expect(html).toContain("Token usage");
    expect(html).toContain("Cached input 20");
    expect(html).toContain("Conversation total 200");
    expect(html).not.toContain("<details");
  });

  it("keeps simulator-only diagnostics out of the visible chrome", () => {
    const html = renderToStaticMarkup(<AgentSessionMenu {...base} debugMode tokenUsage={null} />);
    expect(html).toContain("Token usage");
    expect(html).toContain("Not measured in preview");
    expect(html).not.toContain("Local UI simulator");
    expect(html).toContain("New conversation");
  });
});
