import { watch } from "node:fs";
import path from "node:path";
import type { StorageFailure } from "../src/platform/storage.js";

/** Watch the directory so editor-style atomic replacements don't detach us from the file. */
export function watchDocument(filename: string, notify: (error: StorageFailure | null) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const invalidate = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!closed) notify(null); }, 100);
  };
  const watcher = watch(path.dirname(filename), { persistent: false }, (_event, name) => {
    // Some platforms omit the filename. Re-read in that case, never assume no change.
    if (name === null || name === path.basename(filename)) invalidate();
  });
  watcher.on("error", (error) => {
    clearTimeout(timer);
    watcher.close();
    if (!closed) notify({ kind: "read_failed", message: `File monitoring stopped: ${error.message}` });
  });
  // Close the gap between opening a file and subscribing to changes.
  invalidate();
  return () => { closed = true; clearTimeout(timer); watcher.close(); };
}
