import { useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { splitNoteScroll } from "./noteModel";

/** Intro travel is outside the grid. Once exhausted, the native grid scrolls as before. */
export function NoteWorkspace({ intro, children, sheetId, width }: {
  intro: ReactNode; children: (railHost: HTMLDivElement) => ReactNode; sheetId: number; width: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const scrollbar = useRef<HTMLDivElement>(null);
  const scrollbarContent = useRef<HTMLDivElement>(null);
  const horizontalScrollbar = useRef<HTMLDivElement>(null);
  const horizontalContent = useRef<HTMLDivElement>(null);
  const [railHost, setRailHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = root.current!;
    const measure = () => element.style.setProperty("--note-stage-height", `${element.clientHeight}px`);
    const resize = new ResizeObserver(measure);
    measure();
    resize.observe(element);
    return () => {
      resize.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    const shell = frame.current!;
    const element = root.current!;
    const track = scrollbar.current!;
    const content = scrollbarContent.current!;
    const horizontalTrack = horizontalScrollbar.current!;
    const horizontalTrackContent = horizontalContent.current!;
    const observedContent = new Map<string, Element>();
    const resize = new ResizeObserver(() => schedule());
    let frameId = 0;
    let trackSyncFrame = 0;
    let scrollbarIdleTimer = 0;
    let projectedTrackTop = track.scrollTop;
    let composite = false;
    let measuredViewport: HTMLElement | null = null;
    let measuredGridScrollbar: HTMLElement | null = null;
    let measuredHorizontalViewport: HTMLElement | null = null;
    let measuredCenterViewport: HTMLElement | null = null;
    const revealScrollbar = () => {
      shell.classList.add("scrollbar-active");
      window.clearTimeout(scrollbarIdleTimer);
      scrollbarIdleTimer = window.setTimeout(() => shell.classList.remove("scrollbar-active"), 1_000);
    };
    const onGridScrollbarScroll = (event: Event) => {
      // In a note workspace, the visible composite track and body viewport own
      // vertical input. AG Grid's hidden paired scrollbar must not replay it.
      if (composite) event.stopImmediatePropagation();
    };
    const observeContent = (selector: string) => {
      const node = element.querySelector(selector);
      const previous = observedContent.get(selector);
      if (node === previous) return;
      if (previous) resize.unobserve(previous);
      if (node) {
        resize.observe(node);
        observedContent.set(selector, node);
      } else {
        observedContent.delete(selector);
      }
    };
    const syncTrack = () => {
      const viewport = element.querySelector<HTMLElement>(".ag-body-viewport");
      if (!viewport) return;
      projectedTrackTop = element.scrollTop + viewport.scrollTop;
      track.scrollTop = projectedTrackTop;
    };
    const syncHorizontalTrack = () => {
      const viewport = measuredHorizontalViewport;
      if (viewport && Math.abs(horizontalTrack.scrollLeft - viewport.scrollLeft) > 0.5) {
        horizontalTrack.scrollLeft = viewport.scrollLeft;
      }
    };
    const onHorizontalTrackScroll = () => {
      const viewport = measuredHorizontalViewport;
      if (viewport && Math.abs(viewport.scrollLeft - horizontalTrack.scrollLeft) > 0.5) {
        viewport.scrollLeft = horizontalTrack.scrollLeft;
      }
    };
    const scheduleTrackSync = () => {
      if (trackSyncFrame) return;
      trackSyncFrame = requestAnimationFrame(() => { trackSyncFrame = 0; syncTrack(); });
    };
    const measure = () => {
      const viewport = element.querySelector<HTMLElement>(".ag-body-viewport");
      observeContent(".ag-body-viewport");
      observeContent(".ag-center-cols-viewport");
      observeContent(".ag-body-horizontal-scroll-viewport");
      observeContent(".ag-body-horizontal-scroll-container");
      observeContent(".sheet-note-slot--afterTable");
      const horizontalViewport = element.querySelector<HTMLElement>(".ag-body-horizontal-scroll-viewport");
      const centerViewport = element.querySelector<HTMLElement>(".ag-center-cols-viewport");
      if (horizontalViewport !== measuredHorizontalViewport) {
        measuredHorizontalViewport?.removeEventListener("scroll", syncHorizontalTrack);
        measuredHorizontalViewport = horizontalViewport;
        measuredHorizontalViewport?.addEventListener("scroll", syncHorizontalTrack);
      }
      if (centerViewport !== measuredCenterViewport) {
        measuredCenterViewport?.removeEventListener("scroll", syncHorizontalTrack);
        measuredCenterViewport = centerViewport;
        measuredCenterViewport?.addEventListener("scroll", syncHorizontalTrack);
      }
      if (horizontalViewport) {
        const shellRect = shell.getBoundingClientRect();
        const viewportRect = horizontalViewport.getBoundingClientRect();
        const left = `${viewportRect.left - shellRect.left}px`;
        const width = `${viewportRect.width}px`;
        const contentWidth = `${horizontalViewport.scrollWidth}px`;
        if (horizontalTrack.style.left !== left) horizontalTrack.style.left = left;
        if (horizontalTrack.style.width !== width) horizontalTrack.style.width = width;
        if (horizontalTrackContent.style.width !== contentWidth) horizontalTrackContent.style.width = contentWidth;
        shell.classList.toggle("has-horizontal-scrollbar", horizontalViewport.scrollWidth - horizontalViewport.clientWidth > 0.5);
        syncHorizontalTrack();
      } else {
        shell.classList.remove("has-horizontal-scrollbar");
      }
      const introMax = Math.max(0, element.scrollHeight - element.clientHeight);
      const gridMax = viewport ? Math.max(0, viewport.scrollHeight - viewport.clientHeight) : 0;
      const height = `${track.clientHeight + introMax + gridMax}px`;
      if (content.style.height !== height) content.style.height = height;
      composite = introMax > 0.5 && introMax + gridMax > 0.5;
      shell.classList.toggle("has-composite-scrollbar", composite);
      const gridScrollbar = element.querySelector<HTMLElement>(".ag-body-vertical-scroll-viewport");
      if (gridScrollbar !== measuredGridScrollbar) {
        measuredGridScrollbar?.removeEventListener("scroll", onGridScrollbarScroll, true);
        measuredGridScrollbar = gridScrollbar;
        measuredGridScrollbar?.addEventListener("scroll", onGridScrollbarScroll, true);
      }
      const gridScrollbarContent = gridScrollbar?.querySelector<HTMLElement>(".ag-body-vertical-scroll-container");
      if (viewport && gridScrollbar && gridScrollbarContent) {
        // The body includes note/footer scroll space outside AG Grid's row
        // model. Its paired fake scroller must have the same maximum offset.
        const minHeight = `${gridMax + gridScrollbar.clientHeight}px`;
        if (gridScrollbarContent.style.minHeight !== minHeight) gridScrollbarContent.style.minHeight = minHeight;
      } else if (gridScrollbarContent?.style.minHeight) {
        gridScrollbarContent.style.minHeight = "";
      }
      if (viewport !== measuredViewport) {
        measuredViewport = viewport;
        if (viewport) syncTrack();
      }
    };
    const schedule = () => {
      if (frameId) return;
      frameId = requestAnimationFrame(() => { frameId = 0; measure(); });
    };
    const projectPosition = (position: number) => {
      const viewport = element.querySelector<HTMLElement>(".ag-body-viewport");
      if (!viewport) return;
      cancelAnimationFrame(trackSyncFrame);
      trackSyncFrame = 0;
      const next = splitNoteScroll(position,
        Math.max(0, element.scrollHeight - element.clientHeight),
        Math.max(0, viewport.scrollHeight - viewport.clientHeight));
      element.scrollTop = next.intro;
      viewport.scrollTop = next.grid;
      syncTrack();
    };
    const onTrackScroll = () => {
      if (!composite || Math.abs(track.scrollTop - projectedTrackTop) < 0.5) return;
      revealScrollbar();
      projectPosition(track.scrollTop);
    };
    const onStageScroll = (event: Event) => {
      if (event.target !== measuredGridScrollbar) {
        revealScrollbar();
        scheduleTrackSync();
      }
    };
    const onWheel = (event: WheelEvent) => {
      const target = event.target;
      if (!composite || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
        || !(target instanceof Element) || target.closest("textarea, [contenteditable='true']")) return;
      revealScrollbar();
      event.preventDefault();
      event.stopPropagation();
      const viewport = element.querySelector<HTMLElement>(".ag-body-viewport");
      if (!viewport) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      projectPosition(element.scrollTop + viewport.scrollTop + delta);
    };
    resize.observe(element);
    resize.observe(element.querySelector(".sheet-note-intro")!);
    resize.observe(track);
    const mutation = new MutationObserver(schedule);
    mutation.observe(element, { childList: true, subtree: true });
    element.addEventListener("scroll", onStageScroll, true);
    element.addEventListener("wheel", onWheel, { capture: true, passive: false });
    track.addEventListener("wheel", onWheel, { capture: true, passive: false });
    track.addEventListener("scroll", onTrackScroll);
    horizontalTrack.addEventListener("scroll", onHorizontalTrackScroll);
    measure();
    return () => {
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(trackSyncFrame);
      window.clearTimeout(scrollbarIdleTimer);
      mutation.disconnect();
      resize.disconnect();
      measuredGridScrollbar?.removeEventListener("scroll", onGridScrollbarScroll, true);
      measuredHorizontalViewport?.removeEventListener("scroll", syncHorizontalTrack);
      measuredCenterViewport?.removeEventListener("scroll", syncHorizontalTrack);
      element.removeEventListener("scroll", onStageScroll, true);
      element.removeEventListener("wheel", onWheel, true);
      track.removeEventListener("wheel", onWheel, true);
      track.removeEventListener("scroll", onTrackScroll);
      horizontalTrack.removeEventListener("scroll", onHorizontalTrackScroll);
    };
  }, [railHost]);
  useLayoutEffect(() => { root.current!.scrollTop = 0; }, [sheetId]);
  return <div ref={frame} className="note-workspace-frame">
    <div ref={root} className="note-workspace" style={{ "--note-table-width": `${width}px` } as CSSProperties}>
      <div className="note-rail-host" ref={setRailHost} />
      <div className="sheet-note-intro">{intro}</div>
      {railHost && children(railHost)}
    </div>
    <div ref={scrollbar} className="note-scrollbar" aria-label="Scroll sheet" tabIndex={0}>
      <div ref={scrollbarContent} />
    </div>
    <div ref={horizontalScrollbar} className="note-horizontal-scrollbar" aria-label="Scroll sheet horizontally" tabIndex={0}>
      <div ref={horizontalContent} />
    </div>
  </div>;
}
