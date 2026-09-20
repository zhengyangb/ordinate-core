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

function BooleanControlIcon({ value }: { value: boolean }) {
  return (
    <span className="boolean-cell-capsule-icon" aria-hidden="true">
      {value ? (
        <svg viewBox="0 0 12 12" focusable="false">
          <path d="m2.25 6.15 2.15 2.1 5.35-5.1" />
        </svg>
      ) : null}
    </span>
  );
}

export default function BooleanCellCapsule(props: BooleanCellCapsuleProps) {
  const stateClass = props.value ? "is-true" : "is-false";
  if (!props.interactive) {
    return (
      <span
        className={`boolean-cell-capsule ${stateClass} is-passive`}
        aria-label={`Boolean value: ${props.value ? "true" : "false"}`}
      >
        <BooleanControlIcon value={props.value} />
        <span className="boolean-cell-capsule-label">{props.value ? "true" : "false"}</span>
      </span>
    );
  }

  return (
    <span
      className={`boolean-cell-capsule ${stateClass} is-interactive`}
      aria-label={`Boolean value: ${props.value ? "true" : "false"}`}
    >
      <button
        type="button"
        className="boolean-cell-control"
        role="switch"
        aria-checked={props.value}
        aria-label={`Set Boolean value to ${props.value ? "false" : "true"}`}
        aria-keyshortcuts="Space"
        tabIndex={-1}
        onMouseDownCapture={(event) => {
          _stopPropagationForAgGrid(event.nativeEvent);
        }}
        onTouchStartCapture={(event) => {
          _stopPropagationForAgGrid(event.nativeEvent);
        }}
        onClickCapture={(event) => {
          _stopPropagationForAgGrid(event.nativeEvent);
        }}
        onDoubleClickCapture={(event) => {
          _stopPropagationForAgGrid(event.nativeEvent);
        }}
        onClick={(event) => {
          event.stopPropagation();
          props.onToggle();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <BooleanControlIcon value={props.value} />
      </button>
      <span className="boolean-cell-capsule-label">{props.value ? "true" : "false"}</span>
    </span>
  );
}
import { _stopPropagationForAgGrid } from "ag-grid-community";
