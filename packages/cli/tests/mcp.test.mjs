import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("MCP exposes the shared import and writes only a new output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ordinate-mcp-test-"));
  const sourcePath = join(directory, "items.csv"), outputPath = join(directory, "items.ord");
  const source = "item,amount\nA,12\nB,7\n";
  await writeFile(sourcePath, source);
  const client = new Client({ name: "ordinate-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/ordinate-mcp.mjs")] });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === "ordinate_import"));
    const call = await client.callTool({ name: "ordinate_import", arguments: { sourcePath, outputPath, format: "csv", sheetName: "Items" } });
    assert.notEqual(call.isError, true, JSON.stringify(call.content));
    assert.equal(await readFile(sourcePath, "utf8"), source);
    assert.match(await readFile(outputPath, "utf8"), /# Items/);
    const again = await client.callTool({ name: "ordinate_import", arguments: { sourcePath, outputPath, format: "csv", sheetName: "Items" } });
    assert.equal(again.isError, true);
    assert.match(JSON.stringify(again.content), /Output already exists/);
  }
  finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});
