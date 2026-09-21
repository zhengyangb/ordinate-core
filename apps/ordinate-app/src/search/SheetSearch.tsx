import { createContext, useContext, type ReactNode } from "react";
import { cellAddress } from "./searchModel";
import type { useSheetSearch } from "./useSheetSearch";
import { useSearchPanelPlacement } from "./useSearchPanelPlacement";
import "./search.css";

export const SheetSearchContext = createContext<ReturnType<typeof useSheetSearch> | null>(null);

function SearchIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.7 12.7 4 4" /></svg>;
}

export function SearchButton() {
  const search = useContext(SheetSearchContext);
  if (!search) return null;
  return <button type="button" className={`tool-button search-button${search.isOpen ? " active" : ""}`} disabled={!search.enabled}
    aria-label="Find in document" aria-keyshortcuts="Meta+f Control+f" aria-pressed={search.isOpen} aria-expanded={search.isOpen} aria-controls="sheet-search"
    title="Find in document (⌘F / Ctrl+F)" onMouseDown={event => event.stopPropagation()} onClick={search.isOpen ? search.close : search.show}>
    <span className="tool-icon"><SearchIcon /></span>
  </button>;
}

export function SearchPanel() {
  const search = useContext(SheetSearchContext);
  useSearchPanelPlacement(search);
  if (!search?.isOpen) return null;
  const count = search.matches.length;
  return <div className="search-anchor">
    <div id="sheet-search" className="sheet-search" role="search" aria-label="Find in all sheets" ref={search.panelRef}
      onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
        event.stopPropagation();
        if (event.target === search.inputRef.current && event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault(); search.navigate(event.shiftKey ? -1 : 1);
        }
      }}>
      <div className="search-input-wrap">
        <SearchIcon />
        <input ref={search.inputRef} type="text" aria-label="Search all sheets" placeholder="Find in all sheets…" autoComplete="off" spellCheck={false}
          value={search.query} onChange={event => search.setQuery(event.target.value)} aria-describedby="search-summary" />
        <button type="button" className="search-case" aria-label="Match case" aria-pressed={search.matchCase} title="Match case"
          onClick={() => search.setMatchCase(!search.matchCase)}>Aa</button>
      </div>
      <span className="search-count" id="search-summary" role="status" aria-live="polite" aria-atomic="true"
        title={search.matches[search.activeIndex]?.sheet}
        aria-label={search.query ? `${count ? search.activeIndex + 1 : 0} of ${count} matching cells across all sheets` : "Search displayed values in all sheets"}>
        {search.query ? count ? `${search.activeIndex + 1} / ${count}` : "No results" : "All sheets"}
      </span>
      <div className="search-navigation">
        <button type="button" aria-label="Previous match" title="Previous (Shift+Enter)" disabled={!count} onClick={() => search.navigate(-1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 12 5-5 5 5" /></svg></button>
        <button type="button" aria-label="Next match" title="Next (Enter)" disabled={!count} onClick={() => search.navigate(1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg></button>
      </div>
      <button className="search-close" type="button" aria-label="Close search" title="Close (Esc)" onClick={search.close}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" /></svg></button>
    </div>
  </div>;
}

/** Context updates visible renderers without rebuilding grid columns or cell selection. */
export function SearchText({ row, col, text, children }: { row: number; col: number; text: string; children?: ReactNode }) {
  const search = useContext(SheetSearchContext);
  const match = search?.highlights.get(cellAddress(row, col));
  if (!match) return <>{children ?? text}</>;
  const className = match.id === search?.activeId ? "search-hit is-current" : "search-hit";
  // Interactive boolean/error capsules retain their controls and accessible labels.
  if (children) return <span className={className} data-search-current={match.id === search?.activeId || undefined}>{children}</span>;
  let cursor = 0;
  const fragments: ReactNode[] = [];
  for (const range of match.ranges) {
    fragments.push(text.slice(cursor, range.start));
    fragments.push(<mark key={range.start} className={className} data-search-current={match.id === search?.activeId || undefined}>{text.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  fragments.push(text.slice(cursor));
  return <>{fragments}</>;
}
