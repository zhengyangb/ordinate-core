import { afterEach, describe, expect, it, vi } from "vitest";
import { failStartup, finishStartup } from "./startupScreen";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let visible = true;
  const root = { inert: true, removeAttribute: vi.fn() };
  const screen = {
    remove: vi.fn(() => { visible = false; }),
    replaceChildren: vi.fn(), removeAttribute: vi.fn(),
  };
  const dataset = { startup: "loading" };
  const mark = vi.fn();
  vi.stubGlobal("performance", { mark });
  vi.stubGlobal("document", {
    documentElement: { dataset },
    getElementById: (id: string) => id === "root" ? root : visible ? screen : null,
    createElement: () => ({ textContent: "", setAttribute: vi.fn(), addEventListener: vi.fn() }),
  });
  return { root, screen, dataset, mark };
}

describe("startup screen lifecycle", () => {
  it("unlocks the editor exactly once with no artificial wait", () => {
    const { root, screen, dataset, mark } = fixture();
    finishStartup();
    finishStartup();
    expect(root.inert).toBe(false);
    expect(root.removeAttribute).toHaveBeenCalledWith("aria-hidden");
    expect(screen.remove).toHaveBeenCalledTimes(1);
    expect(dataset.startup).toBe("ready");
    expect(mark).toHaveBeenCalledOnce();
  });

  it("replaces indefinite loading with an error and reload action", () => {
    const { root, screen, dataset } = fixture();
    failStartup(new Error("Could not load editor"));
    expect(dataset.startup).toBe("failed");
    expect(root.inert).toBe(true);
    const [message, button] = screen.replaceChildren.mock.calls[0];
    expect(message.textContent).toContain("Could not load editor");
    expect(message.setAttribute).toHaveBeenCalledWith("role", "alert");
    expect(button.textContent).toBe("Reload");
    expect(screen.removeAttribute).toHaveBeenCalledWith("aria-busy");
  });
});
