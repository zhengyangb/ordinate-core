import { mkdtemp, readFile, writeFile, rm, readdir, symlink, stat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeInterchange } from "../../desktop/interchangeStorage";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ordinate-interchange-")); directories.push(dir);
  const target = path.join(dir, "report.xlsx");
  const dialogs = { open: vi.fn(async (): Promise<string | null> => target), save: vi.fn(async (): Promise<string | null> => target), checkDestination: vi.fn(async (_path: string) => {}) };
  return { dir, target, dialogs, io: createNativeInterchange(dialogs), file: { name: "report.xlsx", format: "xlsx" as const, bytes: new Uint8Array([0x50, 0x4b, 0, 0xff, 0x80]) } };
}
describe("native interchange capabilities", () => {
  it("round-trips binary bytes without text decoding or adopting a backing file", async () => {
    const f = await fixture();
    expect(await f.io.saveExport(f.file)).toBe("saved");
    expect(await f.io.pickImport()).toEqual({ name: "report.xlsx", bytes: f.file.bytes });
    expect(f.dialogs.checkDestination).toHaveBeenCalledTimes(2);
    expect(await readdir(f.dir)).toEqual(["report.xlsx"]);
  });
  it("cancels import and export without touching the filesystem", async () => {
    const f = await fixture(); f.dialogs.open.mockResolvedValue(null); f.dialogs.save.mockResolvedValue(null);
    expect(await f.io.pickImport()).toBeNull(); expect(await f.io.saveExport(f.file)).toBeNull();
    expect(await readdir(f.dir)).toEqual([]);
  });
  it("validates export payload before granting a save destination", async () => {
    const f = await fixture();
    await expect(f.io.saveExport({ ...f.file, name: "../wrong.csv" })).rejects.toThrow("Invalid export");
    expect(f.dialogs.save).not.toHaveBeenCalled();
  });
  it("rejects misleading output extensions", async () => {
    const f = await fixture(); f.dialogs.save.mockResolvedValue(path.join(f.dir, "report.csv"));
    await expect(f.io.saveExport(f.file)).rejects.toThrow(".xlsx filename");
    expect(await readdir(f.dir)).toEqual([]);
  });
  it("keeps an open document intact when the destination guard rejects", async () => {
    const f = await fixture(); await writeFile(f.target, "original");
    f.dialogs.checkDestination.mockRejectedValue(new Error("Open document"));
    await expect(f.io.saveExport(f.file)).rejects.toThrow("Open document");
    expect(await readFile(f.target, "utf8")).toBe("original");
    expect(await readdir(f.dir)).toEqual(["report.xlsx"]);
  });
  it("rechecks destinations before replacement and cleans only its temporary file", async () => {
    const f = await fixture(); await writeFile(f.target, "original");
    f.dialogs.checkDestination.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Now open"));
    await expect(f.io.saveExport(f.file)).rejects.toThrow("Now open");
    expect(await readFile(f.target, "utf8")).toBe("original");
    expect(await readdir(f.dir)).toEqual(["report.xlsx"]);
  });
  it("resolves symlinks before applying the open-document guard", async () => {
    const f = await fixture(); await writeFile(f.target, "original");
    const link = path.join(f.dir, "alias.xlsx"); await symlink(f.target, link); f.dialogs.save.mockResolvedValue(link);
    f.dialogs.checkDestination.mockRejectedValue(new Error("Protected"));
    await expect(f.io.saveExport(f.file)).rejects.toThrow("Protected");
    expect(f.dialogs.checkDestination).toHaveBeenCalledWith(await realpath(f.target));
    expect(await readFile(f.target, "utf8")).toBe("original");
  });
  it("preserves restrictive destination permissions on replacement", async () => {
    const f = await fixture(); await writeFile(f.target, "old", { mode: 0o600 });
    await f.io.saveExport(f.file);
    expect((await stat(f.target)).mode & 0o777).toBe(0o600);
  });
  it("reports unreadable files and unsupported import types", async () => {
    const f = await fixture(); await expect(f.io.pickImport()).rejects.toThrow();
    const wrong = path.join(f.dir, "file.xls"); await writeFile(wrong, "old format"); f.dialogs.open.mockResolvedValue(wrong);
    await expect(f.io.pickImport()).rejects.toThrow(".xlsx");
  });
});
