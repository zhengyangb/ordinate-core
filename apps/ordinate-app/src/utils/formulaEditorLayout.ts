/** Use the rendered token text as the layout mirror: wrapping and font metrics
 * are identical to the transparent textarea above it. No per-keystroke canvas. */
export function revealFormulaCaret(editor: HTMLTextAreaElement, backdrop: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(backdrop, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const rect = range.getClientRects()[0];
      if (rect) {
        const viewport = editor.getBoundingClientRect();
        if (rect.top < viewport.top + 4) editor.scrollTop -= viewport.top + 4 - rect.top;
        else if (rect.bottom > viewport.bottom - 4) editor.scrollTop += rect.bottom - viewport.bottom + 4;
      }
      break;
    }
    remaining -= length;
    node = walker.nextNode();
  }
  backdrop.scrollTop = editor.scrollTop;
}
