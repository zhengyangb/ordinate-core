import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentServer } from "./agentServer";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("Codex App Server transport", () => {
  it("initializes, streams identified message items, and rejects unexpected approval requests", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ordinate-agent-server-test-"));
    temporaryDirectories.push(directory);
    const executable = path.join(directory, "fake-codex");
    await writeFile(executable, `#!/usr/bin/env node
const readline = require("node:readline");
let pendingConfigId = null;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: {} });
  } else if (message.method === "config/read") {
    pendingConfigId = message.id;
    send({ id: 99, method: "item/commandExecution/requestApproval", params: {} });
  } else if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    send({ method: "turn/completed", params: { threadId: message.params.threadId, turn: { id: message.params.turnId, status: "interrupted" } } });
  } else if (message.id === 99) {
    send({ id: pendingConfigId, result: { approvalRejected: message.error?.code === -32601 } });
    send({ method: "item/agentMessage/delta", params: { threadId: "t", turnId: "u", itemId: "m1", delta: "Hello" } });
  }
});
`, "utf8");
    await chmod(executable, 0o700);

    const server = new AgentServer(executable, directory, "test-token", "0.0.1");
    const message = new Promise<unknown>(resolve => {
      server.onNotification = (method, params) => {
        if (method === "item/agentMessage/delta") resolve(params);
      };
    });
    const interrupted = new Promise<unknown>(resolve => {
      const previous = server.onNotification;
      server.onNotification = (method, params) => {
        previous(method, params);
        if (method === "turn/completed") resolve(params);
      };
    });
    try {
      expect(await server.request<{ approvalRejected: boolean }>("config/read", { includeLayers: false }))
        .toEqual({ approvalRejected: true });
      expect(await message).toEqual({ threadId: "t", turnId: "u", itemId: "m1", delta: "Hello" });
      await server.request("turn/interrupt", { threadId: "t", turnId: "u" });
      expect(await interrupted).toEqual({ threadId: "t", turn: { id: "u", status: "interrupted" } });
    } finally {
      server.dispose();
    }
  });
});
