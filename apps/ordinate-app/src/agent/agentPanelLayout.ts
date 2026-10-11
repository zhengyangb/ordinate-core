export const ASSISTANT_MIN_WIDTH = 320;
export const ASSISTANT_MAX_WIDTH = 720;
export const EDITOR_MIN_WIDTH = 340;

export function assistantWidthLimits(workspaceWidth: number) {
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) throw new Error("Assistant workspace width must be positive and finite.");
  return {
    min: ASSISTANT_MIN_WIDTH,
    max: Math.max(ASSISTANT_MIN_WIDTH, Math.min(ASSISTANT_MAX_WIDTH, Math.floor(workspaceWidth - EDITOR_MIN_WIDTH))),
  };
}

export function clampAssistantWidth(width: number, workspaceWidth: number): number {
  if (!Number.isFinite(width)) throw new Error("Assistant width must be finite.");
  const { min, max } = assistantWidthLimits(workspaceWidth);
  return Math.min(max, Math.max(min, Math.round(width)));
}
