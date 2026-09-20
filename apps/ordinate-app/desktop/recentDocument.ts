import { open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** Main-process-only session bookmark. No arbitrary renderer path is persisted. */
export function createRecentDocument(directory: string) {
  const location = path.join(directory, "last-document.json");
  let previous: string | null = null;
  let queue = Promise.resolve();
  return {
    async read(): Promise<string | null> {
      let raw: string;
      try { raw = await readFile(location, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
      const record = JSON.parse(raw) as { path: unknown };
      if (typeof record.path !== "string" || !path.isAbsolute(record.path)) throw new Error("Invalid document session bookmark");
      previous = record.path;
      return previous;
    },
    remember(filename: string): Promise<void> {
      if (!path.isAbsolute(filename)) throw new Error("Expected an absolute document path");
      const next = queue.then(async () => {
        if (filename === previous) return;
        const temporary = `${location}.${randomUUID()}.tmp`;
        const file = await open(temporary, "wx", 0o600);
        let moved = false;
        try {
          try { await file.writeFile(JSON.stringify({ path: filename })); await file.sync(); }
          finally { await file.close(); }
          await rename(temporary, location);
          moved = true;
          previous = filename;
        } finally { if (!moved) await unlink(temporary); }
      });
      // Keep the queue usable after a surfaced error; the failed caller still rejects.
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
