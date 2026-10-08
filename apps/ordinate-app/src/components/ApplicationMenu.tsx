import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MenuGroup, MenuOption, MenuSurface } from "./MenuSurface";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import "./applicationMenu.css";

export type ApplicationMenuGroup = { label: string; items: { label: string; run: () => void; disabled?: boolean; icon?: ReactNode }[] };

/** Commands are supplied by the editor, never reimplemented by the menu. */
export function ApplicationMenu({ groups }: { groups: ApplicationMenuGroup[] }) {
  const triggerId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useAnchoredMenuPosition(open, trigger, menu, setPosition, "start");
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>("[data-category]")?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [open]);
  return <>
    <button ref={trigger} id={triggerId} className="brand-menu-button" type="button" aria-label="Ordinate menu"
      aria-haspopup="menu" aria-expanded={open} onClick={() => { setActive(0); setOpen(!open); }}
      onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}>
      <span className="brand-name">ordinate</span>
    </button>
    {open && createPortal(<div onKeyDown={event => {
      event.stopPropagation();
      const category = (event.target as HTMLElement).hasAttribute("data-category");
      if (event.key === "Escape") { event.preventDefault(); close(true); }
      else if (event.key === "Tab") close(true);
      else if (event.key === "ArrowRight" && category) {
        event.preventDefault(); menu.current?.querySelector<HTMLButtonElement>("[data-command]:not(:disabled)")?.focus();
      } else if (event.key === "ArrowLeft" && !category) {
        event.preventDefault(); menu.current?.querySelectorAll<HTMLButtonElement>("[data-category]")[active]?.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>(category ? "[data-category]" : "[data-command]:not(:disabled)"));
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}><MenuSurface open innerRef={menu} className="application-menu" role="presentation" triggerId={triggerId} style={position}>
      <MenuGroup className="application-menu-categories" role="menu" ariaLabel="Ordinate">
        {groups.map((group, index) => <MenuOption key={group.label} type="button" role="menuitem" data-category
          active={active === index} aria-haspopup="menu" aria-expanded={active === index}
          onFocus={() => setActive(index)} onPointerEnter={() => setActive(index)} onClick={() => {
            setActive(index); menu.current?.querySelector<HTMLButtonElement>("[data-command]:not(:disabled)")?.focus();
          }} trailing="›">{group.label}</MenuOption>)}
      </MenuGroup>
      <MenuGroup className="application-menu-commands" role="menu" ariaLabel={groups[active].label} reserveIconSpace>
        {groups[active].items.map(item => <MenuOption key={item.label} type="button" role="menuitem" data-command disabled={item.disabled}
          icon={item.icon} onClick={() => { close(true); item.run(); }}>{item.label}</MenuOption>)}
      </MenuGroup>
    </MenuSurface></div>, document.body)}
  </>;
}
