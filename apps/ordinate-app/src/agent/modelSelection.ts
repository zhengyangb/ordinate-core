import type { AgentModel } from "./contracts";

/** Preserve a user's choice, then use the account default or the newest available Sol. */
export function preferredAgentModel(models: readonly AgentModel[], selected: string | null): string {
  if (!models.length) throw new Error("Cannot choose an assistant model from an empty catalog.");
  if (selected && models.some(model => model.slug === selected)) return selected;
  const accountDefault = models.find(model => model.isDefault);
  if (accountDefault) return accountDefault.slug;

  let latestSol: { slug: string; major: number; minor: number } | null = null;
  for (const model of models) {
    const version = /^gpt-(\d+)(?:\.(\d+))?-sol$/.exec(model.slug);
    if (!version) continue;
    const major = Number(version[1]);
    const minor = Number(version[2] ?? 0);
    if (!latestSol || major > latestSol.major || (major === latestSol.major && minor > latestSol.minor)) {
      latestSol = { slug: model.slug, major, minor };
    }
  }
  if (!latestSol) throw new Error("No default or Sol model is available for this account.");
  return latestSol.slug;
}
