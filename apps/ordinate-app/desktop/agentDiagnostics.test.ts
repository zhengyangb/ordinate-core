import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentDiagnosticRun } from "./agentDiagnostics";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("assistant diagnostics", () => {
  async function directory() { const value = await mkdtemp(path.join(os.tmpdir(), "ordinate-diagnostic-test-")); directories.push(value); return value; }

  it("records timed stages without prompt, command, or workbook content", async () => {
    const folder = await directory();
    const run = await AgentDiagnosticRun.begin(folder, "gpt-6-luna", "timing");
    run.record("reasoning_effort_selected", { effort: "medium" });
    run.record("auth_checked");
    run.record("model_ready");
    run.record("connection_ready");
    run.record("server_ready");
    run.record("attachments_staged");
    run.record("source_written");
    run.record("baseline_evaluated");
    run.record("thread_ready");
    run.record("turn_requested");
    run.itemStarted("tool-1", "tool", "Reading authoring guidance");
    run.itemFirstOutput("tool-1", "tool_output");
    run.itemFinished("tool-1", "completed");
    run.itemStarted("reasoning-1", "reasoning");
    run.reasoningSummaryStarted("reasoning-1", 0);
    run.reasoningSummaryDelta("reasoning-1", 0);
    run.itemFinished("reasoning-1", "completed");
    run.itemStarted("message-1", "message", undefined, "final_answer");
    run.itemFirstOutput("message-1", "message");
    run.itemFinished("message-1", "completed");
    run.record("turn_completed");
    await run.finish("completed");
    const filename = (await readdir(folder))[0];
    const raw = await readFile(path.join(folder, filename), "utf8");
    const log = JSON.parse(raw);
    expect(log.summary.preparationMs).toBeTypeOf("number");
    expect(log.events.find((event: { event: string }) => event.event === "reasoning_effort_selected").effort).toBe("medium");
    expect(log.summary.preparationStagesMs).toHaveProperty("authentication");
    expect(log.summary.agentTurnMs).toBeTypeOf("number");
    expect(log.summary.toolDurationsMs["Reading authoring guidance"]).toBeTypeOf("number");
    expect(log.events.find((event: { event: string; itemId?: string }) => event.event === "item_finished" && event.itemId === "tool-1").status).toBe("completed");
    expect(log.events.find((event: { event: string }) => event.event === "reasoning_summary_finished").durationMs).toBeTypeOf("number");
    expect(log.events.find((event: { event: string }) => event.event === "first_stream_output").kind).toBe("tool_output");
    expect(log.events.find((event: { event: string }) => event.event === "first_agent_output").kind).toBe("reasoning_summary");
    expect(log.events.find((event: { event: string }) => event.event === "item_started" && event.phase === "final_answer")).toBeTruthy();
    expect(raw).not.toContain("Workbook.ord");
    expect(raw).not.toContain("ACCESS_TOKEN");
  });

  it("retains only the most recent five runs", async () => {
    const folder = await directory();
    for (let index = 0; index < 7; index++) {
      const run = await AgentDiagnosticRun.begin(folder, `model-${index}`, "timing");
      await run.finish("completed");
    }
    expect((await readdir(folder)).length).toBe(5);
  });

  it("keeps a failed preparation run with partial timing and no fabricated agent duration", async () => {
    const folder = await directory();
    const run = await AgentDiagnosticRun.begin(folder, "gpt-6-luna", "timing");
    run.record("auth_checked");
    await run.finish("failed");
    const raw = await readFile(path.join(folder, (await readdir(folder))[0]), "utf8");
    const log = JSON.parse(raw);
    expect(log.status).toBe("failed");
    expect(log.summary.preparationStagesMs.authentication).toBeTypeOf("number");
    expect(log.summary.agentTurnMs).toBeNull();
    expect(log.summary.hostChecksMs).toBeNull();
  });

  it("closes unfinished items without inventing output and separates successive summaries", async () => {
    const folder = await directory();
    const run = await AgentDiagnosticRun.begin(folder, "gpt-6-luna", "timing");
    run.record("turn_requested");
    run.itemStarted("reasoning-1", "reasoning");
    run.reasoningSummaryStarted("reasoning-1", 0);
    run.reasoningSummaryDelta("reasoning-1", 0);
    run.reasoningSummaryStarted("reasoning-1", 1);
    run.itemStarted("tool-1", "tool", "Other command");
    await run.finish("interrupted");
    const log = JSON.parse(await readFile(path.join(folder, (await readdir(folder))[0]), "utf8"));
    expect(log.events.filter((event: { event: string }) => event.event === "reasoning_summary_finished").map((event: { summaryIndex: number }) => event.summaryIndex)).toEqual([0, 1]);
    expect(log.events.filter((event: { event: string }) => event.event === "item_finished").every((event: { status: string }) => event.status === "incomplete")).toBe(true);
    expect(log.events.some((event: { event: string; itemId?: string }) => event.event === "item_first_output" && event.itemId === "tool-1")).toBe(false);
  });

  it("keeps trace command arguments and workbook text out of the log", async () => {
    const folder = await directory();
    const run = await AgentDiagnosticRun.begin(folder, "gpt-6-luna", "trace");
    run.itemStarted("tool-1", "tool", "Inspecting workbook", undefined, { type: "ordinate.inspect", text: "cat /private/secret/Workbook.ord" });
    run.commandOutputDelta("tool-1", "private tool output");
    run.itemFinished("tool-1", "completed", { exitCode: 3, aggregatedOutput: "private final error" });
    run.hostCliStarted("preview.validate", ["/private/secret/ordinate-cli", "validate", "/private/secret/Workbook.ord"]);
    run.hostCliFinished("preview.validate", 12, { code: 3, output: "private stdout", errorOutput: "private stderr" });
    run.workbookChanged("# Private\n| Old |\n", "# Private\n| New |\n");
    await run.finish("completed");
    const raw = await readFile(path.join(folder, (await readdir(folder))[0]), "utf8");
    const log = JSON.parse(raw);
    expect(log.level).toBe("trace");
    expect(log.events.find((event: { event: string }) => event.event === "item_started").commandType).toBe("ordinate.inspect");
    expect(log.events.find((event: { event: string }) => event.event === "working_copy_changed")).toMatchObject({ changedLines: 1, addedLines: 0, removedLines: 0 });
    expect(log.summary.workbookChangeCount).toBe(1);
    expect(raw).not.toContain("/private/secret");
    expect(raw).not.toContain("Private");
    expect(raw).not.toContain("Old");
    expect(raw).not.toContain("New");
    expect(raw).not.toContain("private tool output");
    expect(raw).not.toContain("private stdout");
    expect(raw).not.toContain("private stderr");
    expect(raw).not.toContain("private final error");
  });

  it("stores commands, CLI results and streamed tool output only at the explicit debug level", async () => {
    const folder = await directory();
    const run = await AgentDiagnosticRun.begin(folder, "gpt-6-luna", "debug");
    run.itemStarted("tool-1", "tool", "Other command", undefined, { type: "shell.other", text: "printf 'private source' > Workbook.ord" });
    run.commandOutputDelta("tool-1", "first output\n");
    run.commandOutputDelta("tool-1", "second output");
    run.itemFinished("tool-1", "failed", { exitCode: 3, aggregatedOutput: "first output\nsecond output\nfinal error" });
    run.hostCliStarted("final.evaluate", ["/bin/node", "/private/ordinate-cli.mjs", "evaluate", "Workbook.ord", "--json"]);
    run.hostCliFinished("final.evaluate", 18, { code: 3, output: "invalid reference", errorOutput: "validation failed" });
    await run.finish("completed");
    const log = JSON.parse(await readFile(path.join(folder, (await readdir(folder))[0]), "utf8"));
    expect(log.events.find((event: { event: string }) => event.event === "item_started").command).toContain("private source");
    expect(log.events.find((event: { event: string }) => event.event === "item_finished")).toMatchObject({ exitCode: 3, output: "first output\nsecond output\nfinal error" });
    expect(log.events.find((event: { event: string }) => event.event === "host_cli_started").argv).toEqual(["/bin/node", "/private/ordinate-cli.mjs", "evaluate", "Workbook.ord", "--json"]);
    expect(log.events.find((event: { event: string }) => event.event === "host_cli_finished")).toMatchObject({ exitCode: 3, stdout: "invalid reference", stderr: "validation failed" });
    expect(log.level).toBe("debug");
  });

  it("bounds debug output and marks truncation", async () => {
    const folder = await directory();
    const run = await AgentDiagnosticRun.begin(folder, "gpt-6-luna", "debug");
    run.itemStarted("tool-1", "tool", "Other command");
    run.commandOutputDelta("tool-1", "x".repeat(40_000));
    run.itemFinished("tool-1", "completed");
    run.hostCliFinished("final.evaluate", 18, { error: new Error("y".repeat(40_000)) });
    await run.finish("failed");
    const log = JSON.parse(await readFile(path.join(folder, (await readdir(folder))[0]), "utf8"));
    expect(log.events.find((event: { event: string }) => event.event === "item_finished")).toMatchObject({ outputTruncated: true });
    expect(log.events.find((event: { event: string }) => event.event === "item_finished").output).toHaveLength(32_768);
    expect(log.events.find((event: { event: string }) => event.event === "host_cli_finished")).toMatchObject({ stderrTruncated: true });
    expect(log.events.find((event: { event: string }) => event.event === "host_cli_finished").stderr).toHaveLength(32_768);
  });
});
