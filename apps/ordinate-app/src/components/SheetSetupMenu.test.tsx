import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SheetSetupMenu from "./SheetSetupMenu";

describe("Sheet Setup header controls", () => {
  it("offers matching editable row and column steppers", () => {
    const html = renderToStaticMarkup(<SheetSetupMenu open onEditNote={() => {}} notesDisabled={false} menuRef={{current:null}} position={{top:0,left:0}}
      headerRowCount={1} headerColCount={2} maxHeaderRowCount={8} maxHeaderColCount={4}
      onSetHeaderRowCount={() => {}} onSetHeaderColCount={() => {}} />);
    expect(html).toContain('id="sheet-setup-header-columns"');
    expect(html).not.toContain('readOnly');
    expect(html).toContain('aria-label="Increase header columns"');
    expect(html).toContain('aria-label="Decrease header rows"');
    expect(html.match(/type="number"/g)).toHaveLength(2);
  });
  it("does not expose controls while closed", () => {
    expect(renderToStaticMarkup(<SheetSetupMenu open={false} onEditNote={() => {}} notesDisabled={false} menuRef={{current:null}} position={{top:0,left:0}}
      headerRowCount={0} headerColCount={0} maxHeaderRowCount={0} maxHeaderColCount={0}
      onSetHeaderRowCount={() => {}} onSetHeaderColCount={() => {}} />)).toBe("");
  });
});
