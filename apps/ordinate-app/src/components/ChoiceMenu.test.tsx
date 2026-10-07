import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChoiceMenu } from "./ChoiceMenu";

const options = [{value:"one", label:"First"}, {value:"two", label:"<Other>"}] as const;
const noop = () => {};
describe("shared choice menu", () => {
  it("keeps options out of the closed control", () => {
    const html = renderToStaticMarkup(<ChoiceMenu open={false} onOpenChange={noop} onChoose={noop} options={options} label="Sheet" buttonProps={{children:"Choose"}} />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="menu"');
  });
  it("labels the menu and marks only the selected option", () => {
    const html = renderToStaticMarkup(<ChoiceMenu open onOpenChange={noop} onChoose={noop} options={options} selected="two" label="Sheet" buttonProps={{children:"Choose"}} />);
    expect(html).toContain('role="menu" aria-label="Sheet"');
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain('&lt;Other&gt;');
  });
  it("uses actions, not radio choices, for export formats", () => {
    const html = renderToStaticMarkup(<ChoiceMenu open onOpenChange={noop} onChoose={noop} options={options} label="Export format" buttonProps={{children:"Export"}} />);
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(html).not.toContain('aria-checked');
  });
});
