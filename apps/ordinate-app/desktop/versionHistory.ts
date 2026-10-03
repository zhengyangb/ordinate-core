import { appKit } from "./nativeChrome.js";

/** First changed save and at most one autosave checkpoint every five minutes. */
export function createVersionHistory() {
  const checkpoints = new Map<string, number>();
  return {
    checkpoint(filename: string, force = false) {
      if (!appKit) return;
      const previous = checkpoints.get(filename);
      if (!force && previous !== undefined && Date.now() - previous < 300_000) return;
      appKit.checkpoint(filename);
      checkpoints.set(filename, Date.now());
    },
  };
}
