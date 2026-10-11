export const AGENT_REASONING_EFFORTS = ["low", "medium", "high"] as const;

export type AgentReasoningEffort = typeof AGENT_REASONING_EFFORTS[number];

export function isAgentReasoningEffort(value: unknown): value is AgentReasoningEffort {
  return AGENT_REASONING_EFFORTS.includes(value as AgentReasoningEffort);
}
