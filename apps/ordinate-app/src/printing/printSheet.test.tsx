import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentState, serializeDocumentState, groupHeaderSpans } from "@ordinate/core";
import { buildPrintSheet } from "./printSheetModel";
import { PrintSheet } from "./PrintSheetView";
import { createCellDisplayFormatter } from "../preferences/temporalDisplay";
const displayCell = createCellDisplayFormatter("locale", "en-US");

const snapshot = (text: string, activeSheet = "Report") => buildPrintSheet({ mode: "table", sourceText: text, docState: DocumentState.fromText(text), activeSheet }, displayCell);

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
    const sheet = buildPrintSheet({ mode: "source", sourceText: '# Report\n| 999 |', docState: DocumentState.fromText('# Report\n| 1 |'), activeSheet: 'Report' }, displayCell);
    expect(sheet.rows[0].col_0).toBe('999');
  });
  it("fails early for invalid structure or a missing current sheet", () => {
    expect(() => buildPrintSheet({ mode:'source', sourceText:'# Report\n| 1 | 2 |\n| 3 |', docState:null, activeSheet:'Report' }, displayCell)).toThrow();
    expect(() => snapshot('# Other\n| 1 |')).toThrow('Choose a sheet');
    expect(() => snapshot('# Report\n<script>invalid note</script>\n\n| 1 |')).toThrow();
  });
  it("preserves number formatting, color, alignment, and cell > row > column overrides", () => {
    const sheet = snapshot('# Report\n| @display | {::>,red} | {::>,red} | {::>,red} |\n| {::bold} | 1 {:.2f} | 2 {::normal,blue} | = A1 + B1 |');
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
    const sheet = buildPrintSheet({ mode:'table', sourceText:original, docState, activeSheet:'Report' }, displayCell);
    sheet.before.blocks.length = 0;
    sheet.rows[0].col_0 = 'other';
    expect(serializeDocumentState(docState)).toBe(original);
  });
});
