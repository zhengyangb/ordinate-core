import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { AgentServer } from "./agentServer.js";
import { activityForStartedItem, diagnosticCommandType, diagnosticToolCategoryForStartedItem } from "./agentActivity.js";
import { isMissingScratchFile } from "./agentScratchFile.js";
import { parseAgentModels } from "./agentModelCatalog.js";
import { chatGptAuth } from "./chatGptAuth.js";
import type { AgentConnection, AgentEvent, AgentMessagePhase, AgentModel, AgentPlanStep, AgentProposal } from "../src/agent/contracts.js";
import type { AgentAttachment } from "../src/agent/attachments.js";
import { appKit } from "./nativeChrome.js";
import { stageAgentAttachments } from "./agentAttachments.js";
import { parseTokenCounts, turnTokenUsage, ZERO_TOKEN_COUNTS, type TokenCounts } from "./agentTokenUsage.js";
import { AgentDiagnosticRun, agentDiagnosticDirectory } from "./agentDiagnostics.js";
import { agentDeveloperInstructions } from "./agentInstructions.js";
import { agentTurnInput } from "./agentTurnInput.js";
import { agentCliCommand, agentCliLauncher } from "./agentCliLauncher.js";
import type { AgentDiagnosticLevel } from "../src/agent/diagnosticLevel.js";
import type { AgentReasoningEffort } from "../src/agent/reasoningEffort.js";

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 12_000;
const execFileAsync = promisify(execFile);
type ThreadResponse = { thread: { id: string } };
type TurnResponse = { turn: { id: string } };
type Completion = { threadId: string; turn: { id: string; status: string; error?: { message?: string } | null } };
type TokenUsageUpdate = { threadId: string; turnId: string; tokenUsage: { total: TokenCounts } };
type AgentConversationThread = { sessionId: string; threadId: string | null; needsResume: boolean; tokenTotal: TokenCounts };
type AgentSendInput = { sessionId: string; message: string; sourceText: string; activeSheet: string | null; untouchedDefault: boolean; model: string; attachments: AgentAttachment[]; diagnosticLevel: AgentDiagnosticLevel; reasoningEffort: AgentReasoningEffort };
class AgentTurnStopped extends Error {}
function agentResources() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "agent")
    : path.resolve(app.getAppPath(), "../../packages/cli");
}

async function codexExecutable() {
  if (process.platform !== "darwin") throw new Error("The desktop AI assistant currently requires macOS.");
  // Finder/Dock launches do not inherit the user's interactive shell PATH.
  // Resolve the system-installed CLI with the same login environment as Terminal.
  let executable: string;
  try {
    const { stdout } = await execFileAsync("/bin/zsh", ["-lc", "whence -p codex"], { timeout: 5_000 });
    executable = stdout.trim();
    if (!path.isAbsolute(executable) || executable.includes("\n")) throw new Error("Invalid Codex executable path.");
    await access(executable, constants.X_OK);
  } catch {
    throw new Error("Codex CLI is not available in your login shell. Install it, confirm `codex --version` works in Terminal, then retry.");
  }
  return executable;
}

function cliInvocation(args: string[]): [string, ...string[]] {
  const cli = path.join(agentResources(), app.isPackaged ? "ordinate-cli.mjs" : "dist/ordinate-cli.mjs");
  return [process.execPath, cli, ...args];
}

function runCli(invocation: [string, ...string[]]): Promise<{ code: number; output: string; errorOutput: string }> {
  const [executable, ...args] = invocation;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill(), 60_000);
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", chunk => { output += String(chunk); if (output.length > 1_000_000) child.kill(); });
    child.stderr.on("data", chunk => { errorOutput += String(chunk); if (errorOutput.length > 1_000_000) child.kill(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); resolve({ code: code ?? 1, output: output.trim(), errorOutput: errorOutput.trim() }); });
  });
}

type CliEvaluation = { result: { status: string; diagnostics: Array<{ code: string; location?: { sheet?: string } }>; failure?: { stage: string } } | null };
type CliValidation = { result: { data: { valid: boolean; summary: { sheets: Array<{ name: string; rowCount: number; columnCount: number | null }> } } } | null };
function evaluationDiagnostics(report: { code: number; output: string; errorOutput: string }, subject = "The workbook") {
  if (report.code !== 0 && report.code !== 3 && report.code !== 4) throw new Error(`${subject} could not be evaluated.\n${(report.output || report.errorOutput).slice(0, 2000)}`);
  const parsed = JSON.parse(report.output) as CliEvaluation;
  if (report.code === 3 && parsed.result?.status === "rejected" && parsed.result.failure?.stage === "validation") {
    throw new Error(`${subject} did not validate.\n${report.output.slice(0, 2000)}`);
  }
  if (parsed.result?.status !== "completed") throw new Error("The workbook evaluation was incomplete.");
  const counts = new Map<string, number>();
  for (const diagnostic of parsed.result.diagnostics) {
    const key = `${diagnostic.location?.sheet ?? ""}:${diagnostic.code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** A document-scoped scratch copy is the only writable agent target. */
export class AgentSession {
  private server: AgentServer | null = null;
  private serverToken: string | null = null;
  private workspace: string | null = null;
  private conversations = new Map<string, AgentConversationThread>();
  private activeConversation: AgentConversationThread | null = null;
  private preparingTurn = false;
  private finishingTurn = false;
  private stopRequested = false;
  private interruptRequest: Promise<void> | null = null;
  private turnStartRequest: Promise<TurnResponse> | null = null;
  private activeTurnId: string | null = null;
  private displayedTurnId: string | null = null;
  private turnTokenBaseline: TokenCounts = ZERO_TOKEN_COUNTS;
  private messagePhases = new Map<string, AgentMessagePhase | undefined>();
  private baseText: string | null = null;
  private baselineDiagnostics = new Map<string, number>();
  private awaitingReview = false;
  private modelCatalog: AgentModel[] | null = null;
  private modelCatalogToken: string | null = null;
  private draftPollTimer: NodeJS.Timeout | null = null;
  private draftReadInProgress = false;
  private lastDraftVersion: string | null = null;
  private lastDraftText: string | null = null;
  private diagnostic: AgentDiagnosticRun | null = null;
  private readonly unsubscribeAuth: () => void;
  constructor(private readonly emit: (event: AgentEvent) => void) {
    this.unsubscribeAuth = chatGptAuth.subscribe(() => {
      void this.connection().then(connection => this.emit({ type: "connection", connection }));
    });
  }

  private invalidateServer() {
    if (this.server) {
      this.server.onNotification = () => {};
      this.server.dispose();
    }
    this.server = null;
    this.serverToken = null;
    for (const conversation of this.conversations.values()) conversation.needsResume = Boolean(conversation.threadId);
  }

  private async ensureServer() {
    const token = await chatGptAuth.accessToken();
    if (!token) throw new Error("Connect ChatGPT before starting the assistant.");
    if (this.server && this.serverToken === token) return this.server;
    if (this.server) this.invalidateServer();
    const workspace = this.workspace ?? await mkdtemp(path.join(os.tmpdir(), "ordinate-agent-"));
    try {
      if (!this.workspace) {
        const resource = agentResources();
        await cp(path.join(resource, "skills", "ordinate-authoring"), path.join(workspace, "ordinate-authoring"), { recursive: true });
        const cli = path.join(resource, app.isPackaged ? "ordinate-cli.mjs" : "dist/ordinate-cli.mjs");
        await writeFile(path.join(workspace, "ordinate-cli"), agentCliLauncher(process.execPath, cli), { mode: 0o700 });
      }
      this.workspace = workspace;
      const server = new AgentServer(await codexExecutable(), workspace, token, app.getVersion());
      server.onNotification = (method, params) => { void this.onNotification(method, params); };
      this.server = server;
      this.serverToken = token;
      return server;
    } catch (error) {
      if (!this.workspace) await rm(workspace, { recursive: true, force: true });
      throw error;
    }
  }

  async connection(): Promise<AgentConnection> {
    try {
      const account = await chatGptAuth.account();
      if (!account) return chatGptAuth.signingIn ? { state: "signing-in" }
        : chatGptAuth.error ? { state: "sign-in-error", reason: chatGptAuth.error }
        : { state: "signed-out" };
      const server = await this.ensureServer();
      await server.request("config/read", { includeLayers: false });
      return { state: "ready", email: account.email };
    } catch (error) {
      this.invalidateServer();
      const reason = String(error);
      return { state: "unavailable", reason: `Codex App Server is unavailable: ${reason}` };
    }
  }

  async login() {
    await chatGptAuth.login();
  }

  async models(): Promise<AgentModel[]> {
    const token = await chatGptAuth.accessToken();
    if (!token) throw new Error("Connect ChatGPT before choosing a model.");
    const server = await this.ensureServer();
    const [response, catalog] = await Promise.all([
      fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
      }),
      server.request<{ data: Array<{ model: string; isDefault: boolean }> }>("model/list", { includeHidden: true }),
    ]);
    if (!response.ok) throw new Error(`Could not load models for this ChatGPT account (${response.status}).`);
    if (!Array.isArray(catalog.data)) throw new Error("Codex returned an invalid model catalog.");
    const defaultSlug = catalog.data.find(item => item.isDefault)?.model ?? null;
    const models = parseAgentModels(await response.json()).map(model => ({ ...model, isDefault: model.slug === defaultSlug }));
    this.modelCatalog = models;
    this.modelCatalogToken = token;
    return models;
  }

  async send(input: AgentSendInput) {
    if ((!input.message.trim() && !input.attachments.length) || input.message.length > MAX_MESSAGE_LENGTH) throw new Error("Write a shorter request before sending.");
    if (Buffer.byteLength(input.sourceText) > MAX_DOCUMENT_BYTES) throw new Error("This workbook is too large for the AI scratch workspace.");
    if (this.preparingTurn || this.activeTurnId || this.finishingTurn || this.awaitingReview) throw new Error("Finish reviewing the current change first.");
    this.stopRequested = false;
    this.interruptRequest = null;
    this.preparingTurn = true;
    try {
      if (input.diagnosticLevel !== "off") this.diagnostic = await AgentDiagnosticRun.begin(agentDiagnosticDirectory(app.getPath("userData")), input.model, input.diagnosticLevel);
      this.throwIfStopped();
      this.diagnostic?.record("reasoning_effort_selected", { effort: input.reasoningEffort });
      await this.sendPrepared(input);
    } catch (error) {
      if (this.stopRequested || error instanceof AgentTurnStopped) {
        this.baseText = null;
        this.stopDraftPreview();
        await this.finishDiagnostic("interrupted");
        this.stopRequested = false;
        this.emit({ type: "turn-stopped" });
        return;
      }
      await this.finishDiagnostic("failed");
      throw error;
    }
    finally { this.preparingTurn = false; }
  }

  private throwIfStopped() {
    if (this.stopRequested) throw new AgentTurnStopped();
  }

  private async interruptActiveTurn() {
    if (this.interruptRequest) return this.interruptRequest;
    const threadId = this.activeConversation?.threadId;
    const turnId = this.activeTurnId;
    const server = this.server;
    if (!threadId || !turnId || !server) throw new Error("An active assistant turn has no App Server identity.");
    this.interruptRequest = server.request<void>("turn/interrupt", { threadId, turnId }).catch(error => {
      if (this.activeTurnId !== turnId) return;
      this.interruptRequest = null;
      this.stopRequested = false;
      throw error;
    });
    return this.interruptRequest;
  }

  async stop() {
    if (!this.preparingTurn && !this.activeTurnId && !this.finishingTurn) throw new Error("The assistant has no task to stop.");
    this.stopRequested = true;
    if (this.activeTurnId) { await this.interruptActiveTurn(); return; }
    if (this.turnStartRequest) {
      try { await this.turnStartRequest; }
      catch { return; }
      if (this.activeTurnId) await this.interruptActiveTurn();
    }
  }

  private async finishDiagnostic(status: "completed" | "failed" | "interrupted") {
    const run = this.diagnostic;
    this.diagnostic = null;
    if (run) await run.finish(status);
  }

  private async runTrackedCli(stage: "baseline.evaluate" | "preview.validate" | "final.evaluate", args: string[]) {
    const started = performance.now();
    const invocation = cliInvocation(args);
    this.diagnostic?.hostCliStarted(stage, invocation);
    try {
      const result = await runCli(invocation);
      this.diagnostic?.hostCliFinished(stage, Math.round(performance.now() - started), result);
      return result;
    } catch (error) {
      this.diagnostic?.hostCliFinished(stage, Math.round(performance.now() - started), { error });
      throw error;
    }
  }

  private async sendPrepared(input: AgentSendInput) {
    const token = await chatGptAuth.accessToken();
    this.throwIfStopped();
    this.diagnostic?.record("auth_checked");
    if (!token) throw new Error("Connect ChatGPT before sending a request.");
    if (this.modelCatalogToken !== token) await this.models();
    this.throwIfStopped();
    if (!this.modelCatalog?.some(model => model.slug === input.model)) {
      throw new Error("Choose a model from the current ChatGPT account before sending.");
    }
    this.diagnostic?.record("model_ready");
    const connection = await this.connection();
    this.throwIfStopped();
    if (connection.state !== "ready") throw new Error("Connect ChatGPT before sending a request.");
    this.diagnostic?.record("connection_ready");
    const server = await this.ensureServer();
    this.throwIfStopped();
    this.diagnostic?.record("server_ready");
    const workspace = this.workspace!;
    const file = path.join(workspace, "Workbook.ord");
    let conversation = this.conversations.get(input.sessionId);
    if (!conversation) {
      conversation = { sessionId: input.sessionId, threadId: null, needsResume: false, tokenTotal: ZERO_TOKEN_COUNTS };
      this.conversations.set(input.sessionId, conversation);
    }
    this.activeConversation = conversation;
    if (!appKit) throw new Error("Desktop attachments require macOS.");
    const staged = await stageAgentAttachments(workspace, input.attachments, appKit.extractAssistantPDF);
    this.throwIfStopped();
    this.diagnostic?.record("attachments_staged");
    await writeFile(file, input.sourceText, "utf8");
    this.throwIfStopped();
    this.diagnostic?.record("source_written");
    this.baselineDiagnostics = evaluationDiagnostics(await this.runTrackedCli("baseline.evaluate", ["evaluate", file, "--json"]));
    this.throwIfStopped();
    this.diagnostic?.record("baseline_evaluated");
    this.baseText = input.sourceText;
    if (conversation.threadId && conversation.needsResume) {
      await server.request("thread/resume", { threadId: conversation.threadId, cwd: workspace });
      this.throwIfStopped();
      conversation.needsResume = false;
    }
    if (!conversation.threadId) {
      const guide = await readFile(path.join(agentResources(), "skills", "ordinate-authoring", "SKILL.md"), "utf8");
      this.throwIfStopped();
      const developerInstructions = agentDeveloperInstructions(guide, {
        inspect: agentCliCommand("inspect"), validate: agentCliCommand("validate"), evaluate: agentCliCommand("evaluate"),
      });
      this.diagnostic?.record("guidance_injected", { bytes: Buffer.byteLength(guide) });
      const { thread } = await server.request<ThreadResponse>("thread/start", {
        cwd: workspace, sandbox: "workspace-write", approvalPolicy: "never", ephemeral: false, model: input.model,
        developerInstructions,
      });
      conversation.threadId = thread.id;
      conversation.tokenTotal = ZERO_TOKEN_COUNTS;
      this.throwIfStopped();
    }
    this.diagnostic?.record("thread_ready");
    this.turnTokenBaseline = conversation.tokenTotal;
    this.displayedTurnId = null;
    this.emit({ type: "turn-started" });
    this.messagePhases.clear();
    this.emit({ type: "activity", itemId: "host-start", label: "Starting work on a private copy" });
    try {
      const turnInput = agentTurnInput({
        message: input.message, file, sourceText: input.sourceText, activeSheet: input.activeSheet,
        untouchedDefault: input.untouchedDefault, attachmentPrompt: staged.prompt,
      });
      this.diagnostic?.record("workbook_context_prepared", { status: turnInput.workbookInlined ? "inlined" : "path_only", bytes: Buffer.byteLength(input.sourceText) });
      this.diagnostic?.record("turn_requested");
      this.turnStartRequest = server.request<TurnResponse>("turn/start", {
        threadId: conversation.threadId, model: input.model, effort: input.reasoningEffort,
        input: [{ type: "text", text: turnInput.text }, ...staged.images],
      });
      const { turn } = await this.turnStartRequest;
      this.turnStartRequest = null;
      if (this.displayedTurnId === turn.id && this.activeTurnId === null) return;
      this.activeTurnId = turn.id;
      this.diagnostic?.record("turn_accepted");
      this.displayedTurnId = turn.id;
      this.emit({ type: "activity-finished", itemId: "host-start", status: "completed" });
      if (this.stopRequested) return;
      this.startDraftPreview();
    } catch (error) {
      this.turnStartRequest = null;
      this.baseText = null;
      this.emit({ type: "activity-finished", itemId: "host-start", status: "failed" });
      throw error;
    }
  }

  private startDraftPreview() {
    this.stopDraftPreview();
    this.lastDraftText = this.baseText;
    this.draftPollTimer = setInterval(() => { void this.readDraftSummary(); }, 1_500);
  }

  private async readDraftSummary() {
    if (this.draftReadInProgress) return;
    const turnId = this.activeTurnId;
    if (!turnId || !this.workspace) return;
    this.draftReadInProgress = true;
    try {
      const file = path.join(this.workspace, "Workbook.ord");
      const details = await stat(file, { bigint: true });
      const version = `${details.size}:${details.mtimeNs}`;
      if (version === this.lastDraftVersion) return;
      this.lastDraftVersion = version;
      const text = await readFile(file, "utf8");
      if (this.activeTurnId !== turnId) return;
      if (text === this.lastDraftText || Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) return;
      this.diagnostic?.workbookChanged(this.lastDraftText ?? "", text);
      this.lastDraftText = text;
      const report = await this.runTrackedCli("preview.validate", ["validate", file, "--json"]);
      if (report.code !== 0) return; // A half-written draft is normal; keep the last valid preview.
      const result = JSON.parse(report.output) as CliValidation;
      if (!result.result?.data.valid) throw new Error("The draft validator returned an inconsistent result.");
      if (this.activeTurnId !== turnId) return;
      this.emit({ type: "draft-preview", text });
      this.emit({ type: "draft-summary", sheets: result.result.data.summary.sheets.map(sheet => {
        if (sheet.columnCount === null) throw new Error("A valid draft contains a sheet without columns.");
        return { name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount };
      }) });
    } catch (error) {
      if (this.activeTurnId !== turnId) return;
      if (isMissingScratchFile(error)) {
        if (this.lastDraftText !== null) {
          this.diagnostic?.workbookMissing();
          this.lastDraftVersion = null;
          this.lastDraftText = null;
          this.emit({ type: "draft-summary", sheets: null });
        }
      } else {
        this.stopDraftPreview();
        console.error("Assistant draft preview stopped:", error);
        this.emit({ type: "activity", itemId: "host-preview-error", label: "Live preview stopped; the final workbook will still be checked." });
        this.emit({ type: "activity-finished", itemId: "host-preview-error", status: "failed" });
      }
    } finally {
      this.draftReadInProgress = false;
    }
  }

  private stopDraftPreview() {
    if (this.draftPollTimer) clearInterval(this.draftPollTimer);
    this.draftPollTimer = null;
    this.lastDraftVersion = null;
    this.lastDraftText = null;
  }

  resolveProposal() { this.awaitingReview = false; this.baseText = null; }

  private async onNotification(method: string, params: unknown) {
    if (method === "server/disconnected") {
      const interrupted = this.activeTurnId !== null;
      this.stopDraftPreview();
      this.messagePhases.clear();
      this.activeTurnId = null;
      this.baseText = null;
      this.invalidateServer();
      await this.finishDiagnostic("interrupted");
      this.emit({ type: "connection", connection: { state: "unavailable", reason: "Codex App Server stopped." } });
      if (interrupted) this.emit({ type: "turn-finished", error: "The assistant connection stopped before this request finished.", proposal: null });
      return;
    }
    if (method === "turn/started") {
      const event = params as { threadId: string; turn: { id: string } };
      if (event.threadId === this.activeConversation?.threadId) {
        this.diagnostic?.record("turn_started");
        this.turnTokenBaseline = this.activeConversation.tokenTotal;
        this.activeTurnId = event.turn.id;
        this.displayedTurnId = event.turn.id;
      }
      return;
    }
    if (method === "thread/tokenUsage/updated") {
      const event = params as TokenUsageUpdate;
      const conversation = [...this.conversations.values()].find(item => item.threadId === event.threadId);
      if (!conversation) return;
      const total = parseTokenCounts(event.tokenUsage.total);
      conversation.tokenTotal = total;
      if (conversation === this.activeConversation && event.turnId === this.displayedTurnId) {
        const usage = turnTokenUsage(total, this.turnTokenBaseline);
        this.diagnostic?.record("token_usage", { inputTokens: usage.turn.input, outputTokens: usage.turn.output, cachedInputTokens: usage.turn.cachedInput });
        this.emit({ type: "token-usage", sessionId: conversation.sessionId, usage });
      }
      return;
    }
    if (method === "item/agentMessage/delta") {
      const event = params as { threadId: string; turnId: string; itemId: string; delta: string };
      if (event.threadId === this.activeConversation?.threadId && event.turnId === this.activeTurnId) {
        if (event.delta) this.diagnostic?.itemFirstOutput(event.itemId, "message");
        this.emit({ type: "message-delta", itemId: event.itemId, text: event.delta, phase: this.messagePhases.get(event.itemId) });
      }
      return;
    }
    if (method === "item/reasoning/summaryTextDelta") {
      const event = params as { threadId: string; turnId: string; itemId: string; summaryIndex: number; delta: string };
      if (event.threadId === this.activeConversation?.threadId && event.turnId === this.activeTurnId && event.delta) {
        this.diagnostic?.reasoningSummaryDelta(event.itemId, event.summaryIndex);
      }
      return;
    }
    if (method === "item/reasoning/summaryPartAdded") {
      const event = params as { threadId: string; turnId: string; itemId: string; summaryIndex: number };
      if (event.threadId === this.activeConversation?.threadId && event.turnId === this.activeTurnId) {
        this.diagnostic?.reasoningSummaryStarted(event.itemId, event.summaryIndex);
      }
      return;
    }
    if (method === "item/commandExecution/outputDelta") {
      const event = params as { threadId: string; turnId: string; itemId: string; delta: string };
      if (event.threadId === this.activeConversation?.threadId && event.turnId === this.activeTurnId && event.delta) {
        this.diagnostic?.itemFirstOutput(event.itemId, "tool_output");
        this.diagnostic?.commandOutputDelta(event.itemId, event.delta);
      }
      return;
    }
    if (method === "item/started") {
      const event = params as { threadId: string; turnId: string; item: { id: string; type: string; phase?: AgentMessagePhase; command?: string } };
      if (event.threadId === this.activeConversation?.threadId && event.turnId === this.activeTurnId) {
        if (event.item.type === "agentMessage") this.messagePhases.set(event.item.id, event.item.phase);
        const label = activityForStartedItem(event.item);
        const category = diagnosticToolCategoryForStartedItem(event.item);
        if (event.item.type === "agentMessage") this.diagnostic?.itemStarted(event.item.id, "message", undefined, event.item.phase);
        else if (event.item.type === "reasoning") this.diagnostic?.itemStarted(event.item.id, "reasoning");
        else if (category) this.diagnostic?.itemStarted(event.item.id, "tool", category, undefined,
          event.item.type === "commandExecution" ? { type: diagnosticCommandType(event.item.command ?? ""), text: event.item.command ?? "" } : undefined);
        if (label) this.emit({ type: "activity", itemId: event.item.id, label });
      }
      return;
    }
    if (method === "item/completed") {
      const event = params as { threadId: string; turnId: string; item: { id: string; type: string; status?: string; aggregatedOutput?: string | null; exitCode?: number | null } };
      if (event.threadId === this.activeConversation?.threadId && event.turnId === this.activeTurnId) {
        this.diagnostic?.itemFinished(event.item.id, event.item.status ?? "completed", event.item.type === "commandExecution"
          ? { aggregatedOutput: event.item.aggregatedOutput ?? null, exitCode: event.item.exitCode ?? null } : undefined);
        this.emit({ type: "activity-finished", itemId: event.item.id, status: event.item.status === undefined || event.item.status === "completed" ? "completed" : "failed" });
      }
      return;
    }
    if (method === "turn/plan/updated") {
      const event = params as { threadId: string; turnId: string; plan: AgentPlanStep[] };
      if (event.threadId === this.activeConversation?.threadId && event.turnId === this.activeTurnId) {
        this.emit({ type: "plan-updated", steps: event.plan });
      }
      return;
    }
    if (method !== "turn/completed") return;
    const event = params as Completion;
    if (event.threadId !== this.activeConversation?.threadId || event.turn.id !== this.activeTurnId) return;
    this.finishingTurn = true;
    try {
      this.diagnostic?.record("turn_completed", { status: event.turn.status });
      const lastObservedDraftText = this.lastDraftText;
      this.stopDraftPreview();
      this.messagePhases.clear();
      this.activeTurnId = null;
      if (this.stopRequested || event.turn.status === "interrupted") {
        this.baseText = null;
        await this.finishDiagnostic("interrupted");
        this.emit({ type: "turn-stopped" });
        return;
      }
      if (event.turn.status !== "completed") {
        this.baseText = null;
        await this.finishDiagnostic("failed");
        this.emit({ type: "turn-finished", error: event.turn.error?.message ?? `Agent turn ${event.turn.status}.`, proposal: null });
        return;
      }
      let proposal: AgentProposal | null = null;
      let errorMessage: string | null = null;
      try {
        const baseText = this.baseText!;
        const file = path.join(this.workspace!, "Workbook.ord");
        let text: string;
        try { text = await readFile(file, "utf8"); }
        catch (error) {
          if (isMissingScratchFile(error)) throw new Error("The assistant did not leave a workbook to apply. Your original workbook is unchanged.");
          throw error;
        }
        this.throwIfStopped();
        if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw new Error("The proposed workbook is too large.");
        if (text !== lastObservedDraftText) this.diagnostic?.workbookChanged(lastObservedDraftText ?? "", text);
        if (text !== baseText) {
          const diagnostics = evaluationDiagnostics(await this.runTrackedCli("final.evaluate", ["evaluate", file, "--json"]), "The proposed workbook");
          this.throwIfStopped();
          for (const [key, count] of diagnostics) {
            if (count > (this.baselineDiagnostics.get(key) ?? 0)) throw new Error(`The proposed workbook introduced evaluation errors in ${key}.`);
          }
          proposal = { baseText, text, validation: diagnostics.size ? "Validated; existing evaluation errors unchanged" : "Validated and evaluated" };
        }
      } catch (error) {
        this.baseText = null;
        if (!(error instanceof AgentTurnStopped)) errorMessage = String(error);
      }
      await this.finishDiagnostic(this.stopRequested ? "interrupted" : errorMessage ? "failed" : "completed");
      if (this.stopRequested) { this.emit({ type: "turn-stopped" }); return; }
      if (proposal && !errorMessage) this.awaitingReview = true;
      this.emit({ type: "turn-finished", error: errorMessage, proposal: errorMessage ? null : proposal });
    } finally {
      this.finishingTurn = false;
      this.stopRequested = false;
      this.interruptRequest = null;
    }
  }

  async dispose() {
    this.stopDraftPreview();
    this.unsubscribeAuth();
    this.server?.dispose();
    this.server = null;
    await this.finishDiagnostic("interrupted");
    if (this.workspace) await rm(this.workspace, { recursive: true, force: true });
    this.workspace = null;
  }
}
