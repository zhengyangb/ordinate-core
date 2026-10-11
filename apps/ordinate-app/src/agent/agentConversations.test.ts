import { describe, expect, it } from "vitest";
import { createAgentConversation, groupAgentProcessUpdates, titleForAgentMessage, updateAgentConversation } from "./agentConversations";

describe("assistant conversations", () => {
  it("keeps each conversation's messages and draft isolated", () => {
    const first = createAgentConversation(), second = createAgentConversation();
    const updated = updateAgentConversation([first, second], first.id, conversation => ({
      ...conversation, draft: "First draft", messages: [{ role: "user", text: "First", attachments: [] }],
    }));
    expect(updated[0].draft).toBe("First draft");
    expect(updated[0].messages).toHaveLength(1);
    expect(updated[1]).toEqual(second);
    expect(() => updateAgentConversation(updated, "missing", conversation => conversation)).toThrow("Unknown assistant conversation");
  });

  it("names a conversation from the first line or its attachments", () => {
    expect(titleForAgentMessage("  Build a cash flow  \nThen check it", [])).toBe("Build a cash flow");
    expect(titleForAgentMessage("", ["statement.pdf"])).toBe("statement.pdf");
    expect(titleForAgentMessage("", [])).toBe("Untitled conversation");
    expect(titleForAgentMessage("x".repeat(60), [])).toHaveLength(40);
  });

  it("groups process updates by user turn while leaving final answers separate", () => {
    const groups = groupAgentProcessUpdates([
      { role: "user", text: "Build a table", attachments: [] },
      { role: "assistant", itemId: "p1", text: "Reading", phase: "commentary" },
      { role: "assistant", itemId: "p2", text: "Checking", phase: "commentary" },
      { role: "assistant", itemId: "a1", text: "Done", phase: "final_answer" },
      { role: "status", text: "Workbook updated" },
      { role: "user", text: "Add a column", attachments: [] },
      { role: "assistant", itemId: "p3", text: "Editing", phase: "commentary" },
      { role: "assistant", itemId: "a2", text: "Added", phase: "final_answer" },
    ]);
    expect([...groups.keys()]).toEqual([1, 6]);
    expect(groups.get(1)?.updates.map(update => update.message.text)).toEqual(["Reading", "Checking"]);
    expect(groups.get(1)?.statusIndex).toBe(4);
    expect(groups.get(6)?.turnIndex).toBe(5);
    expect(groups.get(6)?.statusIndex).toBeNull();
  });
});
