import { randomUUID } from "node:crypto";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentDiagnosticLevel } from "../src/agent/diagnosticLevel.js";
import type { AgentReasoningEffort } from "../src/agent/reasoningEffort.js";
import { workbookChangeSummary } from "./workbookChangeSummary.js";

const RETAINED_LOGS = 5;
const MAX_EVENTS = 1_000;
const MAX_DEBUG_COMMAND_LENGTH = 8_192;
const MAX_DEBUG_OUTPUT_LENGTH = 32_768;
const PREPARATION_STAGES = [
  ["auth_checked", "authentication"],
  ["model_ready", "modelCatalog"],
  ["connection_ready", "connection"],
  ["server_ready", "server"],
  ["attachments_staged", "attachments"],
  ["source_written", "workingCopy"],
  ["baseline_evaluated", "baselineEvaluation"],
  ["thread_ready", "thread"],
  ["turn_requested", "turnRequest"],
] as const;

type DiagnosticEvent = {
  elapsedMs: number;
  event: string;
  kind?: DiagnosticItemKind | DiagnosticOutputKind;
  category?: string;
  phase?: "commentary" | "final_answer";
  itemId?: string;
  summaryIndex?: number;
  durationMs?: number;
  exitCode?: number;
  status?: string;
  effort?: AgentReasoningEffort;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  bytes?: number;
  commandType?: string;
  command?: string;
  commandTruncated?: boolean;
  argv?: string[];
  output?: string;
  outputTruncated?: boolean;
  stdout?: string;
  stdoutTruncated?: boolean;
  stderr?: string;
  stderrTruncated?: boolean;
  beforeLines?: number;
  afterLines?: number;
  changedLines?: number;
  addedLines?: number;
  removedLines?: number;
  sameLineContents?: boolean;
  beforeBytes?: number;
  afterBytes?: number;
};

type DiagnosticItemKind = "message" | "reasoning" | "tool";
type DiagnosticOutputKind = "message" | "reasoning_summary" | "tool_output";
type ItemTiming = { startedMs: number; kind: DiagnosticItemKind; category?: string; firstOutputSeen: boolean; output?: string; outputTruncated?: boolean; summary?: { index: number; startedMs: number } };

function limitedOutput(text: string): { text: string; truncated: boolean } {
  return { text: text.slice(0, MAX_DEBUG_OUTPUT_LENGTH), truncated: text.length > MAX_DEBUG_OUTPUT_LENGTH };
}

export function agentDiagnosticDirectory(userDataPath: string): string {
  return path.join(userDataPath, "agent-diagnostics");
}

/** Opt-in local diagnostics. Debug retains bounded raw commands and tool output. */
export class AgentDiagnosticRun {
  private readonly startedAt = new Date();
  private readonly started = process.hrtime.bigint();
  private readonly events: DiagnosticEvent[] = [];
  private readonly items = new Map<string, ItemTiming>();
  private firstStreamOutputMs: number | null = null;
  private firstAgentOutputMs: number | null = null;
  private droppedEvents = 0;
  private finished = false;

  private constructor(private readonly directory: string, private readonly filename: string, private readonly model: string, private readonly level: Exclude<AgentDiagnosticLevel, "off">) {
    this.record("request_received");
  }

  static async begin(directory: string, model: string, level: Exclude<AgentDiagnosticLevel, "off">): Promise<AgentDiagnosticRun> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = `turn-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`;
    const run = new AgentDiagnosticRun(directory, filename, model, level);
    await writeFile(path.join(directory, filename), JSON.stringify({ startedAt: run.startedAt.toISOString(), model, level, status: "in_progress" }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return run;
  }

  private elapsedMs(): number { return Number((process.hrtime.bigint() - this.started) / 1_000_000n); }

  record(event: string, details: Omit<DiagnosticEvent, "elapsedMs" | "event"> = {}) {
    if (this.finished) throw new Error("Cannot record a completed assistant diagnostic run.");
    if (this.events.length === MAX_EVENTS) { this.droppedEvents++; return; }
    this.events.push({ elapsedMs: this.elapsedMs(), event, ...details });
  }

  itemStarted(itemId: string, kind: DiagnosticItemKind, category?: string, phase?: "commentary" | "final_answer", command?: { type: string; text: string }) {
    if (this.items.has(itemId)) throw new Error(`Assistant diagnostic item started twice: ${itemId}`);
    if ((kind === "tool") !== Boolean(category)) throw new Error("Tool diagnostic category is required only for tools.");
    if (phase && kind !== "message") throw new Error("Only messages have a diagnostic phase.");
    const startedMs = this.elapsedMs();
    this.items.set(itemId, { startedMs, kind, category, firstOutputSeen: false });
    if (command && kind !== "tool") throw new Error("Only a tool item can have a command.");
    const commandDetails = command && this.level !== "timing" ? {
      commandType: command.type,
      ...(this.level === "debug" ? { command: command.text.slice(0, MAX_DEBUG_COMMAND_LENGTH), commandTruncated: command.text.length > MAX_DEBUG_COMMAND_LENGTH } : {}),
    } : {};
    this.record("item_started", { itemId, kind, category, phase, ...commandDetails });
  }

  workbookChanged(before: string, after: string) {
    if (this.level === "timing") return;
    this.record("working_copy_changed", workbookChangeSummary(before, after));
  }

  workbookMissing() {
    if (this.level !== "timing") this.record("working_copy_missing");
  }

  hostCliStarted(category: string, argv: string[]) {
    this.record("host_cli_started", { category, ...(this.level === "debug" ? { argv } : {}) });
  }

  hostCliFinished(category: string, durationMs: number, result: { code: number; output: string; errorOutput: string } | { error: unknown }) {
    if ("error" in result) {
      if (this.level !== "debug") this.record("host_cli_finished", { category, durationMs, status: "failed" });
      else {
        const errorOutput = limitedOutput(String(result.error));
        this.record("host_cli_finished", { category, durationMs, status: "failed", stderr: errorOutput.text, stderrTruncated: errorOutput.truncated });
      }
      return;
    }
    if (this.level !== "debug") this.record("host_cli_finished", { category, durationMs, exitCode: result.code });
    else {
      const stdout = limitedOutput(result.output);
      const stderr = limitedOutput(result.errorOutput);
      this.record("host_cli_finished", { category, durationMs, exitCode: result.code,
        stdout: stdout.text, stdoutTruncated: stdout.truncated, stderr: stderr.text, stderrTruncated: stderr.truncated });
    }
  }

  commandOutputDelta(itemId: string, delta: string) {
    if (this.level !== "debug") return;
    const item = this.items.get(itemId);
    if (!item || item.kind !== "tool") return;
    const remaining = MAX_DEBUG_OUTPUT_LENGTH - (item.output?.length ?? 0);
    item.output = (item.output ?? "") + delta.slice(0, Math.max(0, remaining));
    item.outputTruncated = Boolean(item.outputTruncated || delta.length > remaining);
  }

  itemFirstOutput(itemId: string, kind: DiagnosticOutputKind) {
    const item = this.items.get(itemId);
    if (!item || item.firstOutputSeen) return;
    const elapsedMs = this.elapsedMs();
    item.firstOutputSeen = true;
    this.record("item_first_output", { itemId, kind, durationMs: elapsedMs - item.startedMs });
    if (this.firstStreamOutputMs === null) {
      this.firstStreamOutputMs = elapsedMs;
      this.record("first_stream_output", { itemId, kind });
    }
    if (kind !== "tool_output" && this.firstAgentOutputMs === null) {
      this.firstAgentOutputMs = elapsedMs;
      this.record("first_agent_output", { itemId, kind });
    }
  }

  reasoningSummaryDelta(itemId: string, summaryIndex: number) {
    this.reasoningSummaryStarted(itemId, summaryIndex);
    this.itemFirstOutput(itemId, "reasoning_summary");
  }

  reasoningSummaryStarted(itemId: string, summaryIndex: number) {
    const item = this.items.get(itemId);
    if (!item || item.kind !== "reasoning") return;
    if (!Number.isSafeInteger(summaryIndex) || summaryIndex < 0) throw new Error("Invalid reasoning summary index.");
    if (item.summary?.index === summaryIndex) return;
    if (item.summary) this.finishSummary(itemId, item);
    const startedMs = this.elapsedMs();
    item.summary = { index: summaryIndex, startedMs };
    this.record("reasoning_summary_started", { itemId, summaryIndex });
  }

  private finishSummary(itemId: string, item: ItemTiming) {
    const summary = item.summary;
    if (!summary) return;
    item.summary = undefined;
    this.record("reasoning_summary_finished", { itemId, summaryIndex: summary.index, durationMs: this.elapsedMs() - summary.startedMs });
  }

  itemFinished(itemId: string, status: string, commandResult?: { exitCode: number | null; aggregatedOutput: string | null }) {
    const item = this.items.get(itemId);
    if (!item) return;
    this.finishSummary(itemId, item);
    this.items.delete(itemId);
    const output = this.level === "debug" && commandResult?.aggregatedOutput !== null && commandResult?.aggregatedOutput !== undefined
      ? limitedOutput(commandResult.aggregatedOutput) : null;
    this.record("item_finished", { itemId, kind: item.kind, category: item.category, status, durationMs: this.elapsedMs() - item.startedMs,
      ...(this.level === "debug" && commandResult?.exitCode != null ? { exitCode: commandResult.exitCode } : {}),
      ...(output ? { output: output.text, outputTruncated: output.truncated }
        : item.output === undefined ? {} : { output: item.output, outputTruncated: item.outputTruncated ?? false }) });
  }

  async finish(status: "completed" | "failed" | "interrupted") {
    if (this.finished) throw new Error("Assistant diagnostic run already completed.");
    for (const itemId of this.items.keys()) this.itemFinished(itemId, "incomplete");
    this.record("request_finished", { category: status });
    this.finished = true;
    const totalMs = this.elapsedMs();
    const requested = this.events.find(event => event.event === "turn_requested")?.elapsedMs;
    const completed = this.events.find(event => event.event === "turn_completed")?.elapsedMs;
    const stageDurationsMs: Record<string, number> = {};
    let previousMs = 0;
    for (const [eventName, stage] of PREPARATION_STAGES) {
      const endMs = this.events.find(event => event.event === eventName)?.elapsedMs;
      if (endMs === undefined) break;
      stageDurationsMs[stage] = endMs - previousMs;
      previousMs = endMs;
    }
    const toolDurationsMs: Record<string, number> = {};
    for (const event of this.events) {
      if (event.event !== "item_finished" || event.kind !== "tool" || !event.category || event.durationMs === undefined) continue;
      toolDurationsMs[event.category] = (toolDurationsMs[event.category] ?? 0) + event.durationMs;
    }
    await writeFile(path.join(this.directory, this.filename), JSON.stringify({
      startedAt: this.startedAt.toISOString(), model: this.model, level: this.level, status, totalMs,
      summary: {
        preparationMs: requested ?? null,
        preparationStagesMs: stageDurationsMs,
        agentTurnMs: requested !== undefined && completed !== undefined ? completed - requested : null,
        hostChecksMs: completed !== undefined ? totalMs - completed : null,
        firstStreamOutputMs: this.firstStreamOutputMs,
        firstAgentOutputMs: this.firstAgentOutputMs,
        toolDurationsMs,
        workbookChangeCount: this.events.filter(event => event.event === "working_copy_changed").length,
        note: "Tool-item intervals can be near zero when App Server reports start and completion together; a later gap is not tool runtime. Reasoning-summary timing measures the visible stream, not hidden reasoning. Working-copy changes are sampled every 1.5 seconds and once more at completion; line counts compare contents rather than positions. Sampling cannot detect reads, attribute writes to a specific tool, or guarantee capture of transient writes. Debug logs may contain workbook text, paths, or secrets in commands and tool output. Debug output is limited to 32768 characters per stream; no level stores chat messages or reasoning text.",
      },
      droppedEvents: this.droppedEvents,
      events: this.events,
    }, null, 2) + "\n", { mode: 0o600 });
    const logs = (await readdir(this.directory)).filter(name => /^turn-.*\.json$/.test(name)).sort().reverse();
    for (const old of logs.slice(RETAINED_LOGS)) await unlink(path.join(this.directory, old));
  }
}
