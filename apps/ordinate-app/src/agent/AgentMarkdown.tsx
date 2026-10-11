import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function webLink(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function renderableText(text: string): string {
  // Codex file citations refer to its disposable scratch workspace, not to a
  // document the user can open. Ordinate applies the validated workbook itself.
  return text.replace(/:codex-file-citation\{[^}\n]*\}/g, "[Temporary working copy; see the editor for the result]");
}

/** Assistant text is untrusted Markdown: render syntax, never raw HTML. */
export function AgentMarkdown({ text, onOpenLink }: { text: string; onOpenLink: (url: string) => void }) {
  return <div className="agent-markdown selectable-text">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      a({ href, children }) {
        const url = webLink(href);
        return url ? <a href={url} onClick={event => { event.preventDefault(); onOpenLink(url); }}>{children}</a> : <span>{children}</span>;
      },
      img({ alt }) { return <span>{alt ? `[Image: ${alt}]` : "[Image]"}</span>; },
    }}>{renderableText(text)}</ReactMarkdown>
  </div>;
}
