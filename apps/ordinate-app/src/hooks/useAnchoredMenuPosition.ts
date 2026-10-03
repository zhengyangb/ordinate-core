import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { FloatingMenuPosition } from "../types/ui";
import { POSITION_EPSILON, resolveAnchoredMenuPosition } from "../utils/appHelpers";

export function useAnchoredMenuPosition(
  open: boolean, anchorRef: RefObject<HTMLElement>, menuRef: RefObject<HTMLElement>,
  setPosition: Dispatch<SetStateAction<FloatingMenuPosition>>, align: "start" | "end",
) {
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current, menu = menuRef.current;
      if (!anchor || !menu) return;
      const next = resolveAnchoredMenuPosition(anchor.getBoundingClientRect(), menu.getBoundingClientRect(), { preferredY: "below", align });
      setPosition(current => Math.abs(current.top - next.top) < POSITION_EPSILON && Math.abs(current.left - next.left) < POSITION_EPSILON ? current : next);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, menuRef, setPosition, align]);
}
