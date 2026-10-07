import type { DocumentState, SheetState } from "../incremental";
import { getStandardFunctionMetadata } from "../runtime/functions";
import type { ArrayExpr, ExprNode, FunctionCall, IndexExpr, ReferenceExpr, RuntimeValue } from "../runtime/types";
import { ExcelFailure, type ExcelLimits, type ExcelReport } from "./contracts";
import { excelChooseArray, excelQuotedText, exportReference, sliceReference, type ExcelSelection, type FormulaLocation } from "./referenceTranslation";
import { nativeFunctionCompatibility } from "./compatibilityRegistry";
import { functionTranslations } from "./functionTranslation";
import { exportTemporalValue, exportTemporalFunction, temporalInstantText, temporalProjection, type TemporalProjection } from "./temporalExport";
import { exportText, exportTextFunction, exportTextFunctions } from "./textTranslation";
import { exportTextFormat } from "./formatTranslation";
import { parseFormatSpec } from "../runtime/formatting";
import { matchCalendarSerialConversion } from "./calendarConversionPattern";

type Domain = "number" | "text" | "boolean" | "unknown";
interface Term {
  text: string; domain: Domain; precedence: number; rows: number; columns: number;
  view: boolean; areas?: string[];
  selection?: ExcelSelection;
  // & already performs the conversion expressed by text(x).
  concatenand?: Term;
  dynamic?: boolean;
  oneBasedPosition?: string;
  temporal?: TemporalProjection;
}
const scalar = (text: string, domain: Domain = "unknown", precedence = 100): Term =>
  ({ text, domain, precedence, rows: 1, columns: 1, view: false });
const call = (name: string, args: readonly string[]) => name + "(" + args.join(",") + ")";
const operand = (term: Term, precedence: number, equal = false) =>
  term.precedence < precedence || (equal && term.precedence === precedence) ? "(" + term.text + ")" : term.text;
const predicates: Record<string, string> = {
  isNumber: "ISNUMBER", isText: "ISTEXT", isBoolean: "ISLOGICAL", isBlank: "ISBLANK", isError: "ISERROR",
};
export interface ExportedFormula { formula: string; arrayFormula: boolean }

/** Readable target-language formulas, not emulation of the native evaluator.
 * Domains come only from syntax, never current values or cached results.
 */
export function exportFormula(expression: ExprNode, document: DocumentState, sheet: SheetState,
  at: FormulaLocation, limits: Readonly<ExcelLimits>, report: ExcelReport): ExportedFormula {
  let arrayFormula = false;
  const fail = (message: string): never => { throw new ExcelFailure("unsupported_formula", message, at); };
  const scalarOnly = (term: Term): Term => {
    if (term.dynamic || term.rows !== 1 || term.columns !== 1) fail("This formula requires one value, not multiple cells.");
    return term;
  };
  const arity = (args: Term[], min: number, max = min) => {
    if (args.length < min || args.length > max) fail("Expected " + (min === max ? min : min + "–" + max) + " arguments.");
  };
  const extent = (value: Term, row: boolean) => call(row ? "ROWS" : "COLUMNS", [value.text]);
  const vector = (value: Term): Term => {
    if (!value.view || value.rows > 1 && value.columns > 1) return fail("This argument requires a one-dimensional view.");
    return value;
  };
  const indexView = (value: Term, indexes: Term[]): Term => {
    if (!value.view) return fail("INDEX requires a view.");
    if (indexes.length === 1 && value.rows > 1 && value.columns > 1) return fail("A two-dimensional view needs two indices.");
    const position = (index: Term, row: boolean) => {
      scalarOnly(index);
      if (index.oneBasedPosition) return index.oneBasedPosition;
      const size = extent(value, row), literal = Number(index.text);
      if (index.domain === "number" && Number.isInteger(literal)) {
        if (!value.dynamic && literal < -(row ? value.rows : value.columns)) return fail("Negative index is outside the exported view.");
        if (literal >= 0) return String(literal + 1);
        return size + (literal === -1 ? "" : String(literal + 1));
      }
      const n = operand(index, 30);
      // Necessary negative/zero-based address conversion, not a type guard.
      return "IF(" + index.text + "<0," + size + "+" + n + "+1," + n + "+1)";
    };
    const axes = indexes.length === 2 ? [position(indexes[0], true), position(indexes[1], false)]
      : value.rows === 1 ? ["1", position(indexes[0], false)] : [position(indexes[0], true)];
    return scalar(call("INDEX", [value.text, ...axes]), value.domain);
  };
  const wrap = (node: ExprNode, depth: number, scopeSheet = sheet, scopeAt = at): Term => {
    if (depth > limits.maxFormulaDepth) throw new ExcelFailure("limit_exceeded", "Native formula nesting exceeds the conversion limit.", at);
    const result = visit(node, arg => wrap(arg, depth + 1, scopeSheet, scopeAt), depth, scopeSheet, scopeAt);
    if (result.text.length > limits.maxFormulaLength) throw new ExcelFailure("limit_exceeded", "Translated formula exceeds Excel's formula length budget.", at);
    // Position shortcuts belong only to the original MATCH expression, never
    // to a conversion/predicate/conditional constructed from its result.
    return { ...result, oneBasedPosition: node.kind === "call" && getStandardFunctionMetadata((node.value as FunctionCall).name)?.name === "match"
      ? result.oneBasedPosition : undefined };
  };
  const select = (ref: ReferenceExpr, scopeSheet: SheetState, scopeAt: FormulaLocation) =>
    exportReference(ref, document, scopeSheet, scopeAt, scopeSheet !== sheet);
  /** Excel has no date type. Prove the native type from source syntax, not from
   * serial integrality (midnight datetimes and ordinary numbers are not dates).
   * Conditional source cells retain their live branch decision on export.
   * Unknown type-producing expressions fail early rather than guessing. */
  const inspectCalendar = (node: ExprNode, depth: number, scopeSheet: SheetState, scopeAt: FormulaLocation): {dateTest: string; calendar: boolean} => {
    if (depth > limits.maxFormulaDepth) throw new ExcelFailure("limit_exceeded", "Calendar type inspection exceeds the conversion limit.", at);
    if (node.kind === "literal") {
      const kind = (node.value as RuntimeValue).kind;
      return {dateTest: kind === "date" ? "TRUE" : "FALSE", calendar: ["date", "datetime", "error"].includes(kind)};
    }
    if (node.kind === "reference") {
      const selected = select(node.value as ReferenceExpr, scopeSheet, scopeAt);
      if (selected.view) return fail("Calendar type export requires a single source cell.");
      const rowIndex = selected.rowIndices[0], colIndex = selected.colIndices[0];
      const body = selected.sourceSheet.cells[rowIndex][colIndex].body;
      if (!body.valid) return {dateTest: "FALSE", calendar: true};
      if (body.kind === "literal") return {dateTest: body.literal.kind === "date" ? "TRUE" : "FALSE", calendar: ["date", "datetime", "error"].includes(body.literal.kind)};
      return inspectCalendar(body.expression, depth + 1, selected.sourceSheet, {sheetName: selected.sourceSheet.name, rowIndex, colIndex});
    }
    if (node.kind === "call") {
      const source = node.value as FunctionCall, metadata = getStandardFunctionMetadata(source.name);
      if (metadata?.name === "if" && source.args.length === 3) {
        const yes = inspectCalendar(source.args[1], depth + 1, scopeSheet, scopeAt);
        const no = inspectCalendar(source.args[2], depth + 1, scopeSheet, scopeAt);
        return {calendar: yes.calendar && no.calendar, dateTest: yes.dateTest === no.dateTest ? yes.dateTest
          : call("IF", [scalarOnly(wrap(source.args[0], depth + 1, scopeSheet, scopeAt)).text, yes.dateTest, no.dateTest])};
      }
      const returns = metadata?.signatures.map(signature => signature.returns);
      if (returns?.every(kind => kind === "date")) return {dateTest: "TRUE", calendar: true};
      if (returns?.every(kind => kind !== "date" && kind !== "value" && !kind.startsWith("view")))
        return {dateTest: "FALSE", calendar: returns.every(kind => kind === "datetime")};
    }
    if (node.kind === "binary" || node.kind === "unary") {
      const kind = wrap(node, depth + 1, scopeSheet, scopeAt).temporal?.kind;
      if (kind) return {dateTest: kind === "date" ? "TRUE" : "FALSE", calendar: kind === "date" || kind === "datetime"};
    }
    return fail("Calendar type cannot be established from this formula's source syntax.");
  };
  const visit = (node: ExprNode, child: (arg: ExprNode) => Term, depth: number, scopeSheet: SheetState, scopeAt: FormulaLocation): Term => {
    const conversion = matchCalendarSerialConversion(node);
    if (conversion) {
      const type = inspectCalendar(conversion.source, depth + 1, scopeSheet, scopeAt);
      if (!type.calendar || conversion.kind === "datetime" && type.dateTest !== "FALSE")
        return fail("Calendar serial conversion requires a proven compatible native calendar type.");
      const source = scalarOnly(child(conversion.source));
      // Exported workbooks use 1900 dates. Native calendar values are already
      // represented by Excel serials here; undo only the source workbook epoch.
      const days = conversion.kind === "date" ? scalar(call("INT", [source.text]), "number") : source;
      return scalar(conversion.system === 1900 ? days.text : `${operand(days, 30)}-1462`, "number", conversion.system === 1900 ? days.precedence : 30);
    }
    if (node.kind === "literal") {
      const value = node.value as RuntimeValue;
      switch (value.kind) {
        case "number":
          if (!Number.isFinite(value.value)) return fail("Excel cannot represent a non-finite literal.");
          return scalar(String(value.value), "number", value.value < 0 ? 60 : 100);
        case "string": return scalar(excelQuotedText(value.value), "text");
        case "boolean": return scalar(value.value ? "TRUE" : "FALSE", "boolean");
        case "blank": return scalar('""', "text");
        case "date": case "datetime": case "time": case "duration": return {...scalar(String(exportTemporalValue(value, report, at)), "number"),temporal:temporalProjection(value)};
        case "error": return scalar(value.errorKind === "div_by_zero" ? "#DIV/0!" : value.errorKind === "unresolved_reference" ? "#REF!" : "#VALUE!");
        default: return fail("The " + value.kind + " literal has no supported Excel formula representation.");
      }
    }
    if (node.kind === "reference") {
      const ref = node.value as ReferenceExpr, selected = select(ref, scopeSheet, scopeAt);
      if ([ref.rowSelector, ref.colSelector].some(axis => ["all", "current", "offset", "absolute_fixed"].includes(axis.kind))) {
        report.warn("semantic_difference", "References use exported addresses and follow Excel's copy and insert rules.", at);
      }
      // Offset metadata comes from source literals, never cached/current results.
      // Native references remain views, even when they select a single cell.
      const body = !selected.view ? selected.sourceSheet.cells[selected.rowIndices[0]][selected.colIndices[0]].body : null;
      const literal = body?.valid && body.kind === "literal" ? body.literal : null;
      // A constructor's declared return type can establish the kind, but not a
      // formula cell's offset. Do not specialize from its evaluated result.
      const declared = body?.valid && body.kind === "formula" && body.expression.kind === "call"
        ? getStandardFunctionMetadata((body.expression.value as FunctionCall).name)?.signatures.map(signature => signature.returns) : [];
      const kind = declared?.[0];
      const temporal = literal ? temporalProjection(literal)
        : kind && ["date", "time", "datetime", "duration"].includes(kind) && declared!.every(result => result === kind)
          ? {kind:kind as TemporalProjection["kind"]} : undefined;
      return { ...selected, selection: selected, view: true, domain: "unknown", precedence: 100, temporal };
    }
    if (node.kind === "array") {
      const array = node.value as ArrayExpr;
      if (!array.rows.length || !array.rows[0].length) return fail("Excel cannot represent an empty array.");
      const rows = array.rows.map(row => row.map(item => scalarOnly(child(item))));
      const constants = array.rows.every(row => row.every(item => item.kind === "literal"
        || item.kind === "unary" && item.right?.kind === "literal" && (item.right.value as RuntimeValue).kind === "number"));
      if (!constants && rows.flat().length > 254) return fail("Temporary array exceeds Excel CHOOSE's argument limit.");
      const text = constants ? "{" + rows.map(row => row.map(item => item.text).join(",")).join(";") + "}"
        : excelChooseArray(rows.map(row => row.map(item => item.text)));
      return { ...scalar(text), rows: rows.length, columns: rows[0].length, view: true };
    }
    if (node.kind === "index") {
      const index = node.value as IndexExpr;
      const target = child(index.target);
      // Both spellings share one text translation. Do not route text through
      // reference slicing, and never infer a text target from evaluated values.
      if (target.domain === "text" && !target.view) {
        if (index.axes.length !== 1) return fail("Text indexing requires one axis.");
        const axis=index.axes[0];
        if (axis.kind === "slice") return scalar(exportText("slice",[target.text,axis.start ? scalarOnly(child(axis.start)).text : "0",...(axis.end ? [scalarOnly(child(axis.end)).text] : [])]),"text");
        const position=scalarOnly(child(axis.value)).text;
        if (/^-?\d+$/.test(position)) {
          const n = Number(position);
          return scalar(`MID(${target.text},${n >= 0 ? n + 1 : `LEN(${target.text})${n === -1 ? "" : n + 1}`},1)`, "text");
        }
        return scalar(`MID(${target.text},IF(${position}<0,LEN(${target.text})+(${position})+1,(${position})+1),1)`,"text");
      }
      if (index.axes.some(axis => axis.kind === "slice")) {
        if (!target.selection) return fail("Only reference views support static slice export.");
        const bound = (node: ExprNode) => {
          const term = child(node), value = Number(term.text);
          if (term.domain !== "number" || !Number.isInteger(value)) return fail("Reference slice bounds must be integer literals.");
          return { kind: "number" as const, value };
        };
        const selected = sliceReference(target.selection, index.axes.map(axis => axis.kind === "scalar"
          ? { kind: "scalar", value: bound(axis.value) }
          : { kind: "slice", start: axis.start === null ? null : bound(axis.start), end: axis.end === null ? null : bound(axis.end) }), at);
        return { ...selected, selection: selected, domain: "unknown", precedence: 100 };
      }
      return indexView(target, index.axes.map(axis => {
        if (axis.kind !== "scalar") throw new Error("Expected a scalar index axis.");
        return child(axis.value);
      }));
    }
    if (node.kind === "unary") {
      const value = scalarOnly(child(node.right!));
      // Excel negation binds more tightly than exponentiation.
      return { ...scalar("-" + operand(value, 70, true), "number", 60), temporal: value.temporal?.kind === "duration" ? value.temporal : undefined };
    }
    if (node.kind === "binary") {
      const a = child(node.left!), b = child(node.right!), sourceOp = String(node.value);
      if (a.view && b.view && (a.rows !== b.rows || a.columns !== b.columns || a.dynamic || b.dynamic)) return fail("View operands must have matching shapes.");
      const op = sourceOp === "+" && (a.domain === "text" || b.domain === "text") ? "&"
        : ({ "**": "^", "==": "=", "!=": "<>" }[sourceOp] ?? sourceOp);
      const precedence = ["=", "<>", "<", ">", "<=", ">="].includes(op) ? 10 : op === "&" ? 20
        : ["+", "-"].includes(op) ? 30 : ["*", "/"].includes(op) ? 40 : op === "^" ? 70 : 0;
      if (!precedence) return fail("Unsupported operator '" + sourceOp + "'.");
      const left = op === "&" ? a.concatenand ?? a : a, right = op === "&" ? b.concatenand ?? b : b;
      const instants = a.temporal && b.temporal && a.temporal.kind === b.temporal.kind
        && a.temporal.offsetMinutes !== undefined && b.temporal.offsetMinutes !== undefined
        && (sourceOp === "-" || precedence === 10);
      const text = instants ? `(${temporalInstantText(a)})${op}(${temporalInstantText(b)})`
        : operand(left, precedence, op === "^") + op + operand(right, precedence, true);
      const temporal = precedence === 10 ? undefined
        : b.temporal?.kind === "duration" && ["+", "-"].includes(op) ? a.temporal
        : a.temporal?.kind === "duration" && op === "+" ? b.temporal
        : a.temporal && b.temporal && op === "-" ? { kind: "duration" as const } : undefined;
      const rows = Math.max(a.rows, b.rows), columns = Math.max(a.columns, b.columns);
      if (rows > 1 || columns > 1) arrayFormula = true;
      return { ...scalar(text, op === "&" ? "text" : precedence === 10 ? "boolean" : "number", precedence),
        rows, columns, view: a.view || b.view, dynamic: a.dynamic || b.dynamic, temporal };
    }
    if (node.kind !== "call") return fail("Unsupported expression '" + node.kind + "'.");
    const source = node.value as FunctionCall, name = getStandardFunctionMetadata(source.name)?.name;
    if (!name) return fail("Unknown function '" + source.name + "'.");
    const policy = nativeFunctionCompatibility.get(name);
    if (!policy) throw new Error("Missing Excel compatibility decision for '" + name + "'.");
    if (policy.status === "unsupported") return fail(name + " is not supported for Excel export.");
    if ((name === "format" || name === "text") && source.args.length === 1 && source.args[0].kind === "literal") {
      const literal = source.args[0].value as RuntimeValue;
      if (["date", "time", "datetime", "duration"].includes(literal.kind)) {
        // The original literal's ISO spelling is already the requested text.
        // No serial projection, timezone removal, cached result or TEXT guard.
        return scalar(excelQuotedText((literal as {value:string}).value), "text");
      }
    }
    const args = source.args.map(child), x = args[0];
    const texts = () => args.map(arg => scalarOnly(arg).text);
    switch (policy.rule) {
      case "calendarPredicate": {
        arity(args, 1); scalarOnly(x);
        const test = inspectCalendar(source.args[0], depth + 1, scopeSheet, scopeAt).dateTest;
        // A native predicate returns false for errors too. This guard expresses
        // that definition; it is not a fallback or Excel-wide coercion policy.
        return scalar(test === "FALSE" ? test : test === "TRUE" ? call("ISNUMBER", [x.text])
          : call("IF", [call("ISNUMBER", [x.text]), test, "FALSE"]), "boolean");
      }
      case "temporal": return {...scalar("", "number"),...exportTemporalFunction(name,args.map(scalarOnly),at)};
      case "format": {
        arity(args, 1, 2);
        scalarOnly(x);
        if (args.length === 1) {
          if (x.temporal?.kind === "date") return scalar(call("TEXT", [x.text, '"yyyy-mm-dd"']), "text");
          if (x.temporal) return fail("Implicit temporal text requires a static ISO literal or an explicit calendar/clock format for Excel export.");
          return { ...scalar(operand(x, 20) + '&""', "text", 20), concatenand: x };
        }
        const literal = source.args[1];
        if (literal.kind !== "literal" || (literal.value as RuntimeValue).kind !== "string") return fail("Dynamic format specifications cannot be exported to Excel.");
        const parsed = parseFormatSpec((literal.value as { value: string }).value);
        const code = "value" in parsed ? exportTextFormat(parsed.value) : null;
        if (code === null) return fail("This format has no supported Excel TEXT representation.");
        return scalar(call("TEXT", [x.text, excelQuotedText(code)]), "text");
      }
      case "conversion":
        arity(args, 1);
        if (x.rows > 1 || x.columns > 1) arrayFormula = true;
        if (name === "text") {
          if (x.temporal?.kind === "date") return {...x, text:call("TEXT",[x.text,'"yyyy-mm-dd"']),domain:"text",precedence:100,temporal:undefined,areas:undefined,selection:undefined};
          if (x.temporal) return fail("Implicit temporal text requires a static ISO literal or an explicit calendar/clock format for Excel export.");
          return { ...x, text: operand(x, 20) + '&""', domain: "text", precedence: 20, concatenand: x, areas: undefined, selection: undefined };
        }
        return { ...x, text: name === "number" ? call("VALUE", [x.text]) : operand(x, 10, true) + "<>0",
          domain: name === "number" ? "number" : "boolean", precedence: name === "number" ? 100 : 10, areas: undefined, concatenand: undefined, selection: undefined };
      case "index": arity(args, 2, 3); return indexView(x, args.slice(1));
      case "shape": {
        arity(args, 1);
        if (!x.view) return fail("Shape functions require a view.");
        const rows = extent(x, true), cols = extent(x, false);
        if (name === "shape") return { ...scalar("CHOOSE({1,2}," + rows + "," + cols + ")", "number"), view: true, columns: 2 };
        return scalar(name === "size" ? rows + "*" + cols : name === "rowCount" ? rows : cols, "number", name === "size" ? 40 : 100);
      }
      case "signature": {
        const spec = functionTranslations[name];
        if (!spec) throw new Error("Missing function signature '" + name + "'.");
        arity(args, spec.required, spec.args.length);
        if (spec.solver) report.warn("semantic_difference", "Excel uses an initial guess; its root solver can select a different root from Ordinate.", at);
        const values = args.map((arg, i) => {
          const kind = spec.args[i];
          if (kind === "scalar") return scalarOnly(arg).text;
          if (!arg.view) return fail(name + " requires a view argument.");
          if (kind === "vector" || kind === "dates") vector(arg);
          return arg.text;
        });
        if (spec.argumentOrder) {
          const ordered = spec.argumentOrder.map(slot => typeof slot === "string" ? slot : values[slot]);
          while (ordered.length > (spec.excelRequired ?? spec.required) && ordered[ordered.length - 1] === undefined) ordered.pop();
          return scalar(call(spec.excel, ordered.map((value, i) => {
            if (value !== undefined) return value;
            const slot = spec.argumentOrder![i];
            if (typeof slot !== "number" || spec.defaults?.[slot] === undefined) throw new Error("Missing required Excel argument.");
            return spec.defaults[slot];
          })), "number");
        }
        for (let i = values.length; i < (spec.excelRequired ?? values.length); i++) {
          if (spec.defaults?.[i] === undefined) throw new Error("Missing required Excel argument default.");
          values.push(spec.defaults[i]);
        }
        return scalar(call(spec.excel, values), "number");
      }
      case "join":
        arity(args, 2); scalarOnly(x);
        if (!args[1].view) return fail("join requires a text view.");
        return scalar(call("_xlfn.TEXTJOIN", [x.text, "FALSE", (args[1].concatenand ?? args[1]).text]), "text");
      case "match": {
        arity(args, 2); scalarOnly(x); vector(args[1]);
        const position = call("MATCH", [x.text, args[1].text, "0"]);
        return { ...scalar(position + "-1", "number", 30), oneBasedPosition: position };
      }
      case "lookup":
        arity(args, 3); scalarOnly(x); vector(args[1]); vector(args[2]);
        return scalar(call("_xlfn.XLOOKUP", args.map(arg => arg.text)));
      case "dotProduct":
        arity(args, 2); vector(x); vector(args[1]);
        if (x.rows !== args[1].rows || x.columns !== args[1].columns || x.dynamic || args[1].dynamic) return fail("dotProduct requires equally shaped vectors.");
        return scalar(call("SUMPRODUCT", args.map(arg => arg.text)), "number");
      case "filter": {
        arity(args, 2); vector(x); vector(args[1]);
        if (x.rows !== args[1].rows || x.columns !== args[1].columns || x.dynamic || args[1].dynamic) return fail("filter requires equally shaped vectors.");
        const filtered = call("_xlfn._xlws.FILTER", args.map(arg => arg.text));
        // Native filter flattens into a row vector, even for a column input.
        return { ...scalar(x.rows === 1 ? filtered : call("TRANSPOSE", [filtered])), view: true, dynamic: true,
          columns: Math.max(x.rows, x.columns) };
      }
      case "selection": {
        arity(args, 2); scalarOnly(args[1]);
        if (x.domain === "text" && !x.view) {
          const n = args[1].text, length = `MIN(LEN(${x.text}),ABS(${n}))`;
          // TAKE/DROP share native negative-count direction, but Excel's
          // names accept arrays only. Use scalar text operations for text.
          return scalar(name === "take"
            ? `IF(${n}<0,RIGHT(${x.text},${length}),LEFT(${x.text},${length}))`
            : `IF(${n}<0,LEFT(${x.text},LEN(${x.text})-${length}),MID(${x.text},${length}+1,LEN(${x.text})))`, "text");
        }
        if (!x.view) return fail(name + " requires a view for Excel export.");
        const horizontal = x.rows === 1, size = horizontal ? x.columns : x.rows;
        const count = args[1].domain === "number" ? Number(args[1].text) : NaN;
        const length = Number.isInteger(count) ? name === "take" ? Math.min(size, Math.abs(count)) : Math.max(0, size - Math.abs(count)) : undefined;
        return { ...scalar(call(`_xlfn.${name.toUpperCase()}`, [x.text, ...(horizontal ? [""] : []), args[1].text])), view: true,
          rows: horizontal ? 1 : length ?? 1, columns: horizontal ? length ?? 1 : x.columns, dynamic: x.dynamic || length === undefined };
      }
      case "predicate":
        arity(args, 1);
        if (x.rows > 1 || x.columns > 1) arrayFormula = true;
        return { ...x, text: call(predicates[name], [x.text]), domain: "boolean", precedence: 100, areas: undefined, concatenand: undefined, selection: undefined };
      case "conditional":
        arity(args, 3); scalarOnly(x);
        if (args[1].rows !== args[2].rows || args[1].columns !== args[2].columns) return fail("Conditional branches with different shapes are unsupported.");
        return { ...args[1], text: call("IF", args.map(arg => arg.text)), precedence: 100, areas: undefined, selection: undefined,
          concatenand: undefined, dynamic: args[1].dynamic || args[2].dynamic, view: args[1].view || args[2].view,
          domain: args[1].domain === args[2].domain ? args[1].domain : "unknown",
          temporal: args[1].temporal?.kind === args[2].temporal?.kind && args[1].temporal?.offsetMinutes === args[2].temporal?.offsetMinutes ? args[1].temporal : undefined };
      case "not": arity(args, 1); return { ...x, text: call("NOT", [x.text]), domain: "boolean", precedence: 100, areas: undefined, selection: undefined, concatenand: undefined };
      case "logical": arity(args, 1, 254); return scalar(call(name.toUpperCase(), args.flatMap(arg => arg.areas ?? [arg.text])), "boolean");
      case "aggregate": {
        arity(args, 1);
        if (!x.view) return fail(name + " requires a view.");
        const areas = x.areas ?? [x.text];
        return scalar(name === "countblank" && areas.length > 1 ? call("SUM", areas.map(area => call("COUNTBLANK", [area])))
          : call(name.toUpperCase(), areas), "number");
      }
      case "numericUnary": arity(args, 1); return scalar(call(name === "floor" ? "INT" : name === "ceil" ? "CEILING" : name.toUpperCase(), [...texts(), ...(name === "ceil" ? ["1"] : [])]), "number");
      case "numericBinary": arity(args, 2); return scalar(call(name.toUpperCase(), texts()), "number");
      case "rounding": arity(args, name === "trunc" ? 1 : 2, 2); return scalar(call(name.toUpperCase(), texts()), "number");
      case "pi": arity(args, 0); return scalar("PI()", "number");
      case "text": {
        const textName = exportTextFunction(name);
        if (!textName) throw new Error("Missing text rule '" + name + "'.");
        const rule = exportTextFunctions[textName];
        arity(args, rule.required, rule.arguments.length);
        return scalar(exportText(textName, texts()), rule.result);
      }
    }
  };
  return { formula: scalarOnly(wrap(expression, 0)).text, arrayFormula };
}
