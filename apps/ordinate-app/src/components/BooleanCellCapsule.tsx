import { useRef } from "react";

import { isPointInsideBooleanControl } from "../utils/booleanCell";

type BooleanCellCapsuleProps =
  | {
      value: boolean;
      interactive: true;
      onToggle: () => void;
    }
  | {
      value: boolean;
      interactive: false;
      onToggle?: never;
    };

function CapsuleContent({ value }: { value: boolean }) {
  return (
    <>
      {value ? (
        <span className="boolean-cell-capsule-icon" aria-hidden="true">
          <svg viewBox="0 0 12 12" focusable="false">
            <path d="m2.25 6.15 2.15 2.1 5.35-5.1" />
          </svg>
        </span>
      ) : null}
      <span className="boolean-cell-capsule-label">{value ? "true" : "false"}</span>
    </>
  );
}

export default function BooleanCellCapsule(props: BooleanCellCapsuleProps) {
  const activePointerIdRef = useRef<number | null>(null);
  const stateClass = props.value ? "is-true" : "is-false";
  if (!props.interactive) {
    return (
      <span
        className={`boolean-cell-capsule ${stateClass} is-passive`}
        aria-label={`Boolean value: ${props.value ? "true" : "false"}`}
      >
        <CapsuleContent value={props.value} />
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`boolean-cell-capsule ${stateClass} is-interactive`}
      role="switch"
      aria-checked={props.value}
      aria-label={`Boolean value: ${props.value ? "true" : "false"}`}
      aria-keyshortcuts="Space"
      tabIndex={-1}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        activePointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        activePointerIdRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const releasedInside = isPointInsideBooleanControl(
          { x: event.clientX, y: event.clientY },
          rect,
        );
        if (releasedInside) props.onToggle();
      }}
      onPointerCancel={(event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        event.stopPropagation();
        activePointerIdRef.current = null;
      }}
      onLostPointerCapture={(event) => {
        if (activePointerIdRef.current === event.pointerId) {
          activePointerIdRef.current = null;
        }
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <CapsuleContent value={props.value} />
    </button>
  );
}
