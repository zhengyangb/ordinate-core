import { expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
const listeners = vi.hoisted(() => new Map<string, (...args: any[]) => unknown>());
vi.mock("electron", () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => unknown) => listeners.set(name, fn), on: vi.fn() } }));
import { createWindowIpc } from "./windowIpc";

it("isolates documents, rejects child frames, and closing one leaves other routes intact", async () => {
  const a = { webContents: { id: 1, mainFrame: { url: "ordinate://app/" } } } as unknown as BrowserWindow;
  const b = { webContents: { id: 2, mainFrame: { url: "ordinate://app/" } } } as unknown as BrowserWindow;
  const first = createWindowIpc(a, "ordinate://app/");
  const second = createWindowIpc(b, "ordinate://app/");
  first.handle("test:save", (_event, text) => `first:${text}`);
  second.handle("test:save", (_event, text) => `second:${text}`);
  const dispatch = listeners.get("test:save")!;
  const event = (win: BrowserWindow) => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  expect(dispatch(event(a), "A")).toBe("first:A");
  expect(dispatch(event(b), "B")).toBe("second:B");
  expect(() => dispatch({ ...event(a), senderFrame: { url: "ordinate://app/" } }, "forged")).toThrow("Untrusted");
  first.dispose();
  expect(() => dispatch(event(a), "stale")).toThrow("Untrusted");
  expect(dispatch(event(b), "still open")).toBe("second:still open");
  second.dispose();
});
