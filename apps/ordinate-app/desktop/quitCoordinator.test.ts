import { expect, it, vi } from "vitest";
import { createQuitCoordinator } from "./quitCoordinator";
import type { DocumentSession } from "./workspaceSession";

function document(id: string, filename: string | null = null) {
  return { record: { id, filename, text: null } as DocumentSession, prepareToClose: vi.fn(async () => true) };
}
function fixture(documents = [document("blank")]) {
  const effects = { documents: () => documents, persist: vi.fn(async (_records: DocumentSession[]) => {}),
    flushStorage: vi.fn(), quit: vi.fn(), reportError: vi.fn() };
  return { documents, effects, coordinator: createQuitCoordinator(effects) };
}
it("checks every window before quit and only restores saved files", async () => {
  const untouched = document("untouched"), discarded = document("discarded"), saved = document("saved", "/tmp/saved.ord");
  const { coordinator, effects } = fixture([untouched, discarded, saved]);
  expect(await coordinator.request()).toBe(true);
  for (const entry of [untouched, discarded, saved]) expect(entry.prepareToClose).toHaveBeenCalledExactlyOnceWith("quit");
  expect(effects.persist).toHaveBeenCalledExactlyOnceWith([saved.record]);
  expect(effects.flushStorage).toHaveBeenCalledOnce();
  expect(effects.quit).toHaveBeenCalledOnce();
  expect(coordinator.phase).toBe("approved");
  expect(effects.persist.mock.invocationCallOrder[0]).toBeLessThan(effects.flushStorage.mock.invocationCallOrder[0]);
  expect(effects.flushStorage.mock.invocationCallOrder[0]).toBeLessThan(effects.quit.mock.invocationCallOrder[0]);
});
it("Cancel stops the whole quit without committing earlier discard choices", async () => {
  const first = document("discard"), second = document("cancel"), third = document("not-reached");
  second.prepareToClose.mockResolvedValueOnce(false);
  const { coordinator, effects } = fixture([first, second, third]);
  expect(await coordinator.request()).toBe(false);
  expect(third.prepareToClose).not.toHaveBeenCalled();
  expect(effects.persist).not.toHaveBeenCalled();
  expect(effects.quit).not.toHaveBeenCalled();
  expect(coordinator.phase).toBe("idle");
  expect(await coordinator.request()).toBe(true);
  expect(first.prepareToClose).toHaveBeenCalledTimes(2);
});
it("uses the filename assigned by Save As before persisting the workspace", async () => {
  const entry = document("new");
  entry.prepareToClose.mockImplementation(async () => { entry.record.filename = "/tmp/new.ord"; return true; });
  const { coordinator, effects } = fixture([entry]);
  await coordinator.request();
  expect(effects.persist).toHaveBeenCalledExactlyOnceWith([entry.record]);
});
it.each(["Save canceled", "Disk conflict", "Renderer stopped"])("%s keeps quit blocked and retryable", async error => {
  const { coordinator, effects, documents } = fixture();
  documents[0].prepareToClose.mockRejectedValueOnce(new Error(error));
  await expect(coordinator.request()).rejects.toThrow(error);
  expect(coordinator.phase).toBe("idle");
  expect(effects.persist).not.toHaveBeenCalled();
  expect(effects.quit).not.toHaveBeenCalled();
  await expect(coordinator.request()).resolves.toBe(true);
});
it("workspace persistence failure prevents quit", async () => {
  const { coordinator, effects } = fixture();
  effects.persist.mockRejectedValueOnce(new Error("Workspace could not be written"));
  await expect(coordinator.request()).rejects.toThrow("Workspace could not be written");
  expect(coordinator.phase).toBe("idle");
  expect(effects.flushStorage).not.toHaveBeenCalled();
  expect(effects.quit).not.toHaveBeenCalled();
});
it("repeated quit events share one pending confirmation and allow only the approved quit", async () => {
  const { coordinator, effects, documents } = fixture();
  let finish!: (approved: boolean) => void;
  documents[0].prepareToClose.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const event = { preventDefault: vi.fn() };
  coordinator.beforeQuit(event);
  coordinator.beforeQuit(event);
  const pending = coordinator.request();
  expect(coordinator.request()).toBe(pending);
  expect(coordinator.phase).toBe("checking");
  expect(documents[0].prepareToClose).toHaveBeenCalledOnce();
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
  finish(true); await pending;
  coordinator.beforeQuit(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
  expect(effects.quit).toHaveBeenCalledOnce();
});
it("reports a failed before-quit request once without closing the app", async () => {
  const { coordinator, effects, documents } = fixture();
  documents[0].prepareToClose.mockRejectedValue(new Error("Cannot save"));
  coordinator.beforeQuit({ preventDefault: vi.fn() });
  coordinator.beforeQuit({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(effects.reportError).toHaveBeenCalledOnce());
  expect(effects.quit).not.toHaveBeenCalled();
  expect(coordinator.phase).toBe("idle");
});
