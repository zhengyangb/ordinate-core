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
  host.complete(request.id, null, { needsSave: false });
  expect(await saving).toEqual({ needsSave: false });
  expect(() => host.complete(request.id, null, { needsSave: false })).toThrow("Invalid document completion");
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
it("returns the fresh save requirement rather than inferring it from the filename", async () => {
  const { host, send } = fixture();
  host.ready();
  const flushing = host.flush();
  host.complete(send.mock.calls[0][1].id, null, { needsSave: true });
  expect(await flushing).toEqual({ needsSave: true });
  host.dispose();
});
it("requires an explicit save requirement before completing a successful flush", async () => {
  const { host, send } = fixture();
  host.ready();
  const flushing = host.flush();
  const id = send.mock.calls[0][1].id;
  expect(() => host.complete(id, null, null)).toThrow("Missing document flush result");
  host.complete(id, null, { needsSave: false });
  await flushing;
  host.dispose();
});
it("keeps the close blocked when flushing fails", async () => {
  const { host, send } = fixture();
  host.ready();
  const flushing = host.flush();
  host.complete(send.mock.calls[0][1].id, "Draft could not be written", null);
  await expect(flushing).rejects.toThrow("Draft could not be written");
  host.dispose();
});
it("does not allow renderer-invented write capabilities", async () => {
  const { host } = fixture();
  await expect(host.commit("forged", { file: null, text: "payload", version: null })).rejects.toThrow("Invalid document write capability");
  host.dispose();
});
