import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { FormatPreviewPanel, StylePreviewPanel } from "./DisplayMetadataPreview";
import { EditorPopover } from "./EditorPopover";
import { POSITION_EPSILON, resolveFlyoutMenuPosition } from "../utils/appHelpers";
import type { ColumnRailMenuView, FloatingMenuPosition, FormatLocalKey, FormatLocalOptions, RowRailMenuView, StyleLocalView } from "../types/ui";

type DisplayEditableRailMenuView = ColumnRailMenuView | RowRailMenuView;

type RailMenuDetailPanelProps = {
  open: boolean;
  panel: "format" | "style" | null;
  railMenu: DisplayEditableRailMenuView;
  anchorRef: RefObject<HTMLElement>;
  containerRef: RefObject<HTMLElement>;
  inspectedKey: FormatLocalKey;
  onInspectKey: (key: FormatLocalKey) => void;
  onSetColumnDefaultFormat: (colId: number, key: FormatLocalKey, options: FormatLocalOptions | null) => void;
  onSetColumnDefaultStyle: <Axis extends keyof StyleLocalView>(colId: number, axis: Axis, value: StyleLocalView[Axis]) => void;
  onSetRowDefaultFormat: (rowId: number, key: FormatLocalKey, options: FormatLocalOptions | null) => void;
  onSetRowDefaultStyle: <Axis extends keyof StyleLocalView>(rowId: number, axis: Axis, value: StyleLocalView[Axis]) => void;
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
  onSetRowDefaultFormat,
  onSetRowDefaultStyle,
}: RailMenuDetailPanelProps) {
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0 });

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
  }, [open, panel, anchorRef, containerRef]);

  if (!open || panel == null) {
    return null;
  }

  return (
    <EditorPopover
      ref={detailRef}
      role="menu"
      className="rail-menu rail-menu-detail open"
      style={{ top: `${position.top}px`, left: `${position.left}px`, maxHeight: `calc(100dvh - ${position.top}px - 24px)` }}
    >
      <div className={[
        "rail-menu-detail-body",
        panel === "format" ? "rail-menu-detail-body--format" : "rail-menu-detail-body--style",
      ].join(" ")}>
        {panel === "format" ? (
          <FormatPreviewPanel
            scope={railMenu.kind}
            localFormatKey={railMenu.formatLocalKey}
            localFormatOptions={railMenu.formatLocalOptions}
            inspectedKey={inspectedKey}
            previewContext={railMenu.formatPreviewContext}
            onInspectKey={onInspectKey}
            onChange={(key, options) => {
              if (railMenu.kind === "column") {
                onSetColumnDefaultFormat(railMenu.colId, key, options);
              } else {
                onSetRowDefaultFormat(railMenu.rowId, key, options);
              }
            }}
          />
        ) : (
          <StylePreviewPanel
            scope={railMenu.kind}
            styleLocal={railMenu.styleLocal}
            onChange={(axis, value) => {
              if (railMenu.kind === "column") {
                onSetColumnDefaultStyle(railMenu.colId, axis, value);
              } else {
                onSetRowDefaultStyle(railMenu.rowId, axis, value);
              }
            }}
          />
        )}
      </div>
    </EditorPopover>
  );
}
