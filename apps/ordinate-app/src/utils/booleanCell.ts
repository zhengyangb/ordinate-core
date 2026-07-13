import type { CellBodyState, RuntimeValue } from "@ordinate/core";

export type BooleanCellView = {
  value: boolean;
  interactive: boolean;
};

export function resolveBooleanCellView(
  runtimeValue: RuntimeValue | undefined,
  body: CellBodyState | undefined,
): BooleanCellView | null {
  if (runtimeValue?.kind !== "boolean") return null;
  if (!body) {
    throw new Error("boolean runtime value requires a cell body");
  }
  if (!body.valid) {
    throw new Error("boolean runtime value cannot originate from an invalid cell body");
  }
  if (body.kind === "formula") {
    return { value: runtimeValue.value, interactive: false };
  }
  if (body.literal.kind !== "boolean") {
    throw new Error("boolean runtime value does not match its literal cell body");
  }
  if (body.literal.value !== runtimeValue.value) {
    throw new Error("boolean runtime value is stale relative to its literal cell body");
  }
  return { value: runtimeValue.value, interactive: true };
}

export function toggledBooleanInput(value: boolean): "true" | "false" {
  return value ? "false" : "true";
}

type BooleanKeyboardActivation = {
  key: string;
  repeat: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

export function isBooleanKeyboardActivation(event: BooleanKeyboardActivation): boolean {
  return (
    event.key === " " &&
    !event.repeat &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

type BooleanControlBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function isPointInsideBooleanControl(
  point: { x: number; y: number },
  bounds: BooleanControlBounds,
): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}
