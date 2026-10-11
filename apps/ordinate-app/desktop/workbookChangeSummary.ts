function lines(text: string): string[] {
  if (!text) return [];
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

/** Content-free line inventory delta; it does not reveal text or infer the writing tool. */
export function workbookChangeSummary(before: string, after: string) {
  if (before === after) throw new Error("A workbook change requires different source text.");
  const previous = lines(before);
  const current = lines(after);
  const remaining = new Map<string, number>();
  for (const line of previous) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  let unmatchedCurrent = 0;
  for (const line of current) {
    const count = remaining.get(line) ?? 0;
    if (count) remaining.set(line, count - 1);
    else unmatchedCurrent++;
  }
  const unmatchedPrevious = [...remaining.values()].reduce((total, count) => total + count, 0);
  const changedLines = Math.min(unmatchedPrevious, unmatchedCurrent);
  return {
    beforeLines: previous.length,
    afterLines: current.length,
    changedLines,
    addedLines: unmatchedCurrent - changedLines,
    removedLines: unmatchedPrevious - changedLines,
    sameLineContents: unmatchedPrevious === 0 && unmatchedCurrent === 0,
    beforeBytes: Buffer.byteLength(before),
    afterBytes: Buffer.byteLength(after),
  };
}
