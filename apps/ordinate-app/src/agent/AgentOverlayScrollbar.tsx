import { useLayoutEffect, useRef, type RefObject } from "react";

export function AgentOverlayScrollbar({ open, scrollRef, contentRef }: {
  open: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!scroll || !content || !track || !thumb) throw new Error("Assistant scrollbar requires its scroll region.");

    let hideTimer: number | null = null;
    let drag: { pointerId: number; offset: number } | null = null;
    let thumbHeight = 0;
    let lastUserScrollIntent = -Infinity;

    const noteUserScrollIntent = () => { lastUserScrollIntent = performance.now(); };
    const onScrollKey = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) noteUserScrollIntent();
    };

    const hideLater = () => {
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!drag) track.classList.remove("is-scrolling");
      }, 900);
    };
    const update = () => {
      const maxScroll = scroll.scrollHeight - scroll.clientHeight;
      track.hidden = maxScroll <= 1;
      if (track.hidden) return;
      const travel = track.clientHeight;
      thumbHeight = Math.min(travel, Math.max(32, travel * scroll.clientHeight / scroll.scrollHeight));
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${(scroll.scrollTop / maxScroll) * (travel - thumbHeight)}px)`;
    };
    const onScroll = () => {
      update();
      if (track.hidden || performance.now() - lastUserScrollIntent > 700) return;
      track.classList.add("is-scrolling");
      if (!drag) hideLater();
    };
    const moveToPointer = (clientY: number) => {
      const bounds = track.getBoundingClientRect();
      const maxTravel = bounds.height - thumbHeight;
      if (maxTravel <= 0 || !drag) return;
      const position = Math.max(0, Math.min(maxTravel, clientY - bounds.top - drag.offset));
      scroll.scrollTop = position / maxTravel * (scroll.scrollHeight - scroll.clientHeight);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const offset = event.target === thumb ? event.clientY - thumb.getBoundingClientRect().top : thumbHeight / 2;
      drag = { pointerId: event.pointerId, offset };
      track.setPointerCapture(event.pointerId);
      track.classList.add("is-scrolling");
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      moveToPointer(event.clientY);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (drag?.pointerId === event.pointerId) moveToPointer(event.clientY);
    };
    const endDrag = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return;
      drag = null;
      hideLater();
    };

    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    observer.observe(content);
    observer.observe(track);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    scroll.addEventListener("wheel", noteUserScrollIntent, { passive: true });
    scroll.addEventListener("touchmove", noteUserScrollIntent, { passive: true });
    scroll.addEventListener("keydown", onScrollKey);
    track.addEventListener("pointerdown", onPointerDown);
    track.addEventListener("pointermove", onPointerMove);
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
    update();
    return () => {
      observer.disconnect();
      track.classList.remove("is-scrolling");
      scroll.removeEventListener("scroll", onScroll);
      scroll.removeEventListener("wheel", noteUserScrollIntent);
      scroll.removeEventListener("touchmove", noteUserScrollIntent);
      scroll.removeEventListener("keydown", onScrollKey);
      track.removeEventListener("pointerdown", onPointerDown);
      track.removeEventListener("pointermove", onPointerMove);
      track.removeEventListener("pointerup", endDrag);
      track.removeEventListener("pointercancel", endDrag);
      if (hideTimer !== null) window.clearTimeout(hideTimer);
    };
  }, [open, scrollRef, contentRef]);

  return <div ref={trackRef} className="agent-overlay-scrollbar" aria-hidden="true"><div ref={thumbRef} className="agent-overlay-scrollbar-thumb" /></div>;
}
