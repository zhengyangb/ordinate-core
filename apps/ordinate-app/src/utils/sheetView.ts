import { type RuntimeValue, type SheetEvaluation } from "@ordinate/core";

export function runtimeValueToText(value: RuntimeValue): string {
  switch (value.kind) {
    case "number":
      return String(value.value ?? "");
    case "string":
      return String(value.value ?? "");
    case "boolean":
      return value.value ? "true" : "false";
    case "blank":
      return "";
    case "null":
      return "null";
    case "error":
      return "#ERROR";
    default:
      return String(value.value ?? "");
  }
}

export function runtimeKindLabel(value: RuntimeValue | null | undefined): string {
  switch (value?.kind) {
    case "number":
      return "Number";
    case "string":
      return "Text";
    case "boolean":
      return "Boolean";
    case "blank":
      return "Blank";
    case "null":
      return "Null";
    case "error":
      return "Error";
    default:
      return "Value";
  }
}

export function splitPath(path: string): string[] {
  return path.split(".").filter((part) => part.length > 0);
}

export function leafLabel(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? path;
}

export function compactColLabel(label: string): string {
  const parts = splitPath(label);
  if (parts.length <= 1) return label;
  return parts.slice(-2).join(" / ");
}

export function isVisiblePath(path: string, collapsed: Set<string>): boolean {
  const parts = splitPath(path);
  let current = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = current ? `${current}.${parts[i]}` : parts[i];
    if (collapsed.has(current)) {
      return false;
    }
  }
  return true;
}

function normalizeLabel(text: string): string {
  return text.replace(/^\[|\]$/g, "").trim().toLowerCase();
}

export function shouldHideFirstDataColumn(sheet: SheetEvaluation): boolean {
  if (sheet.colLabels.length === 0 || sheet.values.length === 0) {
    return false;
  }

  let comparableRows = 0;
  let matchedRows = 0;

  for (let i = 0; i < sheet.values.length; i += 1) {
    const rowPath = sheet.rowPaths[i] ?? "";
    const rawValue = runtimeValueToText(sheet.values[i]?.[0] as RuntimeValue);
    if (!rowPath || rawValue.length === 0) continue;
    comparableRows += 1;
    if (normalizeLabel(rawValue) === normalizeLabel(leafLabel(rowPath))) {
      matchedRows += 1;
    }
  }

  return comparableRows > 0 && matchedRows / comparableRows >= 0.7;
}

export function rowHeaderLabel(sheet: SheetEvaluation): string {
  if (sheet.colLabels.length === 0) {
    return "Line Item";
  }
  return shouldHideFirstDataColumn(sheet) ? sheet.colLabels[0] ?? "Line Item" : "Line Item";
}
