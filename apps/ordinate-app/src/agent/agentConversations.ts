import type { AgentMessagePhase, AgentTokenUsage } from "./contracts";

export type AgentChatMessage =
  | { role: "user"; text: string; attachments: string[] }
  | { role: "status"; text: string }
  | { role: "assistant"; itemId: string; text: string; phase?: AgentMessagePhase };

export type AgentConversation = {
  id: string;
  messages: AgentChatMessage[];
  draft: string;
  attachments: File[];
  tokenUsage: AgentTokenUsage | null;
  hasStartedTurn: boolean;
};

export type AgentProcessGroup = {
  firstIndex: number;
  turnIndex: number;
  statusIndex: number | null;
  updates: Array<{ index: number; message: Extract<AgentChatMessage, { role: "assistant" }> }>;
};

/** Attach a turn's process updates to its completion status, leaving active updates visible. */
export function groupAgentProcessUpdates(messages: readonly AgentChatMessage[]): Map<number, AgentProcessGroup> {
  const groups = new Map<number, AgentProcessGroup>();
  let turnIndex = -1;
  let currentGroup: AgentProcessGroup | null = null;
  messages.forEach((message, index) => {
    if (message.role === "user") { turnIndex = index; currentGroup = null; return; }
    if (message.role === "status") {
      if (currentGroup) currentGroup.statusIndex = index;
      currentGroup = null;
      return;
    }
    if (message.role !== "assistant" || message.phase !== "commentary") return;
    if (turnIndex < 0) throw new Error("Assistant process update has no user turn.");
    if (!currentGroup) {
      currentGroup = { firstIndex: index, turnIndex, statusIndex: null, updates: [] };
      groups.set(index, currentGroup);
    }
    currentGroup.updates.push({ index, message });
  });
  return groups;
}

export function createAgentConversation(): AgentConversation {
  return { id: crypto.randomUUID(), messages: [], draft: "", attachments: [], tokenUsage: null, hasStartedTurn: false };
}

export function titleForAgentMessage(message: string, attachments: readonly string[]): string {
  const firstLine = message.split(/\r?\n/, 1)[0].trim().replace(/\s+/g, " ");
  const title = firstLine || attachments.join(", ") || "Untitled conversation";
  return title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title;
}

export function titleForAgentConversation(conversation: AgentConversation): string {
  const first = conversation.messages.find(message => message.role === "user");
  return first?.role === "user" ? titleForAgentMessage(first.text, first.attachments) : "Untitled conversation";
}

export function updateAgentConversation(
  conversations: readonly AgentConversation[], id: string, update: (conversation: AgentConversation) => AgentConversation,
): AgentConversation[] {
  let found = false;
  const next = conversations.map(conversation => {
    if (conversation.id !== id) return conversation;
    found = true;
    return update(conversation);
  });
  if (!found) throw new Error(`Unknown assistant conversation: ${id}`);
  return next;
}
