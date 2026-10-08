import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MenuGroup, MenuOption, MenuSurface } from "./MenuSurface";

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
  it("reserves icon space at group level without changing labels or button semantics", () => {
    const markup = renderToStaticMarkup(<MenuGroup role="menu" ariaLabel="File" reserveIconSpace>
      <MenuOption role="menuitem" icon={<svg aria-hidden="true" />}>Open…</MenuOption>
      <MenuOption role="menuitem">Print…</MenuOption>
      <MenuOption role="menuitem" disabled>Unavailable</MenuOption>
    </MenuGroup>);
    expect(markup).toContain('data-icon-gutter="true"');
    expect(markup.match(/menu-surface-option-icon/g)).toHaveLength(1);
    expect(markup.match(/menu-surface-option-label/g)).toHaveLength(3);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('>Print…</span>');
    expect(markup).not.toContain('&nbsp;');
  });
  it("leaves iconless menus and category navigation compact unless their group opts in", () => {
    const markup = renderToStaticMarkup(<MenuGroup><MenuOption trailing="›">File</MenuOption></MenuGroup>);
    expect(markup).not.toContain('data-icon-gutter');
    expect(markup).not.toContain('menu-surface-option-icon');
    expect(markup).toContain('menu-surface-option-trailing');
  });
});
