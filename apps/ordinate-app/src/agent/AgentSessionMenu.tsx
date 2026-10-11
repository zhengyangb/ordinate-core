import { useEffect, useRef } from "react";
import { PlusIcon } from "../icons/uiIcons";
import { MenuDivider, MenuGroup, MenuHead, MenuOption, MenuSurface } from "../components/MenuSurface";
import { titleForAgentConversation, type AgentConversation } from "./agentConversations";
import type { AgentTokenUsage } from "./contracts";

const tokenNumber = new Intl.NumberFormat(undefined);

export function AgentSessionMenu({ open, onOpenChange, conversations, activeSessionId, onSelect, onNew, disabled,
  tokenUsage, usagePending, hasStartedTurn, accountEmail, debugMode }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: readonly AgentConversation[];
  activeSessionId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  disabled: boolean;
  tokenUsage: AgentTokenUsage | null;
  usagePending: boolean;
  hasStartedTurn: boolean;
  accountEmail: string | null;
  debugMode: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss); };
  }, [open, onOpenChange]);

  return <div className="agent-session-control">
    <button ref={trigger} type="button" className="agent-session-trigger" aria-label="Sessions" title="Sessions"
      aria-haspopup="menu" aria-expanded={open} onClick={() => onOpenChange(!open)}>
      <svg aria-hidden="true" viewBox="0 0 18 18" fill="none"><path d="M3.5 5.5h11M3.5 9h11M3.5 12.5h11" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
    </button>
    <MenuSurface open={open} innerRef={menu} className="agent-session-menu" ariaLabel="Assistant sessions">
      <div onKeyDown={event => {
        const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") { event.preventDefault(); onOpenChange(false); trigger.current?.focus({ preventScroll: true }); }
        else if (event.key === "Tab") onOpenChange(false);
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[index]?.focus({ preventScroll: true });
        }
      }}>
        <MenuHead className="agent-session-menu-heading">Conversations</MenuHead>
        <MenuGroup reserveIconSpace>
          <MenuOption type="button" role="menuitem" icon={<PlusIcon />} disabled={disabled} onClick={onNew}>New conversation</MenuOption>
        </MenuGroup>
        <MenuGroup className="agent-session-list" role="group" ariaLabel="Conversations" reserveIconSpace>
          {conversations.map(conversation => <MenuOption key={conversation.id} type="button" role="menuitemradio"
            aria-checked={conversation.id === activeSessionId} active={conversation.id === activeSessionId}
            disabled={disabled && conversation.id !== activeSessionId} title={titleForAgentConversation(conversation)}
            onClick={() => onSelect(conversation.id)}>{titleForAgentConversation(conversation)}</MenuOption>)}
        </MenuGroup>
        <MenuDivider />
        <div className="agent-session-usage" role="group" aria-label="Token usage" title="Cached input is included in input tokens, not added separately.">
          <div className="agent-session-usage-title">Token usage</div>
          {tokenUsage ? <>
            <div className="agent-token-primary"><span>This turn</span><strong>{tokenNumber.format(tokenUsage.turn.total)}</strong></div>
            <div className="agent-token-detail"><span>Input {tokenNumber.format(tokenUsage.turn.input)}</span><span>Output {tokenNumber.format(tokenUsage.turn.output)}</span><span className="agent-token-cached">Cached input {tokenNumber.format(tokenUsage.turn.cachedInput)}</span></div>
            <div className="agent-token-session">Conversation total {tokenNumber.format(tokenUsage.session.total)}</div>
          </> : <div className="agent-token-empty">{debugMode ? "Not measured in preview" : usagePending ? "Waiting for usage…" : hasStartedTurn ? "Not reported" : "Available after a message"}</div>}
        </div>
        {!debugMode && <div className="agent-session-account" title={accountEmail ?? undefined}>ChatGPT plan{accountEmail ? ` · ${accountEmail}` : ""}</div>}
      </div>
    </MenuSurface>
  </div>;
}
