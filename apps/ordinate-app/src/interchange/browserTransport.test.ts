import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserInterchange } from "./browserTransport";

function environment() {
  const listeners = new Map<string, () => void>();
  const input = { type: "", accept: "", hidden: false, files: [] as { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }[],
    remove: vi.fn(), click: vi.fn(), addEventListener: (name: string, listener: () => void) => listeners.set(name, listener) };
  const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal("document", { createElement: (name: string) => name === "input" ? input : link, body: { append: vi.fn() } });
  const timer = vi.fn(); vi.stubGlobal("window", { setTimeout: timer });
  const createURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { input, link, listeners, timer, createURL, revokeURL, io: createBrowserInterchange() };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("browser interchange transport", () => {
  it("reads selected files as bytes, without an ORD writable handle", async () => {
    const f = environment();
    const pending = f.io.pickImport();
    expect(f.input.accept).toBe(".csv,.tsv,.xlsx");
    expect(f.input.click).toHaveBeenCalledOnce();
    const bytes = new Uint8Array([0, 0xff]);
    f.input.files = [{ name: "file.xlsx", size: 2, arrayBuffer: async () => bytes.buffer }];
    f.listeners.get("change")!();
    expect(await pending).toEqual({ name: "file.xlsx", bytes });
    expect(f.input.remove).toHaveBeenCalledOnce();
  });
  it("cleans up a cancelled file picker", async () => {
    const f = environment(); const pending = f.io.pickImport(); f.listeners.get("cancel")!();
    expect(await pending).toBeNull(); expect(f.input.remove).toHaveBeenCalledOnce();
  });
  it("rejects large inputs before allocating file bytes", async () => {
    const f = environment(); const arrayBuffer = vi.fn();
    const pending = f.io.pickImport(); f.input.files = [{ name: "large.csv", size: 16_777_217, arrayBuffer }]; f.listeners.get("change")!();
    await expect(pending).rejects.toThrow("too large"); expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it("reports read errors without adopting a document", async () => {
    const f = environment(); const pending = f.io.pickImport();
    f.input.files = [{ name: "file.csv", size: 1, arrayBuffer: async () => { throw new Error("Unreadable"); } }]; f.listeners.get("change")!();
    await expect(pending).rejects.toThrow("Unreadable");
  });
  it("starts a download with exact bytes and releases its URL only after dispatch", async () => {
    const f = environment(); const bytes = new Uint8Array([0xff, 0x50, 0x4b]);
    expect(await f.io.saveExport({ name: "report.xlsx", format: "xlsx", bytes })).toBe("downloaded");
    expect(f.link.download).toBe("report.xlsx"); expect(f.link.href).toBe("blob:test");
    expect(f.link.click).toHaveBeenCalledOnce(); expect(f.link.remove).toHaveBeenCalledOnce();
    const blob = f.createURL.mock.calls[0][0] as Blob;
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(blob.type).toContain("spreadsheetml");
    expect(f.revokeURL).not.toHaveBeenCalled();
    f.timer.mock.calls[0][0](); expect(f.revokeURL).toHaveBeenCalledWith("blob:test");
  });
  it("does not start downloads for invalid payloads", async () => {
    const f = environment();
    await expect(f.io.saveExport({ name: "report.csv", format: "xlsx", bytes: new Uint8Array() })).rejects.toThrow();
    expect(f.createURL).not.toHaveBeenCalled(); expect(f.link.click).not.toHaveBeenCalled();
  });
});
