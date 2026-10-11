import type { GridRow } from "../types/ui";
import type { ColumnWidthMode } from "../preferences/preferences";

type ColumnLayout = { width: number; wrapText: boolean; autoHeight: boolean };

// Short scalar columns need the same compact floor in sparse sheets and dense
// reports. The floor is not a preferred width: displayed content still sizes up.
const MIN_DATA_COLUMN_WIDTH = 80;

// Also used by the append-column preview: an empty column has no text or
// numeric peers to size from, regardless of the preceding column's content.
export const EMPTY_COLUMN_WIDTH = MIN_DATA_COLUMN_WIDTH;

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
  mode: ColumnWidthMode,
): ColumnLayout[] {
  if (!Number.isInteger(headerColCount) || headerColCount < 0 || headerColCount > headers.length) {
    throw new Error("invalid header column count for column layout");
  }
  if (mode !== "standard" && mode !== "wide") throw new Error("invalid column width mode");
  const compact = mode === "standard";
  const profiles = headers.map((header, colIndex) => {
    const widths: number[] = [];
    let hasText = false;
    let hasNumber = false;
    let hasBoolean = false;
    let hasTemporal = false;
    let numberCount = 0;
    let textCount = 0;
    let scalarContentWidth = 0;
    for (const row of rows) {
      const value = row[`col_${colIndex}`];
      if (typeof value !== "string") throw new Error(`missing display text for column ${colIndex}`);
      if (!value) continue;
      const kind = row[`__kind_${colIndex}`];
      if (kind === "error") continue; // Error chips can collapse to their icon.
      numberCount += kind === "number" ? 1 : 0;
      const temporal = kind === "date" || kind === "datetime" || kind === "time" || kind === "duration";
      hasTemporal ||= temporal;
      if (kind === "number" || temporal) scalarContentWidth = Math.max(scalarContentWidth, textWidth(value), value.length * 8);
      textCount += kind === "string" || kind === "label" ? 1 : 0;
      hasText ||= kind === "string" || kind === "label";
      hasNumber ||= kind === "number";
      hasBoolean ||= kind === "boolean";
      const indent = colIndex === 0 && headerColCount > 0 ? Math.max(0, row.__depth - 1) * 12 + 24 : 0;
      widths.push(textWidth(value) + indent);
    }
    widths.sort((a, b) => a - b);
    // An unusually long note should wrap instead of widening its entire column.
    const representative = widths.length ? widths[Math.ceil(widths.length * 0.8) - 1] : 0;
    const isHeader = colIndex < headerColCount;
    const numeric = !isHeader && hasNumber && numberCount / (numberCount + textCount) >= 0.7;
    // Prose can wrap; numeric and temporal displays must also account for a
    // single outlier. Measure the projected display, including locale/format,
    // rather than the underlying ISO value. Temporal columns do not inherit
    // the dense report's numeric width cap or widen unrelated numeric peers.
    // In standard mode a long heading may wrap; actual scalar displays still
    // contribute their full measured width. Row-label columns retain more room.
    const headingWidth = compact && !isHeader ? Math.min(textWidth(header), 80) : textWidth(header);
    const desired = Math.max(headingWidth, representative, numeric || hasTemporal ? scalarContentWidth : 0) + (compact ? 24 : 32);
    const width = isHeader ? boundedWidth(desired, compact ? 160 : 176, compact ? 224 : 256)
      : hasTemporal ? boundedWidth(desired, MIN_DATA_COLUMN_WIDTH, 320)
      : hasText && !numeric ? boundedWidth(desired, compact ? 112 : 144, compact ? 256 : 320)
      : hasBoolean && !hasNumber ? boundedWidth(desired, compact ? 80 : 96, 144)
      : boundedWidth(desired, MIN_DATA_COLUMN_WIDTH, 176);
    return { width, numeric, hasTemporal, desired, empty: widths.length === 0, wrapText: hasText, autoHeight: hasText };
  });
  // Comparable numeric columns share a rhythm rather than varying with each value.
  const dense = profiles.filter(column => column.numeric).length >= 4;
  const numericWidth = profiles.reduce((max, column) => column.numeric && !column.hasTemporal ? Math.max(max, dense ? boundedWidth(column.desired, MIN_DATA_COLUMN_WIDTH, 144) : column.width) : max, MIN_DATA_COLUMN_WIDTH);
  const firstContent = profiles.findIndex(c => !c.empty);
  const lastContent = profiles.reduce((last, column, i) => column.empty ? last : i, -1);
  return profiles.map(({ numeric, hasTemporal, desired: _desired, empty, ...column }, i) => ({ ...column,
    width: numeric && !hasTemporal ? numericWidth : dense && empty && i > firstContent && i < lastContent ? 32 : column.width,
  }));
}
