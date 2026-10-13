import { open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { validateDocumentName } from "../src/platform/documentName.js";

export type DocumentSession = { id: string; filename: string | null; text: string | null; draftName?: string };
export type RestoredWorkspace = { records: DocumentSession[]; firstLaunch: boolean };

/** Window identity also names its durable untitled draft. Save all windows together. */
export function createWorkspaceSession(directory: string) {
  const location = path.join(directory, "workspace.json");
  let queue = Promise.resolve();
  return {
    async read(): Promise<RestoredWorkspace> {
      let raw: string;
      try { raw = await readFile(location, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // One-time data migration, before workspace.json exists. Existing user
        // drafts and file locations must survive the move to multiple windows.
        let previous: string;
        try { previous = await readFile(path.join(directory, "last-document.json"), "utf8"); }
        catch (legacyError) {
          if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") throw legacyError;
          return { records: [{ id: "browser-untitled", filename: null, text: null }], firstLaunch: true };
        }
        const bookmark = JSON.parse(previous) as { path: unknown };
        if (typeof bookmark.path !== "string" || !path.isAbsolute(bookmark.path)) throw new Error("Invalid document session bookmark");
        return { records: [{ id: "browser-untitled", filename: bookmark.path, text: null }], firstLaunch: false };
      }
      const records: unknown = JSON.parse(raw);
      if (!Array.isArray(records) || records.some(record => !record || typeof record.id !== "string"
        || !/^[a-zA-Z0-9-]+$/.test(record.id)
        || (record.filename !== null && (typeof record.filename !== "string" || !path.isAbsolute(record.filename)))
        || (record.text !== null && typeof record.text !== "string"))
        || new Set(records.map(record => record.id)).size !== records.length) throw new Error("Invalid document workspace");
      for (const record of records) if (record.draftName !== undefined) validateDocumentName(record.draftName);
      return { records, firstLaunch: false };
    },
    write(records: DocumentSession[]): Promise<void> {
      const text = JSON.stringify(records);
      const next = queue.then(async () => {
        const temporary = `${location}.${randomUUID()}.tmp`;
        const file = await open(temporary, "wx", 0o600);
        let moved = false;
        try {
          try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
          await rename(temporary, location);
          moved = true;
        } finally { if (!moved) await unlink(temporary); }
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
