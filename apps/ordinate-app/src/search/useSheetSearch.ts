import type { GridApi } from "ag-grid-community";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { GridRow } from "../types/ui";
import { toColFieldId } from "../utils/appHelpers";
import { splitPath } from "../utils/sheetView";
import { cellAddress, findMatches, resolveActiveMatch, stepMatch, type SearchCell } from "./searchModel";

type Options = {
  cells: SearchCell[];
  scope: string;
  enabled: boolean;
  gridApiRef: RefObject<GridApi<GridRow> | null>;
  displayedRows: Map<number, number>;
  expandRowPath: (path: string) => void;
};

export function useSheetSearch({ cells, scope, enabled, gridApiRef, displayedRows, expandRowPath }: Options) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [active, setActive] = useState<{ scope: string; id: string } | null>(null);
  const [navigation, setNavigation] = useState<{ scope: string; id: string } | null>(null);
  const [revealRevision, setRevealRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const isOpen = open && enabled;
  const matches = useMemo(() => findMatches(cells, isOpen ? query : "", matchCase), [cells, query, matchCase, isOpen]);
  const activeIndex = resolveActiveMatch(matches, active?.scope === scope ? active.id : null);
  const activeMatch = matches[activeIndex];
  const highlights = useMemo(() => new Map(matches.map(match => [cellAddress(match.row, match.col), match])), [matches]);

  const show = useCallback(() => {
    if (!enabled) return;
    if (!panelRef.current?.contains(document.activeElement)) returnFocusRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }, [enabled]);
  const close = useCallback(() => {
    if (panelRef.current?.contains(document.activeElement) && returnFocusRef.current?.isConnected) {
      returnFocusRef.current.focus({ preventScroll: true });
    }
    setOpen(false);
    setNavigation(null);
  }, []);
  const navigate = useCallback((direction: number) => {
    const index = stepMatch(activeIndex, matches.length, direction);
    if (index < 0) return;
    const match = matches[index];
    const target = { scope, id: match.id };
    setActive(target);
    setNavigation(target);
    // Match the hierarchy's path convention; never expand unrelated groups.
    const parts = match.rowPath ? splitPath(match.rowPath) : [];
    for (let i = 1; i < parts.length; i++) expandRowPath(parts.slice(0, i).join("."));
  }, [activeIndex, matches, scope, expandRowPath]);

  useEffect(() => {
    if (!enabled) { setOpen(false); setNavigation(null); }
  }, [enabled]);
  useEffect(() => {
    if (!navigation) return;
    const match = navigation.scope === scope ? matches.find(item => item.id === navigation.id) : undefined;
    const api = gridApiRef.current;
    if (!match || !api || api.isDestroyed()) { setNavigation(null); return; }
    const rowIndex = displayedRows.get(match.row);
    if (match.rowPath && rowIndex == null) return; // Wait for the group expansion projection.
    const frame = requestAnimationFrame(() => {
      if (api.isDestroyed()) return;
      if (rowIndex != null) api.ensureIndexVisible(rowIndex, "middle");
      api.ensureColumnVisible(toColFieldId(match.col), "middle");
      setRevealRevision(revision => revision + 1);
      setNavigation(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, matches, scope, gridApiRef, displayedRows]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || !enabled || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[role='dialog'], [role='menu']")) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault(); event.stopImmediatePropagation(); show();
      } else if (isOpen && ((event.key === "F3") || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g"))) {
        event.preventDefault(); event.stopImmediatePropagation(); navigate(event.shiftKey ? -1 : 1);
      } else if (isOpen && event.key === "Escape") {
        // An active cell editor owns its first Escape (cancel edit); do not steal it.
        if (!panelRef.current?.contains(target) && target?.closest("textarea, input, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
        event.preventDefault(); event.stopImmediatePropagation(); close();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [enabled, isOpen, show, close, navigate]);

  const updateQuery = useCallback((value: string) => {
    setQuery(value); setActive(null); setNavigation(null);
  }, []);
  const updateMatchCase = useCallback((value: boolean) => {
    setMatchCase(value); setActive(null); setNavigation(null);
  }, []);

  return useMemo(() => ({
    enabled, isOpen, query, matchCase, matches, activeIndex, activeId: activeMatch?.id, highlights,
    inputRef, panelRef, show, close, navigate, revealRevision,
    setQuery: updateQuery, setMatchCase: updateMatchCase,
  }), [enabled, isOpen, query, matchCase, matches, activeIndex, activeMatch?.id, highlights, show, close, navigate, revealRevision, updateQuery, updateMatchCase]);
}
