import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspaceSession } from "./workspaceSession";

it("restores independent untitled drafts and serializes overlapping window changes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ordinate-workspace-"));
  try {
    const workspace = createWorkspaceSession(directory);
    expect(await workspace.read()).toEqual([{ id: "browser-untitled", filename: null, text: null }]);
    await writeFile(path.join(directory, "last-document.json"), JSON.stringify({ path: path.join(directory, "Previous.ord") }));
    expect(await workspace.read()).toEqual([{ id: "browser-untitled", filename: path.join(directory, "Previous.ord"), text: null }]);
    const a = { id: "document-a", filename: null, text: null };
    const b = { id: "document-b", filename: path.join(directory, "Saved.ord"), text: null };
    await Promise.all([workspace.write([a]), workspace.write([a, b]), workspace.write([b])]);
    expect(await createWorkspaceSession(directory).read()).toEqual([b]);
    await writeFile(path.join(directory, "workspace.json"), JSON.stringify([{ ...b, filename: "relative" }]));
    await expect(workspace.read()).rejects.toThrow("Invalid document workspace");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
