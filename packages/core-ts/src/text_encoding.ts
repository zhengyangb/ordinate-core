/** Whitespace outside cell content excludes semantic line breaks. */
export function trimCellText(text: string): string {
  return text.replace(/^[^\S\r\n]+|[^\S\r\n]+$/g, "");
}

export function normalizeTextLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Quoted literals use JSON string escapes; table escaping is a separate layer. */
export function encodeStringLiteral(text: string): string {
  return JSON.stringify(text);
}
