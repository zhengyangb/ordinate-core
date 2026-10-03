/** Counter-scale only the vertical corner radius, never the editor's text. */
export function formulaBarSurfaceFrames(fromHeight: number, toHeight: number, radius: number): Keyframe[] {
  if (![fromHeight, toHeight, radius].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("Formula bar geometry must be finite and positive");
  }
  return Array.from({ length: 17 }, (_, index) => {
    const offset = index / 16;
    const scale = (fromHeight + (toHeight - fromHeight) * offset) / toHeight;
    return { offset, transform: `scaleY(${scale})`, borderRadius: `${radius}px / ${radius / scale}px` };
  });
}
