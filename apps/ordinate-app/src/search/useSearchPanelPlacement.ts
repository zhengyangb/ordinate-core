import { useLayoutEffect } from "react";
import type { useSheetSearch } from "./useSheetSearch";
import { searchPanelOffset } from "./searchPlacement";

export function useSearchPanelPlacement(search: ReturnType<typeof useSheetSearch> | null) {
  const { isOpen, panelRef, activeId, highlights, revealRevision } = search ?? {};
  useLayoutEffect(() => {
    const panel = panelRef?.current;
    if (!isOpen || !panel) return;
    const anchor = panel.parentElement!;
    const workspace = panel.closest(".app-window")!;
    const place = () => {
      const rect = panel.getBoundingClientRect();
      const preferredTop = anchor.getBoundingClientRect().top + 8;
      const preferred = { left: rect.left, right: rect.right, top: preferredTop, bottom: preferredTop + rect.height };
      const targets = Array.from(workspace.querySelectorAll("[data-search-current]")).map(mark => {
        // Avoid the whole cell, not just the marked substring; frozen headers cannot scroll away.
        return mark.closest(".header-matrix-cell, .ag-cell")!.getBoundingClientRect();
      });
      const offset = searchPanelOffset(preferred, targets, workspace.getBoundingClientRect().bottom);
      panel.style.setProperty("--search-offset", `${offset}px`);
    };
    const frame = requestAnimationFrame(place);
    const observer = new ResizeObserver(place);
    observer.observe(workspace);
    observer.observe(panel);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [isOpen, panelRef, activeId, highlights, revealRevision]);
}
