import { deriveHierarchyRows, type ParsedRow } from "./parser";

export interface SheetBodyRowStructure {
  rowId: number;
  bodyRowIndex: number;
  absoluteRowIndex: number;
  absoluteRowNumber: number;
  rowPath: string;
  label: string;
  depth: number;
  hasChildren: boolean;
  subtreeRowCount: number;
}

type SheetRowStructureSource = {
  logicalRows: ParsedRow[];
  bodyStart: number;
  rowIds: number[];
};

/*
 * Row structure is derived from flat row order plus hierarchy depth.
 * This is a read surface only; row order and row depth remain the single source of truth.
 */
export function resolveSheetRowStructure(sheet: SheetRowStructureSource): SheetBodyRowStructure[] {
  const derived = deriveHierarchyRows(sheet.logicalRows, sheet.bodyStart);
  const subtreeRowCounts = buildSubtreeRowCounts(derived.map((row) => row.depth));

  return derived.map((row, bodyRowIndex) => {
    const absoluteRowIndex = row.rowIndex;
    const nextDepth = derived[bodyRowIndex + 1]?.depth ?? null;
    return {
      rowId: sheet.rowIds[absoluteRowIndex] ?? absoluteRowIndex + 1,
      bodyRowIndex,
      absoluteRowIndex,
      absoluteRowNumber: absoluteRowIndex + 1,
      rowPath: row.path.join("."),
      label: row.content,
      depth: row.depth,
      hasChildren: nextDepth !== null && nextDepth > row.depth,
      subtreeRowCount: subtreeRowCounts[bodyRowIndex] ?? 1,
    };
  });
}

function buildSubtreeRowCounts(depths: number[]): number[] {
  const counts = Array.from({ length: depths.length }, () => 1);

  for (let i = depths.length - 1; i >= 0; i -= 1) {
    let count = 1;
    let cursor = i + 1;
    while (cursor < depths.length && depths[cursor] > depths[i]) {
      const childSpan = counts[cursor] ?? 1;
      count += childSpan;
      cursor += childSpan;
    }
    counts[i] = count;
  }

  return counts;
}
