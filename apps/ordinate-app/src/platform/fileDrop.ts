import { FORMATS, IMPORT_FORMATS, validateImport } from "../interchange/contracts";

export type FileDropCue = { kind: "document" | "import" | "unknown" } | { kind: "blocked"; message: string };

// Files are protected until drop in most browsers. MIME can identify an import,
// but text/plain is ambiguous (ORD and CSV), so do not guess from it.
export function fileDragCue(transfer: DataTransfer): FileDropCue {
  const files = Array.from(transfer.files);
  if (files.length) {
    try { return { kind: droppedFileKind(files) }; }
    catch (error) { return { kind: "blocked", message: error instanceof Error ? error.message : String(error) }; }
  }
  const items = Array.from(transfer.items).filter(item => item.kind === "file");
  if (items.length > 1) return { kind: "blocked", message: "Drop one file at a time." };
  return { kind: items.length === 1 && IMPORT_FORMATS.some(format => FORMATS[format].mime === items[0].type) ? "import" : "unknown" };
}

export function droppedFileKind(files: readonly File[]): "document" | "import" {
  if (files.length !== 1) throw new Error("Drop one file at a time.");
  const file = files[0];
  const kind = /\.ord$/i.test(file.name) ? "document" : "import";
  if (kind === "import") validateImport(file.name, file.size);
  else if (file.size > FORMATS.ord.maxInput) throw new Error("This file is too large to open (maximum 16 MiB).");
  return kind;
}

type FileDropActions = {
  scope: "open" | "import";
  canDrop(): boolean;
  preview(cue: FileDropCue | null): void;
  receive(file: File, kind: "document" | "import"): Promise<void>;
  report(error: unknown): Promise<void>;
};

// A local receiver owns drags within its region, even when it is temporarily
// busy. The window receiver must neither consume those drops nor publish an
// invitation behind a modal. Event paths work across portal boundaries too.
const dropReceivers = new WeakSet<EventTarget>();

// Capture only external file drags. Text editing and the grid's internal drag
// gestures keep their own handlers; files must never navigate the browser away.
export function installFileDrop(target: Window | HTMLElement, actions: FileDropActions): () => void {
  if (dropReceivers.has(target)) throw new Error("file drop receiver already installed");
  dropReceivers.add(target);
  const owns = (event: Event) => event.composedPath().find(node => dropReceivers.has(node)) === target;
  const lifecycleTarget = "ownerDocument" in target ? target.ownerDocument.defaultView! : target;
  const acceptKind = (kind: "document" | "import") => {
    if (kind === "document" && actions.scope === "import") throw new Error("Use Open for .ord documents.");
    return kind;
  };
  const previewCue = (transfer: DataTransfer): FileDropCue => {
    const next = fileDragCue(transfer);
    try {
      if (next.kind === "document" || next.kind === "import") acceptKind(next.kind);
      return next;
    } catch (error) {
      return { kind: "blocked", message: (error as Error).message };
    }
  };
  let busy = false;
  let depth = 0;
  let cue: FileDropCue | null = null;
  const publish = (next: FileDropCue | null) => {
    if (cue?.kind === next?.kind && (cue?.kind !== "blocked" || next?.kind !== "blocked" || cue.message === next.message)) return;
    cue = next;
    actions.preview(next);
  };
  const clear = () => { depth = 0; publish(null); };
  const preview = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    if (!owns(event)) { clear(); return; }
    event.preventDefault();
    const next = !busy && actions.canDrop() ? previewCue(event.dataTransfer) : null;
    publish(next);
    event.dataTransfer.dropEffect = next && next.kind !== "blocked" ? "copy" : "none";
  };
  const dragenter = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    if (!owns(event)) { clear(); return; }
    depth++;
    preview(event);
  };
  const dragleave = (event: DragEvent) => {
    if (!owns(event)) { clear(); return; }
    depth = Math.max(0, depth - 1);
    if (depth === 0) publish(null);
  };
  const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
  const dragover = (event: DragEvent) => {
    preview(event);
  };
  const drop = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    if (!owns(event)) { clear(); return; }
    const alreadyHandled = event.defaultPrevented;
    clear();
    event.preventDefault();
    event.stopPropagation();
    if (alreadyHandled || busy || !actions.canDrop()) return;
    const files = Array.from(event.dataTransfer.files);
    busy = true;
    void (async () => {
      try { await actions.receive(files[0], acceptKind(droppedFileKind(files))); }
      catch (error) { await actions.report(error); }
      finally { busy = false; }
    })();
  };
  const options = { capture: true };
  // Window and element targets share EventTarget, but their typed DOM overloads
  // differ. Narrow native drag events at this single listener boundary.
  const dragTarget: EventTarget = target;
  const listeners = Object.entries({ dragenter, dragleave, dragover, drop }).map(([name, handler]) => {
    const listener: EventListener = event => handler(event as DragEvent);
    dragTarget.addEventListener(name, listener, options);
    return { name, listener };
  });
  lifecycleTarget.addEventListener("dragend", clear, options);
  lifecycleTarget.addEventListener("blur", clear);
  lifecycleTarget.addEventListener("keydown", keydown, options);
  return () => {
    clear();
    dropReceivers.delete(target);
    for (const { name, listener } of listeners) dragTarget.removeEventListener(name, listener, options);
    lifecycleTarget.removeEventListener("dragend", clear, options);
    lifecycleTarget.removeEventListener("blur", clear);
    lifecycleTarget.removeEventListener("keydown", keydown, options);
  };
}
