import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { FormatPreviewPanel, StylePreviewPanel } from "./DisplayMetadataPreview";
import { MenuSurface } from "./MenuSurface";
import { POSITION_EPSILON, resolveFlyoutMenuPosition } from "../utils/appHelpers";
import type { ColumnRailMenuView, FloatingMenuPosition, FormatLocalKey, FormatLocalOptions, StyleLocalView } from "../types/ui";

type RailMenuDetailPanelProps = {
  open: boolean;
  panel: "format" | "style" | null;
  railMenu: ColumnRailMenuView;
  anchorRef: RefObject<HTMLElement>;
  containerRef: RefObject<HTMLElement>;
  inspectedKey: FormatLocalKey;
  onInspectKey: (key: FormatLocalKey) => void;
  onSetColumnDefaultFormat: (colId: number, key: FormatLocalKey, options: FormatLocalOptions | null) => void;
  onSetColumnDefaultStyle: <Axis extends keyof StyleLocalView>(colId: number, axis: Axis, value: StyleLocalView[Axis]) => void;
};

export default function RailMenuDetailPanel({
  open,
  panel,
  railMenu,
  anchorRef,
  containerRef,
  inspectedKey,
  onInspectKey,
  onSetColumnDefaultFormat,
  onSetColumnDefaultStyle,
}: RailMenuDetailPanelProps) {
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0 });
  const formatShowsDetail = railMenu.formatLocalKey !== "auto" && inspectedKey !== "auto";

  useLayoutEffect(() => {
    if (!open || panel == null) return;

    const updatePosition = () => {
      const trigger = anchorRef.current;
      const container = containerRef.current;
      const menu = detailRef.current;
      if (!trigger || !container || !menu) return;
      const next = resolveFlyoutMenuPosition(
        trigger.getBoundingClientRect(),
        container.getBoundingClientRect(),
        menu.getBoundingClientRect(),
        {
        preferredSide: "right",
        },
      );
      setPosition((current) => {
        if (
          Math.abs(current.top - next.top) < POSITION_EPSILON &&
          Math.abs(current.left - next.left) < POSITION_EPSILON
        ) {
          return current;
        }
        return next;
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, panel, anchorRef, inspectedKey]);

  if (!open || panel == null) {
    return null;
  }

  return (
    <MenuSurface
      innerRef={detailRef}
      className={[
        "rail-menu",
        "rail-menu-detail",
        panel === "format"
          ? formatShowsDetail
            ? "rail-menu-detail--format-detail"
            : "rail-menu-detail--format-list"
          : "rail-menu-detail--style",
      ].join(" ")}
      open={open}
      ariaHidden={!open}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      <div className={[
        "rail-menu-detail-body",
        panel === "format" ? "rail-menu-detail-body--format" : "rail-menu-detail-body--style",
      ].join(" ")}>
        {panel === "format" ? (
          <FormatPreviewPanel
            localFormatKey={railMenu.formatLocalKey}
            localFormatOptions={railMenu.formatLocalOptions}
            inspectedKey={inspectedKey}
            onInspectKey={onInspectKey}
            onChange={(key, options) => onSetColumnDefaultFormat(railMenu.colId, key, options)}
          />
        ) : (
          <StylePreviewPanel
            styleLocal={railMenu.styleLocal}
            onChange={(axis, value) => onSetColumnDefaultStyle(railMenu.colId, axis, value)}
          />
        )}
      </div>
    </MenuSurface>
  );
}
