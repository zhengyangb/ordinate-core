import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentCliCommand, agentCliLauncher } from "./agentCliLauncher";

describe("agent CLI launcher", () => {
  it("uses a short workspace command and safely quotes host paths", () => {
    expect(agentCliCommand("evaluate")).toBe("./ordinate-cli evaluate Workbook.ord");
    expect(agentCliLauncher("/Apps/Ordinate's App", "/path with spaces/ordinate-cli.mjs"))
      .toBe("#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/Apps/Ordinate'\\''s App' '/path with spaces/ordinate-cli.mjs' \"$@\"\n");
  });
  it("executes the bundled CLI with arguments from a scratch workspace", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "ordinate-launcher-"));
    try {
      const cli = path.join(workspace, "cli's entry.mjs");
      const launcher = path.join(workspace, "ordinate-cli");
      writeFileSync(cli, "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE }));\n");
      writeFileSync(launcher, agentCliLauncher(process.execPath, cli), { mode: 0o700 });
      const result = spawnSync(launcher, ["evaluate", "Workbook.ord", "--json"], { cwd: workspace, encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ args: ["evaluate", "Workbook.ord", "--json"], runAsNode: "1" });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
