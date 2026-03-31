import { formatDocument } from "./formatter";
import { parseDocument, parseTableRow, type ParsedRow } from "./parser";
import { stripCellDisplayMetadata } from "./runtime/parse";
import { parseCellInput, type ParsedDisplayMetadata, type RuntimeValue, evaluateDocument } from "./runtime";

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

export function evaluateAndFormatDocument(text: string): string {
  const parsedSheets = parseDocument(text);
  const evaluated = evaluateDocument(text);

  const lines: string[] = [];
  parsedSheets.forEach((sheet, sIdx) => {
    lines.push(`# ${sheet.name}`);
    let usedPrimaryTable = false;
    const evalRows = sIdx < evaluated.sheets.length ? evaluated.sheets[sIdx].values : [];
    for (const block of sheet.blocks) {
      if (block.kind === "unparsed") {
        lines.push(...block.lines);
        continue;
      }

      if (usedPrimaryTable) {
        lines.push(...block.table.rows);
        continue;
      }
      usedPrimaryTable = true;

      const parsedRows = block.table.rows.map((row) => parseTableRow(row));
      const bodyStart = bodyStartIndex(parsedRows);
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
              const displaySuffix = renderDisplayBlock(parsedCell.display ?? null);
              if (value.kind === "blank") {
                renderedCells.push(`= ${rhs}${displaySuffix}`);
              } else {
                renderedCells.push(`${serializeValue(value)} = ${rhs}${displaySuffix}`);
              }
            } else {
              const displaySuffix = renderDisplayBlock(parsedCell.display ?? null);
              if (displaySuffix === "") {
                renderedCells.push(rawCell);
              } else {
                const base = stripCellDisplayMetadata(rawCell).trim();
                renderedCells.push(`${base}${displaySuffix}`);
              }
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
  if (value.kind === "date" || value.kind === "time" || value.kind === "datetime" || value.kind === "duration") {
    return String(value.value ?? "");
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

function renderDisplayBlock(display: ParsedDisplayMetadata | null): string {
  if (!display) return "";
  if (!display.valid) {
    return display.rawBlock ? ` ${display.rawBlock}` : "";
  }
  const format = display.formatSpec ? serializeFormatSpec(display.formatSpec) : "";
  const style = display.styleSpec ? serializeStyleSpec(display.styleSpec) : "";
  if (format === "" && style === "") return "";
  if (style === "") return ` {:${format}}`;
  if (format === "") return ` {::${style}}`;
  return ` {:${format}:${style}}`;
}

function serializeFormatSpec(spec: NonNullable<ParsedDisplayMetadata["formatSpec"]>): string {
  let out = "";
  if (spec.sign === "plus") out += "+";
  else if (spec.sign === "parentheses") out += "()";
  if (spec.zeroPad) out += "0";
  if (spec.width !== null) out += `${spec.width}`;
  if (spec.grouping) out += ",";
  if (spec.precision !== null) out += `.${spec.precision}`;
  if (spec.type !== null) out += spec.type;
  return out;
}

function serializeStyleSpec(spec: NonNullable<ParsedDisplayMetadata["styleSpec"]>): string {
  const parts: string[] = [];
  if (spec.align === "left") parts.push("<");
  if (spec.align === "right") parts.push(">");
  if (spec.align === "center") parts.push("^");
  if (spec.weight === "bold") parts.push("bold");
  if (spec.weight === "normal") parts.push("normal");
  if (spec.color === "red") parts.push("red");
  if (spec.color === "green") parts.push("green");
  if (spec.color === "blue") parts.push("blue");
  return parts.join(",");
}
