/** AG Grid first mounts default-height rows, then measures auto-height cells.
 * Keep that intermediate layout out of the first paint. This checks rendered
 * geometry only during mount, leaving all sizing to AG Grid's own service. */
export function renderedRowsFitContent(root: HTMLElement): boolean {
  for (const cell of root.querySelectorAll<HTMLElement>(".ag-cell-auto-height")) {
    const row = cell.closest<HTMLElement>(".ag-row");
    const wrapper = cell.querySelector<HTMLElement>(".ag-cell-wrapper");
    if (!row || !wrapper) throw new Error("auto-height cell is missing its row or content wrapper");
    const style = getComputedStyle(cell);
    const inset = [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]
      .reduce((sum, value) => sum + Number.parseFloat(value), 0);
    const requiredHeight = wrapper.offsetHeight + inset;
    if (!Number.isFinite(requiredHeight)) throw new Error("invalid auto-height cell measurement");
    if (row.offsetHeight < requiredHeight) return false;
  }
  return true;
}

export function waitForInitialRowLayout(root: HTMLElement, onReady: () => void): () => void {
  let cancelled = false;
  let frame = 0;
  const check = () => {
    if (cancelled || !root.isConnected) return;
    if (renderedRowsFitContent(root)) {
      onReady();
      return;
    }
    frame = requestAnimationFrame(check);
  };
  // Font metrics must also be final before checking wrapped text. No fixed
  // debounce or guessed row heights: short and long notes use the same check.
  void root.ownerDocument.fonts.ready.then(() => {
    if (!cancelled) frame = requestAnimationFrame(check);
  });
  return () => { cancelled = true; cancelAnimationFrame(frame); };
}
