import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FillMethodMenu } from "./FillOptions";

describe("fill method menu", () => {
  it("renders independent parent and collapsed row options", () => {
    const html = renderToStaticMarkup(<FillMethodMenu mode="auto" canSeries onSelect={() => {}}
      rowOptions={[{ key: "parents", included: false, onChange: () => {} }, { key: "collapsed", included: true, onChange: () => {} }]} />);
    expect(html.match(/role="menuitemcheckbox"/g)).toHaveLength(2);
    expect(html).toContain("Include parent rows");
    expect(html).toContain("Include collapsed rows");
  });
  it("only offers collapsed rows when relevant, using the shared checkbox menu item", () => {
    const render = (included: boolean) => renderToStaticMarkup(<FillMethodMenu mode="auto" canSeries onSelect={() => {}}
      rowOptions={[{ key: "collapsed", included, onChange: () => {} }]} />);
    expect(render(true)).toContain('role="menuitemcheckbox" aria-checked="true"');
    expect(render(false)).toContain('role="menuitemcheckbox" aria-checked="false"');
    expect(render(true)).toContain("Include collapsed rows");
    expect(renderToStaticMarkup(<FillMethodMenu mode="auto" canSeries onSelect={() => {}} />)).not.toContain("Include collapsed rows");
  });
  it("uses shared menu surfaces instead of an OS select", () => {
    const html = renderToStaticMarkup(<FillMethodMenu mode="copy" canSeries onSelect={() => {}} />);
    expect(html).toContain("menu-surface fill-method-menu");
    expect(html).not.toContain("<select");
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(3);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?Copy cells/);
  });
  it("keeps unsupported series unavailable and explains why", () => {
    const html = renderToStaticMarkup(<FillMethodMenu mode="auto" canSeries={false} onSelect={() => {}} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain("consistent interval");
    expect(html).toContain("Fill series");
  });
});
