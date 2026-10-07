import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileDropOverlay } from "./FileDropOverlay";

describe("file drop feedback", () => {
  it("has no idle overlay", () => { expect(renderToStaticMarkup(<FileDropOverlay cue={null} />)).toBe(""); });
  it.each([['document', 'Drop to open document', 'document'], ['import', 'Drop to import spreadsheet', 'import']] as const)("labels the %s route without adding focusable controls", (kind, title, route) => {
    const html = renderToStaticMarkup(<FileDropOverlay cue={{kind}} />);
    expect(html).toContain(title);
    expect(html).toContain(`data-route="${route}"`);
    expect(html.match(/data-route=/g)).toHaveLength(1);
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/<button|tabindex|role="dialog"/i);
  });
  it("explains both actions when the browser hides the filename", () => {
    const html = renderToStaticMarkup(<FileDropOverlay cue={{kind:'unknown'}} />);
    expect(html).toContain('Drop a file to open or import');
    expect(html.match(/data-route=/g)).toHaveLength(2);
  });
  it("does not invite a drop known to be invalid", () => {
    const html = renderToStaticMarkup(<FileDropOverlay cue={{kind:'blocked',message:'Drop one file at a time.'}} />);
    expect(html).toContain('Drop one file at a time.');
    expect(html).not.toContain('data-route=');
  });
});
