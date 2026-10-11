import { describe, expect, it } from "vitest";
import { turnTokenUsage, ZERO_TOKEN_COUNTS } from "./agentTokenUsage";

describe("assistant token usage", () => {
  it("reports a first turn without treating cached input as extra tokens", () => {
    expect(turnTokenUsage({ inputTokens: 120, cachedInputTokens: 40, outputTokens: 30, totalTokens: 150 }, ZERO_TOKEN_COUNTS)).toEqual({
      turn: { input: 120, cachedInput: 40, output: 30, total: 150 },
      session: { input: 120, output: 30, total: 150 },
    });
  });

  it("subtracts the previous thread total for a later turn", () => {
    expect(turnTokenUsage(
      { inputTokens: 290, cachedInputTokens: 140, outputTokens: 75, totalTokens: 365 },
      { inputTokens: 120, cachedInputTokens: 40, outputTokens: 30, totalTokens: 150 },
    ).turn).toEqual({ input: 170, cachedInput: 100, output: 45, total: 215 });
  });

  it("rejects malformed or decreasing counts", () => {
    expect(() => turnTokenUsage({ inputTokens: -1, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 }, ZERO_TOKEN_COUNTS)).toThrow("Invalid Codex token count");
    expect(() => turnTokenUsage(ZERO_TOKEN_COUNTS, { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, totalTokens: 1 })).toThrow("decreased");
  });
});
