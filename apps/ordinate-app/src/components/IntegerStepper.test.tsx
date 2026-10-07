import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IntegerStepper } from "./IntegerStepper";

const render = (value: number, maximum: number, disabled = false) => renderToStaticMarkup(
  <IntegerStepper id="count" label="Header rows" value={value} maximum={maximum} disabled={disabled} onChange={() => {}} />
);

describe("IntegerStepper", () => {
  it("places separately named decrement and increment buttons around an editable number", () => {
    const html = render(3, 20);
    expect(html).toMatch(/Decrease header rows[\s\S]*type="number"[\s\S]*Increase header rows/);
    expect(html).toContain('min="0" max="20" step="1"');
    expect(html).toContain('value="3"');
    expect(html).not.toContain('disabled=""');
  });
  it("disables decrement at zero and increment at the maximum", () => {
    expect(render(0, 3)).toContain('aria-label="Decrease header rows" disabled=""');
    expect(render(3, 3)).toContain('aria-label="Increase header rows" disabled=""');
  });
  it("disables both buttons when there are no available headers", () => {
    expect(render(0, 0).match(/disabled=""/g)).toHaveLength(2);
  });
  it("disables the input and both buttons while preparing", () => {
    expect(render(1, 3, true).match(/disabled=""/g)).toHaveLength(3);
  });
});
