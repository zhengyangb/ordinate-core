import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MenuOption, MenuSurface } from "./MenuSurface";

describe("MenuSurface interaction tree", () => {
  it("does not render a closed menu", () => {
    const markup = renderToStaticMarkup(
      <MenuSurface open={false}>
        <MenuOption>Hidden action</MenuOption>
      </MenuSurface>,
    );

    expect(markup).toBe("");
  });

  it("renders an open menu and its actions", () => {
    const markup = renderToStaticMarkup(
      <MenuSurface open>
        <MenuOption>Visible action</MenuOption>
      </MenuSurface>,
    );

    expect(markup).toContain('role="menu"');
    expect(markup).toContain("Visible action");
  });
});
