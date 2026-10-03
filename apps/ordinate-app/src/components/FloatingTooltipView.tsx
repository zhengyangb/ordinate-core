import { useLayoutEffect, useRef, useState } from "react";
import type { FloatingTooltip } from "../types/ui";
import { tooltipPosition } from "../utils/tooltipPosition";

export default function FloatingTooltipView({ tooltip }: { tooltip: FloatingTooltip | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, placement: "below" as "above" | "below" });
  useLayoutEffect(() => {
    if (!tooltip) return;
    const element = ref.current!;
    const measure = () => setPosition(tooltipPosition(tooltip.anchor,
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tooltip]);
  return <div ref={ref}
    className={tooltip ? "floating-tooltip visible" : "floating-tooltip"}
    data-placement={position.placement} data-alignment="center"
    role="tooltip" aria-hidden={!tooltip}
    style={{ top: position.top, left: position.left }}
  >{tooltip?.text ?? ""}</div>;
}
