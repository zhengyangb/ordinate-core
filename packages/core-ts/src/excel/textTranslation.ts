/** Scalar text semantics at the compatibility boundary, not native evaluator rules. */
type ArgumentKind = "text" | "number";
interface TextRule {
  arguments: readonly ArgumentKind[];
  required: number;
  result: "text" | "number" | "boolean";
  unicode: boolean;
}

export const exportTextFunctions = {
  lower: { arguments: ["text"], required: 1, result: "text", unicode: true },
  upper: { arguments: ["text"], required: 1, result: "text", unicode: true },
  len: { arguments: ["text"], required: 1, result: "number", unicode: true },
  contains: { arguments: ["text", "text"], required: 2, result: "boolean", unicode: false },
  startsWith: { arguments: ["text", "text"], required: 2, result: "boolean", unicode: true },
  endsWith: { arguments: ["text", "text"], required: 2, result: "boolean", unicode: true },
  replace: { arguments: ["text", "text", "text"], required: 3, result: "text", unicode: false },
  slice: { arguments: ["text", "number", "number"], required: 2, result: "text", unicode: true },
} as const satisfies Record<string, TextRule>;

export const importTextFunctions = {
  LOWER: { arguments: ["text"], required: 1, result: "text", unicode: true },
  UPPER: { arguments: ["text"], required: 1, result: "text", unicode: true },
  LEN: { arguments: ["text"], required: 1, result: "number", unicode: true },
  LEFT: { arguments: ["text", "number"], required: 1, result: "text", unicode: true },
  RIGHT: { arguments: ["text", "number"], required: 1, result: "text", unicode: true },
  MID: { arguments: ["text", "number", "number"], required: 3, result: "text", unicode: true },
  SUBSTITUTE: { arguments: ["text", "text", "text"], required: 3, result: "text", unicode: false },
} as const satisfies Record<string, TextRule>;

type ExportTextFunction = keyof typeof exportTextFunctions;
type ImportTextFunction = keyof typeof importTextFunctions;
export function exportTextFunction(name: string): ExportTextFunction | undefined {
  return Object.hasOwn(exportTextFunctions, name) ? name as ExportTextFunction : undefined;
}
export function importTextFunction(name: string): ImportTextFunction | undefined {
  return Object.hasOwn(importTextFunctions, name) ? name as ImportTextFunction : undefined;
}

/** Minimal Excel expressions for the operation; target coercion/error rules apply. */
export function exportText(name: ExportTextFunction, args: readonly string[]): string {
  const [source, second, third] = args;
  switch (name) {
    case "lower": case "upper": case "len": return `${name.toUpperCase()}(${source})`;
    case "contains": return `ISNUMBER(FIND(${second},${source}))`;
    case "startsWith": return `EXACT(LEFT(${source},LEN(${second})),${second})`;
    case "endsWith": return `EXACT(RIGHT(${source},LEN(${second})),${second})`;
    case "replace": return `SUBSTITUTE(${source},${second},${third})`;
    case "slice": {
      const length = `LEN(${source})`;
      const integer = (index: string | undefined) => index !== undefined && /^-?\d+$/.test(index) ? Number(index) : undefined;
      const startLiteral = integer(second), endLiteral = integer(third);
      // MID itself clips positive coordinates. Literal coordinates need neither
      // sign tests nor duplicate length guards; only dynamic bounds need them.
      if (startLiteral !== undefined && startLiteral >= 0 && (third === undefined || endLiteral !== undefined && endLiteral >= 0)) {
        return `MID(${source},${startLiteral + 1},${endLiteral === undefined ? length : Math.max(0, endLiteral - startLiteral)})`;
      }
      const normalize = (index: string) => {
        const literal = integer(index);
        return literal === undefined ? `MIN(${length},MAX(0,IF(${index}<0,${length}+(${index}),${index})))`
          : literal >= 0 ? `MIN(${length},${literal})` : `MAX(0,${length}+(${literal}))`;
      };
      const start = normalize(second), end = third === undefined ? length : normalize(third);
      return `MID(${source},${start}+1,MAX(0,${end}-${start}))`;
    }
  }
}

/** Translate the text operation and its coordinate convention, without coercion guards. */
export function importText(name: ImportTextFunction, args: readonly string[]): string {
  const [source, second = "1", third] = args;
  switch (name) {
    case "LOWER": case "UPPER": case "LEN": return `${name.toLowerCase()}(${source})`;
    case "SUBSTITUTE": return `replace(${source}, ${second}, ${third})`;
    case "LEFT": return `slice(${source}, 0, ${second})`;
    // Clamp the start, so RIGHT(text, 0) is empty and a long count keeps all text.
    case "RIGHT": return `slice(${source}, max([0, len(${source}) - (${second})]))`;
    case "MID": return `slice(${source}, (${second}) - 1, (${second}) - 1 + (${third}))`;
  }
}
