import { useCallback, useEffect, useRef, useState } from "react";
import type { FloatingTooltip } from "../types/ui";
import { CONTROL_TOOLTIP_DELAY_MS, POSITION_EPSILON, TAB_TOOLTIP_DELAY_MS, TOOLTIP_ESTIMATED_HEIGHT, TOOLTIP_ESTIMATED_WIDTH, TOOLTIP_GAP, TOOLTIP_VIEWPORT_MARGIN } from "../utils/appHelpers";

export function useTooltips() {
  const [tooltip, setTooltip] = useState<FloatingTooltip | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);
  const tooltipAnchorRef = useRef<HTMLElement | null>(null);
  const suppressedTooltipTargetRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dismissTooltip = () =>
      setTooltip((current) => {
        if (!current) return current;
        return null;
      });
    window.addEventListener("resize", dismissTooltip);
    window.addEventListener("scroll", dismissTooltip, true);
    return () => {
      window.removeEventListener("resize", dismissTooltip);
      window.removeEventListener("scroll", dismissTooltip, true);
    };
  }, []);

  const clearTooltip = useCallback(() => {
    if (tooltipTimerRef.current != null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    tooltipAnchorRef.current = null;
    setTooltip((current) => {
      if (!current) return current;
      return null;
    });
  }, []);

  const suppressTooltipForTarget = useCallback((target: HTMLElement) => {
    suppressedTooltipTargetRef.current = target;
    clearTooltip();
  }, [clearTooltip]);

  const releaseTooltipForTarget = useCallback((target: HTMLElement) => {
    if (suppressedTooltipTargetRef.current === target) {
      suppressedTooltipTargetRef.current = null;
    }
    clearTooltip();
  }, [clearTooltip]);

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current != null) {
        window.clearTimeout(tooltipTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!tooltip) return;
    let rafId: number | null = null;

    const validateAnchor = () => {
      const anchor = tooltipAnchorRef.current;
      if (!anchor || !anchor.isConnected || anchor.getClientRects().length === 0) {
        clearTooltip();
        return;
      }
      rafId = window.requestAnimationFrame(validateAnchor);
    };

    rafId = window.requestAnimationFrame(validateAnchor);
    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [tooltip, clearTooltip]);

  const buildTooltip = useCallback((text: string, target: HTMLElement): FloatingTooltip => {
    const rect = target.getBoundingClientRect();
    const belowTop = rect.bottom + TOOLTIP_GAP;
    const aboveTop = rect.top - TOOLTIP_GAP;
    const shouldPlaceAbove = belowTop + TOOLTIP_ESTIMATED_HEIGHT > window.innerHeight - TOOLTIP_VIEWPORT_MARGIN;
    const centerLeft = rect.left + rect.width / 2;
    const halfWidth = TOOLTIP_ESTIMATED_WIDTH / 2;
    const shouldAlignLeft = centerLeft - halfWidth < TOOLTIP_VIEWPORT_MARGIN;
    const shouldAlignRight = centerLeft + halfWidth > window.innerWidth - TOOLTIP_VIEWPORT_MARGIN;
    const alignment = shouldAlignLeft ? "left" : shouldAlignRight ? "right" : "center";
    const left = shouldAlignLeft
      ? TOOLTIP_VIEWPORT_MARGIN
      : shouldAlignRight
        ? window.innerWidth - TOOLTIP_VIEWPORT_MARGIN
        : centerLeft;
    return {
      text,
      top: shouldPlaceAbove ? aboveTop : belowTop,
      left,
      placement: shouldPlaceAbove ? "above" : "below",
      alignment,
    };
  }, []);

  const handleTabMouseEnter = useCallback((sheetName: string, target: HTMLButtonElement) => {
    if (target.scrollWidth <= target.clientWidth + 1) {
      clearTooltip();
      return;
    }
    if (tooltipTimerRef.current != null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    const next = buildTooltip(sheetName, target);
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null;
      tooltipAnchorRef.current = target;
      setTooltip((current) => {
        if (
          current &&
          current.text === next.text &&
          current.placement === next.placement &&
          current.alignment === next.alignment &&
          Math.abs(current.top - next.top) < POSITION_EPSILON &&
          Math.abs(current.left - next.left) < POSITION_EPSILON
        ) {
          return current;
        }
        return next;
      });
    }, TAB_TOOLTIP_DELAY_MS);
  }, [buildTooltip, clearTooltip]);

  const showTooltip = useCallback((text: string, target: HTMLElement, delayMs = CONTROL_TOOLTIP_DELAY_MS) => {
    if (suppressedTooltipTargetRef.current === target) {
      return;
    }
    if (tooltipTimerRef.current != null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    const next = buildTooltip(text, target);
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null;
      tooltipAnchorRef.current = target;
      setTooltip((current) => {
        if (
          current &&
          current.text === next.text &&
          current.placement === next.placement &&
          current.alignment === next.alignment &&
          Math.abs(current.top - next.top) < POSITION_EPSILON &&
          Math.abs(current.left - next.left) < POSITION_EPSILON
        ) {
          return current;
        }
        return next;
      });
    }, delayMs);
  }, [buildTooltip]);

  return {
    tooltip, setTooltip, clearTooltip, showTooltip, handleTabMouseEnter, suppressTooltipForTarget,
    releaseTooltipForTarget,
  };
}
