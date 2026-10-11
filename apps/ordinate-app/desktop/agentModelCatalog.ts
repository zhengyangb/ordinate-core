import type { AgentModel } from "../src/agent/contracts.js";

/** The ChatGPT account endpoint, not app-server's bundled catalog, is the picker source. */
export function parseAgentModels(value: unknown): AgentModel[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { models?: unknown }).models)) {
    throw new Error("ChatGPT returned an invalid model list.");
  }
  const models: AgentModel[] = [];
  const seen = new Set<string>();
  for (const entry of (value as { models: unknown[] }).models) {
    if (!entry || typeof entry !== "object") throw new Error("ChatGPT returned an invalid model entry.");
    const model = entry as Record<string, unknown>;
    if (model.visibility !== "list") continue;
    if (typeof model.slug !== "string" || !model.slug || typeof model.display_name !== "string" || !model.display_name) {
      throw new Error("ChatGPT returned an incomplete model entry.");
    }
    if (seen.has(model.slug)) throw new Error("ChatGPT returned duplicate models.");
    seen.add(model.slug);
    models.push({ slug: model.slug, displayName: model.display_name, isDefault: false });
  }
  if (!models.length) throw new Error("No models are available for this ChatGPT account.");
  return models;
}
