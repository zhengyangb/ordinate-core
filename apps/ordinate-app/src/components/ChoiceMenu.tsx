import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { MenuOption, MenuSurface } from "./MenuSurface";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import { ModalPortalContext } from "./ModalShell";

/** Shared menu surface for toolbar actions and compact option pickers. */
export function ChoiceMenu<T extends string>({ open, onOpenChange, onChoose, options, selected, label, portal = false, buttonProps }: {
  open: boolean; onOpenChange: (open: boolean) => void; onChoose: (value: T) => void;
  options: readonly { value: T; label: string; detail?: string }[]; selected?: T; label: string; portal?: boolean;
  buttonProps: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const modalPortal = useContext(ModalPortalContext);
  const generatedId = useId(), triggerId = buttonProps.id ?? generatedId;
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useAnchoredMenuPosition(open && portal, button, menu, setPosition, "start");
  useLayoutEffect(() => {
    if (open) (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !button.current?.contains(event.target) && !menu.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss); };
  }, [open, onOpenChange]);
  const popup = <MenuSurface open={open} innerRef={menu} ariaLabel={label} triggerId={triggerId} className={`choice-menu tool-menu${portal ? " choice-menu--portal" : ""}`}
    style={portal ? position : undefined}>
    <div data-escape-owner onKeyDown={event => {
      event.stopPropagation();
      const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") { event.preventDefault(); onOpenChange(false); button.current?.focus({ preventScroll: true }); }
      else if (event.key === "Tab") { if (!event.defaultPrevented) button.current?.focus({ preventScroll: true }); onOpenChange(false); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[index]?.focus({ preventScroll: true });
      }
    }}>
      {options.map(option => <MenuOption key={option.value} type="button" role={selected === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={selected === undefined ? undefined : selected === option.value} active={selected === option.value}
        tabIndex={-1} trailing={option.detail} onClick={() => {
          onOpenChange(false); button.current?.focus({ preventScroll: true }); onChoose(option.value);
        }}>{option.label}</MenuOption>)}
    </div>
  </MenuSurface>;
  return <div className="choice-control">
    <button {...buttonProps} id={triggerId} ref={button} type="button" aria-haspopup="menu" aria-expanded={open}
      onClick={() => onOpenChange(!open)} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); onOpenChange(true); }
      }} />
    {portal && open ? createPortal(popup, modalPortal?.current ?? document.body) : popup}
  </div>;
}
