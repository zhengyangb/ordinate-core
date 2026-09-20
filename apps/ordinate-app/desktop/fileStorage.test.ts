import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNativeStorage } from "./fileStorage";
import type { FileReference, StorageResult } from "../src/platform/storage";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function unwrap<T>(result: StorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ordinate-desktop-test-"));
  temporaryDirectories.push(directory);
  const source = path.join(directory, "source.ord");
  const destination = path.join(directory, "saved.ord");
  await writeFile(source, "# 本地文件\n| Item || Value |\n| A || 42 |\n", { mode: 0o640 });
  const adapter = createNativeStorage({ open: async () => source, save: async () => destination });
  return { directory, source, destination, adapter };
}

describe("native desktop file storage", () => {
  it("opens and saves UTF-8 through an opaque file capability, preserving permissions", async () => {
    const { source, adapter, directory } = await fixture();
    const opened = unwrap(await adapter.open());
    expect(opened.text).toContain("本地文件");
    expect(opened.file.id).not.toContain(source);
    expect(opened.file.adapterKind).toBe("electron");
    expect(adapter.documentPath({ ...opened.file, displayName: "forged" })).toBe(await realpath(source));
    expect(await adapter.availability(opened.file)).toEqual({ readPermission: "granted", writePermission: "granted" });
    const updated = unwrap(await adapter.save(opened.file, "updated", { expectedVersion: opened.version, reason: "manual" }));
    expect(await readFile(source, "utf8")).toBe("updated");
    expect(unwrap(await adapter.readCurrent(opened.file))).toEqual(updated);
    expect((await stat(source)).mode & 0o777).toBe(0o640);
    expect(await readdir(directory)).toEqual(["source.ord"]);
  });
  it("save-as creates a new backing file without touching the opened file", async () => {
    const { adapter, destination, source } = await fixture();
    const original = await readFile(source, "utf8");
    const saved = unwrap(await adapter.saveAs("new document"));
    expect(saved.file.displayName).toBe("saved.ord");
    expect(await readFile(destination, "utf8")).toBe("new document");
    expect(await readFile(source, "utf8")).toBe(original);
  });
  it("rejects a stale save and cleans up its temporary file", async () => {
    const { adapter, source, directory } = await fixture();
    const opened = unwrap(await adapter.open());
    await writeFile(source, "external edit");
    const result = await adapter.save(opened.file, "my edit", { expectedVersion: opened.version, reason: "autosave" });
    expect(result).toMatchObject({ ok: false, error: { kind: "version_mismatch", current: { text: "external edit" } } });
    expect(await readFile(source, "utf8")).toBe("external edit");
    expect(await readdir(directory)).toEqual(["source.ord"]);
  });
  it("serializes simultaneous writes so a stale baseline cannot win", async () => {
    const { adapter, source } = await fixture();
    const opened = unwrap(await adapter.open());
    const options = { expectedVersion: opened.version, reason: "manual" as const };
    const results = await Promise.all([adapter.save(opened.file, "first", options), adapter.save(opened.file, "second", options)]);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, error: { kind: "version_mismatch" } });
    expect(await readFile(source, "utf8")).toBe("first");
  });
  it("cannot access arbitrary paths or capabilities issued to another window", async () => {
    const { adapter, source } = await fixture();
    const forged: FileReference = { id: source, displayName: source, adapterKind: "electron" };
    expect(() => adapter.documentPath(forged)).toThrow("Unknown file capability");
    await expect(adapter.readCurrent(forged)).rejects.toThrow("Unknown file capability");
    expect(() => adapter.save(forged, "bad", { expectedVersion: "fake", reason: "manual" })).toThrow("Unknown file capability");
    const other = createNativeStorage({ open: async () => source, save: async () => source });
    await expect(other.readCurrent(unwrap(await adapter.open()).file)).rejects.toThrow("Unknown file capability");
  });
  it("treats cancelled native dialogs as cancellation, not successful saving", async () => {
    const adapter = createNativeStorage({ open: async () => null, save: async () => null });
    expect(await adapter.open()).toEqual({ ok: false, error: { kind: "cancelled" } });
    expect(await adapter.saveAs("test")).toEqual({ ok: false, error: { kind: "cancelled" } });
  });
  it("reports deleted files and does not silently recreate them on save", async () => {
    const { adapter, source } = await fixture();
    const opened = unwrap(await adapter.open());
    await rm(source);
    expect(await adapter.readCurrent(opened.file)).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(await adapter.save(opened.file, "test", { expectedVersion: opened.version, reason: "manual" })).toEqual({ ok: false, error: { kind: "not_found" } });
  });
  it("resolves symlinks without replacing the user's link", async () => {
    const { source, directory } = await fixture();
    const link = path.join(directory, "link.ord");
    await symlink(source, link);
    const adapter = createNativeStorage({ open: async () => link, save: async () => link });
    const opened = unwrap(await adapter.open());
    unwrap(await adapter.save(opened.file, "through link", { expectedVersion: opened.version, reason: "manual" }));
    expect(await readFile(source, "utf8")).toBe("through link");
    expect(await readFile(link, "utf8")).toBe("through link");
  });
  it("has a stable recovery key across native app sessions", async () => {
    const { adapter, source } = await fixture();
    const another = createNativeStorage({ open: async () => source, save: async () => source });
    const a = unwrap(await adapter.open()).file;
    const b = unwrap(await another.open()).file;
    expect(a.id).not.toBe(b.id);
    expect(a.draftKey).toBe(b.draftKey);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("does not bypass read-only files using directory rename permissions", async () => {
    const { adapter, source } = await fixture();
    const opened = unwrap(await adapter.open());
    await chmod(source, 0o444);
    const result = await adapter.save(opened.file, "not permitted", { expectedVersion: opened.version, reason: "manual" });
    expect(result).toEqual({ ok: false, error: { kind: "permission_denied", permission: "denied" } });
    expect(await readFile(source, "utf8")).toBe(opened.text);
  });
});
