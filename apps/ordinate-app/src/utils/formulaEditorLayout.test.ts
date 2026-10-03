import { afterEach, expect, it, vi } from "vitest";
import { revealFormulaCaret } from "./formulaEditorLayout";

afterEach(() => vi.unstubAllGlobals());
it("uses wrapped token geometry to reveal a caret and synchronize vertical scrolling", () => {
  const nodes = [{ textContent: "= " }, { textContent: "@[LongReference]" }];
  const range = { setStart: vi.fn(), collapse: vi.fn(), getClientRects: () => [{ top: 140, bottom: 160 }] };
  vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 });
  vi.stubGlobal("document", { createTreeWalker: () => ({ nextNode: () => nodes.shift() ?? null }), createRange: () => range });
  const editor = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 100 }) } as unknown as HTMLTextAreaElement;
  const backdrop = { scrollTop: 0 } as HTMLElement;
  revealFormulaCaret(editor, backdrop, 5);
  expect(range.setStart).toHaveBeenCalledWith({ textContent: "@[LongReference]" }, 3);
  expect(editor.scrollTop).toBe(64);
  expect(backdrop.scrollTop).toBe(64);
});
