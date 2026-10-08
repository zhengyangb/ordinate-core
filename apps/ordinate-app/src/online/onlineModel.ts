import type { FileSessionState } from "../store/fileSessionStore";
import { CANONICAL_BLANK_DOCUMENT } from "../platform/blankDocument";

export type Example = {
  featured?: boolean;
  id: string; file: string; title: string; category: string; description: string; sheets: number;
  preview: { headers: string[]; rows: string[][] };
};

/** Only the untouched default new document warrants automatic onboarding. */
export function shouldOfferExamples(state: Pick<FileSessionState, "file" | "documentDirty" | "untitledBaselineText">): boolean {
  return state.file === null && state.documentDirty === "clean" && state.untitledBaselineText === CANONICAL_BLANK_DOCUMENT;
}

export function exampleById(examples: Example[], id: string): Example {
  const example = examples.find(item => item.id === id);
  if (!example) throw new Error(`Unknown example: ${id}`);
  return example;
}

// Detection affects only the download shortcut, never editor capabilities.
export function isMacPlatform(platform: string, maxTouchPoints: number): boolean {
  return /mac/i.test(platform) && maxTouchPoints < 2;
}

export function macDownloadUrl(configured: string | undefined): string | null {
  if (!configured) return null; // Explicit unpublished release, not a broken link.
  const url = new URL(configured);
  if (url.protocol !== "https:") throw new Error("Mac download URL must use HTTPS");
  return url.href;
}

export function exampleAssetUrl(file: string, base: string, origin: string): URL {
  // Public requests come from the build's catalog, not arbitrary query-string URLs.
  if (!/^[a-zA-Z0-9-]+\.(ord|json)$/.test(file)) throw new Error("Invalid example asset name");
  return new URL(`${base}examples/${file}`, origin);
}
