import { describe, expect, it } from "vitest";
import { formatAgentTaskTime } from "./agentTaskTime";

describe("assistant task duration", () => {
  it.each([
    [0, "<1s"], [999, "<1s"], [1_000, "1s"],
    [59_999, "59s"], [60_000, "1m 0s"], [132_500, "2m 12s"],
    [3_661_000, "1h 1m 1s"],
  ])("formats %i milliseconds as %s", (milliseconds, expected) => {
    expect(formatAgentTaskTime(milliseconds)).toBe(expected);
  });

  it("rejects invalid durations", () => {
    expect(() => formatAgentTaskTime(-1)).toThrow();
    expect(() => formatAgentTaskTime(Number.NaN)).toThrow();
  });
});
