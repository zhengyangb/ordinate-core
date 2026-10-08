import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintOptionsContent } from "./PrintDialog";
import { DEFAULT_PRINT_OPTIONS, type PreparedPrintDocument, type PrintOptions } from "./printDocumentModel";

const noop = () => {};
const render = (document: Pick<PreparedPrintDocument, 'currentSheet' | 'sheets'>, options: PrintOptions = DEFAULT_PRINT_OPTIONS) =>
  renderToStaticMarkup(<PrintOptionsContent document={document} options={options} onChange={noop} onClose={noop} onPrint={noop} />);
const sheets = [
  { name:'Report', hasBeforeNotes:true, hasAfterNotes:true },
  { name:'Other', hasBeforeNotes:false, hasAfterNotes:false },
];

describe('print choices', () => {
  it('uses shared segmented radios and full-row toggle buttons, defaulting to current sheet and both notes', () => {
    const html = render({ currentSheet:'Report', sheets });
    expect(html).toContain('class="segmented-choice"');
    expect(html).toContain('role="radiogroup" aria-label="Sheets to print"');
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Current sheet/);
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>All sheets/);
    expect(html.match(/class="selection-row"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toMatch(/Preparing|wizard|Print a copy/);
  });
  it('keeps note rows mounted across scope changes, disabling unavailable notes in the current sheet', () => {
    const current = render({ currentSheet:'Other', sheets });
    const all = render({ currentSheet:'Other', sheets }, { ...DEFAULT_PRINT_OPTIONS, scope:'all' });
    expect(current.match(/class="selection-row"/g)).toHaveLength(2);
    expect(current.match(/disabled=""/g)).toHaveLength(2);
    expect(all.match(/class="selection-row"/g)).toHaveLength(2);
    expect(all).not.toContain('disabled');
    expect(all).toContain('2 sheets · Each starts on a new page');
  });
  it('omits absent note positions, including all options when the workbook has no notes', () => {
    expect(render({ currentSheet:'Other', sheets:[sheets[1]] })).not.toContain('selection-row');
    const html = render({ currentSheet:'Report', sheets:[{ ...sheets[0], hasAfterNotes:false }] });
    expect(html).toContain('Notes above table');
    expect(html).not.toContain('Notes below table');
  });
  it('renders independent excluded states without changing the choice structure', () => {
    const html = render({ currentSheet:'Report', sheets }, { ...DEFAULT_PRINT_OPTIONS, includeAfterNotes:false });
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
  });
  it('escapes document titles and keeps the selected scope in one summary line', () => {
    const name = '<img src=x onerror=alert(1)>';
    const html = render({ currentSheet:name, sheets:[{ ...sheets[0], name }] });
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html.match(/print-range-summary/g)).toHaveLength(1);
  });
});
