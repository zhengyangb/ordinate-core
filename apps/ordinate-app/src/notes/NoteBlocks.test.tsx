import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseSheetNote } from "@ordinate/core";
import { noteColumns } from "./noteModel";
import { NoteBlocks } from "./NoteBlocks";
import { NoteContent } from "./NoteContent";

describe("safe note rendering", () => {
  it("renders real ordered lists with their starting number, marks and horizontal rules", () => {
    const blocks=parseSheetNote('3. **First**\n4. *Second*\n\n-----\n\n+ Last').blocks;
    expect(renderToStaticMarkup(<NoteBlocks blocks={blocks}/>))
      .toBe('<ol start="3"><li><strong>First</strong></li><li><em>Second</em></li></ol><hr/><ul><li>Last</li></ul>');
  });
  it.each([String.raw`\<script\>alert(1)\</script\>`,String.raw`\<ol\>Literal\</ol\>`,String.raw`\[link\](javascript:alert(1))`])("never executes escaped markup %s", source => {
    const html=renderToStaticMarkup(<NoteBlocks blocks={noteColumns(parseSheetNote(source))[0]}/>);
    expect(html).not.toMatch(/<(script|ol|a)\b/);
    expect(html).toContain('<p>');
  });
  it("retains separators in the shared renderer for responsive presentation", () => {
    const columns=noteColumns(parseSheetNote('Left\n\n---\n\n1. Right\n\n-----'));
    expect(columns).toHaveLength(2);
    expect(renderToStaticMarkup(<NoteBlocks blocks={columns[0]}/>)).toBe('<p>Left</p>');
    expect(renderToStaticMarkup(<NoteBlocks blocks={columns[1]}/>)).toBe('<hr/><ol start="1"><li>Right</li></ol><hr/>');
  });
  it("produces identical presentation for short and long separator markers", () => {
    const render = (separator: string) => renderToStaticMarkup(<NoteContent note={parseSheetNote(`Left\n\n${separator}\n\nRight`)}/>);
    expect(render('---')).toBe(render('-----'));
  });
  it("renders unsupported editor input as inert text, not HTML", () => {
    const html = renderToStaticMarkup(<NoteContent note={parseSheetNote('<ol><li>A</li></ol>\n\n<script>alert(1)</script>', {unsupportedSyntax:'literal'})}/>);
    expect(html).toContain('&lt;ol&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<(script|ol|li)\b/);
  });
});
