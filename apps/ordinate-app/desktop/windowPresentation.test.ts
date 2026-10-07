import { describe, expect, it, vi } from "vitest";
import { windowPresentation } from "./windowPresentation";
import type { DesktopWindowState, FileReference } from "../src/platform/storage";

const file: FileReference = { id: "capability", displayName: "Untrusted name", adapterKind: "electron" };
describe("native document presentation", () => {
  it("uses the host's draft name without creating a represented file URL", () => {
    const result = windowPresentation({file:null, edited:true, appearance:"dark", chromeColor:"#343532"}, vi.fn(), "季度报告");
    expect(result.title).toBe("季度报告");
    expect(result.filename).toBe("");
  });
  it("uses the granted path for the system title and proxy, not renderer text", () => {
    const resolve = vi.fn(() => "/Documents/季度报告.ord");
    expect(windowPresentation({ file, edited: true, appearance: "dark", chromeColor: "#343532" }, resolve)).toEqual({
      title: "季度报告.ord", filename: "/Documents/季度报告.ord", edited: true, themeSource: "dark", chromeColor: "#343532",
    });
    expect(resolve).toHaveBeenCalledWith(file);
  });
  it("clears the previous document proxy for an untitled document", () => {
    const resolve = vi.fn();
    expect(windowPresentation({ file: null, edited: false, appearance: "auto", chromeColor: "#fafafa" }, resolve)).toEqual({
      title: "Untitled", filename: "", edited: false, themeSource: "system", chromeColor: "#fafafa",
    });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("rejects malformed state and unknown capabilities", () => {
    const resolve = () => { throw new Error("Unknown file capability"); };
    expect(() => windowPresentation({ file, edited: false, appearance: "light", chromeColor: "#fafafa" }, resolve)).toThrow("Unknown file capability");
    expect(() => windowPresentation({ file: null, edited: "yes", appearance: "light" } as unknown as DesktopWindowState, resolve)).toThrow("Invalid window state");
    expect(() => windowPresentation({ file: null, edited: false, appearance: "invalid" } as unknown as DesktopWindowState, resolve)).toThrow("Invalid window state");
  });
  it.each(["red", "#fff", "#aabbcc00", "#zzzzzz", ""])("rejects invalid native chrome color %s", (chromeColor) => {
    expect(() => windowPresentation({ file: null, edited: false, appearance: "auto", chromeColor }, vi.fn())).toThrow("Invalid window state");
  });
});
