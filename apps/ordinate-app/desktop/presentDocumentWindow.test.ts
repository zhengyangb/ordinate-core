import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { presentDocumentWindow } from "./presentDocumentWindow";

function fixture() {
  const events: string[] = [];
  const win = { isVisible: vi.fn(() => false), show: vi.fn(() => events.push("show")), destroy: vi.fn() };
  const parent = { isDestroyed: vi.fn(() => false), addTabbedWindow: vi.fn(() => events.push("join")) };
  return { events, win, parent, document: win as unknown as BrowserWindow, tabParent: parent as unknown as BrowserWindow };
}

describe("document window presentation", () => {
  it("joins the tab group before showing, exactly once", () => {
    const f = fixture();
    presentDocumentWindow(f.document, f.tabParent);
    expect(f.events).toEqual(["join", "show"]);
    expect(f.parent.addTabbedWindow).toHaveBeenCalledWith(f.document);
    expect(f.win.show).toHaveBeenCalledTimes(1);
  });
  it("shows a standalone document without tab placement", () => {
    const f = fixture();
    presentDocumentWindow(f.document);
    expect(f.events).toEqual(["show"]);
  });
  it("rejects premature presentation rather than merging a visible window", () => {
    const f = fixture();
    f.win.isVisible.mockReturnValue(true);
    expect(() => presentDocumentWindow(f.document, f.tabParent)).toThrow("before its window placement");
    expect(f.events).toEqual([]);
  });
  it("cancels when the target group closed during loading instead of popping up another window", () => {
    const f = fixture();
    f.parent.isDestroyed.mockReturnValue(true);
    expect(() => presentDocumentWindow(f.document, f.tabParent)).toThrow("tab group closed");
    expect(f.win.destroy).toHaveBeenCalledOnce();
    expect(f.events).toEqual([]);
  });
});
