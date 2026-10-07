import {renderToStaticMarkup} from "react-dom/server";
import {describe,it,expect} from "vitest";
import {ImportPreview} from "./ImportPreview";
import {parseSheetNote} from "@ordinate/core";
import {importNoteSummary} from "./ImportNoteChoice";
import {defaultImportNotes} from "./conversion";
const sheets=[{sheetName:"Data",headerRows:0,headerColumns:0,rows:2,columns:2,cells:[["A","B"],["1","2"]]}];
const candidates=[{sheetName:"Data",position:"beforeTable" as const,rowCount:2,firstRow:1,lastRow:2,markdown:"\\<b\\>literal text\\</b\\>"}];
describe("header selectors",()=>{
  it("offers a shared stepper for both axes with accessible labels and bounded values",()=>{
    const html=renderToStaticMarkup(<ImportPreview sheets={sheets} choices={sheets} onChange={()=>{}} disabled={false}
      noteCandidates={[]} notes={[]} onNotesChange={()=>{}}/>);
    expect(html.match(/class="integer-stepper"/g)).toHaveLength(2);
    for(const axis of ["rows","columns"]) {
      expect(html).toContain(`aria-label="Decrease header ${axis}" disabled=""`);
      expect(html).toContain(`aria-label="Increase header ${axis}"`);
    }
    expect(html.match(/min="0" max="1" step="1"/g)).toHaveLength(2);
  });
});
describe("note extraction confirmation",()=>{
  it("shows default-selected notes as pressable options with exact rows and escaped content",()=>{
    const html=renderToStaticMarkup(<ImportPreview sheets={sheets} choices={sheets} onChange={()=>{}} disabled={false}
      noteCandidates={candidates} notes={defaultImportNotes(candidates)} onNotesChange={()=>{}}/>);
    expect(html).toContain("Note before table");expect(html).toContain("Source rows 1–2");
    expect(html).toContain("&lt;b&gt;literal text&lt;/b&gt;");expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Note before table"');
    expect(html).toContain('aria-label="Preview note before table"');
    expect(html).not.toContain('import-note-reader');
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('import-note-switch');
  });
  it("shows selected notes and disables changes while preparing",()=>{
    const html=renderToStaticMarkup(<ImportPreview sheets={sheets} choices={sheets} onChange={()=>{}} disabled
      noteCandidates={candidates} notes={[{sheetName:"Data",beforeRows:2,afterRows:0}]} onNotesChange={()=>{}}/>);
    expect(html).toMatch(/class="selection-row import-note-select"[^>]*aria-pressed="true"[^>]*disabled=""/);
    expect(html).not.toContain('type="checkbox"');
  });
  it("explains referenced regions before selection, disables only the toggle and keeps Preview accessible",()=>{
    const html=renderToStaticMarkup(<ImportPreview sheets={sheets} choices={sheets} onChange={()=>{}} disabled={false}
      noteCandidates={[{...candidates[0],unavailableReason:"Referenced by 'Index'!A1. Keep those rows in the table."}]} notes={[]} onNotesChange={()=>{}}/>);
    expect(html).toMatch(/class="selection-row import-note-select"[^>]*aria-pressed="false"[^>]*disabled=""/);
    expect(html).toContain('Keep those rows in the table.');
    expect(html).toMatch(/aria-label="Preview note before table"[^>]*aria-describedby=/);
    expect(html).not.toMatch(/aria-label="Preview note before table"[^>]*disabled/);
    expect(html).not.toContain('role="alert"');
  });
  it("only shows note choices belonging to the active sheet",()=>{
    const html=renderToStaticMarkup(<ImportPreview sheets={sheets} choices={sheets} onChange={()=>{}} disabled={false}
      noteCandidates={[...candidates,{...candidates[0],sheetName:'Other',markdown:'Other sheet note'}]} notes={[]} onNotesChange={()=>{}}/>);
    expect(html.match(/class="selection-row import-note-select"/g)).toHaveLength(1);
    expect(html).not.toContain('Other sheet note');
  });
  it("omits the notes section when there are no candidates",()=>{
    const html=renderToStaticMarkup(<ImportPreview sheets={sheets} choices={sheets} onChange={()=>{}} disabled={false}
      noteCandidates={[]} notes={[]} onNotesChange={()=>{}}/>);
    expect(html).not.toContain('import-note-choices');
  });
  it("summarizes just the first paragraph or list item as plain text",()=>{
    expect(importNoteSummary(parseSheetNote('**Financial** *report*\n\nHidden second paragraph'))).toBe('Financial report');
    expect(importNoteSummary(parseSheetNote('- **First** item\n- Second item'))).toBe('First item');
    expect(importNoteSummary(parseSheetNote('-----\n\n3. **First** item\n4. Second'))).toBe('First item');
    expect(importNoteSummary(parseSheetNote('-----'))).toBe('');
    expect(importNoteSummary(parseSheetNote('First column\n\n---\n\nSecond column'))).toBe('First column');
    expect(importNoteSummary(parseSheetNote(''))).toBe('');
  });
});
