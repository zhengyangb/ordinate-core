import { DocumentState } from "./incremental";
import { stripCellDisplayMetadata } from "./runtime/parse";
import { type Diagnostic, type FormatSpec, type NumericFormatSpec, type RuntimeValue, type StyleSpec } from "./runtime/types";
import { formatTemporalValue } from "./runtime/temporalFormat";

export interface DisplayLayer<T> {
  local: T | null;
  inherited: T | null;
  effective: T | null;
}

export interface ColumnDisplayDefault {
  formatLayer: DisplayLayer<FormatSpec>;
  styleLayer: DisplayLayer<StyleSpec>;
  valid: boolean;
  errors: Diagnostic[];
}

export interface RowDisplayDefault {
  formatLayer: DisplayLayer<FormatSpec>;
  styleLayer: DisplayLayer<StyleSpec>;
  valid: boolean;
  errors: Diagnostic[];
}

export interface PresentedCell {
  rowIndex: number;
  colIndex: number;
  displayText: string;
  formatLayer: DisplayLayer<FormatSpec>;
  styleLayer: DisplayLayer<StyleSpec>;
  source: "cell" | "row" | "column" | "default";
  errors: Diagnostic[];
}

export interface SheetPresentation {
  name: string;
  bodyStart: number;
  headerDisplayRows: string[][];
  columnDefaults: ColumnDisplayDefault[];
  rowDefaults: RowDisplayDefault[];
  cells: PresentedCell[][];
}

export interface PresentationResult {
  sheets: SheetPresentation[];
}

export function formatPresentedCell(cell: {
  value: RuntimeValue | null;
  formatLayer: { effective: FormatSpec | null };
}): string {
  return formatRuntimeValue(cell.value, cell.formatLayer.effective).displayText;
}

export function resolvePresentationFromText(text: string): PresentationResult {
  const state = DocumentState.fromText(text);
  return resolveDocumentPresentation(state);
}

export function resolveDocumentPresentation(state: DocumentState): PresentationResult {
  const evaluation = state.evaluate();
  const sheets: SheetPresentation[] = [];

  state.sheets.forEach((sheet, sIdx) => {
    const defaults = computeColumnDefaults(sheet);
    const rowDefaults = computeRowDefaults(sheet);
    const evalSheet = sIdx < evaluation.sheets.length ? evaluation.sheets[sIdx] : null;
    const headerDisplayRows = computeHeaderDisplayRows(sheet);
    const cells: PresentedCell[][] = [];

    for (let rAbs = sheet.bodyStart; rAbs < sheet.rowCount; rAbs += 1) {
      const evalRow = evalSheet && rAbs - sheet.bodyStart < evalSheet.values.length
        ? evalSheet.values[rAbs - sheet.bodyStart]
        : [];
      const rowCells: PresentedCell[] = [];
      for (let c = 0; c < sheet.colCount; c += 1) {
        const isHeaderColumn = c < sheet.headerColCount;
        const parsedDisplay = sheet.cells[rAbs][c].localDisplay ?? null;
        const cellFormatLocal = !isHeaderColumn && parsedDisplay && parsedDisplay.valid ? parsedDisplay.format : null;
        const cellStyleLocal = !isHeaderColumn && parsedDisplay && parsedDisplay.valid ? parsedDisplay.style : null;
        const colDefault = c < defaults.length
          ? defaults[c]
          : {
              formatLayer: { local: null, inherited: null, effective: null },
              styleLayer: { local: null, inherited: null, effective: null },
              valid: true,
              errors: [],
            };
        const rowDefault = rAbs < rowDefaults.length
          ? rowDefaults[rAbs]
          : {
              formatLayer: { local: null, inherited: colDefault.formatLayer.effective, effective: colDefault.formatLayer.effective },
              styleLayer: { local: null, inherited: colDefault.styleLayer.effective, effective: colDefault.styleLayer.effective },
              valid: true,
              errors: [],
            };
        // Display defaults apply to data cells only; header/label columns keep their semantic text.
        // Format is all-or-nothing: local override replaces inherited format entirely.
        const inheritedFormat = isHeaderColumn ? null : rowDefault.formatLayer.effective ?? colDefault.formatLayer.effective;
        const formatLayer: DisplayLayer<FormatSpec> = {
          local: cellFormatLocal,
          inherited: inheritedFormat,
          effective: cellFormatLocal ?? inheritedFormat,
        };
        // Style is axis-level cascading: align/weight/color resolve independently.
        const inheritedStyle = isHeaderColumn ? null : resolveStyleSpec(rowDefault.styleLayer.effective, colDefault.styleLayer.effective);
        const styleLayer: DisplayLayer<StyleSpec> = {
          local: cellStyleLocal,
          inherited: inheritedStyle,
          effective: resolveStyleSpec(cellStyleLocal, inheritedStyle),
        };
        const hasCellStyleOverride = hasAnyStyleAxis(cellStyleLocal);
        const hasColumnStyleDefault = hasAnyStyleAxis(colDefault.styleLayer.effective);
        const hasRowStyleDefault = hasAnyStyleAxis(rowDefault.styleLayer.effective);
        const hasCellOverride = !isHeaderColumn && (cellFormatLocal !== null || hasCellStyleOverride);
        const hasRowDefault = rowDefault.formatLayer.effective !== null || hasRowStyleDefault;
        const hasColumnDefault = colDefault.formatLayer.effective !== null || hasColumnStyleDefault;
        const source: "cell" | "row" | "column" | "default" = isHeaderColumn
          ? "default"
          : hasCellOverride
            ? "cell"
            : hasRowDefault
              ? "row"
              : hasColumnDefault
                ? "column"
                : "default";
        const errors: Diagnostic[] = [];
        if (!isHeaderColumn && parsedDisplay && !parsedDisplay.valid) {
          errors.push(parsedDisplay.issue);
        } else if (!isHeaderColumn && rowDefault.valid === false && rowDefault.errors.length > 0) {
          errors.push(...rowDefault.errors);
        } else if (!isHeaderColumn && colDefault.valid === false && colDefault.errors.length > 0) {
          errors.push(...colDefault.errors);
        }
        const value = c < evalRow.length ? evalRow[c] : null;
        const formatted = formatRuntimeValue(value, formatLayer.effective);
        if (formatted.issue) {
          errors.push(formatted.issue);
        }

        rowCells.push({
          rowIndex: rAbs,
          colIndex: c,
          displayText: formatted.displayText,
          formatLayer,
          styleLayer,
          source,
          errors,
        });
      }
      cells.push(rowCells);
    }

    sheets.push({
      name: sheet.name,
      bodyStart: sheet.bodyStart,
      headerDisplayRows,
      columnDefaults: defaults,
      rowDefaults,
      cells,
    });
  });

  return { sheets };
}

function hasAnyStyleAxis(style: StyleSpec | null): boolean {
  if (!style) return false;
  return style.align !== null || style.weight !== null || style.color !== null;
}

/**
 * Resolve style axes with fallback.
 * Each axis (align/weight/color) is resolved independently: local -> inherited.
 */
function resolveStyleSpec(localStyle: StyleSpec | null, inheritedStyle: StyleSpec | null): StyleSpec | null {
  if (!localStyle && !inheritedStyle) return null;
  const align = localStyle?.align ?? inheritedStyle?.align ?? null;
  const weight = localStyle?.weight ?? inheritedStyle?.weight ?? null;
  const color = localStyle?.color ?? inheritedStyle?.color ?? null;
  if (align === null && weight === null && color === null) {
    return null;
  }
  return {
    align,
    weight,
    color,
  };
}

function serializeStyleSpec(spec: StyleSpec): string {
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

function computeHeaderDisplayRows(sheet: DocumentState["sheets"][number]): string[][] {
  if (sheet.colCount <= 0 || sheet.headerRowCount <= 0) return [];
  const depth = sheet.headerRowCount;
  const matrix: string[][] = [];

  for (let rowIndex = 0; rowIndex < depth; rowIndex += 1) {
    const headerRow = rowIndex < sheet.headerRowCount ? sheet.logicalRows[rowIndex] : null;
    const rowLabels: string[] = [];
    for (let colIndex = 0; colIndex < sheet.colCount; colIndex += 1) {
      const rawHeader = headerRow && colIndex < headerRow.rawCells.length ? headerRow.rawCells[colIndex] : "";
      const label = stripCellDisplayMetadata(rawHeader).trim();
      if (label.length > 0) {
        rowLabels.push(label);
        continue;
      }
      rowLabels.push("");
    }
    matrix.push(rowLabels);
  }

  return matrix;
}

function emptyDisplayDefault(inheritedFormat: FormatSpec | null = null, inheritedStyle: StyleSpec | null = null): RowDisplayDefault {
  return {
    formatLayer: {
      local: null,
      inherited: inheritedFormat,
      effective: inheritedFormat,
    },
    styleLayer: {
      local: null,
      inherited: inheritedStyle,
      effective: inheritedStyle,
    },
    valid: true,
    errors: [],
  };
}

function computeColumnDefaults(sheet: DocumentState["sheets"][number]): ColumnDisplayDefault[] {
  const defaults: ColumnDisplayDefault[] = Array.from({ length: sheet.colCount }, () => ({
    formatLayer: {
      local: null,
      inherited: null,
      effective: null,
    },
    styleLayer: {
      local: null,
      inherited: null,
      effective: null,
    },
    valid: true,
    errors: [],
  }));
  if (sheet.colCount <= 0) {
    return defaults;
  }

  for (let c = 0; c < sheet.colCount; c += 1) {
    const parsedDisplay = c < sheet.columnDisplayMetadata.length ? sheet.columnDisplayMetadata[c] : null;
    if (!parsedDisplay) continue;
    defaults[c] = {
      formatLayer: {
        local: parsedDisplay.valid ? parsedDisplay.format : null,
        inherited: null,
        effective: parsedDisplay.valid ? parsedDisplay.format : null,
      },
      styleLayer: {
        local: parsedDisplay.valid ? parsedDisplay.style : null,
        inherited: null,
        effective: parsedDisplay.valid ? parsedDisplay.style : null,
      },
      valid: parsedDisplay.valid,
      errors: parsedDisplay.valid ? [] : [parsedDisplay.issue],
    };
  }
  return defaults;
}

function computeRowDefaults(sheet: DocumentState["sheets"][number]): RowDisplayDefault[] {
  const defaults: RowDisplayDefault[] = Array.from({ length: sheet.rowCount }, () => emptyDisplayDefault());
  if (sheet.rowCount <= 0) {
    return defaults;
  }

  for (let rAbs = sheet.bodyStart; rAbs < sheet.rowCount; rAbs += 1) {
    const parsedDisplay = rAbs < sheet.rowDisplayMetadata.length ? sheet.rowDisplayMetadata[rAbs] : null;
    if (!parsedDisplay) continue;
    defaults[rAbs] = {
      formatLayer: {
        local: parsedDisplay.valid ? parsedDisplay.format : null,
        inherited: null,
        effective: parsedDisplay.valid ? parsedDisplay.format : null,
      },
      styleLayer: {
        local: parsedDisplay.valid ? parsedDisplay.style : null,
        inherited: null,
        effective: parsedDisplay.valid ? parsedDisplay.style : null,
      },
      valid: parsedDisplay.valid,
      errors: parsedDisplay.valid ? [] : [parsedDisplay.issue],
    };
  }
  return defaults;
}

function formatRuntimeValue(value: RuntimeValue | null, format: FormatSpec | null): { displayText: string; issue: Diagnostic | null } {
  const base = runtimeValueToText(value);
  if (!format || !value || value.kind === "blank" || value.kind === "null" || value.kind === "error") {
    return { displayText: base, issue: null };
  }
  if (format.kind === "numeric") {
    if (value.kind !== "number") {
      return {
        displayText: base,
        issue: diagnostic("format_value_kind_mismatch", { formatKind: "numeric", valueKind: value.kind }),
      };
    }
    const rawNumber = Number(value.value);
    if (!Number.isFinite(rawNumber)) {
      return { displayText: "#ERROR", issue: null };
    }
    return { displayText: formatNumber(rawNumber, format), issue: null };
  }

  const formatted = formatTemporalValue(value, format);
  if ("issue" in formatted) {
    return { displayText: base, issue: formatted.issue };
  }
  return { displayText: formatted.text, issue: null };
}

function runtimeValueToText(value: RuntimeValue | null): string {
  if (!value) return "";
  switch (value.kind) {
    case "number":
      return serializeNumber(Number(value.value));
    case "string":
      return String(value.value ?? "");
    case "boolean":
      return value.value ? "true" : "false";
    case "blank":
      return "";
    case "null":
      return "null";
    case "date":
    case "time":
    case "datetime":
    case "duration":
      return String(value.value ?? "");
    case "error":
      return "#ERROR";
    default:
      return "";
  }
}

function formatNumber(value: number, format: NumericFormatSpec): string {
  const isNegative = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);

  let numericText: string;
  const precision = format.precision;
  switch (format.type) {
    case "e":
      numericText = abs.toExponential(precision ?? 6);
      break;
    case "%": {
      const percentage = abs * 100;
      const percentageText = precision != null ? percentage.toFixed(precision) : serializeNumber(percentage);
      numericText = `${percentageText}%`;
      break;
    }
    case "d":
      numericText = Math.trunc(abs).toString(10);
      break;
    case "f":
      numericText = precision != null ? abs.toFixed(precision) : serializeNumber(abs);
      break;
    default:
      numericText = precision != null ? abs.toFixed(precision) : serializeNumber(abs);
      break;
  }

  if (format.grouping) {
    numericText = applyGrouping(numericText);
  }

  let signedText: string;
  if (format.sign === "parentheses" && isNegative) {
    signedText = `(${numericText})`;
  } else {
    const signPrefix = isNegative ? "-" : format.sign === "plus" ? "+" : "";
    signedText = `${signPrefix}${numericText}`;
  }

  if (format.padWidth === null || format.padWidth <= 0 || signedText.length >= format.padWidth) {
    return signedText;
  }
  if (signedText.startsWith("-") || signedText.startsWith("+")) {
    const sign = signedText[0];
    const body = signedText.slice(1).padStart(format.padWidth - 1, "0");
    return `${sign}${body}`;
  }
  return signedText.padStart(format.padWidth, "0");
}

function applyGrouping(text: string): string {
  const [integerPart, fractionalPart = ""] = text.split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fractionalPart.length > 0 ? `${grouped}.${fractionalPart}` : grouped;
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "#ERROR";
  }
  if (Number.isInteger(value)) {
    return `${value}`;
  }
  const text = Number(value).toPrecision(15);
  return Number(text).toString();
}

function diagnostic(code: string, context: Record<string, unknown> = {}): Diagnostic {
  return { code, context };
}
