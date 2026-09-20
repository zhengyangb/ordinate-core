import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import BooleanCellCapsule from "./BooleanCellCapsule";

describe("BooleanCellCapsule interaction contract", () => {
  it("exposes only the leading control as a button", () => {
    const markup = renderToStaticMarkup(
      <BooleanCellCapsule value interactive onToggle={() => undefined} />,
    );

    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('class="boolean-cell-control"');
    expect(markup).toContain('<span class="boolean-cell-capsule-label">true</span>');
    expect(markup).toMatch(/^<span class="boolean-cell-capsule/);
  });

  it("renders passive Boolean values without an interactive control", () => {
    const markup = renderToStaticMarkup(
      <BooleanCellCapsule value={false} interactive={false} />,
    );

    expect(markup).not.toContain("<button");
    expect(markup).toContain("is-passive");
    expect(markup).toContain('<span class="boolean-cell-capsule-label">false</span>');
  });
});
