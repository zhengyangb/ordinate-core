import { expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { createNativeStorage } from "./fileStorage";
vi.mock("./nativeChrome.js", () => ({ appKit: null }));
import { createDocumentHost } from "./documentHost";

function fixture() {
  const send = vi.fn();
  const win = { webContents: { send } } as unknown as BrowserWindow;
  const host = createDocumentHost(win, createNativeStorage({ open: async () => null, save: async () => null }));
  return { host, send };
}
it("fails early while loading instead of waiting forever on a missing renderer", async () => {
  const { host } = fixture();
  await expect(host.flush()).rejects.toThrow("not ready");
  host.dispose();
});
it("completes a flush only after the editor acknowledges durable content", async () => {
  const { host, send } = fixture();
  host.ready();
  const saving = host.flush();
  const request = send.mock.calls[0][1];
  expect(request.kind).toBe("flush");
  host.complete(request.id, null);
  await saving;
  expect(() => host.complete(request.id, null)).toThrow("Invalid document completion");
  host.dispose();
});
it("rejects pending closure if the renderer crashes", async () => {
  const { host } = fixture();
  host.ready();
  const saving = host.flush();
  host.unavailable("Renderer crashed");
  await expect(saving).rejects.toThrow("Renderer crashed");
  await expect(host.flush()).rejects.toThrow("not ready");
  host.dispose();
});
it("does not allow renderer-invented write capabilities", async () => {
  const { host } = fixture();
  await expect(host.commit("forged", { file: null, text: "payload", version: null })).rejects.toThrow("Invalid document write capability");
  host.dispose();
});
