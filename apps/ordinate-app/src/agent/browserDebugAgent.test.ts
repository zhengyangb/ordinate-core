import { describe, expect, it } from "vitest";
import { evaluateWorkbook, inspectWorkbook, validateWorkbook } from "@ordinate/core";
import { createBrowserDebugAgentBridge, DEBUG_PROMPTS } from "./browserDebugAgent";
import type { AgentEvent } from "./contracts";

const SOURCE = "# Plan\n| Item || Jan | Feb |\n| --- || --- | --- |\n| Revenue || 100 | 120 |\n";

function setup(delays: { stepDelayMs: number; replacePreviewHoldMs: number } = { stepDelayMs: 0, replacePreviewHoldMs: 0 }) {
  const bridge = createBrowserDebugAgentBridge(delays);
  const events: AgentEvent[] = [];
  bridge.onEvent(event => events.push(event));
  const send = (message: string, sourceText = SOURCE) => bridge.send({ sessionId: "00000000-0000-4000-8000-000000000001", message, sourceText, activeSheet: "Plan", untouchedDefault: false, model: "deterministic", attachments: [], diagnosticLevel: "off", reasoningEffort: "medium" });
  return { bridge, events, send };
}

function lastFinish(events: AgentEvent[]) {
  return events.filter(event => event.type === "turn-finished").at(-1);
}

describe("raw browser assistant simulator", () => {
  it("holds a replaced working copy on screen after its last draft update", async () => {
    const { bridge, send } = setup({ stepDelayMs: 0, replacePreviewHoldMs: 40 });
    let previewAt = 0;
    let finishedAt = 0;
    bridge.onEvent(event => {
      if (event.type === "draft-preview") previewAt = performance.now();
      if (event.type === "turn-finished") finishedAt = performance.now();
    });
    await send(DEBUG_PROMPTS[0]);
    expect(previewAt).toBeGreaterThan(0);
    expect(finishedAt - previewAt).toBeGreaterThanOrEqual(35);
  });

  it("stops an in-progress edit without proposing the working copy and permits a later turn", async () => {
    const { bridge, events, send } = setup({ stepDelayMs: 40, replacePreviewHoldMs: 200 });
    const turn = send(DEBUG_PROMPTS[0]);
    await bridge.stop();
    await turn;
    expect(events.some(event => event.type === "turn-stopped")).toBe(true);
    expect(events.some(event => event.type === "turn-finished")).toBe(false);
    await send(DEBUG_PROMPTS[2]);
    expect(lastFinish(events)).toMatchObject({ error: null, proposal: null });
  });

  it("discards a visible partial preview when stopped mid-edit", async () => {
    const { bridge, events, send } = setup({ stepDelayMs: 30, replacePreviewHoldMs: 200 });
    let sawPreview!: () => void;
    const preview = new Promise<void>(resolve => { sawPreview = resolve; });
    bridge.onEvent(event => { if (event.type === "draft-preview") sawPreview(); });
    const turn = send(DEBUG_PROMPTS[0]);
    await preview;
    await bridge.stop();
    await turn;
    expect(events.some(event => event.type === "draft-preview")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "turn-stopped" });
    expect(events.some(event => event.type === "turn-finished" && event.proposal)).toBe(false);
  });

  it("uses workbook capabilities to stage a valid formula sheet and proposes one undoable document change", async () => {
    const { bridge, events, send } = setup();
    await send(DEBUG_PROMPTS[1]);
    const finished = lastFinish(events);
    expect(finished?.type).toBe("turn-finished");
    if (finished?.type !== "turn-finished" || !finished.proposal) throw new Error(`Missing proposal: ${JSON.stringify(finished)}`);
    expect(finished.proposal.baseText).toBe(SOURCE);
    expect((await validateWorkbook(finished.proposal.text)).status).toBe("completed");
    const inspected = await inspectWorkbook(finished.proposal.text);
    expect(inspected.status).toBe("completed");
    if (inspected.status !== "completed") throw new Error(inspected.failure.message);
    expect(inspected.data.sheets.map(sheet => sheet.name)).toEqual(["Plan", "Assistant Demo"]);
    const evaluated = await evaluateWorkbook(finished.proposal.text);
    expect(evaluated.status).toBe("completed");
    if (evaluated.status !== "completed") throw new Error(evaluated.failure.message);
    expect(evaluated.data.summary.errorCount).toBe(0);
    expect(events.filter(event => event.type === "draft-summary")).toHaveLength(3);
    const previews = events.filter((event): event is Extract<AgentEvent, { type: "draft-preview" }> => event.type === "draft-preview");
    expect(previews).toHaveLength(3);
    expect(previews[0].text).toContain("# Assistant Demo");
    expect(previews[1].text).toContain("Subscriptions");
    expect(previews[2].text).toContain("A small connected model");
    const planUpdates = events.filter(event => event.type === "plan-updated");
    expect(planUpdates).toHaveLength(5);
    expect(planUpdates[0]?.steps.map(step => step.status)).toEqual(["inProgress", "pending", "pending", "pending"]);
    expect(planUpdates.at(-1)?.steps.map(step => step.status)).toEqual(["completed", "completed", "completed", "completed"]);
    expect(events.some(event => event.type === "message-delta" && event.phase === "commentary")).toBe(true);
    expect(events.some(event => event.type === "message-delta" && event.phase === "final_answer")).toBe(true);
    await expect(send(DEBUG_PROMPTS[1])).rejects.toThrow("Finish the current simulated turn");
    await bridge.resolveProposal();
    await send(DEBUG_PROMPTS[1], finished.proposal.text);
    expect(lastFinish(events)).toMatchObject({ proposal: { text: expect.stringContaining("Assistant Demo 2") } });
  });

  it("keeps inspection, unsupported prompts, and rejected edits read-only", async () => {
    const { events, send } = setup();
    await send(DEBUG_PROMPTS[2]);
    expect(lastFinish(events)).toMatchObject({ error: null, proposal: null });
    expect(events.some(event => event.type === "message-delta" && event.text.includes("Plan"))).toBe(true);
    await send("Write a poem");
    expect(lastFinish(events)).toMatchObject({ error: null, proposal: null });
    await send(DEBUG_PROMPTS[3]);
    expect(lastFinish(events)).toMatchObject({ error: expect.stringContaining("Edit rejected"), proposal: null });
  });

  it("does not edit an invalid workbook implicitly but can explicitly replace it with a validated demo", async () => {
    const { events, send } = setup();
    const invalid = SOURCE.replace("100", "= (");
    await send(DEBUG_PROMPTS[1], invalid);
    expect(lastFinish(events)).toMatchObject({ error: expect.stringContaining("validation errors"), proposal: null });
    await send(DEBUG_PROMPTS[0], invalid);
    const finished = lastFinish(events);
    if (finished?.type !== "turn-finished" || !finished.proposal) throw new Error(`Missing replacement: ${JSON.stringify(finished)}`);
    expect(finished.proposal.baseText).toBe(invalid);
    const validated = await validateWorkbook(finished.proposal.text);
    expect(validated).toMatchObject({ status: "completed", data: { valid: true } });
  });
});
