function serializeReferenceComponent(text: string): string {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\"/g, '\\"');
  return `"${escaped}"`;
}

export function formatFormulaReferencePathComponent(text: string): string {
  if (/^[A-Za-z0-9_]+$/.test(text) && text !== "_" && !/^_\d+$/.test(text)) return text;
  return serializeReferenceComponent(text);
}

export function formatFormulaSheetSelector(text: string): string {
  if (/^[A-Za-z0-9]+$/.test(text)) return text;
  return serializeReferenceComponent(text);
}
