import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { CoreFillMode } from "@ordinate/core";
import { MenuOption, MenuSurface } from "../components/MenuSurface";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import type { FillHandleController } from "./useFillHandle";
import type { FillRowOptions } from "./fillRows";

const labels: Record<CoreFillMode, string> = { auto: "Auto fill", copy: "Copy cells", series: "Fill series" };
const modes: CoreFillMode[] = ["auto", "copy", "series"];
const rowLabels: Record<keyof FillRowOptions, string> = { collapsed: "Include collapsed rows", parents: "Include parent rows" };
const Check = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>;

export function FillMethodMenu({ mode, canSeries, onSelect, innerRef, style, rowOptions = [] }: {
  mode: CoreFillMode; canSeries: boolean; onSelect: (mode: CoreFillMode) => void;
  innerRef?: RefObject<HTMLDivElement>; style?: CSSProperties;
  rowOptions?: { key: keyof FillRowOptions; included: boolean; onChange: (included: boolean) => void }[];
}) {
  return <MenuSurface open className="fill-method-menu" innerRef={innerRef} style={style}>
    {modes.map(value => <MenuOption key={value} type="button" role="menuitemradio" aria-checked={mode === value}
      active={mode === value} disabled={value === "series" && !canSeries} tabIndex={mode === value ? 0 : -1}
      trailing={<span className="fill-method-check">{mode === value ? <Check /> : null}</span>}
      title={value === "series" && !canSeries ? "Select numbers, dates or numbered text with a consistent interval" : undefined}
      onClick={() => onSelect(value)}>{labels[value]}</MenuOption>)}
    {rowOptions.map(option => <MenuOption key={option.key} type="button" role="menuitemcheckbox" aria-checked={option.included}
      tabIndex={-1} trailing={<span className="fill-method-check">{option.included ? <Check /> : null}</span>}
      onClick={() => option.onChange(!option.included)}>{rowLabels[option.key]}</MenuOption>)}
  </MenuSurface>;
}

function FillOptionsPopover({ fill }: { fill: FillHandleController }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: fill.result?.x ?? 24, top: fill.result?.y ?? 80 });
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useAnchoredMenuPosition(Boolean(fill.result), fill.handleRef, rootRef, setPosition, "end");
  useAnchoredMenuPosition(open, rootRef, menuRef, setMenuPosition, "end");

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const closeMenu = () => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); };
  return <div ref={rootRef} className="fill-options" role="group" aria-label="Fill options" data-escape-owner
    style={fill.result ? position : { right: 24, bottom: 80 }}
    onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); if (open) closeMenu(); else fill.dismiss(); return; }
      if (!open) return;
      if (event.key === "Tab") { closeMenu(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus({ preventScroll: true });
    }}>
    {fill.error ? <span role="alert" className="fill-options-error">{fill.error}</span> : null}
    {fill.result ? <>
      <button ref={triggerRef} type="button" className="fill-method-trigger" aria-label="Fill method" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
        onClick={() => setOpen(value => !value)} onKeyDown={event => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); event.stopPropagation(); setOpen(true); }
        }}>
        <span>{labels[fill.result.mode]}</span>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {open ? createPortal(<div id={menuId} data-escape-owner><FillMethodMenu mode={fill.result.mode} canSeries={fill.result.canSeries} innerRef={menuRef} style={menuPosition}
        rowOptions={(Object.keys(rowLabels) as (keyof FillRowOptions)[]).filter(key => fill.result!.rowGroups[key].length > 0)
          .map(key => ({ key, included: fill.result!.rowOptions[key], onChange: include => { fill.changeRowOption(key, include); closeMenu(); } }))}
        onSelect={mode => { if (mode !== fill.result!.mode) fill.changeMode(mode); closeMenu(); }} /></div>, document.body) : null}
    </> : null}
    <button type="button" className="fill-options-dismiss" aria-label="Dismiss fill options" onClick={fill.dismiss}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
    </button>
  </div>;
}

export function FillOptions({ fill }: { fill: FillHandleController }) {
  if (!fill.result && !fill.error) return null;
  return createPortal(<FillOptionsPopover fill={fill} />, document.body);
}
