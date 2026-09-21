import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FillMethodMenu } from "./FillOptions";

describe("fill method menu", () => {
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
