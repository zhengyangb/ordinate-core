import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPrint } from "./browserPrint";

afterEach(() => vi.unstubAllGlobals());

function fixture(print: () => void = () => {}) {
  const host = Object.assign(new EventTarget(), { print: vi.fn(print) });
  vi.stubGlobal("window", host);
  return host;
}

describe("browser print dialog lifecycle", () => {
  it("waits for afterprint rather than removing content when print() returns", async () => {
    const host = fixture(); const finished = vi.fn();
    const operation = browserPrint().then(finished);
    await Promise.resolve();
    expect(host.print).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
    host.dispatchEvent(new Event("afterprint")); await operation;
    expect(finished).toHaveBeenCalledOnce();
    host.dispatchEvent(new Event("afterprint"));
    expect(finished).toHaveBeenCalledOnce();
  });
  it("registers completion before calling print, including synchronous cancel/close", async () => {
    const host = fixture(() => host.dispatchEvent(new Event("afterprint")));
    await expect(browserPrint()).resolves.toBeUndefined();
  });
  it("rejects invocation errors and removes the listener so a retry can succeed", async () => {
    const host = fixture(() => { throw new Error("Print denied"); });
    const removed = vi.spyOn(host, "removeEventListener");
    await expect(browserPrint()).rejects.toThrow("Print denied");
    expect(removed).toHaveBeenCalledWith("afterprint", expect.any(Function));
    host.print.mockImplementation(() => host.dispatchEvent(new Event("afterprint")));
    await expect(browserPrint()).resolves.toBeUndefined();
  });
});
