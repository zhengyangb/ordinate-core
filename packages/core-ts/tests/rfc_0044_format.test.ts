import { describe, expect, it } from "vitest";
import { DocumentState, getCellTextView, inspectFormulaInput, planFillRegion, serializeDocumentState } from "../src";
import { parseCellInput } from "../src/runtime/parse";
import { parseFormatSpec, formatValue, serializeFormatSpec } from "../src/runtime/formatting";

function document(formula: string) {
  const doc = DocumentState.fromText('# Data\n| 1234.5 | 0.125 | | |\n| 2 | 3 | | |');
  doc.setCellByIndex("Data", 0, 3, "= " + formula);
  return doc;
}
function value(formula: string) { return document(formula).evaluate().sheets[0].values[0][3]; }

describe("RFC-0044 scalar format", () => {
  it.each([
    ['format(A1, ",.2f")', '1,234.50'], ['format(B1, ".1%")', '12.5%'],
    ['format(-1234.5, "(),.2f")', '(1,234.50)'], ['format(12, "+06d")', '+00012'],
    ['format(-12.9, "d")', '-12'], ['format(1.2, ".2e")', '1.20e+0'],
    ['format(2025-06-29, "%m/%d/%Y")', '06/29/2025'],
    ['format(12:34:56, "%H:%M:%S")', '12:34:56'],
    ['format(A1)', '1234.5'], ['format(true)', 'true'], ['format(false)', 'false'],
    ['format(null)', 'null'], ['format(C1)', ''], ['format("hello")', 'hello'],
    ['format(2025-06-29)', '2025-06-29'],
    ['format(A1, "," + ".2f")', '1,234.50'],
    ['format(-0, ".2f")', '-0.00'], ['format(-0, "().2f")', '(0.00)'],
    ['format(1.005, ".2f")', '1.00'],
    ['format(2025-06-29T12:34:56+02:30, "%F %T %:z")', '2025-06-29 12:34:56 +02:30'],
    ['format(PT25H, "%[h]:%M")', '25:00'],
    ['format(1234.5, ",")', '1,234.5'], ['format(12.34, ".1")', '12.3'],
    ['format(12, "5")', '00012'], ['format(0.125, "+%")', '+12.5%'],
    ['FORMAT(12, ".1f")', '12.0'],
    ['if(false, format(1, 1 / 0), "lazy")', 'lazy'],
  ])("evaluates %s", (formula, expected) => {
    expect(value(formula)).toEqual({ kind: "string", value: expected });
  });

  it.each(['format()', 'format(1,".2f",3)', 'format("12",".2f")', 'format(true,"d")',
    'format(null,"d")', 'format(C1,"d")', 'format(A1,null)', 'format(A1,12)',
    'format(A1:A2)', 'format([1,2])', 'join(",", [format(A1:A2)])',
    'format(1,"" + "bad")', 'format(2025-06-29,".2f")', 'format(1,"%Y")', 'text(1,".2f")',
  ])("rejects invalid calls without returning replacement text: %s", formula => {
    expect(value(formula).kind).toBe("error");
  });
  it.each(['', '.f', '.101f', '9999999999d', ',e', '.2d', '%B', '%', 'bad'])('validates a literal spec early: %j', spec => {
    const parsed = parseCellInput('= format(1,' + JSON.stringify(spec) + ')');
    expect(parsed.body.valid).toBe(false);
  });
  it.each(['format(1 / 0)', 'format(1 / 0,".2f")', 'format(1,1 / 0)'])('preserves errors: %s', formula => {
    expect(value(formula)).toMatchObject({ kind: "error", errorKind: "div_by_zero" });
  });
  it("uses one format parser/serializer and formatter for all callers", () => {
    for (const spec of [",.2f", "(),.1%", "+6d", ".3e", "%Y-%m-%d"]) {
      const parsed = parseFormatSpec(spec);
      expect(parsed).toHaveProperty("value");
      if (!("value" in parsed)) throw new Error(spec);
      expect(serializeFormatSpec(parsed.value)).toBe(spec);
      if (parsed.value.kind === "numeric") expect(formatValue({ kind: "number", value: 12.34 }, parsed.value)).toHaveProperty("text");
    }
  });
  it("does not read referenced cell display metadata", () => {
    const doc = document('format(A1)');
    const before = doc.evaluate().sheets[0].values[0][3];
    doc.setCellByIndex("Data", 0, 0, '1234.5 {:,.0f} {::bold,red}');
    expect(doc.evaluate().sheets[0].values[0][3]).toEqual(before);
  });
});

describe("RFC-0044 f-string syntax sugar", () => {
  it.each([
    ['f"Revenue: {A1:,.2f} USD"', 'Revenue: 1,234.50 USD'],
    ['f"Margin: {B1:.1%}"', 'Margin: 12.5%'],
    ['f"{{Total}}: {sum(A1:A2):,.2f}"', '{Total}: 1,236.50'],
    ['f"{if(A1 > 0, "Profit", "Loss")}: {A1:,.2f}"', 'Profit: 1,234.50'],
    ['f"{sum([1,2,3][0:2]):.0f}"', '3'],
    ['f"{2025-06-29:%Y-%m-%d}"', '2025-06-29'],
    ['f"{12:34:56:%H:%M:%S}"', '12:34:56'],
    ['f"{A1 != A2}"', 'true'], ['f"{C1}/{null}/{true}"', '/null/true'],
    ['f"{"a:b"}"', 'a:b'], ['f""', ''], ['f"plain"', 'plain'],
    ['f"\\u007BA1}"', null],
    ['f"\\u007Bnot a field\\u007D"', '{not a field}'],
    ['f"line\\n\\\"quoted\\\"\\\\{A2}"', 'line\n"quoted"\\2'],
    ['upper(f"x{A2}")', 'X2'], ['f"{A2}" + f"/{B2}"', '2/3'],
  ])("evaluates %s", (formula, expected) => {
    if (expected === null) expect(value(formula).kind).toBe("error");
    else expect(value(formula)).toEqual({ kind: "string", value: expected });
  });
  it.each(['f"{}"', 'f"{ }"', 'f"{A1:}"', 'f"{A1:bad}"', 'f"{A1"', 'f"oops',
    'f"}"', 'f"{A1!r}"', 'f"{A1=}"', 'f"{f"{A1}"}"', 'f"{A1:{A2}}"',
    'f"\\{literal}"', 'f"{sum(A1:A2}"', 'f"x" "y"', 'F"x"', 'f"{A1 +}"',
    'f"{[1,2])}"', 'f"{A1:,.101f}"',
  ])("does not execute malformed syntax: %s", formula => {
    expect(parseCellInput("= " + formula).body.valid).toBe(false);
    expect(value(formula).kind).toBe("error");
  });
  it.each(['f"{A1:A2}"', 'f"{[1,2]}"', 'join(",", f"{A1:A2}")'])('never becomes a view: %s', formula => {
    expect(value(formula).kind).toBe("error");
  });
  it("keeps non-formula text inert", () => {
    const doc = document('1');
    doc.setCellByIndex("Data", 0, 3, 'f"{A1}"');
    expect(doc.evaluate().sheets[0].values[0][3]).toEqual({ kind: "string", value: 'f"{A1}"' });
  });
  it("tracks fields, not reference-looking literal text, and preserves syntax through editing", () => {
    const doc = document('f"B2: {$A1:,.2f}/{B$1}"');
    const point = (r: number) => ({ rowStart: r, rowEnd: r, colStart: 3, colEnd: 3 });
    const copy = planFillRegion(doc.sheets[0], point(0), point(1), "copy").values[0][0];
    expect(copy).toBe('= f"B2: {$A2:,.2f}/{B$1}"');
    doc.setCellByIndex("Data", 1, 3, copy);
    doc.insertRow("Data", 0);
    expect(getCellTextView(doc.sheets[0].cells[2][3]).inputText).toBe('= f"B2: {$A3:,.2f}/{B$2}"');
    const restored = DocumentState.fromText(serializeDocumentState(doc));
    restored.setCellByIndex("Data", 2, 0, '4');
    expect(restored.evaluate().sheets[0].values[2][3]).toEqual({ kind: "string", value: 'B2: 4.00/0.125' });
  });
  it("propagates cycles and ordinary errors", () => {
    expect(value('f"{D1}"')).toMatchObject({ kind: "error", errorKind: "cycle" });
    expect(value('f"x{1 / 0}"')).toMatchObject({ kind: "error", errorKind: "div_by_zero" });
  });
  it("exposes field references and calls with lossless original source spans", () => {
    const source = '= upper(f"literal B2 {sum(A1:A2):,.2f} {B1}")';
    const caret = source.indexOf('A1');
    const inspection = inspectFormulaInput(source, { caret });
    expect(inspection.diagnostics).toEqual([]);
    expect(inspection.tokens.map(t => source.slice(t.span.start, t.span.end)).join('')).toBe(source);
    expect(inspection.tokens.filter(t => t.kind === "spreadsheet_reference").map(t => source.slice(t.span.start, t.span.end))).toEqual(['A1:A2', 'B1']);
    expect(inspection.caret?.referenceTokenIndex).not.toBeNull();
    expect(inspection.structures.map(s => s.kind === 'call' ? s.name : s.kind)).toEqual(['upper', 'interpolation', 'sum', 'interpolation']);
    expect(inspection.structures[1].parent).toBe(0);
    expect(inspection.structures[2].parent).toBe(1);
  });
  it("bounds format allocation and f-string segment counts", () => {
    expect(value('f"' + '{A2}'.repeat(128) + '"')).toEqual({ kind: 'string', value: '2'.repeat(128) });
    expect(value('f"' + 'a'.repeat(65533) + '"')).toEqual({ kind: 'string', value: 'a'.repeat(65533) });
    expect(value('f"' + 'a'.repeat(65534) + '"').kind).toBe('error');
    expect(value('format(1,"99999999999999999" + "d")').kind).toBe('error');
    expect(value('f"' + '{A1}'.repeat(130) + '"').kind).toBe('error');
    expect(value('f"' + 'a'.repeat(65537) + '"').kind).toBe('error');
    expect(value('f"{format(1,"65536d")}{A1}"').kind).toBe('error');
    expect(value('f"{' + '-'.repeat(300) + '1}"').kind).toBe('error');
    expect(value('f"{' + '('.repeat(70) + '1' + ')'.repeat(70) + '}"').kind).toBe('error');
  });
  it.each(['= f"{A1', '= f"{sum(A1', '= f"{}"', '= f"{A1} unfinished'])('inspects incomplete %s without executing it', source => {
    const result = inspectFormulaInput(source);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.tokens.map(t => source.slice(t.span.start, t.span.end)).join('')).toBe(source);
    expect(parseCellInput(source).body.valid).toBe(false);
    if (source.includes('A1')) expect(result.tokens.some(t => t.kind === 'spreadsheet_reference')).toBe(true);
  });
  it("remains lossless and non-throwing at every typing prefix", () => {
    const templates = ['= f"escaped \\\\ {sum(A1:A2):,.2f}"', '= f"{if(A1 > 0, "yes", "no")}"', '= f"{A1:\\u002e2f}"'];
    for (const template of templates) for (let end = 3; end <= template.length; end++) {
      const source = template.slice(0, end);
      const inspection = inspectFormulaInput(source, { caret: source.length });
      expect(inspection.tokens.map(t => source.slice(t.span.start, t.span.end)).join('')).toBe(source);
      expect(() => parseCellInput(source)).not.toThrow();
    }
  });
  it("rejects invalid escapes, oversized temporal output and imported oversized strings", () => {
    for (const source of ['= f"\\q"', '= f"{A1:bad\\', '= f"{A1:\\q}"']) {
      expect(inspectFormulaInput(source).diagnostics.length).toBeGreaterThan(0);
      expect(parseCellInput(source).body.valid).toBe(false);
    }
    expect(value('format(2025-06-29, "' + '%Y'.repeat(17000) + '")').kind).toBe('error');
    const doc = document('format(A1)');
    doc.setCellByIndex('Data', 0, 0, JSON.stringify('x'.repeat(65537)));
    expect(doc.evaluate().sheets[0].values[0][3].kind).toBe('error');
    const spec = parseFormatSpec('.2f');
    if (!('value' in spec)) throw new Error('Expected numeric format');
    expect(formatValue({ kind: 'number', value: Infinity }, spec.value)).toHaveProperty('issue');
  });
});
