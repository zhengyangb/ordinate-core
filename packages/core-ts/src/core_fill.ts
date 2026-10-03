import { ChangeKind, type SheetState } from "./incremental";
import { CoreEditFailure } from "./core_edit_common";
import { getCellTextView, parseCellInput } from "./runtime/parse";
import { renderFormulaExpression } from "./runtime/renderFormula";
import { walkExpressionReferences } from "./runtime/references";
import { evalTemporalArithmetic } from "./runtime/temporal";
import type { RefSelector, RuntimeValue } from "./runtime/types";

export type CoreFillMode = "auto" | "copy" | "series";
/** Zero-based, inclusive semantic coordinates, never viewport coordinates. */
export type CoreFillRect = { rowStart: number; rowEnd: number; colStart: number; colEnd: number };
export type CoreFillPlan = { values: string[][]; canSeries: boolean };

const fail = (message: string): never => { throw new CoreEditFailure("invalid_operation", message); };
const modulo = (value: number, length: number) => ((value % length) + length) % length;

function validateRect(sheet: SheetState, rect: CoreFillRect): void {
  if ([rect.rowStart, rect.rowEnd, rect.colStart, rect.colEnd].some(value => !Number.isInteger(value)) ||
      rect.rowStart < sheet.bodyStart || rect.colStart < sheet.headerColCount ||
      rect.rowEnd < rect.rowStart || rect.colEnd < rect.colStart ||
      rect.rowEnd >= sheet.rowCount || rect.colEnd >= sheet.colCount) {
    fail("fill regions must be normalized rectangles inside the existing data area");
  }
}

/** Only positional selectors move. Labels, current/offset selectors and fixed axes retain their meaning. */
function shiftSelector(selector: RefSelector, delta: number): RefSelector {
  if (selector.kind === "absolute") {
    const value = Number(selector.value) + delta;
    return value < 0 ? { kind: "invalid" } : { kind: "absolute", value };
  }
  if (selector.kind === "range") {
    return { kind: "range", value: (selector.value as (RefSelector | null)[]).map(item => item ? shiftSelector(item, delta) : null) };
  }
  return selector;
}

function copyInput(input: string, rowDelta: number, colDelta: number): string {
  // Parse the current input, not the bound AST: stable IDs are for structural edits, not copy offsets.
  const { body } = parseCellInput(input);
  if (!body.valid || body.kind !== "formula") return input;
  walkExpressionReferences(body.expression, ref => {
    ref.rowSelector = shiftSelector(ref.rowSelector, rowDelta);
    ref.colSelector = shiftSelector(ref.colSelector, colDelta);
  });
  const text = renderFormulaExpression(body.expression, new Map(), new Map());
  if (text === null) fail("cannot render copied formula");
  return `= ${text}`;
}

type Series = { automatic: boolean; generate: (indices: number[]) => string[] };
function numericSeries(values: number[], render: (value: number) => string, automatic: boolean): Series | null {
  const step = values.length === 1 ? 1 : values[1] - values[0];
  if (!Number.isFinite(step) || values.some((value, index) =>
    Math.abs(value - (values[0] + step * index)) > Number.EPSILON * 16 * Math.max(Math.abs(value), Math.abs(values[0]), Math.abs(step * index)))) return null;
  return { automatic, generate: indices => indices.map(index => {
    const raw = values[0] + step * index;
    const cancellation = Number.EPSILON * 8 * Math.max(Math.abs(values[0]), Math.abs(step * index));
    const value = Math.abs(raw) <= cancellation ? 0 : Number.isInteger(raw) ? raw : Number(raw.toPrecision(15));
    if (!Number.isFinite(value)) fail("fill series exceeds the numeric range");
    return render(value);
  }) };
}

function inferSeries(inputs: string[]): Series | null {
  const bodies = inputs.map(input => parseCellInput(input).body);
  const values = bodies.map(body => body.valid && body.kind === "literal" ? body.literal : null);
  if (values.every(value => value?.kind === "number")) {
    return numericSeries(values.map(value => Number(value!.value)), String, values.length > 1);
  }
  if (values.every(value => value?.kind === "string")) {
    const parts = values.map(value => /^(.*?)(\d+)([^\d]*)$/.exec(String(value!.value)));
    const first = parts[0];
    if (first && parts.every(part => part && part[1] === first[1] && part[3] === first[3])) {
      const padded = parts.every(part => part![2].length === first[2].length) && first[2].startsWith("0");
      return numericSeries(parts.map(part => Number(part![2])), value => {
        if (!Number.isSafeInteger(value) || value < 0) fail("numbered text series requires non-negative safe integers");
        return JSON.stringify(`${first[1]}${padded ? String(value).padStart(first[2].length, "0") : value}${first[3]}`);
      }, values.length > 1);
    }
  }
  const first = values[0];
  if (!first || !["date", "datetime", "time", "duration"].includes(first.kind) ||
      !values.every(value => value?.kind === first.kind)) return null;
  // A single date advances by a calendar day. Other temporal kinds need two examples.
  const step = values.length > 1 ? evalTemporalArithmetic("-", values[1]!, first)
    : first.kind === "date" ? { kind: "duration" as const, value: "P1D" } : null;
  if (!step || step.kind !== "duration") return null;
  if (values.slice(1).some((value, i) => {
    const difference = evalTemporalArithmetic("-", value!, values[i]!);
    return difference?.kind !== "duration" || difference.value !== step.value;
  })) return null;
  return { automatic: true, generate: indices => {
    const generated = new Map<number, RuntimeValue>(values.map((value, i) => [i, value!]));
    const advance = (index: number, previous: number, op: "+" | "-") => {
      const value = evalTemporalArithmetic(op, generated.get(previous)!, step);
      if (!value || value.kind === "error") return fail("temporal fill series is outside the supported range");
      generated.set(index, value);
    };
    for (let i = values.length; i <= indices[indices.length - 1]; i++) advance(i, i - 1, "+");
    for (let i = -1; i >= indices[0]; i--) advance(i, i + 1, "-");
    return indices.map(index => String((generated.get(index)! as Exclude<RuntimeValue, { kind: "error" }>).value));
  } };
}

/** Pure planning shared by UI and mutation; no inference from formatted display strings or formula results. */
export function planFillRegion(sheet: SheetState, source: CoreFillRect, target: CoreFillRect, mode: CoreFillMode = "auto", excludedRows: readonly number[] = []): CoreFillPlan {
  if (!["auto", "copy", "series"].includes(mode)) fail(`unknown fill mode '${mode}'`);
  validateRect(sheet, source);
  validateRect(sheet, target);
  const excluded = new Set(excludedRows);
  if (excluded.size !== excludedRows.length || excludedRows.some(row => !Number.isInteger(row) ||
    row < Math.min(source.rowStart, target.rowStart) || row > Math.max(source.rowEnd, target.rowEnd))) fail("invalid excluded fill rows");
  const vertical = source.colStart === target.colStart && source.colEnd === target.colEnd &&
    (target.rowStart === source.rowEnd + 1 || target.rowEnd === source.rowStart - 1);
  const horizontal = source.rowStart === target.rowStart && source.rowEnd === target.rowEnd &&
    (target.colStart === source.colEnd + 1 || target.colEnd === source.colStart - 1);
  if (!vertical && !horizontal) fail("fill target must adjoin the source along exactly one axis, with matching lane width");
  const sourceStart = vertical ? source.rowStart : source.colStart;
  const sourceEnd = vertical ? source.rowEnd : source.colEnd;
  const targetStart = vertical ? target.rowStart : target.colStart;
  const targetEnd = vertical ? target.rowEnd : target.colEnd;
  const laneStart = vertical ? source.colStart : source.rowStart;
  const laneEnd = vertical ? source.colEnd : source.rowEnd;
  const positions = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i).filter(position => !vertical || !excluded.has(position));
  const seeds = positions(sourceStart, sourceEnd);
  const destinations = positions(targetStart, targetEnd);
  if (!seeds.length || !destinations.length || (!vertical && Array.from({ length: laneEnd - laneStart + 1 }, (_, i) => laneStart + i).every(row => excluded.has(row)))) fail("fill requires non-excluded source and target cells");
  const indices = destinations.map((_, i) => targetStart > sourceEnd ? seeds.length + i : i - destinations.length);
  const values = Array.from({ length: target.rowEnd - target.rowStart + 1 }, (_, r) =>
    Array.from({ length: target.colEnd - target.colStart + 1 }, (_, c) => getCellTextView(sheet.cells[target.rowStart + r][target.colStart + c]).inputText));
  let canSeries = true;
  for (let lane = laneStart; lane <= laneEnd; lane++) {
    if (!vertical && excluded.has(lane)) continue;
    const inputs = seeds.map(position =>
      getCellTextView(sheet.cells[vertical ? position : lane][vertical ? lane : position]).inputText);
    const series = inferSeries(inputs);
    canSeries &&= series !== null;
    if (mode === "series" && !series) fail("this selection has no consistent series; use Copy cells or Auto");
    const generated = series && (mode === "series" || (mode === "auto" && series.automatic)) ? series.generate(indices) : null;
    indices.forEach((index, i) => {
      const sourceIndex = modulo(index, inputs.length);
      const delta = destinations[i] - seeds[sourceIndex];
      const input = generated ? generated[i] : copyInput(inputs[sourceIndex], vertical ? delta : 0, vertical ? 0 : delta);
      values[vertical ? destinations[i] - targetStart : lane - laneStart][vertical ? lane - laneStart : destinations[i] - targetStart] = input;
    });
  }
  return { values, canSeries };
}

export function applyFillRegion(sheet: SheetState, source: CoreFillRect, target: CoreFillRect, mode: CoreFillMode, excludedRows: readonly number[] = []): void {
  const plan = planFillRegion(sheet, source, target, mode, excludedRows);
  const excluded = new Set(excludedRows);
  plan.values.forEach((row, r) => {
    if (excluded.has(target.rowStart + r)) return;
    row.forEach((input, c) => sheet.setCellByIndex(target.rowStart + r, target.colStart + c, input, ChangeKind.VALUE, false));
  });
}
