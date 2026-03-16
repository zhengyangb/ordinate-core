import { formatDocument } from "./formatter";
import { parseDocument, parseTableRow, type ParsedRow } from "./parser";
import { parseCellInput, type RuntimeValue, evaluateDocument } from "./runtime";

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

export function evaluateAndFormatDocument(text: string): string {
  const parsedSheets = parseDocument(text);
  const evaluated = evaluateDocument(text);

  const lines: string[] = [];
  parsedSheets.forEach((sheet, sIdx) => {
    lines.push(`# ${sheet.name}`);
    if (sheet.table) {
      const parsedRows = sheet.table.rows.map((row) => parseTableRow(row));
      const bodyStart = bodyStartIndex(parsedRows);
      const evalRows = sIdx < evaluated.sheets.length ? evaluated.sheets[sIdx].values : [];

      parsedRows.forEach((row, rIdx) => {
        let renderedCells: string[];
        if (rIdx < bodyStart) {
          renderedCells = [...row.rawCells];
        } else {
          const evalRowIdx = rIdx - bodyStart;
          const evalRow = evalRowIdx < evalRows.length ? evalRows[evalRowIdx] : [];
          renderedCells = [];
          row.rawCells.forEach((rawCell, cIdx) => {
            const cellText = cIdx < row.cells.length ? row.cells[cIdx] : "";
            const parsedCell = parseCellInput(cellText);
            if (parsedCell.kind === "formula") {
              const rhs = parsedCell.expressionText ?? "";
              const value = cIdx < evalRow.length ? evalRow[cIdx] : { kind: "error", value: "internal" };
              if (value.kind === "blank") {
                renderedCells.push(`= ${rhs}`);
              } else {
                renderedCells.push(`${serializeValue(value)} = ${rhs}`);
              }
            } else {
              renderedCells.push(rawCell);
            }
          });
        }
        lines.push(buildRow(renderedCells, row.boundary));
      });
    }
    if (sIdx !== parsedSheets.length - 1) {
      lines.push("");
    }
  });

  const intermediate = `${lines.join("\n").replace(/\s+$/, "")}\n`;
  return formatDocument(intermediate);
}

function bodyStartIndex(parsedRows: ParsedRow[]): number {
  const sep = separatorRowIndex(parsedRows);
  return sep !== null ? sep + 1 : 0;
}

function separatorRowIndex(parsedRows: ParsedRow[]): number | null {
  for (let idx = 0; idx < parsedRows.length; idx += 1) {
    if (isSeparatorRow(parsedRows[idx].cells)) {
      return idx;
    }
  }
  return null;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL_RE.test(cell));
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
