import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentState, serializeDocumentState, groupHeaderSpans } from "@ordinate/core";
import { preparePrintDocument, DEFAULT_PRINT_OPTIONS } from "./printDocumentModel";
import { PrintSheet, PrintDocument } from "./PrintSheetView";
import { createCellDisplayFormatter } from "../preferences/temporalDisplay";
const displayCell = createCellDisplayFormatter("locale", "en-US");

const prepare = (text: string, activeSheet = "Report") => preparePrintDocument({ mode: "table", sourceText: text, docState: DocumentState.fromText(text), activeSheet }, displayCell);
const snapshot = (text: string, activeSheet = "Report") => prepare(text, activeSheet).build(DEFAULT_PRINT_OPTIONS)[0];

describe("complete sheet print snapshot", () => {
  it("shares grouped headers with the screen without merging across header columns or hidden gaps", () => {
    const columns = [0, 1, 2, 3, 5].map(colIndex => ({ colIndex }));
    expect(groupHeaderSpans(columns, ['2025', '2025', '2025', '2026', '', '2026'], 1)).toEqual([
      {start:0,end:0,label:'2025'}, {start:1,end:2,label:'2025'}, {start:3,end:3,label:'2026'}, {start:4,end:4,label:'2026'},
    ]);
    const sheet = snapshot('# Report\n| Item || 2025 | 2025 |\n| Item || H1 | H2 |\n| --- || --- | --- |\n| Sales || 1 | 2 |');
    expect(renderToStaticMarkup(<PrintSheet sheet={sheet} />)).toContain('scope="colgroup" colSpan="2">2025');
  });
  it("includes all rows, computed results, both notes, and only the active sheet", () => {
    const text = '# Report\n**Units**\n\n| Item || Value |\n| --- || --- |\n' +
      Array.from({ length: 240 }, (_, i) => `| Item ${i + 1} || = ${i + 1} * 2 |`).join('\n') +
      '\n\n- End of report\n\n# Other\n| DO NOT PRINT |';
    const sheet = snapshot(text);
    expect(sheet.rows).toHaveLength(240);
    expect(sheet.rows.at(-1)?.col_1).toBe("480");
    const html = renderToStaticMarkup(<PrintSheet sheet={sheet} />);
    expect(html).toContain('<strong>Units</strong>');
    expect(html).toContain('<li>End of report</li>');
    expect(html).toContain('<thead>');
    expect(html).toContain('480</td>');
    expect(html).not.toMatch(/DO NOT PRINT|button|ag-grid|rail/);
  });
  it("uses current source, not the last table-mode document", () => {
    const sheet = preparePrintDocument({ mode: "source", sourceText: '# Report\n| 999 |', docState: DocumentState.fromText('# Report\n| 1 |'), activeSheet: 'Report' }, displayCell).build(DEFAULT_PRINT_OPTIONS)[0];
    expect(sheet.rows[0].col_0).toBe('999');
  });
  it("fails early for invalid structure or a missing current sheet", () => {
    expect(() => preparePrintDocument({ mode:'source', sourceText:'# Report\n| 1 | 2 |\n| 3 |', docState:null, activeSheet:'Report' }, displayCell)).toThrow();
    expect(() => snapshot('# Other\n| 1 |')).toThrow('Choose a sheet');
    expect(() => snapshot('# Report\n<script>invalid note</script>\n\n| 1 |')).toThrow();
  });
  it("preserves number formatting, color, alignment, and cell > row > column overrides", () => {
    const sheet = snapshot('# Report\n| @meta | {::>,red} | {::>,red} | {::>,red} |\n| {::bold} | 1 {:.2f} | 2 {::normal,blue} | = A1 + B1 |');
    const html = renderToStaticMarkup(<PrintSheet sheet={sheet} />);
    expect(html).toContain('text-align:right;font-weight:700;color:var(--display-color-red)">1.00');
    expect(html).toContain('text-align:right;font-weight:400;color:var(--display-color-blue)">2');
    expect(html).toContain('>3</td>');
  });
  it("prints visible formula errors instead of silently blanking them", () => {
    const sheet = snapshot('# Report\n| = 1 / 0 |');
    expect(sheet.rows[0].__kind_0).toBe('error');
    expect(String(sheet.rows[0].col_0)).not.toBe('');
  });
  it("escapes cell markup and renders note columns safely", () => {
    const sheet = snapshot('# Report\nLeft **bold**\n\n---\n\nRight *italic*\n\n| "<img src=x onerror=alert(1)>" |');
    const html = renderToStaticMarkup(<PrintSheet sheet={sheet} />);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).toContain('<div class="sheet-note-column"><p>Left <strong>bold</strong></p></div><div class="sheet-note-column"><hr/><p>Right <em>italic</em></p></div>');
  });
  it("does not change the document and snapshots do not follow later edits", () => {
    const docState = DocumentState.fromText('# Report\nBefore\n\n| 7 |');
    const original = serializeDocumentState(docState);
    const sheet = preparePrintDocument({ mode:'table', sourceText:original, docState, activeSheet:'Report' }, displayCell).build(DEFAULT_PRINT_OPTIONS)[0];
    sheet.before!.blocks.length = 0;
    sheet.rows[0].col_0 = 'other';
    expect(serializeDocumentState(docState)).toBe(original);
  });
  it("prints all sheets in workbook order with fresh cross-sheet values, evaluating only once", () => {
    const document = prepare('# Report\nIntro\n\n| 21 |\n\nClosing\n\n# Summary\n| = @["Report"::A1] * 2 |', 'Summary');
    const evaluate = vi.spyOn(DocumentState.prototype, "evaluate");
    try {
      const sheets = document.build({ ...DEFAULT_PRINT_OPTIONS, scope: "all" });
      expect(evaluate).toHaveBeenCalledOnce();
      expect(sheets.map(sheet => sheet.name)).toEqual(['Report', 'Summary']);
      expect(sheets[1].rows[0].col_0).toBe('42');
      const html = renderToStaticMarkup(<PrintDocument sheets={sheets} />);
      expect(html.match(/class="print-sheet"/g)).toHaveLength(2);
      expect(html.indexOf('<h1>Report</h1>')).toBeLessThan(html.indexOf('<h1>Summary</h1>'));
      expect(document.currentSheet).toBe('Summary');
      expect(document.sheets).toEqual([
        { name:'Report', hasBeforeNotes:true, hasAfterNotes:true },
        { name:'Summary', hasBeforeNotes:false, hasAfterNotes:false },
      ]);
    } finally { evaluate.mockRestore(); }
  });
  it("excludes notes independently in both scopes without removing table headers or changing source", () => {
    const text = '# Report\nAbove marker\n\n| Item || Value |\n| --- || --- |\n| Entry || 7 |\n\nBelow marker\n\n# Other\nOther intro\n\n| 9 |';
    const document = prepare(text);
    for (const scope of ['current', 'all'] as const) for (const includeBeforeNotes of [false, true]) for (const includeAfterNotes of [false, true]) {
      const sheets = document.build({ scope, includeBeforeNotes, includeAfterNotes });
      const html = renderToStaticMarkup(<PrintDocument sheets={sheets} />);
      expect(html.includes('Above marker')).toBe(includeBeforeNotes);
      expect(html.includes('Below marker')).toBe(includeAfterNotes);
      expect(html.includes('Other intro')).toBe(scope === 'all' && includeBeforeNotes);
      expect(html).toContain('<thead>');
      expect(html).toContain('>Value</th>');
      expect(html).toContain('>7</td>');
    }
  });
  it("fails all-sheet printing for a structurally invalid other sheet but permits the valid current sheet", () => {
    const document = preparePrintDocument({ mode:'source', sourceText:'# Report\n| 7 |\n\n# Invalid\n| 1 | 2 |\n| 3 |', docState:null, activeSheet:'Report' }, displayCell);
    expect(document.build(DEFAULT_PRINT_OPTIONS)[0].rows[0].col_0).toBe('7');
    expect(() => document.build({ ...DEFAULT_PRINT_OPTIONS, scope:'all' })).toThrow('Invalid');
  });
  it("captures source before the dialog, rather than retaining the live mutable document", () => {
    const docState = DocumentState.fromText('# Report\n| 7 |');
    const document = preparePrintDocument({ mode:'table', sourceText:'stale', docState, activeSheet:'Report' }, displayCell);
    // The document store uses mutable core edits; a print request must own its copy.
    const mutate = vi.spyOn(docState, 'evaluate').mockImplementation(() => { throw new Error('Live document used'); });
    expect(document.build(DEFAULT_PRINT_OPTIONS)[0].rows[0].col_0).toBe('7');
    expect(mutate).not.toHaveBeenCalled();
  });
  it("does not require valid notes/tables on an unselected sheet, but never silently prints them", () => {
    for (const other of ['# Other\nNo table', '# Other\n<script>bad note</script>\n\n| 1 |']) {
      const document = preparePrintDocument({ mode:'source', sourceText:'# Report\n| 7 |\n\n'+other, docState:null, activeSheet:'Report' }, displayCell);
      expect(document.build(DEFAULT_PRINT_OPTIONS)[0].rows[0].col_0).toBe('7');
      expect(() => document.build({ ...DEFAULT_PRINT_OPTIONS, scope:'all' })).toThrow();
    }
  });
});
