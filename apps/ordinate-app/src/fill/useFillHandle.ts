import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { planFillRegion, type CoreFillMode, type SheetState } from "@ordinate/core";
import { useEditorStore } from "../store/editorStore";
import { resolveCoreRegionTarget } from "../utils/coreTargets";
import type { LogicalCell, Rect } from "../types/ui";
import { fillDestination, fillDirection, isFillRange, unionFill } from "./fillGeometry";
import { queryGridBodyViewport, queryGridHorizontalViewport } from "../utils/appHelpers";
import { isFillSessionCurrent, type FillSessionSnapshot } from "./fillSession";
import { defaultFillRowOptions, excludedFillRows, resolveFillRowGroups, type FillRowGroups, type FillRowOptions } from "./fillRows";

type Options = {
  enabled: boolean; sheet: SheetState | null; selection: Rect | null; visibleRows: ReadonlySet<number>;
  gridRef: RefObject<HTMLDivElement>; resolvePoint: (x: number, y: number) => LogicalCell | null;
  select: (rect: Rect) => void;
};
type Drag = FillSessionSnapshot & { pointerId: number; source: Rect; target: Rect | null; x: number; y: number; moved: boolean; startX: number; startY: number };
type Result = FillSessionSnapshot & { source: Rect; target: Rect; mode: CoreFillMode; canSeries: boolean; x: number; y: number; rowGroups: FillRowGroups; rowOptions: FillRowOptions; historyId?: number };
type Feedback = FillSessionSnapshot & { id: number; target: Rect; direction: ReturnType<typeof fillDirection> };
const coreRect = (rect: Rect) => ({ ...rect, rowStart: rect.rowStart - 1, rowEnd: rect.rowEnd - 1 });
const region = (sheet: SheetState, rect: Rect) => resolveCoreRegionTarget(sheet,
  { rAbs: rect.rowStart, cAbs: rect.colStart }, { rAbs: rect.rowEnd, cAbs: rect.colEnd });

export function useFillHandle(options: Options) {
  const documentState = useEditorStore(state => state.docState);
  const [preview, setPreview] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackId = useRef(0);
  const drag = useRef<Drag | null>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const latest = useRef(options);
  latest.current = options;
  const { enabled, sheet, selection, visibleRows } = options;
  const available = Boolean(enabled && sheet && selection && isFillRange(selection, sheet.bodyStart, sheet.headerColCount, sheet.rowCount, sheet.colCount));
  const selectionKey = JSON.stringify(selection);
  const visibilityKey = JSON.stringify([...visibleRows].sort((a, b) => a - b));

  const cancel = () => { drag.current = null; setPreview(null); setDragging(false); };
  const commit = (snapshot: FillSessionSnapshot, source: Rect, target: Rect, mode: CoreFillMode, x: number, y: number, previous?: Result, rowOptions = defaultFillRowOptions) => {
    const current = latest.current;
    const currentSheet = current.sheet;
    if (!isFillSessionCurrent(snapshot, useEditorStore.getState()) || !current.enabled || !currentSheet || !isFillRange(unionFill(source, target), currentSheet.bodyStart, currentSheet.headerColCount, currentSheet.rowCount, currentSheet.colCount)) return;
    try {
      const union = unionFill(source, target);
      const rowGroups = previous?.rowGroups ?? resolveFillRowGroups(currentSheet, union, current.visibleRows);
      const excludedRows = excludedFillRows(rowGroups, rowOptions);
      const plan = planFillRegion(currentSheet, coreRect(source), coreRect(target), mode, excludedRows);
      const before = useEditorStore.getState();
      before.applyCoreEdits("Fill cells", [{ op: "fill_region", source: region(currentSheet, source), target: region(currentSheet, target), mode,
        excludedRowIds: excludedRows.map(row => currentSheet.rowIds[row]) }], undefined, previous?.historyId);
      const nextDocument = useEditorStore.getState().docState!;
      if (nextDocument !== snapshot.document) {
        setFeedback({ id: ++feedbackId.current, document: nextDocument, sheet: currentSheet.name, target, direction: fillDirection(source, target) });
      }
      current.select(unionFill(source, target));
      const after = useEditorStore.getState();
      const historyId = previous?.historyId ?? (after.historyCursor > before.historyCursor ? after.history[after.historyCursor - 1].id : undefined);
      setResult({ document: nextDocument, sheet: currentSheet.name, source, target, mode, canSeries: plan.canSeries, x, y, rowGroups, rowOptions, historyId });
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => { cancel(); setResult(null); }, [visibilityKey]);

  useEffect(() => {
    // Includes undo, edits, external reloads, mode changes, and switching sheets.
    if (drag.current && (drag.current.document !== documentState || drag.current.sheet !== sheet?.name || !enabled)) cancel();
    setResult(current => current && current.document === documentState && current.sheet === sheet?.name && enabled ? current : null);
    setFeedback(current => current && current.document === documentState && current.sheet === sheet?.name && enabled ? current : null);
  }, [documentState, enabled, sheet?.name]);
  useEffect(() => {
    if (drag.current && JSON.stringify(drag.current.source) !== selectionKey) cancel();
    setResult(current => current && JSON.stringify(unionFill(current.source, current.target)) === selectionKey ? current : null);
    setError(null);
  }, [selectionKey, sheet?.name]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const session = drag.current;
      if (!session) { frame = 0; return; }
      const current = latest.current;
      const root = current.gridRef.current;
      if (!root || !current.sheet || !current.enabled || !isFillSessionCurrent(session, useEditorStore.getState())) { cancel(); frame = 0; return; }
      const vertical = queryGridBodyViewport(root);
      const horizontal = queryGridHorizontalViewport(root);
      const bounds = vertical?.getBoundingClientRect();
      const center = root.querySelector<HTMLElement>(".ag-center-cols-viewport")?.getBoundingClientRect();
      const velocity = (p: number, low: number, high: number) => p < low + 24 ? -Math.min(16, Math.ceil((low + 24 - p) / 2)) : p > high - 24 ? Math.min(16, Math.ceil((p - high + 24) / 2)) : 0;
      if (session.moved && bounds) {
        if (vertical) vertical.scrollTop += velocity(session.y, bounds.top, bounds.bottom);
        if (horizontal && center) horizontal.scrollLeft += velocity(session.x, center.left, center.right);
        const point = current.resolvePoint(Math.max(bounds.left + 2, Math.min(bounds.right - 3, session.x)), Math.max(bounds.top + 2, Math.min(bounds.bottom - 3, session.y)));
        const target = point ? fillDestination(session.source, point) : null;
        session.target = target && isFillRange(unionFill(session.source, target), current.sheet.bodyStart, current.sheet.headerColCount, current.sheet.rowCount, current.sheet.colCount) ? target : null;
        setPreview(previous => JSON.stringify(previous) === JSON.stringify(session.target) ? previous : session.target);
      }
      frame = requestAnimationFrame(tick);
    };
    const move = (event: globalThis.PointerEvent) => {
      const session = drag.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if ((event.buttons & 1) === 0) { cancel(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      session.x = event.clientX; session.y = event.clientY;
      session.moved ||= Math.hypot(session.x - session.startX, session.y - session.startY) > 4;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const up = (event: globalThis.PointerEvent) => {
      const session = drag.current;
      if (!session || session.pointerId !== event.pointerId) return;
      // Let the existing grid gesture controller observe release and clear its own state.
      event.preventDefault();
      // Resolve the final pointer position too, even if release beats the next animation frame.
      const point = latest.current.resolvePoint(event.clientX, event.clientY);
      if (session.moved && point) session.target = fillDestination(session.source, point);
      cancel();
      if (session.target) commitRef.current(session, session.source, session.target, "auto", event.clientX, event.clientY);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault(); event.stopImmediatePropagation(); cancel();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape, true);
    return () => {
      cancelAnimationFrame(frame); drag.current = null;
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape, true);
    };
  }, []);

  return {
    feedback: feedback?.document === documentState && feedback.sheet === sheet?.name && enabled ? feedback : null,
    finishFeedback: (id: number) => setFeedback(current => current?.id === id ? null : current),
    available, preview, dragging, handleRef, result: result?.document === documentState && result.sheet === sheet?.name ? result : null, error,
    dismiss: () => { setResult(null); setError(null); },
    changeMode: (mode: CoreFillMode) => {
      if (result) commit(result, result.source, result.target, mode, result.x, result.y, result, result.rowOptions);
    },
    changeRowOption: (key: keyof FillRowOptions, include: boolean) => {
      if (result) commit(result, result.source, result.target, result.mode, result.x, result.y, result, { ...result.rowOptions, [key]: include });
    },
    start: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !available || !selection || !documentState || !sheet) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      setResult(null); setError(null);
      setFeedback(null);
      setDragging(true);
      drag.current = { pointerId: event.pointerId, document: documentState, sheet: sheet.name, source: selection, target: null, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    },
    keyboard: (key: string, x: number, y: number) => {
      if (!available || !selection || !sheet || !documentState) return;
      const point = { rAbs: selection.rowEnd, cAbs: selection.colEnd };
      if (key === "ArrowDown") point.rAbs++;
      else if (key === "ArrowUp") point.rAbs = selection.rowStart - 1;
      else if (key === "ArrowRight") point.cAbs++;
      else if (key === "ArrowLeft") point.cAbs = selection.colStart - 1;
      else return;
      if (point.cAbs >= sheet.colCount) return;
      const target = fillDestination(selection, point);
      if (target) commit({ document: documentState, sheet: sheet.name }, selection, target, "auto", x, y);
    },
  };
}

export type FillHandleController = ReturnType<typeof useFillHandle>;
