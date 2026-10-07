import { ExcelFailure, type ExcelLimits } from "./contracts";
import type { ExcelExpression } from "./formulaAst";
import { parseExcelFormula } from "./formulaParser";
import type { DefinedName } from "./workbookCodec";

/** Resolve names at the Excel boundary. Native references remain ordinary A1 references. */
export function nameResolver(definitions: readonly DefinedName[], limits: Readonly<ExcelLimits>) {
  const definitionsByKey = new Map(definitions.map(d => [`${d.sheetIndex ?? "*"}:${d.name.toLowerCase()}`, d]));
  return function expand(expression: ExcelExpression, sheetIndex: number): ExcelExpression {
    const visit = (node: ExcelExpression, path: string[] = []): ExcelExpression => {
      if (node.kind === "name") {
        const name = node.value.toLowerCase();
        const definition = definitionsByKey.get(`${sheetIndex}:${name}`) ?? definitionsByKey.get(`*:${name}`);
        if (!definition) throw new ExcelFailure("unsupported_formula", `Named reference '${node.value}' has no definition.`);
        if (path.includes(name) || path.length >= limits.maxFormulaDepth) throw new ExcelFailure("unsupported_formula", `Named reference '${node.value}' is circular or too deeply nested.`);
        const target = parseExcelFormula(definition.source, limits);
        if (target.kind === "reference") {
          const fixed = (axis: typeof target.reference.rowSelector): boolean => axis.kind === "all" || (axis.kind === "range"
            ? (axis.value as typeof axis[]).every(fixed) : !!axis.copyFixed);
          if (!target.sheet || !fixed(target.reference.rowSelector) || !fixed(target.reference.colSelector))
            throw new ExcelFailure("unsupported_formula", `Named reference '${node.value}' is relative; its definition origin is unavailable.`);
        } else if (!["name", "number", "text", "boolean", "error"].includes(target.kind)) {
          throw new ExcelFailure("unsupported_formula", `Named reference '${node.value}' uses a calculated definition.`);
        }
        return visit(target, [...path, name]);
      }
      if (node.kind === "binary") return {...node, left:visit(node.left,path), right:visit(node.right,path)};
      if (node.kind === "unary") return {...node, operand:visit(node.operand,path)};
      if (node.kind === "call") return {...node, args:node.args.map(arg=>visit(arg,path))};
      if (node.kind === "array") return {...node, rows:node.rows.map(row=>row.map(arg=>visit(arg,path)))};
      return node;
    };
    return visit(expression);
  };
}
