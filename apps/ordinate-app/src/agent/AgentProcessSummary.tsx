import { useEffect, useId, useRef, useState } from "react";
import { AgentMarkdown } from "./AgentMarkdown";
import type { AgentProcessGroup } from "./agentConversations";

export function AgentProcessSummary({ group, onOpenLink }: { group: AgentProcessGroup; onOpenLink: (url: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const count = group.updates.length;
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !summaryRef.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [expanded]);
  return <div ref={summaryRef} className={`agent-process-summary${expanded ? " is-expanded" : ""}`} onKeyDown={event => {
    if (event.key === "Escape" && expanded) { setExpanded(false); summaryRef.current?.querySelector("button")?.focus(); }
  }}>
    <span className="agent-process-separator" aria-hidden="true">·</span>
    <button type="button" className="agent-process-toggle" aria-label={`${expanded ? "Hide" : "Show"} ${count} process ${count === 1 ? "update" : "updates"}`}
      aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}>
      <span className="agent-process-dot" aria-hidden="true" />
      <span>View process</span>
      <svg aria-hidden="true" viewBox="0 0 12 12" fill="none"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    <div id={detailsId} className="agent-process-details" role="group" aria-label="Assistant process updates">
      {group.updates.map(({ index, message }) => <div className="agent-process-update" key={index}>
        <AgentMarkdown text={message.text} onOpenLink={onOpenLink} />
      </div>)}
    </div>
  </div>;
}
