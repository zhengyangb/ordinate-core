import { afterEach, describe, expect, it, vi } from "vitest";
import { printDocument } from "./runPrint";
import type { PrintSheetModel } from "./printDocumentModel";

const createRoot = vi.hoisted(() => vi.fn());
vi.mock("react-dom/client", () => ({ createRoot }));
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let mounted = false;
  const container = {id:"", remove:vi.fn(() => { mounted=false; })};
  const root = { render:vi.fn(), unmount:vi.fn() };
  createRoot.mockReturnValue(root);
  vi.stubGlobal("document", {
    getElementById: () => mounted ? container : null,
    createElement: () => container,
    body: { append: () => { mounted=true; } },
    fonts: { ready: Promise.resolve() },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => callback(0));
  return {root,container};
}

describe("shared print tree lifetime", () => {
  const sheet = {} as PrintSheetModel; // The renderer is mocked; model/render tests cover content.
  it("retains the tree until the host completes, then removes it", async () => {
    const {root,container} = fixture(); let finish!: () => void;
    const host = vi.fn(() => new Promise<void>(resolve => { finish=resolve; }));
    const operation = printDocument([sheet], host);
    await vi.waitFor(() => expect(host).toHaveBeenCalledOnce());
    expect(container.id).toBe("ordinate-print-root");
    expect(root.render).toHaveBeenCalledOnce();
    expect(root.unmount).not.toHaveBeenCalled();
    expect(container.remove).not.toHaveBeenCalled();
    await expect(printDocument([sheet], host)).rejects.toThrow("already in progress");
    finish(); await operation;
    expect(root.unmount).toHaveBeenCalledOnce();
    expect(container.remove).toHaveBeenCalledOnce();
  });
  it("cleans up host errors and permits a new operation", async () => {
    const {root,container} = fixture();
    await expect(printDocument([sheet], async () => { throw new Error("Print denied"); })).rejects.toThrow("Print denied");
    expect(root.unmount).toHaveBeenCalledOnce();
    expect(container.remove).toHaveBeenCalledOnce();
    await printDocument([sheet], async () => {});
    expect(container.remove).toHaveBeenCalledTimes(2);
  });
});
