import { formatDocument } from "./formatter";
import { type DocumentState } from "./incremental";
import { type RuntimeValue } from "./runtime/types";

// Serialize a DocumentState to canonical .ord text.
export function serializeDocumentState(state: DocumentState): string {
  const lines: string[] = [];

  state.sheets.forEach((sheet, sheetIdx) => {
    lines.push(`# ${sheet.name}`);
    if (sheet.rowCount > 0 && sheet.colCount > 0) {
      const boundary = sheet.logicalRows.length > 0 ? sheet.logicalRows[0].boundary : null;
      const headerCount = sheet.headerRowCount;

      for (let rAbs = 0; rAbs < sheet.logicalRows.length; rAbs += 1) {
        if (headerCount > 0 && rAbs === headerCount) {
          const dividerCells = Array.from({ length: sheet.colCount }, () => "---");
          lines.push(buildRow(dividerCells, boundary));
        }

        const row = sheet.logicalRows[rAbs];
        const cells: string[] = [];
        for (let c = 0; c < sheet.colCount; c += 1) {
          const raw = c < row.rawCells.length ? row.rawCells[c] : "";
          const cellState = sheet.cells[rAbs][c];
          if (cellState.parsed.kind === "formula") {
            const rhs = cellState.parsed.expressionText ?? "";
            if (!cellState.dirty && cellState.value !== null && cellState.value.kind !== "blank") {
              cells.push(`${serializeValue(cellState.value)} = ${rhs}`);
            } else {
              cells.push(`= ${rhs}`);
            }
          } else {
            cells.push(raw);
          }
        }
        lines.push(buildRow(cells, row.boundary));
      }
    }
    if (sheetIdx !== state.sheets.length - 1) {
      lines.push("");
    }
  });

  const intermediate = `${lines.join("\n").replace(/\s+$/, "")}\n`;
  return formatDocument(intermediate);
}

function buildRow(cells: string[], boundary: number | null): string {
  const parts: string[] = [];
  if (boundary === 0) {
    parts.push("");
  }
  cells.forEach((cell, idx) => {
    parts.push(cell);
    if (boundary !== null && idx + 1 === boundary) {
      parts.push("");
    }
  });
  return `|${parts.join("|")}|`;
}

function serializeValue(value: RuntimeValue): string {
  if (value.kind === "number") {
    return serializeNumber(value.value as number | null);
  }
  if (value.kind === "string") {
    return serializeString(String(value.value ?? ""));
  }
  if (value.kind === "boolean") {
    return value.value ? "true" : "false";
  }
  if (value.kind === "blank") {
    return "";
  }
  if (value.kind === "null") {
    return "null";
  }
  if (value.kind === "error") {
    return "error";
  }
  return "error";
}

function serializeNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "error";
  }
  if (Number.isInteger(value)) {
    return `${value}`;
  }
  const text = Number(value).toPrecision(15);
  return Number(text).toString();
}

function serializeString(text: string): string {
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
