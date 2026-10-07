import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { SheetState, SheetNotePosition } from "@ordinate/core";
import { NoteContent } from "./NoteContent";
import { readNote, savesNote } from "./noteModel";
import { insertNoteEnter } from "./noteTextEditing";
import type { NoteEditor, NoteDraft } from "./useNoteEditor";

/** Keep pointer tracking local to the affordance, without rerendering the sheet. */
function NoteAddButton({label, onAdd}: {label: string; onAdd: () => void}) {
  const button = useRef<HTMLButtonElement>(null);
  const leaf = useRef<HTMLSpanElement>(null);
  const pointerX = useRef<number | null>(null);
  const position = () => {
    const target = button.current!, shape = leaf.current!;
    const rect = target.getBoundingClientRect();
    const limit = Math.max(0, (rect.width - shape.offsetWidth) / 2);
    const offset = pointerX.current === null ? 0 : pointerX.current - rect.left - rect.width / 2;
    target.style.setProperty('--note-pointer-offset', `${Math.max(-limit, Math.min(limit, offset))}px`);
  };
  const follow = (event: PointerEvent<HTMLButtonElement>) => {
    pointerX.current = event.pointerType === 'touch' ? null : event.clientX;
    position();
  };
  useLayoutEffect(() => {
    const resize = new ResizeObserver(position);
    resize.observe(button.current!);
    resize.observe(leaf.current!);
    return () => resize.disconnect();
  }, []);
  return <button ref={button} type="button" className="sheet-note-add" aria-label={`Add note ${label}`}
    onPointerEnter={follow} onPointerMove={follow} onPointerLeave={()=>{pointerX.current=null;}}
    onClick={onAdd}>
    <span ref={leaf} className="sheet-note-leaf" aria-hidden="true">
      <svg className="sheet-note-leaf-shape" viewBox="0 0 200 32" preserveAspectRatio="none" focusable="false">
        {/* Single-sided lip, matching the lab's selected tension of 86. */}
        <path d="M0 32 C37.8 32 14 0 42 0 H158 C186 0 162.2 32 200 32Z" />
      </svg>
      <span className="sheet-note-leaf-label">+ Add note {label}</span>
    </span>
  </button>;
}

/** The editor overlays a saved note, or a title/one-line placeholder on creation. */
function NoteEditorOverlay({ anchor, draft, title, label, creating, editor, finish }: {
  anchor: RefObject<HTMLDivElement>; draft: NoteDraft; title: string | null; label: string;
  creating: boolean;
  editor: NoteEditor; finish: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [bounds, setBounds] = useState({left:0,top:0,width:340,ready:false});

  useLayoutEffect(() => {
    const origin = anchor.current!, element = panel.current!, textarea = input.current!;
    const workspace = origin.closest<HTMLElement>(".workspace-shell")!;
    let frame = 0;
    const measure = () => {
      const rect = origin.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 340), window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      textarea.style.height = "0px";
      textarea.style.height = `${textarea.scrollHeight}px`;
      // The editor follows its note, but cannot travel into app chrome. Use
      // the workspace boundary rather than duplicating toolbar/tab heights.
      const top = Math.max(workspace.getBoundingClientRect().top + 12,
        Math.min(rect.top, window.innerHeight - element.offsetHeight - 12));
      setBounds(previous => previous.left === left && previous.top === top && previous.width === width && previous.ready
        ? previous : {left,top,width,ready:true});
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(origin); resize.observe(element);
    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame); resize.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [anchor, draft.markdown, draft.error]);

  useLayoutEffect(() => { if (bounds.ready) input.current?.focus({preventScroll:true}); }, [bounds.ready]);
  const keyDown = (event: KeyboardEvent) => {
    if (savesNote({...event,isComposing:event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229})) {
      event.preventDefault(); event.stopPropagation(); finish();
    }
  };
  return createPortal(<section ref={panel} className={`sheet-note-editor ${bounds.ready?"is-ready":""} ${creating?"is-creating":""}`} data-note-editor=""
    aria-label={`Edit note ${label}`} style={{left:bounds.left,top:bounds.top,width:bounds.width,visibility:bounds.ready?"visible":"hidden"}}
    onKeyDown={keyDown}
    onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
        if (!editor.save()) input.current?.focus({preventScroll:true});
      }
    }}>
    <div className="sheet-note-editor-surface">
      <div className="sheet-note-editor-heading">
        {title && <h2 className="sheet-note-title">{title}</h2>}
            <button type="button" className="app-modal-action primary sheet-note-done" data-surface="sheet" onClick={finish}>Done</button>
      </div>
      <textarea ref={input} rows={1} className="sheet-note-input" aria-label={`Edit note ${label}`}
        aria-invalid={!!draft.error} aria-describedby={draft.error?"sheet-note-error":undefined}
        value={draft.markdown} placeholder="Write a note…" spellCheck
        onChange={event => editor.change(event.currentTarget.value)}
        onKeyDown={event => {
          event.stopPropagation(); keyDown(event);
          if (!event.defaultPrevented && event.key === "Enter" && !event.shiftKey && !event.altKey
            && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault();
            insertNoteEnter(event.currentTarget);
          }
        }} />
      {draft.error && <p id="sheet-note-error" className="sheet-note-error" role="alert">{draft.error}</p>}
    </div>
  </section>, document.body);
}

export function SheetNote({sheet,position,editor,onBegin,onHeight}: {
  sheet:SheetState; position:SheetNotePosition; editor:NoteEditor;
  onBegin:(position:SheetNotePosition)=>void; onHeight?:(height:number)=>void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const view = readNote(sheet,position);
  const draft = editor.draft?.sheetId === sheet.sheetId && editor.draft.position === position ? editor.draft : null;
  const hasNote = !!view.markdown;
  const label = position === "beforeTable" ? "before table" : "after table";
  const title = position === "beforeTable" ? sheet.name : null;
  const finish = () => {
    if (!editor.save()) return;
    requestAnimationFrame(() => {
      // Keep the keyboard's place without selecting/revealing a note action.
      // Never steal focus from a quick re-entry or another control.
      if (!document.querySelector('[data-note-editor]') && document.activeElement === document.body) {
        root.current?.focus({preventScroll:true});
      }
    });
  };
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !onHeight) return;
    const measure = () => onHeight(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    measure(); observer.observe(element);
    return () => observer.disconnect();
  }, [onHeight]);
  return <div ref={root} className={`sheet-note-slot sheet-note-slot--${position} ${hasNote?"has-note":""} ${draft?"is-editing":""}`}
    data-note-position={position} tabIndex={-1}>
    {hasNote || draft ? <section className="sheet-note" role="group" tabIndex={draft?-1:0}
      aria-label={`Note ${label}; double-click to edit`} aria-hidden={!!draft}
      onDoubleClick={event => {event.preventDefault();onBegin(position);}}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === "F2") {event.preventDefault();event.stopPropagation();onBegin(position);}
      }}>
      {title && <h2 className="sheet-note-title">{title}</h2>}
      <div className="sheet-note-content selectable-text">
        {view.note ? <NoteContent note={view.note}/> : hasNote ? <><pre>{view.markdown}</pre><p className="sheet-note-error">{view.error}</p></> : null}
      </div>
    </section> : <NoteAddButton label={label} onAdd={()=>onBegin(position)} />}
    {draft && <NoteEditorOverlay anchor={root} draft={draft} title={title} label={label} creating={!hasNote}
      editor={editor} finish={finish} />}
  </div>;
}
