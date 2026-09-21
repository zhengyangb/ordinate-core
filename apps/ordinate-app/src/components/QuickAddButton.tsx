import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import type { QuickAddAxis } from "../utils/quickAddControls";

// Keep pointer-following feedback local: moving a pointer must not rerender the grid.
export function QuickAddButton({ axis, count, ...props }: ComponentProps<"button"> & {
  axis: QuickAddAxis;
  count: number | null;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const visible = hovered || focused || count !== null;
  useLayoutEffect(() => {
    if (!visible) return;
    const position = () => {
      const hint = hintRef.current;
      const button = buttonRef.current;
      if (!hint || !button) return;
      const bounds = button.getBoundingClientRect();
      const point = count !== null && pointer.current ? pointer.current : { x: bounds.right, y: bounds.top };
      hint.style.left = `${Math.max(8, Math.min(point.x + 16, window.innerWidth - hint.offsetWidth - 8))}px`;
      hint.style.top = `${Math.max(8, Math.min(point.y + 16, window.innerHeight - hint.offsetHeight - 8))}px`;
    };
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      position();
    };
    position();
    window.addEventListener("pointermove", move);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [visible, count]);
  const noun = axis === "row" ? "row" : "column";
  return <>
    <button {...props} ref={buttonRef}
      aria-description={`Click to add a ${noun}. Drag to add multiple ${noun}s.`}
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    ><span className="quick-add-plus" aria-hidden="true">+</span><span className="quick-add-direction" aria-hidden="true">{axis === "row" ? "↓" : "→"}</span></button>
    {visible && createPortal(<div ref={hintRef} className="floating-tooltip visible quick-add-hint" role="status">
      {count === null ? `Click +1 · Drag ${axis === "row" ? "↓" : "→"} for more`
        : count === 0 ? "Release to cancel" : `+${count} ${noun}${count === 1 ? "" : "s"} · Esc cancels`}
    </div>, document.body)}
  </>;
}
