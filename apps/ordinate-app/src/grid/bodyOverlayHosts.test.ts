import { describe, expect, it } from "vitest";
import { readGridBodyOverlayHosts } from "./bodyOverlayHosts";

describe("native body overlay hosts", () => {
  it("uses the actual scrolling content, not the viewport or proxy scrollbar", () => {
    const center = {} as HTMLElement;
    const pinned = {} as HTMLElement;
    const root = { querySelector: (selector: string) => ({
      ".ag-center-cols-container": center,
      ".ag-pinned-left-cols-container": pinned,
    })[selector] } as unknown as HTMLElement;
    expect(readGridBodyOverlayHosts(root)).toEqual({ center, pinned });
  });

  it("fails immediately if AG Grid changes the required DOM contract", () => {
    const root = { querySelector: () => null } as unknown as HTMLElement;
    expect(() => readGridBodyOverlayHosts(root)).toThrow("missing native body overlay containers");
  });
});
