export type FormulaLexicalState = {
  inString: boolean;
  referenceDepth: number;
};

export function scanOrdinateReferenceEnd(text: string, start: number): number | null {
  if (text[start] !== "@" || text[start + 1] !== "[") return null;

  let inString = false;
  let escaped = false;
  let bracketDepth = 0;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (!inString && (char === "\n" || char === "\r")) return null;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth -= 1;
      if (bracketDepth === 0) return index + 1;
      if (bracketDepth < 0) return null;
    }
  }
  return null;
}

export function scanFormulaLexicalState(text: string, end: number): FormulaLexicalState {
  let inString = false;
  let escaped = false;
  let referenceDepth = 0;
  const limit = Math.max(0, Math.min(end, text.length));

  for (let index = 0; index < limit; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "@" && text[index + 1] === "[") {
      referenceDepth += 1;
      index += 1;
      continue;
    }
    if (referenceDepth > 0) {
      if (char === "[") {
        referenceDepth += 1;
      } else if (char === "]") {
        referenceDepth = Math.max(0, referenceDepth - 1);
      }
    }
  }

  return { inString, referenceDepth };
}
