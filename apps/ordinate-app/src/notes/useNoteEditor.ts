import { useCallback, useEffect, useRef, useState } from "react";
import { parseSheetNote, serializeSheetNote, type SheetNotePosition } from "@ordinate/core";
import { useEditorStore } from "../store/editorStore";
import { readNote } from "./noteModel";

export type NoteDraft = {
  sheetId: number;
  position: SheetNotePosition;
  markdown: string;
  original: string;
  error: string | null;
};

export function useNoteEditor() {
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const current = useRef(draft);
  const update = useCallback((next: NoteDraft | null) => {
    current.current = next;
    setDraft(next);
  }, []);

  const save = useCallback(() => {
    const pending = current.current;
    if (!pending) return true;
    try {
      // Literalize unsupported Markdown at the authoring boundary, not after
      // an arbitrary failed edit. Conflicts and invalid data still fail early.
      const markdown = serializeSheetNote(parseSheetNote(pending.markdown, { unsupportedSyntax: "literal" }));
      const store = useEditorStore.getState();
      const sheet = store.docState?.sheets.find(item => item.sheetId === pending.sheetId);
      if (!sheet) throw new Error("This sheet is no longer available. Your note is still in the editor.");
      if (readNote(sheet, pending.position).markdown !== pending.original) {
        throw new Error("This note changed elsewhere. Copy your draft before reloading it.");
      }
      if (markdown !== pending.original) {
        store.applyCoreEdits(markdown ? "Edit sheet note" : "Delete sheet note", [{
          op: "set_sheet_note", sheet: sheet.name, position: pending.position, markdown,
        }]);
      }
      update(null);
      return true;
    } catch (error) {
      update({ ...pending, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }, [update]);

  const begin = useCallback((sheetId: number, position: SheetNotePosition) => {
    if (!save()) return false;
    const sheet = useEditorStore.getState().docState?.sheets.find(item => item.sheetId === sheetId);
    if (!sheet) throw new Error("Cannot edit a note without its sheet");
    const value = readNote(sheet, position);
    update({ sheetId, position, markdown: value.markdown, original: value.markdown, error: value.error });
    return true;
  }, [save, update]);

  useEffect(() => {
    if (!draft) return;
    const outside = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-note-editor]")) return;
      if (!save()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        document.querySelector<HTMLTextAreaElement>("[data-note-editor] textarea")?.focus({ preventScroll: true });
      }
    };
    // Pointerdown commits before focus/selection changes. Click also covers
    // keyboard activation and prevents navigation after a rejected draft.
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("click", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("click", outside, true);
    };
  }, [!!draft, save]);

  const prepare = useCallback(() => {
    if (!save()) throw new Error("Finish editing the sheet note before continuing.");
  }, [save]);

  return {
    draft, begin, save, prepare,
    change: (markdown: string) => {
      if (current.current) update({ ...current.current, markdown, error: null });
    },
  };
}

export type NoteEditor = ReturnType<typeof useNoteEditor>;
