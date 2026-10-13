import { useCallback, useEffect, useRef, useState } from "react";
import type { FloatingTooltip } from "../types/ui";
import { CONTROL_TOOLTIP_DELAY_MS, TAB_TOOLTIP_DELAY_MS } from "../utils/appHelpers";

export function useTooltips() {
  const [tooltip, setTooltip] = useState<FloatingTooltip | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);
  const tooltipAnchorRef = useRef<HTMLElement | null>(null);
  const suppressedTooltipTargetRef = useRef<HTMLElement | null>(null);

  const clearTooltip = useCallback(() => {
    if (tooltipTimerRef.current != null) window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
    tooltipAnchorRef.current = null;
    setTooltip(null);
  }, []);

  useEffect(() => {
    window.addEventListener("resize", clearTooltip);
    window.addEventListener("scroll", clearTooltip, true);
    return () => {
      window.removeEventListener("resize", clearTooltip);
      window.removeEventListener("scroll", clearTooltip, true);
      if (tooltipTimerRef.current != null) window.clearTimeout(tooltipTimerRef.current);
    };
  }, [clearTooltip]);

  const suppressTooltipForTarget = useCallback((target: HTMLElement) => {
    suppressedTooltipTargetRef.current = target;
    clearTooltip();
  }, [clearTooltip]);

  const releaseTooltipForTarget = useCallback((target: HTMLElement) => {
    if (suppressedTooltipTargetRef.current === target) suppressedTooltipTargetRef.current = null;
    clearTooltip();
  }, [clearTooltip]);

  useEffect(() => {
    if (!tooltip) return;
    const anchor = tooltipAnchorRef.current;
    let rafId: number;
    const validateAnchor = () => {
      // A leave/enter handoff can happen before this effect's cleanup. The old
      // tooltip must not cancel the next target's pending show timer.
      if (tooltipAnchorRef.current !== anchor) return;
      if (!anchor || !anchor.isConnected || anchor.getClientRects().length === 0) {
        clearTooltip();
        return;
      }
      rafId = window.requestAnimationFrame(validateAnchor);
    };
    rafId = window.requestAnimationFrame(validateAnchor);
    return () => window.cancelAnimationFrame(rafId);
  }, [tooltip, clearTooltip]);

  const showTooltip = useCallback((text: string, target: HTMLElement, delayMs = CONTROL_TOOLTIP_DELAY_MS) => {
    if (suppressedTooltipTargetRef.current === target) return;
    if (tooltipTimerRef.current != null) window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null;
      if (!target.isConnected || target.getClientRects().length === 0) return;
      // Measure at display time, not before the hover delay / toolbar reflow.
      tooltipAnchorRef.current = target;
      const { top, bottom, left, width } = target.getBoundingClientRect();
      setTooltip({ text, anchor: { top, bottom, left, width } });
    }, delayMs);
  }, []);

  const handleTabMouseEnter = useCallback((sheetName: string, target: HTMLButtonElement) => {
    const label = target.querySelector<HTMLElement>(".sheet-tab-label");
    if (!label || label.scrollWidth <= label.clientWidth) {
      clearTooltip();
      return;
    }
    showTooltip(sheetName, target, TAB_TOOLTIP_DELAY_MS);
  }, [showTooltip, clearTooltip]);

  return {
    tooltip, clearTooltip, showTooltip, handleTabMouseEnter, suppressTooltipForTarget,
    releaseTooltipForTarget,
  };
}
