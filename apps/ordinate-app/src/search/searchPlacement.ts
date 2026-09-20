type Box = { left: number; right: number; top: number; bottom: number };

/** Keep the default corner unless the current result would be hidden by the panel. */
export function searchPanelOffset(panel: Box, targets: Box[], bottomLimit: number, gap = 8): number {
  const overlaps = targets.filter(target =>
    target.left < panel.right + gap && target.right > panel.left - gap &&
    target.top < panel.bottom + gap && target.bottom > panel.top - gap,
  );
  if (!overlaps.length) return 0;
  const below = Math.max(...overlaps.map(target => target.bottom)) + gap - panel.top;
  // In a short window, do not send controls beyond the usable viewport.
  return Math.max(0, Math.min(below, bottomLimit - panel.bottom - gap));
}
