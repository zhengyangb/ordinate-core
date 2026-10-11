import type { AgentAttachment } from "./attachments.js";
import type { AgentDiagnosticLevel } from "./diagnosticLevel.js";
import type { AgentReasoningEffort } from "./reasoningEffort.js";

export type AgentConnection =
  | { state: "unavailable"; reason: string }
  | { state: "signed-out" }
  | { state: "signing-in" }
  | { state: "sign-in-error"; reason: string }
  | { state: "ready"; email: string | null };

export type AgentPlanStep = { step: string; status: "pending" | "inProgress" | "completed" };
export type AgentMessagePhase = "commentary" | "final_answer";
export type AgentTokenUsage = {
  turn: { input: number; output: number; cachedInput: number; total: number };
  session: { input: number; output: number; total: number };
};

export type AgentEvent =
  | { type: "connection"; connection: AgentConnection }
  | { type: "message-delta"; itemId: string; text: string; phase?: AgentMessagePhase }
  | { type: "activity"; itemId: string; label: string }
  | { type: "activity-finished"; itemId: string; status: "completed" | "failed" }
  | { type: "plan-updated"; steps: AgentPlanStep[] }
  | { type: "draft-summary"; sheets: Array<{ name: string; rowCount: number; columnCount: number }> | null }
  | { type: "draft-preview"; text: string }
  | { type: "token-usage"; sessionId: string; usage: AgentTokenUsage }
  | { type: "turn-started" }
  | { type: "turn-stopped" }
  | { type: "turn-finished"; error: string | null; proposal: AgentProposal | null };

export type AgentProposal = { baseText: string; text: string; validation: string; focusSheet?: string };
export type AgentModel = { slug: string; displayName: string; isDefault: boolean };

export type AgentBridge = {
  connection: () => Promise<AgentConnection>;
  login: () => Promise<void>;
  models: () => Promise<AgentModel[]>;
  send: (input: { sessionId: string; message: string; sourceText: string; activeSheet: string | null; untouchedDefault: boolean; model: string; attachments: AgentAttachment[]; diagnosticLevel: AgentDiagnosticLevel; reasoningEffort: AgentReasoningEffort }) => Promise<void>;
  stop: () => Promise<void>;
  openDiagnosticsFolder: () => Promise<void>;
  openLink: (url: string) => Promise<void>;
  startSystemDictation: () => Promise<void>;
  stopSystemDictation: () => Promise<void>;
  resolveProposal: () => Promise<void>;
  onEvent: (callback: (event: AgentEvent) => void) => () => void;
};

