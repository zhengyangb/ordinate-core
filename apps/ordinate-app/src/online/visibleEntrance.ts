/** Give the visible editor 400ms of context before offering examples. Hidden
 * tabs never spend this pause; activation starts with a fresh visible paint. */
export function afterVisiblePause(enter: () => void) {
  let frame = 0;
  let timer = 0;
  const cancel = () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    frame = timer = 0;
  };
  const dispose = () => {
    cancel();
    document.removeEventListener("visibilitychange", schedule);
  };
  function schedule() {
    cancel();
    if (document.visibilityState !== "visible") return;
    // Start the pause after paint, not during startup work or in a hidden tab.
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (document.visibilityState !== "visible") return;
        timer = window.setTimeout(() => {
          if (document.visibilityState !== "visible") return;
          dispose();
          enter();
        }, 400);
      });
    });
  }
  document.addEventListener("visibilitychange", schedule);
  schedule();
  return dispose;
}
