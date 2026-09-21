import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuickAddButton } from "./QuickAddButton";

describe("quick add affordance", () => {
  it.each(["row", "column"] as const)("explains both %s gestures without changing its accessible name", axis => {
    const html = renderToStaticMarkup(<QuickAddButton axis={axis} count={null} aria-label={`Add ${axis}`} />);
    expect(html).toContain(`aria-label="Add ${axis}"`);
    expect(html).toContain(`Click to add a ${axis}. Drag to add multiple ${axis}s.`);
    expect(html).toContain(axis === "row" ? "↓" : "→");
    expect(html).not.toContain('role="status"');
  });
});
