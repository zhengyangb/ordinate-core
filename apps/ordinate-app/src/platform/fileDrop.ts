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
  canDrop(): boolean;
  preview(cue: FileDropCue | null): void;
  receive(file: File, kind: "document" | "import"): Promise<void>;
  report(error: unknown): Promise<void>;
};

// Capture only external file drags. Text editing and the grid's internal drag
// gestures keep their own handlers; files must never navigate the browser away.
export function installFileDrop(target: Window, actions: FileDropActions): () => void {
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
    event.preventDefault();
    const next = !busy && actions.canDrop() ? fileDragCue(event.dataTransfer) : null;
    publish(next);
    event.dataTransfer.dropEffect = next && next.kind !== "blocked" ? "copy" : "none";
  };
  const dragenter = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    depth++;
    preview(event);
  };
  const dragleave = () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) publish(null);
  };
  const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
  const dragover = (event: DragEvent) => {
    preview(event);
  };
  const drop = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    const alreadyHandled = event.defaultPrevented;
    clear();
    event.preventDefault();
    event.stopPropagation();
    if (alreadyHandled || busy || !actions.canDrop()) return;
    const files = Array.from(event.dataTransfer.files);
    busy = true;
    void (async () => {
      try { await actions.receive(files[0], droppedFileKind(files)); }
      catch (error) { await actions.report(error); }
      finally { busy = false; }
    })();
  };
  const options = { capture: true };
  target.addEventListener("dragenter", dragenter, options);
  target.addEventListener("dragleave", dragleave, options);
  target.addEventListener("dragover", dragover, options);
  target.addEventListener("drop", drop, options);
  target.addEventListener("dragend", clear, options);
  target.addEventListener("blur", clear);
  target.addEventListener("keydown", keydown, options);
  return () => {
    clear();
    target.removeEventListener("dragenter", dragenter, options);
    target.removeEventListener("dragleave", dragleave, options);
    target.removeEventListener("dragover", dragover, options);
    target.removeEventListener("drop", drop, options);
    target.removeEventListener("dragend", clear, options);
    target.removeEventListener("blur", clear);
    target.removeEventListener("keydown", keydown, options);
  };
}
