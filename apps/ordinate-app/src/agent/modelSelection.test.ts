import { describe, expect, it } from "vitest";
import { preferredAgentModel } from "./modelSelection";
import type { AgentModel } from "./contracts";

const models: AgentModel[] = [
  { slug: "gpt-6-sol", displayName: "GPT-6 Sol", isDefault: true },
  { slug: "gpt-6-luna", displayName: "GPT-6 Luna", isDefault: false },
];

describe("assistant model preference", () => {
  it("starts with the account default even when Luna is available", () => {
    expect(preferredAgentModel(models, null)).toBe("gpt-6-sol");
  });
  it("preserves a deliberate choice", () => {
    expect(preferredAgentModel(models, "gpt-6-luna")).toBe("gpt-6-luna");
  });
  it("uses the newest available Sol when the account has no default", () => {
    const withoutDefault: AgentModel[] = [
      { slug: "gpt-6-sol", displayName: "GPT-6 Sol", isDefault: false },
      { slug: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", isDefault: false },
      { slug: "gpt-6-luna", displayName: "GPT-6 Luna", isDefault: false },
      { slug: "gpt-6.1-sol", displayName: "GPT-6.1 Sol", isDefault: false },
    ];
    expect(preferredAgentModel(withoutDefault, null)).toBe("gpt-6.1-sol");
    expect(preferredAgentModel(withoutDefault, "unavailable")).toBe("gpt-6.1-sol");
  });
  it("rejects an empty catalog", () => {
    expect(() => preferredAgentModel([], null)).toThrow("empty catalog");
  });
  it("rejects a catalog without a default or Sol model", () => {
    expect(() => preferredAgentModel([{ slug: "gpt-6-luna", displayName: "GPT-6 Luna", isDefault: false }], null))
      .toThrow("No default or Sol model");
  });
});
