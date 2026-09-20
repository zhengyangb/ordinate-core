import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRecentDocument } from "./recentDocument";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ordinate-recent-test-"));
  directories.push(directory);
  return { directory, recent: createRecentDocument(directory) };
}
it("restores a native document location across application sessions", async () => {
  const { directory, recent } = await fixture();
  expect(await recent.read()).toBe(null);
  const document = path.join(directory, "Report.ord");
  await recent.remember(document);
  expect(await createRecentDocument(directory).read()).toBe(document);
});
it("serializes location updates so a rename supersedes the old location", async () => {
  const { directory, recent } = await fixture();
  const oldPath = path.join(directory, "Old.ord"), newPath = path.join(directory, "New.ord");
  await Promise.all([recent.remember(oldPath), recent.remember(newPath)]);
  expect(JSON.parse(await readFile(path.join(directory, "last-document.json"), "utf8"))).toEqual({ path: newPath });
});
it("rejects malformed session metadata instead of silently opening another document", async () => {
  const { directory, recent } = await fixture();
  await writeFile(path.join(directory, "last-document.json"), JSON.stringify({ path: "relative" }));
  await expect(recent.read()).rejects.toThrow("Invalid document session");
  expect(() => recent.remember("relative")).toThrow("absolute");
});
