export const AGENT_DIAGNOSTIC_LEVELS = ["off", "timing", "trace", "debug"] as const;

export type AgentDiagnosticLevel = typeof AGENT_DIAGNOSTIC_LEVELS[number];

export function isAgentDiagnosticLevel(value: unknown): value is AgentDiagnosticLevel {
  return AGENT_DIAGNOSTIC_LEVELS.includes(value as AgentDiagnosticLevel);
}
