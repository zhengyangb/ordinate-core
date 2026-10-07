import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SelectionRow } from "./SelectionRow";

describe("whole-row binary choice", () => {
  it.each([false, true])("uses one button with explicit selected=%s state and a stable label", selected => {
    const html = renderToStaticMarkup(<SelectionRow label="Freeze headers" description="Keep headers visible" selected={selected} onToggle={() => {}} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(`aria-pressed="${selected}"`);
    expect(html).toContain('aria-label="Freeze headers"');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain(selected ? "✓" : "+");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('role="switch"');
  });
  it("disables the whole choice during a write, not just a small control", () => {
    const html = renderToStaticMarkup(<SelectionRow label="Freeze headers" description="Keep headers visible" selected={false} disabled onToggle={() => {}} />);
    expect(html).toContain('disabled=""');
  });
});
