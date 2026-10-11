import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MenuDivider, MenuOption, MenuSurface } from "../components/MenuSurface";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from "./reasoningEffort";
import type { AgentModel } from "./contracts";
import { preferredAgentModel } from "./modelSelection";

export function AgentModelPicker({ open, onOpenChange, models, selectedModel, selectedName, onSelectModel, effort, onEffortChange, disabled }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: readonly AgentModel[];
  selectedModel: string | null;
  selectedName: string;
  onSelectModel: (model: string) => void;
  effort: AgentReasoningEffort;
  onEffortChange: (effort: AgentReasoningEffort) => void;
  disabled: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useAnchoredMenuPosition(open, trigger, menu, setPosition, "start");

  useLayoutEffect(() => {
    if (open) (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss); };
  }, [open, onOpenChange]);

  const effortIndex = AGENT_REASONING_EFFORTS.indexOf(effort);

  return <div className="choice-control agent-model-control">
    <button ref={trigger} id={id} type="button" className="agent-model-button" aria-label="Model and reasoning effort"
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => onOpenChange(!open)}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); onOpenChange(true); }
      }}>
      <span className="agent-model-name">{selectedName}</span>
      <svg aria-hidden="true" viewBox="0 0 12 12" fill="none"><path d="m2.5 4.5 3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && createPortal(<MenuSurface open innerRef={menu} role="dialog" ariaLabel="Model and reasoning effort" triggerId={id}
      className="choice-menu choice-menu--portal agent-model-menu" style={position}>
      <div onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); onOpenChange(false); trigger.current?.focus({ preventScroll: true }); return; }
        if (!(event.target instanceof HTMLButtonElement) || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const choices = [...menu.current!.querySelectorAll<HTMLButtonElement>('.agent-model-choices button:not(:disabled)')];
        const current = choices.indexOf(event.target);
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
        choices[next]?.focus({ preventScroll: true });
      }}>
        <div className="agent-model-choices" role="radiogroup" aria-label="Model">
          {models.map(model => <MenuOption key={model.slug} type="button" role="radio"
            aria-checked={model.slug === selectedModel} active={model.slug === selectedModel}
            trailing={model.slug === preferredAgentModel(models, null) && models.length > 1 ? "Default" : undefined}
            onClick={() => { onSelectModel(model.slug); onOpenChange(false); trigger.current?.focus({ preventScroll: true }); }}>
            {model.displayName}
          </MenuOption>)}
        </div>
        <MenuDivider />
        <div className="agent-model-effort">
          <div className="agent-model-effort-heading"><label htmlFor={`${id}-effort`}>Reasoning effort</label><span>{effort}</span></div>
          <input id={`${id}-effort`} type="range" min="0" max="2" step="1" value={effortIndex}
            aria-valuetext={effort} onChange={event => onEffortChange(AGENT_REASONING_EFFORTS[Number(event.currentTarget.value)])} />
          <div className="agent-model-effort-ticks" aria-hidden="true">{AGENT_REASONING_EFFORTS.map(level => <span key={level} className={level === effort ? "is-active" : ""} />)}</div>
          <div className="agent-model-effort-labels" aria-hidden="true"><span>Low</span><span>Medium</span><span>High</span></div>
        </div>
      </div>
    </MenuSurface>, document.body)}
  </div>;
}
