import {
  editWorkbook,
  evaluateWorkbook,
  inspectWorkbook,
  validateWorkbook,
  workbookSourceRevision,
  type WorkbookOperation,
} from "@ordinate/core";
import type { AgentBridge, AgentEvent, AgentModel, AgentPlanStep } from "./contracts";
import { BLANK_DOCUMENT } from "../platform/blankDocument";

/** The raw browser editor exercises the real capability API without a model or account. */
export const DEBUG_PROMPTS = [
  "Replace with a clean demo workbook",
  "Create a sample sheet",
  "Inspect this workbook",
  "Show a failed edit",
] as const;

const DEBUG_MODEL: AgentModel = { slug: "deterministic", displayName: "Local simulator", isDefault: true };
const STEP_DELAY_MS = 280;
const REPLACE_PREVIEW_HOLD_MS = 1_600;
const DEMO_PLAN = ["Create the working sheet", "Add inputs and formulas", "Add the explanatory note", "Validate and calculate"] as const;

type SendInput = Parameters<AgentBridge["send"]>[0];
class DebugTurnStopped extends Error {}

function pause(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DebugTurnStopped()); return; }
    const cancel = () => { clearTimeout(timer); reject(new DebugTurnStopped()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, durationMs);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function completed<T>(result: { status: "completed"; data: T } | { status: "rejected"; failure: { message: string } }): T {
  if (result.status === "rejected") throw new Error(result.failure.message);
  return result.data;
}

function uniqueDemoName(names: string[]): string {
  let suffix = 1;
  while (names.includes(suffix === 1 ? "Assistant Demo" : `Assistant Demo ${suffix}`)) suffix += 1;
  return suffix === 1 ? "Assistant Demo" : `Assistant Demo ${suffix}`;
}

function demoOperations(name: string, sheetIndex: number): WorkbookOperation[][] {
  return [
    [{ op: "insert_sheet", name, sheetIndex }],
    [{
      op: "set_region",
      target: { sheet: name, rows: { start: 0, end: 4 }, columns: { start: 0, end: 5 } },
      values: [
        ["Metric", "Jan", "Feb", "Mar", "Quarter"],
        ["Subscriptions", "120", "135", "150", "= @[_,Jan] + @[_,Feb] + @[_,Mar]"],
        ["Services", "40", "55", "60", "= @[_,Jan] + @[_,Feb] + @[_,Mar]"],
        ["Revenue", "= @[Subscriptions,_] + @[Services,_]", "= @[Subscriptions,_] + @[Services,_]", "= @[Subscriptions,_] + @[Services,_]", "= @[Subscriptions,_] + @[Services,_]"],
      ],
    }],
    [{ op: "set_sheet_note", sheet: name, position: "beforeTable", markdown: "**A small connected model**\n\nChange a monthly input and watch the quarter and revenue totals recalculate. This sheet was built through the same workbook editing capability used by the CLI." }],
  ];
}

export function createBrowserDebugAgentBridge({ stepDelayMs = STEP_DELAY_MS, replacePreviewHoldMs = REPLACE_PREVIEW_HOLD_MS }: { stepDelayMs?: number; replacePreviewHoldMs?: number } = {}): AgentBridge {
  const listeners = new Set<(event: AgentEvent) => void>();
  let running = false;
  let activeRun: AbortController | null = null;
  let awaitingReview = false;
  let nextItemId = 0;
  const emit = (event: AgentEvent) => { for (const listener of listeners) listener(event); };
  const activity = (label: string) => emit({ type: "activity", itemId: `debug-activity-${++nextItemId}`, label });
  const reportPlan = (active: number) => emit({ type: "plan-updated", steps: DEMO_PLAN.map((step, index): AgentPlanStep => ({
    step, status: index < active ? "completed" : index === active ? "inProgress" : "pending",
  })) });
  const say = (text: string) => emit({ type: "message-delta", itemId: `debug-${++nextItemId}`, text, phase: "final_answer" });

  async function send(input: SendInput): Promise<void> {
    if (running || awaitingReview) throw new Error("Finish the current simulated turn before sending another message.");
    if (input.model !== DEBUG_MODEL.slug) throw new Error(`Unknown debug model: ${input.model}`);
    running = true;
    const controller = new AbortController();
    activeRun = controller;
    const wait = (durationMs = stepDelayMs) => pause(durationMs, controller.signal);
    emit({ type: "turn-started" });
    try {
      activity("Checking the current workbook");
      const sourceValidation = completed(await validateWorkbook(input.sourceText));
      const overview = sourceValidation.summary;
      await wait();

      if (input.message === DEBUG_PROMPTS[2]) {
        const active = input.activeSheet ?? overview.sheets[0]?.name ?? "none";
        say(`**Workbook inspected**\n\n- Active sheet: \`${active}\`\n- Sheets: ${overview.sheets.length}\n- Names: ${overview.sheets.map(sheet => `\`${sheet.name}\``).join(", ")}\n- Validation: ${sourceValidation.valid ? "passed" : "failed"}\n\nThis response is deterministic; it did not change the document.`);
        emit({ type: "turn-finished", error: null, proposal: null });
        return;
      }
      if (input.message === DEBUG_PROMPTS[3]) {
        activity("Simulating a rejected edit");
        await wait();
        const working = sourceValidation.valid ? input.sourceText : BLANK_DOCUMENT;
        const result = await editWorkbook(working, { baseRevision: await workbookSourceRevision(working), operations: [{ op: "delete_sheet", sheet: "A sheet that does not exist" }] });
        if (result.status !== "rejected") throw new Error("The rejection scenario unexpectedly succeeded.");
        emit({ type: "turn-finished", error: `Edit rejected: ${result.failure.message} Your workbook is unchanged.`, proposal: null });
        return;
      }
      if (input.message !== DEBUG_PROMPTS[0] && input.message !== DEBUG_PROMPTS[1]) {
        say(`This is a **deterministic UI simulator**, not an AI model.${input.attachments.length ? ` Received ${input.attachments.length} attachment${input.attachments.length === 1 ? "" : "s"} for interface testing; their contents were not interpreted.` : ""} Choose one of the fixed examples below. Your message was not used to edit the workbook.`);
        emit({ type: "turn-finished", error: null, proposal: null });
        return;
      }

      const replacing = input.message === DEBUG_PROMPTS[0];
      if (!replacing && !sourceValidation.valid) {
        emit({ type: "turn-finished", error: "The current workbook has validation errors, so the editing tool cannot change it. Choose “Replace with a clean demo workbook” to test the workflow, or fix the source first.", proposal: null });
        return;
      }
      const startingText = replacing ? BLANK_DOCUMENT : input.sourceText;
      const startingOverview = replacing ? completed(await inspectWorkbook(startingText)) : overview;
      const name = uniqueDemoName(startingOverview.sheets.map(sheet => sheet.name));
      let candidate = startingText;
      if (replacing) { activity("Starting a clean temporary workbook"); await wait(); }
      const stages = demoOperations(name, startingOverview.sheets.length);
      emit({ type: "message-delta", itemId: `debug-${++nextItemId}`, text: `I’ll build ${name} on a separate copy, then check its formulas before applying it.`, phase: "commentary" });
      const labels = ["Calling editWorkbook · insert_sheet", "Calling editWorkbook · set_region with formulas", "Calling editWorkbook · set_sheet_note"];
      for (let index = 0; index < stages.length; index += 1) {
        reportPlan(index);
        activity(labels[index]);
        const edited = completed(await editWorkbook(candidate, { baseRevision: await workbookSourceRevision(candidate), operations: stages[index] }));
        candidate = edited.candidate.source;
        const summary = completed(await inspectWorkbook(candidate));
        emit({ type: "draft-preview", text: candidate });
        emit({ type: "draft-summary", sheets: summary.sheets.map(sheet => ({ name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount })) });
        await wait();
      }
      if (replacing) {
        activity("Showing the finished working copy");
        await wait(replacePreviewHoldMs);
      }
      reportPlan(3);
      activity("Validating and evaluating the proposal");
      const validation = completed(await validateWorkbook(candidate));
      if (!validation.valid) throw new Error("The simulated workbook did not validate.");
      const before = completed(await evaluateWorkbook(startingText));
      const after = completed(await evaluateWorkbook(candidate));
      if (after.summary.errorCount > before.summary.errorCount) throw new Error("The simulated edit introduced evaluation errors.");
      await wait();
      reportPlan(4);
      say(`${replacing ? "Replaced the current workbook with a clean demo containing" : "Created"} **${name}** with monthly inputs, formulas, and a note. The temporary copy passed validation and evaluation. Applying it to the editor is one undoable change${replacing ? "; Undo restores the previous workbook" : ""}.`);
      awaitingReview = true;
      emit({ type: "turn-finished", error: null, proposal: { baseText: input.sourceText, text: candidate, validation: "Validated and evaluated", focusSheet: name } });
    } catch (error) {
      if (error instanceof DebugTurnStopped) emit({ type: "turn-stopped" });
      else emit({ type: "turn-finished", error: String(error), proposal: null });
    } finally {
      running = false;
      activeRun = null;
    }
  }

  return {
    connection: async () => ({ state: "ready", email: null }),
    login: async () => { throw new Error("The browser simulator does not use ChatGPT sign-in."); },
    models: async () => [DEBUG_MODEL],
    send,
    stop: async () => {
      if (!activeRun) throw new Error("The assistant has no task to stop.");
      activeRun.abort();
    },
    openDiagnosticsFolder: async () => { throw new Error("Assistant diagnostics are available only in the macOS app."); },
    openLink: async url => { window.open(url, "_blank", "noopener,noreferrer"); },
    startSystemDictation: async () => { throw new Error("System Dictation is available only in the macOS app."); },
    stopSystemDictation: async () => { throw new Error("System Dictation is available only in the macOS app."); },
    resolveProposal: async () => { awaitingReview = false; },
    onEvent: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  };
}
