export function isSelectionDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const globalFlag = (window as typeof window & { __ORDINATE_SELECTION_DEBUG?: boolean }).__ORDINATE_SELECTION_DEBUG;
  if (globalFlag === true) return true;
  return window.localStorage.getItem("ordinate-selection-debug") === "1";
}

export function selectionDebugLog(event: string, payload?: unknown): void {
  if (!isSelectionDebugEnabled()) return;
  if (payload === undefined) {
    console.debug(`[ordinate-selection] ${event}`);
    return;
  }
  console.debug(`[ordinate-selection] ${event}`, payload);
}
