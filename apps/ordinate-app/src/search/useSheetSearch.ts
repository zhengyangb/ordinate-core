import type { GridApi } from "ag-grid-community";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { GridRow } from "../types/ui";
import { revealSearchCell, type SearchGrid } from "./searchNavigation";
import { splitPath } from "../utils/sheetView";
import { cellAddress, findDocumentMatches, resolveActiveMatch, stepMatch, type DocumentSearchCell, type SearchScope } from "./searchModel";

type Options = {
  cells: DocumentSearchCell[];
  scope: string;
  enabled: boolean;
  gridApiRef: RefObject<GridApi<GridRow> | null>;
  displayedRows: Map<number, number>;
  expandRowPath: (path: string) => void;
  activateSheet: (sheet: string) => void;
};

export function useSheetSearch({ cells, scope, enabled, gridApiRef, displayedRows, expandRowPath, activateSheet }: Options) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [active, setActive] = useState<{ scope: string; id: string } | null>(null);
  const [navigation, setNavigation] = useState<{ scope: string; id: string } | null>(null);
  const [revealRevision, setRevealRevision] = useState(0);
  const [renderedGrid, setRenderedGrid] = useState<SearchGrid | null>(null);
  const onGridRendered = useCallback((scope: string, api: GridApi<GridRow>) => {
    setRenderedGrid({ scope, api });
  }, []);
  const onGridUpdated = useCallback((api: GridApi<GridRow>) => {
    // Updates before firstDataRendered do not make a grid ready.
    setRenderedGrid(current => current?.api === api ? { ...current } : current);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const isOpen = open && enabled;
  const matches = useMemo(() => findDocumentMatches(cells, isOpen ? query : "", matchCase, searchScope, scope), [cells, query, matchCase, isOpen, searchScope, scope]);
  const activeIndex = resolveActiveMatch(matches, active?.id ?? null);
  const activeMatch = matches[activeIndex];
  const highlights = useMemo(() => new Map(matches.filter(match => match.sheet === scope).map(match => [cellAddress(match.row, match.col), match])), [matches, scope]);

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
    const index = active && active.id === activeMatch?.id ? stepMatch(activeIndex, matches.length, direction) : direction < 0 ? matches.length - 1 : activeIndex;
    if (index < 0) return;
    const match = matches[index];
    const target = { scope: match.sheet, id: match.id };
    setActive(target);
    setNavigation(target);
    if (match.sheet !== scope) activateSheet(match.sheet);
  }, [active, activeIndex, activeMatch, matches, scope, activateSheet]);

  useEffect(() => {
    if (!enabled) { setOpen(false); setNavigation(null); }
  }, [enabled]);
  useEffect(() => {
    if (!navigation) return;
    const match = matches.find(item => item.id === navigation.id);
    if (!match) { setNavigation(null); return; }
    if (navigation.scope !== scope) return; // Wait for the destination sheet to mount.
    const parts = match.rowPath ? splitPath(match.rowPath) : [];
    for (let i = 1; i < parts.length; i++) expandRowPath(parts.slice(0, i).join("."));
    if (!renderedGrid || renderedGrid.scope !== navigation.scope || renderedGrid.api !== gridApiRef.current) return;
    const rowIndex = displayedRows.get(match.row);
    if (match.rowPath && rowIndex == null) return; // Wait for the group expansion projection.
    const frame = requestAnimationFrame(() => {
      if (renderedGrid.api !== gridApiRef.current) return;
      if (!revealSearchCell(renderedGrid, navigation.scope, match.col, rowIndex, Boolean(match.rowPath))) return;
      setRevealRevision(revision => revision + 1);
      setNavigation(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, matches, scope, gridApiRef, displayedRows, expandRowPath, renderedGrid]);

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
        if (target?.closest("[data-escape-owner]")) return;
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
  const toggleScope = useCallback(() => {
    setSearchScope(value => value === "all" ? "current" : "all");
    setActive(null);
    setNavigation(null);
  }, []);

  return useMemo(() => ({
    enabled, isOpen, query, matchCase, searchScope, toggleScope, matches, activeIndex, activeId: activeMatch?.id, highlights,
    inputRef, panelRef, show, close, navigate, revealRevision, onGridRendered, onGridUpdated,
    setQuery: updateQuery, setMatchCase: updateMatchCase,
  }), [enabled, isOpen, query, matchCase, searchScope, toggleScope, matches, activeIndex, activeMatch?.id, highlights, show, close, navigate, revealRevision, onGridRendered, onGridUpdated, updateQuery, updateMatchCase]);
}
