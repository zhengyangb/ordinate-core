import { useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { distributeNoteScroll } from "./noteModel";

/** Intro travel is outside the grid. Once exhausted, the native grid scrolls as before. */
export function NoteWorkspace({ intro, children, sheetId, width }: {
  intro: ReactNode; children: (railHost: HTMLDivElement) => ReactNode; sheetId: number; width: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [railHost, setRailHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = root.current!;
    const measure = () => element.style.setProperty("--note-stage-height", `${element.clientHeight}px`);
    const resize = new ResizeObserver(measure);
    measure();
    resize.observe(element);
    const wheel = (event: WheelEvent) => {
      const target = event.target as Element;
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || target.closest("textarea")) return;
      const viewport = element.querySelector<HTMLElement>(".ag-body-viewport");
      if (!viewport) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const next = distributeNoteScroll(delta, element.scrollTop, element.scrollHeight - element.clientHeight, viewport.scrollTop);
      if (next.intro !== element.scrollTop) {
        event.preventDefault();
        event.stopPropagation();
        element.scrollTop = next.intro;
        if (next.remaining) viewport.scrollTop += next.remaining;
      } else if (!target.closest(".grid-wrap") && delta) {
        event.preventDefault();
        viewport.scrollTop += delta;
      }
    };
    element.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => {
      resize.disconnect();
      element.removeEventListener("wheel", wheel, true);
    };
  }, []);
  useLayoutEffect(() => { root.current!.scrollTop = 0; }, [sheetId]);
  return <div ref={root} className="note-workspace" style={{ "--note-table-width": `${width}px` } as CSSProperties}>
    <div className="note-rail-host" ref={setRailHost} />
    <div className="sheet-note-intro">{intro}</div>
    {railHost && children(railHost)}
  </div>;
}
