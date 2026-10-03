import type { GridRow } from "../types/ui";

type ColumnLayout = { width: number; wrapText: boolean; autoHeight: boolean };

// Also used by the append-column preview: an empty column has no text or
// numeric peers to size from, regardless of the preceding column's content.
export const EMPTY_COLUMN_WIDTH = 112;

// Approximate the 13px table font, including wide scripts. Actual line wrapping
// and row height are measured by the grid, not guessed from character counts.
function textWidth(text: string): number {
  return Math.max(0, ...text.split(/\r?\n/).map((line) => {
    let width = 0;
    for (const character of line) {
      width += /[\u2e80-\uffef]|\p{Extended_Pictographic}/u.test(character) ? 13
        : /[ilI.,' :;!|]/.test(character) ? 3.5
        : /[MW@%]/.test(character) ? 10 : 7;
    }
    return width;
  }));
}

function boundedWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.ceil(width / 16) * 16));
}

export function resolveColumnLayouts(
  rows: GridRow[],
  headers: string[],
  headerColCount: number,
): ColumnLayout[] {
  if (!Number.isInteger(headerColCount) || headerColCount < 0 || headerColCount > headers.length) {
    throw new Error("invalid header column count for column layout");
  }
  const profiles = headers.map((header, colIndex) => {
    const widths: number[] = [];
    let hasText = false;
    let hasNumber = false;
    let hasBoolean = false;
    for (const row of rows) {
      const value = row[`col_${colIndex}`];
      if (typeof value !== "string") throw new Error(`missing display text for column ${colIndex}`);
      if (!value) continue;
      const kind = row[`__kind_${colIndex}`];
      hasText ||= kind === "string" || kind === "label";
      hasNumber ||= kind === "number";
      hasBoolean ||= kind === "boolean";
      const indent = colIndex === 0 && headerColCount > 0 ? Math.max(0, row.__depth - 1) * 12 + 24 : 0;
      widths.push(textWidth(value) + indent);
    }
    widths.sort((a, b) => a - b);
    // An unusually long note should wrap instead of widening its entire column.
    const representative = widths.length ? widths[Math.ceil(widths.length * 0.8) - 1] : 0;
    const desired = Math.max(textWidth(header), representative) + 32;
    const isHeader = colIndex < headerColCount;
    const numeric = !isHeader && hasNumber && !hasText;
    const width = isHeader ? boundedWidth(desired, 176, 256)
      : hasText ? boundedWidth(desired, 144, 320)
      : hasBoolean && !hasNumber ? boundedWidth(desired, 96, 144)
      : boundedWidth(desired, EMPTY_COLUMN_WIDTH, 176);
    return { width, numeric, wrapText: hasText, autoHeight: hasText };
  });
  // Comparable numeric columns share a rhythm rather than varying with each value.
  const numericWidth = profiles.reduce((max, column) => column.numeric ? Math.max(max, column.width) : max, EMPTY_COLUMN_WIDTH);
  return profiles.map(({ numeric, ...column }) => ({ ...column, width: numeric ? numericWidth : column.width }));
}
