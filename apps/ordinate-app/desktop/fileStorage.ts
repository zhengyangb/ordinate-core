import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  DesktopBridge, FileReference, FileSnapshot, StorageFailure, StorageResult,
} from "../src/platform/storage.js";

type NativeDialogs = {
  open: () => Promise<string | null>;
  save: () => Promise<string | null>;
};
type GrantedFile = { path: string; reference: FileReference };
type NativeStorage = Pick<DesktopBridge, "availability" | "open" | "save" | "saveAs" | "readCurrent"> & {
  /** Main-process-only: never exposed through the preload bridge. */
  documentPath: (file: FileReference) => string;
  readPath: (selectedPath: string) => Promise<StorageResult<FileSnapshot>>;
  saveTo: (destination: string, text: string, file: FileReference | null, version: string | null) => Promise<StorageResult<FileSnapshot>>;
  moveTo: (destination: string, file: FileReference, version: string, move: (from: string, to: string) => void) => Promise<StorageResult<FileSnapshot>>;
};
const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const ok = <T>(value: T): StorageResult<T> => ({ ok: true, value });

function failure(error: unknown, operation: "read_failed" | "write_failed"): StorageResult<never> {
  const code = (error as NodeJS.ErrnoException).code;
  const detail: StorageFailure = code === "ENOENT" ? { kind: "not_found" }
    : code === "EACCES" || code === "EPERM" ? { kind: "permission_denied", permission: "denied" }
    : { kind: operation, message: String(error) };
  return { ok: false, error: detail };
}

/** Only paths selected by native dialogs are granted to this window. */
export function createNativeStorage(dialogs: NativeDialogs, preserveMetadata?: (source: string, replacement: string) => void,
  beforeReplace?: (filename: string) => void): NativeStorage {
  const grants = new Map<string, GrantedFile>();
  let writes: Promise<unknown> = Promise.resolve();
  function serializeWrite<T>(action: () => Promise<T>): Promise<T> {
    const next = writes.then(action);
    writes = next.catch(() => undefined);
    return next;
  }
  function resolve(file: FileReference): GrantedFile {
    const grant = file && grants.get(file.id);
    if (!grant || file.adapterKind !== "electron") throw new Error("Unknown file capability");
    return grant;
  }
  async function grant(selectedPath: string): Promise<GrantedFile> {
    // Resolve symlinks, including the parent of a new Save As destination.
    let canonical: string;
    try { canonical = await realpath(selectedPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      canonical = path.join(await realpath(path.dirname(selectedPath)), path.basename(selectedPath));
    }
    for (const existing of grants.values()) if (existing.path === canonical) return existing;
    const reference: FileReference = {
      id: randomUUID(), displayName: path.basename(canonical), adapterKind: "electron",
      draftKey: `electron:${hash(canonical)}`,
    };
    const entry = { path: canonical, reference };
    grants.set(reference.id, entry);
    return entry;
  }
  async function snapshot(file: GrantedFile): Promise<FileSnapshot> {
    const text = await readFile(file.path, "utf8");
    return { file: file.reference, text, version: hash(text) };
  }
  async function replace(file: GrantedFile, text: string, expectedVersion: string | null): Promise<StorageResult<FileSnapshot>> {
    if (typeof text !== "string") throw new TypeError("File content must be text");
    if (expectedVersion !== null && typeof expectedVersion !== "string") throw new TypeError("Invalid file version");
    const temporary = path.join(path.dirname(file.path), `.${path.basename(file.path)}.${randomUUID()}.tmp`);
    let created = false;
    try {
      let mode = 0o600;
      let exists = false;
      try {
        mode = (await stat(file.path)).mode & 0o777;
        exists = true;
        // Rename permission comes from the directory; still honor a read-only file.
        await access(file.path, constants.W_OK);
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const handle = await open(temporary, "wx", mode);
      created = true;
      try { await handle.writeFile(text, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      // Check just before replacement, also for explicit conflict overwrites.
      if (expectedVersion !== null) {
        const current = await snapshot(file);
        if (current.version !== expectedVersion) return { ok: false, error: { kind: "version_mismatch", current } };
        if (current.text === text) return ok(current);
      }
      if (exists) beforeReplace?.(file.path);
      // Include attributes created by version checkpointing, as well as Finder tags.
      if (exists) preserveMetadata?.(file.path, temporary);
      await rename(temporary, file.path);
      created = false;
      return ok({ file: file.reference, text, version: hash(text) });
    } catch (error) { return failure(error, "write_failed"); }
    finally { if (created) await unlink(temporary); }
  }
  return {
    documentPath: (file) => resolve(file).path,
    readPath: async (selectedPath) => {
      try { return ok(await snapshot(await grant(selectedPath))); }
      catch (error) { return failure(error, "read_failed"); }
    },
    saveTo: (destination, text, file, version) => serializeWrite(async () => {
      try {
        const target = await grant(destination);
        const same = file && resolve(file).path === target.path;
        if (same && version === null) throw new Error("Saving requires a baseline version");
        return await replace(target, text, same ? version : null);
      } catch (error) { return failure(error, "write_failed"); }
    }),
    moveTo: (destination, file, version, move) => serializeWrite(async () => {
      const source = resolve(file);
      try {
        const current = await snapshot(source);
        if (current.version !== version) return { ok: false, error: { kind: "version_mismatch", current } };
        const target = await grant(destination);
        if (target.path === source.path) return ok(current);
        // Native coordinated movement must not replace an existing destination.
        move(source.path, target.path);
        return ok({ ...current, file: target.reference });
      } catch (error) { return failure(error, "write_failed"); }
    }),
    availability: async (file) => {
      if (file === null) return { readPermission: "unavailable", writePermission: "unavailable" };
      const selected = resolve(file);
      const permission = async (mode: number) => {
        try { await access(selected.path, mode); return "granted" as const; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") return "unavailable" as const;
          if (code === "EACCES" || code === "EPERM") return "denied" as const;
          throw error;
        }
      };
      return { readPermission: await permission(constants.R_OK), writePermission: await permission(constants.W_OK) };
    },
    open: async () => {
      try {
        const selected = await dialogs.open();
        return selected === null ? { ok: false, error: { kind: "cancelled" } } : ok(await snapshot(await grant(selected)));
      } catch (error) { return failure(error, "read_failed"); }
    },
    readCurrent: async (file) => {
      const selected = resolve(file);
      try { return ok(await snapshot(selected)); }
      catch (error) { return failure(error, "read_failed"); }
    },
    save: (file, text, options) => {
      const selected = resolve(file);
      if (!options || !["manual", "autosave", "overwrite_conflict"].includes(options.reason)) throw new TypeError("Invalid save options");
      if (options.expectedVersion === null) throw new TypeError("Saving an opened file requires a baseline version");
      return serializeWrite(() => replace(selected, text, options.expectedVersion));
    },
    saveAs: (text) => serializeWrite(async () => {
      if (typeof text !== "string") throw new TypeError("File content must be text");
      try {
        const selected = await dialogs.save();
        if (selected === null) return { ok: false, error: { kind: "cancelled" } };
        return await replace(await grant(selected), text, null);
      } catch (error) { return failure(error, "write_failed"); }
    }),
  };
}
