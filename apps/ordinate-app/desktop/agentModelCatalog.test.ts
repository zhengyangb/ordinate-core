import { describe, expect, it } from "vitest";
import { parseAgentModels } from "./agentModelCatalog";

describe("ChatGPT model catalog", () => {
  it("uses visible account models in server order", () => {
    expect(parseAgentModels({ models: [
      { slug: "fast", display_name: "Fast", visibility: "list" },
      { slug: "internal", display_name: "Internal", visibility: "hidden" },
      { slug: "deep", display_name: "Deep", visibility: "list" },
    ] })).toEqual([
      { slug: "fast", displayName: "Fast", isDefault: false },
      { slug: "deep", displayName: "Deep", isDefault: false },
    ]);
  });

  it("rejects a missing or malformed account list", () => {
    expect(() => parseAgentModels({ data: [] })).toThrow("invalid model list");
    expect(() => parseAgentModels({ models: [{ visibility: "list", slug: "fast" }] })).toThrow("incomplete model entry");
    expect(() => parseAgentModels({ models: [] })).toThrow("No models");
  });
});
