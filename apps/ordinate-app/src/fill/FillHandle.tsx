import type { SelectionOverlayFragment } from "../utils/selectionRing";
import type { FillHandleController } from "./useFillHandle";
export { FillOptions } from "./FillOptions";
import "./fill.css";

export function FillHandle({ fill, corner }: { fill: FillHandleController; corner: SelectionOverlayFragment }) {
  return <button ref={fill.handleRef} type="button" className={`fill-handle${fill.dragging ? " is-dragging" : ""}`} data-escape-owner={fill.dragging || undefined}
    style={{ left: corner.left + corner.width, top: corner.top + corner.height }}
    aria-label="Fill selection" title="Drag to fill · Alt + arrow key to fill one step"
    onPointerDown={fill.start} onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => {
      if (!event.altKey || !event.key.startsWith("Arrow")) return;
      event.preventDefault(); event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      fill.keyboard(event.key, rect.right, rect.bottom);
    }}><span /></button>;
}
