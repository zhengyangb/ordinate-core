import type { AgentTokenUsage } from "../src/agent/contracts.js";

export type TokenCounts = { inputTokens: number; outputTokens: number; cachedInputTokens: number; totalTokens: number };

function count(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid Codex token count: ${name}`);
  return value;
}

export function parseTokenCounts(value: TokenCounts): TokenCounts {
  return {
    inputTokens: count(value.inputTokens, "inputTokens"),
    outputTokens: count(value.outputTokens, "outputTokens"),
    cachedInputTokens: count(value.cachedInputTokens, "cachedInputTokens"),
    totalTokens: count(value.totalTokens, "totalTokens"),
  };
}

export function turnTokenUsage(total: TokenCounts, baseline: TokenCounts): AgentTokenUsage {
  const current = parseTokenCounts(total);
  const previous = parseTokenCounts(baseline);
  const difference = (key: keyof TokenCounts) => {
    const value = current[key] - previous[key];
    if (value < 0) throw new Error(`Codex token usage decreased: ${key}`);
    return value;
  };
  return {
    turn: { input: difference("inputTokens"), output: difference("outputTokens"), cachedInput: difference("cachedInputTokens"), total: difference("totalTokens") },
    session: { input: current.inputTokens, output: current.outputTokens, total: current.totalTokens },
  };
}

export const ZERO_TOKEN_COUNTS: TokenCounts = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 };
