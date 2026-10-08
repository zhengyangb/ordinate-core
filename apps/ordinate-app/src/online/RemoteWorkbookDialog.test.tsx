import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RemoteWorkbookContent } from "./RemoteWorkbookDialog";
import { remoteWorkbook } from "./remoteWorkbook";

const noop = () => {};
const props = { remote: null, value: "", busy: false, error: null, onChange: noop, onClose: noop, onOpen: noop, titleId: "open-url" };
describe("open link dialog", () => {
  it.each(["https://models.example/download?id=123", "https://models.example/plan.txt"])("warns about an unknown suffix without disabling opening: %s", value => {
    for (const remote of [null, remoteWorkbook(value, "https://ordinate.example")]) {
      const html = renderToStaticMarkup(<RemoteWorkbookContent {...props} remote={remote} value={value} />);
      expect(html).toContain("This may not be an Ordinate workbook.");
      expect(html).not.toContain('disabled=""');
    }
  });
  it("uses the shared modal controls with a labelled URL input and concise copy", () => {
    const html = renderToStaticMarkup(<RemoteWorkbookContent {...props} />);
    expect(html).toContain('for="open-url-url"');
    expect(html).toContain('type="url"');
    expect(html).toContain("local copy");
    expect(html).toContain('class="app-modal-action primary" disabled=""');
    expect(html).not.toMatch(/checkbox|wizard|Preparing/);
  });
  it("shows a launch as a workbook confirmation, never an editable-looking field", () => {
    const remote = remoteWorkbook("https://models.example/Plan.ord", "https://ordinate.example");
    const html = renderToStaticMarkup(<RemoteWorkbookContent {...props} remote={remote} value={remote.url} />);
    expect(html).toContain("Open from URL</h2>");
    expect(html).toContain(remote.url);
    expect(html).toContain("Only open files from sources you trust.");
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('remote-workbook-format-warning');
  });
  it("disables Open during fetch without changing its text or removing the error region", () => {
    const html = renderToStaticMarkup(<RemoteWorkbookContent {...props} value="https://models.example/Plan.ord" busy />);
    expect(html).toContain('disabled="">Open</button>');
    expect(html).toContain('class="remote-workbook-error" role="alert"');
    expect(html).toContain('>Cancel</button>');
    expect(html).not.toMatch(/Opening|Loading|Preparing/);
  });
  it("escapes server error text rather than injecting markup", () => {
    const html = renderToStaticMarkup(<RemoteWorkbookContent {...props} error="<img src=x onerror=alert(1)>" />);
    expect(html).toContain("&lt;img"); expect(html).not.toContain("<img");
  });
  it("shows the complete URL with its actual host and encoded path", () => {
    const remote = remoteWorkbook("https://untrusted.example/trusted.example/%3Cb%3E.ord?long=1", "https://ordinate.example");
    const html = renderToStaticMarkup(<RemoteWorkbookContent {...props} remote={remote} value={remote.url} />);
    expect(html).toContain(remote.url);
    expect(html).not.toContain('<b>');
  });
  it("keeps Open disabled and the fixed error region during confirmation fetch", () => {
    const remote = remoteWorkbook("https://models.example/Plan.ord", "https://ordinate.example");
    const html = renderToStaticMarkup(<RemoteWorkbookContent {...props} remote={remote} value={remote.url} busy />);
    expect(html).toContain('disabled="">Open</button>');
    expect(html).toContain('class="remote-workbook-error" role="alert"');
    expect(html).not.toContain('<input');
  });
});
