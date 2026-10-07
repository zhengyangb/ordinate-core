import { encodeNumberLiteral } from "../number_encoding";
import { encodeStringLiteral } from "../text_encoding";
import { EXCEL_GRID_LIMITS, ExcelFailure, type ExcelLimits, type ExcelReport } from "./contracts";
import type { ExcelExpression } from "./formulaAst";
import { importReference, importReferenceColumn, type FormulaLocation } from "./referenceTranslation";
import { importedFunctions } from "./functionTranslation";
import { distributionImports } from "./distributionTranslation";
import { importMultipleRounding, multipleRoundingImports } from "./roundingTranslation";
import { calendarFunction, importCalendar, type ExcelDateSystem } from "./dateTranslation";
import { importText, importTextFunction, importTextFunctions } from "./textTranslation";
import { importDateLiteral, nativeDateToSerial, type CalendarValueKind } from "./temporalValues";
import { excelImportRules, predicateImports } from "./importRegistry";
import { exactTextNumberFormat } from "./formatTranslation";
import { serializeFormatSpec } from "../runtime/formatting";

type Domain = "number" | "text" | "boolean" | "unknown";
interface Term {
  text: string; domain: Domain; precedence: number; rows: number; columns: number; view: boolean;
  literal?: number; fullRows?: boolean; fullColumns?: boolean; zeroBasedPosition?:string;
  dynamic?: boolean;
  flattenedColumn?: boolean;
}
const term = (text: string, domain: Domain = "unknown", precedence = 100): Term =>
  ({ text, domain, precedence, rows: 1, columns: 1, view: false });
const call = (name: string, ...args: string[]) => `${name}(${args.join(", ")})`;
const operand = (value: Term, precedence: number, equal = false) =>
  value.precedence < precedence || (equal && value.precedence === precedence) ? `(${value.text})` : value.text;
const convert = (value: Term, domain: "number" | "text"): Term => value.domain === domain ? value
  : { ...value, text: call(domain, value.text), domain, precedence: 100 };
const emptyTextLiteral = (node: ExcelExpression): boolean => node.kind === "text" && node.value === "";

/** Preserve operations and references with narrowly scoped source-semantic
 * conversions, never Excel's general implicit-coercion machinery. */
export function importFormula(expression: ExcelExpression, sheetNames: readonly string[], at: FormulaLocation,
  limits: Readonly<ExcelLimits>, report: ExcelReport, dateSystem: ExcelDateSystem,
  referenceCalendar: (node: Extract<ExcelExpression, {kind: "reference"}>) => CalendarValueKind | "range" | null): string {
  const fail = (message: string): never => { throw new ExcelFailure("unsupported_formula", message, at); };
  const scalar = (arg: Term): string => {
    if (arg.dynamic || arg.rows !== 1 || arg.columns !== 1) return fail("Implicit intersection or a spilled array in scalar context is not supported.");
    return arg.text;
  };
  const text = (arg: Term): string => arg.domain === "text" ? operand(arg, 30) : call("text", scalar(arg));
  const view = (arg: Term): string => arg.view ? arg.text : `[${arg.text}]`;
  const vector = (arg: Term): string => {
    if (arg.rows > 1 && arg.columns > 1) return fail("This argument requires a one-dimensional range.");
    return view(arg);
  };
  const wrap = (node: ExcelExpression, depth: number, dates = false): Term => {
    if (depth > limits.maxFormulaDepth) throw new ExcelFailure("limit_exceeded", "Excel formula nesting exceeds the conversion limit.", at);
    const value = visit(node, depth, dates);
    if (value.text.length > limits.maxFormulaLength * 8) throw new ExcelFailure("limit_exceeded", "Native formula exceeds the conversion budget.", at);
    return { ...value, zeroBasedPosition: node.kind === "call" && node.name.replace(/^_xlfn\./i, "") === "MATCH"
      ? value.zeroBasedPosition : undefined };
  };
  const visit = (node: ExcelExpression, depth: number, dates: boolean): Term => {
    const child = (arg: ExcelExpression) => wrap(arg, depth + 1, dates);
    switch (node.kind) {
      case "number": return dates ? term(importDateLiteral(node.value, dateSystem, "date", at))
        : { ...term(encodeNumberLiteral(node.value), "number"), literal: node.value };
      case "text": return term(encodeStringLiteral(node.value), "text");
      case "boolean": return term(node.value ? "true" : "false", "boolean");
      case "error": return term(node.value === "#DIV/0!" ? "error[div_by_zero]" : node.value === "#REF!" ? "error[unresolved_reference]" : "error[type_error]");
      case "missing": return { ...term("0", "number"), literal: 0 };
      case "name": return fail(`Named reference '${node.value}' is not supported.`);
      case "reference": {
        const extent = (axis: typeof node.reference.rowSelector, full: number) => {
          if (axis.kind === "all") return full;
          if (axis.kind !== "range") return 1;
          const [start, end] = axis.value as typeof node.reference.rowSelector[];
          return Math.abs(Number(end.value) - Number(start.value)) + 1;
        };
        const address = importReference(node.reference, node.sheet, sheetNames, at);
        const calendar = referenceCalendar(node);
        if (dates && !calendar) return fail("A financial date range needs date-formatted source cells; untyped serial-date ranges cannot be inferred.");
        if (!dates && calendar === "range") return fail("A range containing native dates needs an explicit date-range formula translation.");
        // Unit conversion is necessary: imported dates are native dates, not serial numbers.
        if (!dates && calendar && calendar !== "range") return term(nativeDateToSerial(address, calendar, dateSystem), "number");
        return { ...term(address), view: true,
          rows: extent(node.reference.rowSelector, EXCEL_GRID_LIMITS.rows), columns: extent(node.reference.colSelector, EXCEL_GRID_LIMITS.columns),
          fullRows: node.reference.rowSelector.kind === "all", fullColumns: node.reference.colSelector.kind === "all" };
      }
      case "array": return { ...term(`[${node.rows.map(row => `[${row.map(arg => scalar(child(arg))).join(", ")}]`).join(", ")}]`),
        view: true, rows: node.rows.length, columns: node.rows[0].length };
      case "unary": {
        const value = child(node.operand); scalar(value);
        if (node.op === "+") return value;
        if (node.op === "%") return term(`${operand(value, 40)} / 100`, "number", 40);
        return { ...term(`-${operand(value, 60)}`, "number", 60), ...(value.literal === undefined ? {} : { literal: -value.literal }) };
      }
      case "binary": {
        let a = child(node.left), b = child(node.right);
        if (a.view && b.view && (a.rows !== b.rows || a.columns !== b.columns || a.dynamic || b.dynamic)) return fail("View operands must have matching shapes.");
        if (node.op === "&") { scalar(a); scalar(b); }
        if (node.op === "&") return term(`${text(a)} + ${text(b)}`, "text", 30);
        // Scope comes from source syntax/static domains, never sampled cell values.
        // Excel + is numeric: convert only known text operands, leaving unknown
        // references and other operators alone. Do not add type/error guards.
        if (node.op === "+") {
          if (a.domain === "text") a = convert(a, "number");
          if (b.domain === "text") b = convert(b, "number");
        }
        // Only =/<> against a literal empty string gets text comparison. This
        // covers blank and "" without conflating 0/false/null or adding isEmpty.
        if ((node.op === "=" || node.op === "<>") && (emptyTextLiteral(node.left) || emptyTextLiteral(node.right))) {
          a = convert(a, "text");
          b = convert(b, "text");
        }
        const op = node.op === "^" ? "**" : node.op === "=" ? "==" : node.op === "<>" ? "!=" : node.op;
        const precedence = op === "**" ? 70 : ["*", "/"].includes(op) ? 40 : ["+", "-"].includes(op) ? 30 : ["==", "!="].includes(op) ? 20 : 25;
        // Excel powers associate left, native powers right. Preserve the source tree.
        return { ...term(`${operand(a, precedence, op === "**")} ${op} ${operand(b, precedence, op !== "**")}`,
          precedence <= 25 ? "boolean" : node.op === "+" ? "number" : "unknown", precedence), view: a.view || b.view,
          rows: Math.max(a.rows, b.rows), columns: Math.max(a.columns, b.columns), dynamic: a.dynamic || b.dynamic };
      }
      case "call": break;
    }
    const name = node.name.replace(/^_xlfn\./i, "").replace(/^_xlws\./i, "");
    const rule = excelImportRules.get(name);
    if (!rule) return fail(`Excel function '${name}' is not supported.`);
    const definition = importedFunctions.get(name);
    if (definition?.[1].solver && node.args.length > definition[1].args.length)
      return fail(`${name}'s initial guess is not supported by Ordinate's deterministic root-selection contract.`);
    const args = node.args.map((arg, i) => definition?.[1].args[i] === "dates" ? wrap(arg, depth + 1, true)
      : arg.kind === "missing" && definition?.[1].defaults?.[i] !== undefined ? term(definition[1].defaults[i], "number")
      : dates && name === "DATE" ? wrap(arg, depth + 1) : child(arg));
    const arity = (min: number, max = min) => { if (args.length < min || args.length > max) fail(`${name} expects ${min === max ? min : `${min}–${max}`} arguments.`); };
    const x = args[0];
    if (rule === "multipleRounding") {
      arity(2);
      return term(importMultipleRounding(name as keyof typeof multipleRoundingImports,
        { text: scalar(x), literal: x.literal }, { text: scalar(args[1]), literal: args[1].literal }), "number");
    }
    if (rule === "distribution") {
      const spec = distributionImports.get(name);
      if (!spec) throw new Error("Missing distribution import profile.");
      arity(spec.required, spec.maximum);
      const values = spec.values.filter(i => i < args.length).map(i => scalar(args[i]));
      if (spec.operation === "direct") return term(call(spec.native, ...values), "number");
      const flag = args[spec.flag], source = node.args[spec.flag];
      if (source.kind === "boolean" || flag.literal !== undefined)
        return term(call(source.kind === "boolean" ? source.value ? spec.cdf : spec.pdf : flag.literal ? spec.cdf : spec.pdf, ...values), "number");
      // This conditional expresses Excel's requested PDF/CDF choice. It is not
      // a type/error guard and never substitutes a result on a failed input.
      const condition = flag.domain === "boolean" ? scalar(flag) : call("boolean", scalar(flag));
      return term(call("if", condition, call(spec.cdf, ...values), call(spec.pdf, ...values)), "number");
    }
    if (rule === "signature") {
      if (!definition) throw new Error("Missing function translation signature.");
      const [native, spec] = definition;
      arity(spec.required, spec.variadic === undefined ? spec.args.length : 255);
      if (spec.solver) report.warn("semantic_difference", "Ordinate uses a deterministic root solver; Excel's initial guess can select a different root.", at);
      const normalized = spec.argumentOrder ? args.map((_, i) => {
        const slot = spec.argumentOrder!.indexOf(i);
        if (slot < 0) throw new Error("Missing inbound argument permutation.");
        return args[slot];
      }) : args.slice();
      if (spec.variadic !== undefined && args.length > spec.args.length) {
        const tail = args.slice(spec.variadic);
        if (tail.some(arg => arg.view && (arg.dynamic || arg.rows > 1 || arg.columns > 1)))
          return fail(`${name} with multiple ranges requires view concatenation; use one range or scalar arguments.`);
        normalized.splice(spec.variadic, tail.length, { ...term(`[${tail.map(scalar).join(", ")}]`), view: true, columns: tail.length });
      }
      return term(call(native, ...normalized.map((arg, i) => spec.args[i] === "scalar" ? scalar(arg)
        : spec.args[i] === "view" ? view(arg) : vector(arg))), "number");
    }
    if (rule === "verticalLookup") {
      arity(3, 4);
      const mode = node.args[3];
      // Omitted/TRUE means approximate lookup in Excel, not exact. Do not
      // silently change it or expand lookup into filter/type/error guards.
      if (!(mode?.kind === "boolean" && !mode.value || mode?.kind === "number" && mode.value === 0))
        return fail("VLOOKUP requires explicit exact matching (FALSE or 0); approximate or dynamic matching is not supported.");
      const table = args[1], position = args[2].literal;
      if (!table.view || table.dynamic || table.fullRows || table.fullColumns)
        return fail("VLOOKUP requires a finite rectangular table.");
      if (position === undefined || !Number.isInteger(position))
        return fail("VLOOKUP requires a constant integer return-column position.");
      if (position < 1 || position > table.columns) return term("error[unresolved_reference]");
      if (node.args[0].kind === "text" && /[?*~]/.test(node.args[0].value))
        return fail("VLOOKUP wildcard matching is not supported by native exact lookup.");
      const source = node.args[1];
      const column = (offset: number): string => source.kind === "reference"
        ? importReferenceColumn(source.reference, offset, source.sheet, sheetNames, at)
        : table.rows === 1 ? `(${table.text})[${offset}:${offset + 1}]`
        : table.columns === 1 ? table.text : `(${table.text})[:, ${offset}]`;
      report.warn("semantic_difference", "Native lookup uses strict, case-sensitive equality, not Excel's case-insensitive or wildcard matching.", at);
      return term(call("lookup", scalar(x), column(0), column(position - 1)));
    }
    if (rule === "lookup") {
      arity(3, 6);
      if (node.args[3] && node.args[3].kind !== "missing") return fail("XLOOKUP's if_not_found result is not supported by native lookup.");
      if ((args[4] && args[4].literal !== 0) || (args[5] && args[5].literal !== 1))
        return fail("XLOOKUP supports exact matching and first-to-last search only.");
      return term(call("lookup", scalar(x), vector(args[1]), vector(args[2])));
    }
    if (rule === "filter") {
      arity(2);
      if (!x.view || !args[1].view || x.rows !== args[1].rows || x.columns !== args[1].columns || x.dynamic || args[1].dynamic)
        return fail("FILTER requires equally shaped one-dimensional values and masks.");
      vector(x); vector(args[1]);
      return { ...term(call("filter", x.text, args[1].text)), view: true, dynamic: true, flattenedColumn: x.rows > 1 };
    }
    if (rule === "join") {
      arity(3, 254);
      const empty = node.args[1];
      if (empty.kind !== "boolean" && !(empty.kind === "number" && [0, 1].includes(empty.value)))
        return fail("TEXTJOIN requires a constant ignore_empty flag.");
      const tail = args.slice(2);
      if (tail.length > 1 && tail.some(arg => arg.dynamic || arg.rows > 1 || arg.columns > 1))
        return fail("TEXTJOIN with multiple ranges requires view concatenation.");
      const values = tail.length === 1 ? call("text", view(tail[0])) : `[${tail.map(text).join(", ")}]`;
      const strings = empty.value ? call("filter", values, `${values} != ""`) : values;
      return term(call("join", text(x), strings), "text");
    }
    if (rule === "selection") {
      arity(2, 3);
      if (!x.view) return fail(`${name} requires a range or array.`);
      const columnAxis = node.args[1].kind === "missing";
      const horizontalSource = x.rows === 1 && !x.flattenedColumn;
      if (columnAxis ? args.length !== 3 || !horizontalSource : args.length !== 2 || horizontalSource && x.columns > 1)
        return fail(`${name} supports row selection or columns of a single-row vector, not two-axis selection.`);
      const count = args[columnAxis ? 2 : 1]; scalar(count);
      const size = columnAxis || x.flattenedColumn ? x.columns : x.rows;
      const length = count.literal === undefined ? undefined : name === "TAKE" ? Math.min(size, Math.abs(count.literal)) : Math.max(0, size - Math.abs(count.literal));
      return { ...term(call(name.toLowerCase(), x.text, count.text)), view: true,
        rows: columnAxis || x.flattenedColumn ? 1 : length ?? 1, columns: columnAxis || x.flattenedColumn ? length ?? 1 : x.columns,
        dynamic: x.dynamic || length === undefined, flattenedColumn: x.flattenedColumn };
    }
    if (rule === "format") {
      arity(2);
      const code = node.args[1];
      const spec = code.kind === "text" ? exactTextNumberFormat(code.value) : null;
      if (!spec) return fail("TEXT requires a supported literal numeric format; date, locale and dynamic formats are not supported.");
      return term(call("format", scalar(x), encodeStringLiteral(serializeFormatSpec(spec))), "text");
    }
    if (rule === "match") {
      arity(3);
      if (args[2].literal !== 0) return fail("Only exact MATCH (match_type 0) is supported.");
      if (!args[1].view || (args[1].rows > 1 && args[1].columns > 1)) return fail("MATCH requires a one-dimensional range.");
      const position=call("match",scalar(x),args[1].text);
      return {...term(`${position} + 1`,"number",30),zeroBasedPosition:position};
    }
    if (rule === "char") {
      arity(1);
      if (x.literal === undefined || !Number.isInteger(x.literal) || x.literal < 1 || x.literal > 127) return fail("CHAR supports constant ASCII codes 1–127; other codes depend on the workbook's character set.");
      return term(encodeStringLiteral(String.fromCharCode(x.literal)),"text");
    }
    if (rule === "switch") {
      arity(3,254);
      scalar(x);
      let result=args.length%2===0?scalar(args[args.length-1]):"error[type_error]";
      for(let i=(args.length%2===0?args.length-3:args.length-2);i>=1;i-=2) {
        scalar(args[i]);
        result=call("if",`${operand(x,20)} == ${operand(args[i],20,true)}`,scalar(args[i+1]),result);
      }
      return term(result);
    }
    if (rule === "dotProduct") {
      arity(2);
      if (!args.every(arg=>arg.view && (arg.rows===1 || arg.columns===1)) || x.rows!==args[1].rows || x.columns!==args[1].columns)
        return fail("SUMPRODUCT requires two equally sized one-dimensional ranges.");
      return term(call("dotProduct",...args.map(arg=>arg.text)),"number");
    }
    if (rule === "shape") {
      arity(1);
      if (x.flattenedColumn) return term(call(name === "ROWS" ? "columnCount" : "rowCount", x.text), "number");
      return term(name === "ROWS" && x.fullRows ? String(EXCEL_GRID_LIMITS.rows) : name === "COLUMNS" && x.fullColumns ? String(EXCEL_GRID_LIMITS.columns)
        : call(name === "ROWS" ? "rowCount" : "columnCount", x.text), "number");
    }
    if (rule === "index") {
      arity(1, 4);
      if (!x.view || x.fullRows || x.fullColumns) return fail("INDEX requires a finite reference or array.");
      if (args[3] && args[3].literal !== 1) return fail("INDEX area selection is not supported.");
      if (x.dynamic) {
        if (args.length !== 2 || x.rows !== 1) return fail("Dynamic INDEX supports scalar positions in a one-dimensional filtered result only.");
        if (args[1].zeroBasedPosition) return term(call("index", x.text, args[1].zeroBasedPosition));
        if (args[1].literal === undefined || !Number.isInteger(args[1].literal) || args[1].literal <= 0)
          return fail("Dynamic INDEX requires a positive integer position or an exact MATCH.");
        return term(call("index", x.text, String(args[1].literal - 1)));
      }
      if(args.length===2 && (x.rows===1 || x.columns===1) && args[1].zeroBasedPosition)
        return term(call("index",x.text,args[1].zeroBasedPosition));
      const zero = () => ({ ...term("0", "number"), literal: 0 });
      let row = args[1] ?? zero(), column = args[2] ?? zero();
      if (!args[2] || node.args[2].kind === "missing") {
        column = zero();
        if (x.rows === 1) { column = row; row = zero(); }
      }
      // A zero axis selects a row/column, not native index -1 (the last item).
      if (![row.literal, column.literal].every(n => n === undefined || Number.isInteger(n) && n >= 0))
        return fail("INDEX positions must be nonnegative integers.");
      if ((row.literal ?? 0) > x.rows || (column.literal ?? 0) > x.columns) return term("error[unresolved_reference]");
      const checks: string[] = [];
      const axis = (position: Term, size: number) => {
        const n = position.literal;
        if (n !== undefined) return n === 0 ? `0:${size}` : `${n - 1}:${n}`;
        const value = scalar(position);
        // These checks protect selection membership: native slices clamp bounds
        // and interpret negative positions from the end, unlike Excel INDEX.
        checks.push(`${operand(position, 20)} >= 0`, `${operand(position, 20)} <= ${size}`);
        return `if(${value} == 0, 0, ${operand(position, 30)} - 1):if(${value} == 0, ${size}, ${value})`;
      };
      const selected = `(${x.text})[${axis(row, x.rows)}, ${axis(column, x.columns)}]`;
      return { ...term(checks.length ? call("if", call("and", ...checks), selected, "error[unresolved_reference]") : selected), view: true,
        rows: row.literal === 0 ? x.rows : 1, columns: column.literal === 0 ? x.columns : 1 };
    }
    if (rule === "calendar") {
      if (!calendarFunction(name)) throw new Error("Calendar import registry is inconsistent.");
      arity(name === "DATE" ? 3 : 1);
      return dates && name === "DATE" ? term(call("date", ...node.args.map(arg => scalar(wrap(arg, depth + 1)))))
        : term(importCalendar(name, args.map(scalar), dateSystem), "number");
    }
    if (rule === "booleanLiteral") { arity(0); return term(name.toLowerCase(), "boolean"); }
    if (rule === "conditional") { arity(2, 3); return term(call("if", ...args.map(scalar), ...(args.length === 2 ? ["false"] : []))); }
    if (rule === "ifError") { arity(2); return term(call("if", call("isError", scalar(x)), scalar(args[1]), scalar(x))); }
    if (rule === "not") { arity(1); return { ...x, text: call("not", x.text), domain: "boolean", precedence: 100 }; }
    if (rule === "predicate") { arity(1); return { ...x, text: call(predicateImports[name], x.text), domain: "boolean", precedence: 100 }; }
    if (rule === "logical") {
      arity(1, 255);
      return term(call(name.toLowerCase(), ...args.map(arg => args.length > 1 && (arg.rows > 1 || arg.columns > 1) ? call(name.toLowerCase(), arg.text) : arg.text)), "boolean");
    }
    if (rule === "aggregate") {
      arity(1, 255);
      const fn = name.toLowerCase();
      if (args.length === 1) return term(call(fn, view(x)), "number");
      if (args.every(arg => !arg.dynamic && arg.rows === 1 && arg.columns === 1)) return term(call(fn, `[${args.map(arg => arg.text).join(", ")}]`), "number");
      const reductions = (fn: string) => args.map(arg => call(fn, view(arg)));
      if (name === "AVERAGE") return term(`(${reductions("sum").join(" + ")}) / (${reductions("count").join(" + ")})`, "number", 40);
      if (name === "MIN" || name === "MAX") return term(call(fn, `[${reductions(fn).join(", ")}]`), "number");
      return term(reductions(fn).join(name === "PRODUCT" ? " * " : " + "), "number", name === "PRODUCT" ? 40 : 30);
    }
    if (rule === "numericUnary") { arity(1); return term(call(name === "INT" ? "floor" : name.toLowerCase(), scalar(x)), "number"); }
    if (rule === "pi") { arity(0); return term("pi()", "number"); }
    if (rule === "numericBinary") { arity(2); return term(call(name.toLowerCase(), ...args.map(scalar)), "number"); }
    if (rule === "rounding") { arity(name === "TRUNC" ? 1 : 2, 2); return term(call(name.toLowerCase(), ...args.map(scalar)), "number"); }
    if (rule === "text") {
      const textFunction = importTextFunction(name);
      if (!textFunction) throw new Error("Text import registry is inconsistent.");
      const definition = importTextFunctions[textFunction]; arity(definition.required, definition.arguments.length);
      return term(importText(textFunction, args.map(scalar)), definition.result);
    }
    if (rule === "concatenate") { arity(1, 255); return term(args.map(text).join(" + "), "text", 30); }
    if (rule === "exact") { arity(2); return term(`${text(x)} == ${text(args[1])}`, "boolean", 20); }
    const unhandled: never = rule;
    throw new Error(`Unimplemented import rule: ${unhandled}`);
  };
  const result = wrap(expression, 0);
  report.warn("semantic_difference", "Formulas use Ordinate’s calculation rules; results may differ from Excel.", at);
  return scalar(result);
}
