import type { FloatingTooltip } from "../types/ui";
import { TOOLTIP_GAP, TOOLTIP_VIEWPORT_MARGIN } from "./appHelpers";

export function tooltipPosition(anchor: FloatingTooltip["anchor"], size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const halfWidth = size.width / 2;
  const left = Math.max(TOOLTIP_VIEWPORT_MARGIN + halfWidth,
    Math.min(anchor.left + anchor.width / 2, viewport.width - TOOLTIP_VIEWPORT_MARGIN - halfWidth));
  const above = anchor.bottom + TOOLTIP_GAP + size.height > viewport.height - TOOLTIP_VIEWPORT_MARGIN;
  return {
    left,
    top: above ? Math.max(TOOLTIP_VIEWPORT_MARGIN + size.height, anchor.top - TOOLTIP_GAP) : anchor.bottom + TOOLTIP_GAP,
    placement: above ? "above" as const : "below" as const,
  };
}
