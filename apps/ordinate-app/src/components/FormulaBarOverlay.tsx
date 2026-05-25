import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { UiLocale } from "../i18n/messages";
import {
  classifyDisplayMetadataIssue,
  formatDisplayMetadataErrorMessage,
  getDisplayMetadataErrorLabel,
} from "../i18n/displayMetadata";
import { FormatPreviewPanel, StylePreviewPanel } from "./DisplayMetadataPreview";
import type { ChromeVisibilityPhase, FormatLocalKey, FormulaBarData, StyleLocalView } from "../types/ui";
import { selectionDebugLog } from "../utils/selectionDebug";
import {
  applyFormulaPointPickToState,
  applyFormulaReferencePick,
  findReferenceTokenForSelection,
  syncFormulaPointSelectionState,
  tokenizeFormulaReferences,
  type FormulaPointGestureReplacement,
  type FormulaPointReplacementTarget,
  type FormulaReferenceView,
} from "../utils/formulaPointMode";

function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function FormatGlyph({ warning = false }: { warning?: boolean }) {
  return (
    <MenuIcon>
      <path d="M3.8 5.4h12.4M3.8 10h12.4M3.8 14.6h12.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <circle cx="7.1" cy="5.4" r="1.35" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12.7" cy="10" r="1.35" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="9.3" cy="14.6" r="1.35" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {warning ? (
        <g className="menu-icon-warning-badge">
          <path className="menu-icon-warning-triangle" d="M17.15 14.75 21.05 20.95h-7.8z" />
          <path className="menu-icon-warning-mark" d="M17.15 16.6v2.22" />
          <circle className="menu-icon-warning-dot" cx="17.15" cy="19.55" r="0.36" />
        </g>
      ) : null}
    </MenuIcon>
  );
}

function StyleGlyph({ warning = false }: { warning?: boolean }) {
  return (
    <MenuIcon>
      <path d="M6.2 14.1 9.8 5.8l3.9 8.3M7.3 11.7h5.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
      <path d="M5.6 16.2h8.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" opacity="0.92" />
      {warning ? (
        <g className="menu-icon-warning-badge">
          <path className="menu-icon-warning-triangle" d="M17.15 14.75 21.05 20.95h-7.8z" />
          <path className="menu-icon-warning-mark" d="M17.15 16.6v2.22" />
          <circle className="menu-icon-warning-dot" cx="17.15" cy="19.55" r="0.36" />
        </g>
      ) : null}
    </MenuIcon>
  );
}

function BannerWarningGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 2.4 18 16.2a1 1 0 0 1-.87 1.4H2.87A1 1 0 0 1 2 16.2L10 2.4z" fill="currentColor" />
      <path d="M10 7.1v5.2M10 14.9h.01" fill="none" stroke="var(--sheet-surface)" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function getEditableSelectionOffsets(editor: HTMLTextAreaElement): { start: number; end: number } {
  return {
    start: editor.selectionStart,
    end: editor.selectionEnd,
  };
}

function setEditableSelectionOffsets(editor: HTMLTextAreaElement, start: number, end: number) {
  const textLength = editor.value.length;
  const targetStart = Math.max(0, Math.min(start, textLength));
  const targetEnd = Math.max(0, Math.min(end, textLength));
  editor.setSelectionRange(targetStart, targetEnd);
}

function measureTextareaTextWidth(editor: HTMLTextAreaElement, text: string): number {
  const style = window.getComputedStyle(editor);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Formula editor requires canvas text measurement.");
  context.font = style.font;
  return context.measureText(text).width;
}

function ensureTextareaOffsetVisible(editor: HTMLTextAreaElement, offset: number) {
  const style = window.getComputedStyle(editor);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const guard = 12;
  const textWidth = measureTextareaTextWidth(editor, editor.value.slice(0, Math.max(0, Math.min(offset, editor.value.length))));
  const caretX = paddingLeft + textWidth;
  const visibleLeft = editor.scrollLeft + paddingLeft + guard;
  const visibleRight = editor.scrollLeft + editor.clientWidth - paddingRight - guard;

  if (caretX > visibleRight) {
    editor.scrollLeft = Math.max(0, caretX - editor.clientWidth + paddingRight + guard);
    return;
  }
  if (caretX < visibleLeft) {
    editor.scrollLeft = Math.max(0, caretX - paddingLeft - guard);
  }
}

function renderFormulaDraftWithTokens(
  draft: string,
  referenceViews: FormulaReferenceView[],
  activeReferenceTokenId: string | null,
  onTokenPointerDown: (tokenId: string) => void,
) {
  if (draft.length === 0) {
    return null;
  }
  const viewsById = new Map(referenceViews.map((view) => [view.id, view]));
  const tokens = tokenizeFormulaReferences(draft);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((token) => {
    if (cursor < token.start) {
      nodes.push(<span key={`text-${cursor}`}>{draft.slice(cursor, token.start)}</span>);
    }
    const view = viewsById.get(token.id);
    nodes.push(
      <span
        key={token.id}
        className={token.id === activeReferenceTokenId ? "formula-reference-token is-active" : "formula-reference-token"}
        data-token-id={token.id}
        data-color-index={view?.colorIndex ?? 0}
        contentEditable={false}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onTokenPointerDown(token.id);
        }}
        onMouseUp={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {token.text}
      </span>,
    );
    cursor = token.end;
  });
  if (cursor < draft.length) {
    nodes.push(<span key={`text-${cursor}`}>{draft.slice(cursor)}</span>);
  }
  return nodes;
}

type FormulaBarOverlayProps = {
  locale: UiLocale;
  mode: "table" | "source";
  phase: ChromeVisibilityPhase;
  formulaBarSnapshot: FormulaBarData | null;
  inputMode: "read" | "edit";
  isInputEditable: boolean;
  areDisplayControlsEditable: boolean;
  onRequestEdit: () => void;
  onCancelEdit: () => void;
  onCommitInput: (nextInput: string) => void;
  onDraftInputChange: (nextInput: string) => void;
  pointReferenceRequest: { id: number; gestureId: number; text: string } | null;
  referenceViews: FormulaReferenceView[];
  activeReferenceTokenId: string | null;
  onActiveReferenceTokenChange: (tokenId: string | null) => void;
  onCancelPointPick: () => void;
  canApplyToSelection: boolean;
  onApplyToSelection: (nextInput: string) => void;
  onSetLocalFormat: (key: FormatLocalKey, options: FormulaBarData["formatLocalOptions"]) => void;
  onSetLocalStyle: <Axis extends keyof StyleLocalView>(axis: Axis, value: StyleLocalView[Axis]) => void;
  onDismiss: () => void;
  onTooltipEnter: (text: string, target: HTMLElement, delayMs?: number) => void;
  onTooltipLeave: () => void;
  onTooltipSuppress: (target: HTMLElement) => void;
  onTooltipRelease: (target: HTMLElement) => void;
};

export default function FormulaBarOverlay({
  locale,
  mode,
  phase,
  formulaBarSnapshot,
  inputMode,
  isInputEditable,
  areDisplayControlsEditable,
  onRequestEdit,
  onCancelEdit,
  onCommitInput,
  onDraftInputChange,
  pointReferenceRequest,
  referenceViews,
  activeReferenceTokenId,
  onActiveReferenceTokenChange,
  onCancelPointPick,
  canApplyToSelection,
  onApplyToSelection,
  onSetLocalFormat,
  onSetLocalStyle,
  onDismiss,
  onTooltipEnter,
  onTooltipLeave,
  onTooltipSuppress,
  onTooltipRelease,
}: FormulaBarOverlayProps) {
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [menuPanelKey, setMenuPanelKey] = useState<FormatLocalKey>("auto");
  const [formatMenuPosition, setFormatMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const formatButtonRef = useRef<HTMLButtonElement | null>(null);
  const formatMenuRef = useRef<HTMLDivElement | null>(null);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [styleMenuPosition, setStyleMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const styleButtonRef = useRef<HTMLButtonElement | null>(null);
  const styleMenuRef = useRef<HTMLDivElement | null>(null);
  const referenceMenuRef = useRef<HTMLDivElement | null>(null);
  const [draftInput, setDraftInput] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isComposingInput, setIsComposingInput] = useState(false);
  const [referencePopoverCaretLeft, setReferencePopoverCaretLeft] = useState<number | null>(null);
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const sourcePlainInputRef = useRef<HTMLInputElement | null>(null);
  const tokenBackdropRef = useRef<HTMLDivElement | null>(null);
  const appliedPointReferenceRequestIdRef = useRef<number | null>(null);
  const pointGestureReplacementRef = useRef<FormulaPointGestureReplacement | null>(null);
  const pointTokenReplacementRef = useRef<FormulaPointReplacementTarget | null>(null);
  const syncedActiveReferenceTokenIdRef = useRef<string | null>(null);
  const draftInputRef = useRef(draftInput);
  const referenceViewsRef = useRef(referenceViews);
  const activeReferenceViewRef = useRef<FormulaReferenceView | null>(null);
  const explicitReferenceViewRef = useRef<FormulaReferenceView | null>(null);
  const editSessionAddressRef = useRef<string | null>(null);
  const focusEditorAt = (start: number, end = start) => {
    const editor = sourceEditorRef.current;
    if (!editor) return;
    editor.focus();
    setEditableSelectionOffsets(editor, start, end);
    ensureTextareaOffsetVisible(editor, end);
    syncEditorBackdropScroll();
    window.requestAnimationFrame(() => {
      const nextEditor = sourceEditorRef.current;
      if (!nextEditor) return;
      nextEditor.focus();
      setEditableSelectionOffsets(nextEditor, start, end);
      ensureTextareaOffsetVisible(nextEditor, end);
      syncEditorBackdropScroll();
    });
  };
  const syncEditorBackdropScroll = () => {
    const editor = sourceEditorRef.current;
    const backdrop = tokenBackdropRef.current;
    if (!editor || !backdrop) return;
    backdrop.scrollLeft = editor.scrollLeft;
  };
  const isEditingInput = inputMode === "edit";
  const isFormulaDraft = draftInput.trimStart().startsWith("=");
  const activeReferenceView = useMemo(
    () => referenceViews.find((view) => view.id === activeReferenceTokenId) ?? null,
    [activeReferenceTokenId, referenceViews],
  );
  const referenceOptionGroups = useMemo(() => {
    if (!activeReferenceView) return [];
    return [
      {
        key: "legacy",
        label: "Legacy A1",
        options: activeReferenceView.options.filter((option) => option.style === "spreadsheet-a1"),
      },
      {
        key: "alternate",
        label: "Ordinate styles",
        options: activeReferenceView.options.filter((option) => option.style !== "spreadsheet-a1"),
      },
    ].filter((group) => group.options.length > 0);
  }, [activeReferenceView]);

  useEffect(() => {
    draftInputRef.current = draftInput;
    referenceViewsRef.current = referenceViews;
    activeReferenceViewRef.current = activeReferenceView;
  }, [activeReferenceView, draftInput, referenceViews]);

  useEffect(() => {
    if (areDisplayControlsEditable) return;
    setFormatMenuOpen(false);
    setStyleMenuOpen(false);
  }, [areDisplayControlsEditable]);

  const localFormatKey = formulaBarSnapshot?.formatLocalKey ?? "auto";
  const localFormatOptions = formulaBarSnapshot?.formatLocalOptions ?? null;
  const chipText = formulaBarSnapshot?.chip ?? "";
  const localStyle: StyleLocalView = formulaBarSnapshot?.styleLocal ?? {
    align: "auto",
    weight: "auto",
    color: "auto",
  };
  const hasCellFormatOverride = localFormatKey !== "auto";
  const hasCellStyleOverride =
    localStyle.align !== "auto" || localStyle.weight !== "auto" || localStyle.color !== "auto";
  const displayErrors = formulaBarSnapshot?.displayErrors ?? [];
  const formatErrors = displayErrors.filter((issue) => classifyDisplayMetadataIssue(issue) !== "style");
  const styleErrors = displayErrors.filter((issue) => classifyDisplayMetadataIssue(issue) !== "format");
  const hasFormatDisplayError = formatErrors.length > 0;
  const hasStyleDisplayError = styleErrors.length > 0;

  useEffect(() => {
    if (!formulaBarSnapshot) {
      setDraftInput("");
      onDraftInputChange("");
      setDraftError(null);
      onActiveReferenceTokenChange(null);
      setIsComposingInput(false);
      appliedPointReferenceRequestIdRef.current = null;
      pointGestureReplacementRef.current = null;
      pointTokenReplacementRef.current = null;
      syncedActiveReferenceTokenIdRef.current = null;
      explicitReferenceViewRef.current = null;
      editSessionAddressRef.current = null;
      return;
    }
    if (isEditingInput) {
      if (editSessionAddressRef.current == null) {
        editSessionAddressRef.current = formulaBarSnapshot.primaryAddress;
      } else if (editSessionAddressRef.current !== formulaBarSnapshot.primaryAddress) {
        return;
      }
    } else {
      editSessionAddressRef.current = null;
    }
    setDraftInput(formulaBarSnapshot.inputText);
    onDraftInputChange(formulaBarSnapshot.inputText);
    setDraftError(null);
    onActiveReferenceTokenChange(null);
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    setIsComposingInput(false);
    appliedPointReferenceRequestIdRef.current = null;
    syncedActiveReferenceTokenIdRef.current = null;
    explicitReferenceViewRef.current = null;
  }, [formulaBarSnapshot?.primaryAddress, formulaBarSnapshot?.inputText, isEditingInput, onActiveReferenceTokenChange, onDraftInputChange]);

  useEffect(() => {
    if (!pointReferenceRequest || !isEditingInput) return;
    if (appliedPointReferenceRequestIdRef.current === pointReferenceRequest.id) return;
    appliedPointReferenceRequestIdRef.current = pointReferenceRequest.id;
    if (!draftInput.trimStart().startsWith("=")) return;
    const editor = sourceEditorRef.current;
    const editorSelection = editor
      ? getEditableSelectionOffsets(editor)
      : { start: draftInput.length, end: draftInput.length };
    let application;
    try {
      application = applyFormulaPointPickToState(
        {
          draft: draftInput,
          selectionStart: editorSelection.start,
          selectionEnd: editorSelection.end,
          activeTokenId: activeReferenceTokenId,
          armedToken: pointTokenReplacementRef.current,
          gestureReplacement: pointGestureReplacementRef.current,
        },
        pointReferenceRequest.text,
        pointReferenceRequest.gestureId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDraftError(message);
      selectionDebugLog("formula point reference rejected", {
        text: pointReferenceRequest.text,
        message,
      });
      return;
    }
    const { edit, nextState } = application;
    pointGestureReplacementRef.current = nextState.gestureReplacement;
    setDraftError(null);
    setDraftInput(edit.nextDraft);
    onDraftInputChange(edit.nextDraft);
    selectionDebugLog("formula point reference applied", {
      gestureId: pointReferenceRequest.gestureId,
      text: pointReferenceRequest.text,
      nextDraft: edit.nextDraft,
      selectionStart: edit.selectionStart,
      selectionEnd: edit.selectionEnd,
    });
    syncedActiveReferenceTokenIdRef.current = nextState.activeTokenId;
    pointTokenReplacementRef.current = nextState.armedToken;
    onActiveReferenceTokenChange(nextState.activeTokenId);
    window.requestAnimationFrame(() => {
      focusEditorAt(edit.selectionStart, edit.selectionEnd);
    });
  }, [activeReferenceTokenId, draftInput, isEditingInput, onActiveReferenceTokenChange, onDraftInputChange, pointReferenceRequest?.id]);

  useEffect(() => {
    if (isFormulaDraft) return;
    setDraftError(null);
    syncedActiveReferenceTokenIdRef.current = null;
    explicitReferenceViewRef.current = null;
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    onActiveReferenceTokenChange(null);
    onCancelPointPick();
  }, [isFormulaDraft, onActiveReferenceTokenChange, onCancelPointPick]);

  useEffect(() => {
    setMenuPanelKey(localFormatKey);
  }, [localFormatKey, formulaBarSnapshot?.primaryAddress]);

  useEffect(() => {
    if (!isEditingInput || !isFormulaDraft) return;
    const editor = sourceEditorRef.current;
    if (!editor) return;
    const cursor = draftInput.length;
    focusEditorAt(cursor);
    const raf = window.requestAnimationFrame(() => {
      focusEditorAt(cursor);
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [draftInput.length, isEditingInput, isFormulaDraft]);

  useEffect(() => {
    if (!isEditingInput || isFormulaDraft) return;
    const input = sourcePlainInputRef.current;
    if (!input) return;
    const cursor = draftInput.length;
    input.focus();
    input.setSelectionRange(cursor, cursor);
    const raf = window.requestAnimationFrame(() => {
      const nextInput = sourcePlainInputRef.current;
      if (!nextInput) return;
      nextInput.focus();
      nextInput.setSelectionRange(cursor, cursor);
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [draftInput.length, isEditingInput, isFormulaDraft]);

  useEffect(() => {
    if (!isEditingInput || !isFormulaDraft) return;
    let editor: HTMLTextAreaElement | null = null;
    let rafId: number | null = null;
    let installed = false;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!editor) return;
      if (document.activeElement !== editor && !editor.contains(document.activeElement)) return;
      const activeReference = activeReferenceViewRef.current;
      if (event.key === "Escape" && activeReference) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        syncedActiveReferenceTokenIdRef.current = null;
        explicitReferenceViewRef.current = null;
        pointTokenReplacementRef.current = null;
        onActiveReferenceTokenChange(null);
        onCancelPointPick();
        setDraftError(null);
        focusEditorAt(activeReference.end);
        return;
      }
      if (
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
      ) {
        return;
      }
      const selection = getEditableSelectionOffsets(editor);
      const selectedToken = findReferenceTokenForSelection(draftInputRef.current, selection.start, selection.end);
      const boundaryReferenceView =
        activeReferenceViewRef.current ??
        (selectedToken ? referenceViewsRef.current.find((view) => view.id === selectedToken.id) ?? null : null);
      if (!boundaryReferenceView) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const nextCaret = event.key === "ArrowRight" ? boundaryReferenceView.end : boundaryReferenceView.start;
      syncedActiveReferenceTokenIdRef.current = null;
      explicitReferenceViewRef.current = null;
      pointTokenReplacementRef.current = null;
      onActiveReferenceTokenChange(null);
      onCancelPointPick();
      setDraftError(null);
      focusEditorAt(nextCaret);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!editor) return;
      if (document.activeElement !== editor && !editor.contains(document.activeElement)) return;
      if (
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
      ) {
        return;
      }
      const explicitReferenceView = explicitReferenceViewRef.current;
      if (!explicitReferenceView) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const nextCaret = event.key === "ArrowRight" ? explicitReferenceView.end : explicitReferenceView.start;
      syncedActiveReferenceTokenIdRef.current = null;
      explicitReferenceViewRef.current = null;
      pointTokenReplacementRef.current = null;
      onActiveReferenceTokenChange(null);
      onCancelPointPick();
      setDraftError(null);
      focusEditorAt(nextCaret);
    };
    const install = () => {
      editor = sourceEditorRef.current;
      if (!editor) {
        rafId = window.requestAnimationFrame(install);
        return;
      }
      installed = true;
      editor.addEventListener("keydown", handleKeyDown, { capture: true });
      editor.addEventListener("keyup", handleKeyUp, { capture: true });
      window.addEventListener("keydown", handleKeyDown, { capture: true });
      window.addEventListener("keyup", handleKeyUp, { capture: true });
    };
    install();
    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      if (!installed || !editor) return;
      editor.removeEventListener("keydown", handleKeyDown, { capture: true });
      editor.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
    };
  }, [isEditingInput, isFormulaDraft, onActiveReferenceTokenChange, onCancelPointPick]);

  useEffect(() => {
    if (!isEditingInput || !isFormulaDraft || !activeReferenceView) {
      syncedActiveReferenceTokenIdRef.current = null;
      return;
    }
    if (syncedActiveReferenceTokenIdRef.current === activeReferenceView.id) return;
    syncedActiveReferenceTokenIdRef.current = activeReferenceView.id;
    pointTokenReplacementRef.current = {
      tokenId: activeReferenceView.id,
      start: activeReferenceView.start,
      end: activeReferenceView.end,
    };
    const editor = sourceEditorRef.current;
    if (!editor) return;
    window.requestAnimationFrame(() => {
      focusEditorAt(activeReferenceView.end);
    });
  }, [activeReferenceView?.id, activeReferenceView?.start, activeReferenceView?.end, isEditingInput, isFormulaDraft]);

  useEffect(() => {
    if (!isEditingInput || !isFormulaDraft || !activeReferenceView) {
      setReferencePopoverCaretLeft(null);
      return;
    }
    let rafId: number | null = null;
    const updateCaretPosition = () => {
      const editorWrap = sourceEditorRef.current?.closest<HTMLElement>(".formula-editor-wrap");
      const menu = referenceMenuRef.current;
      if (!editorWrap || !menu) return;
      const token = editorWrap.querySelector<HTMLElement>(
        `.formula-token-backdrop .formula-reference-token[data-token-id="${CSS.escape(activeReferenceView.id)}"]`,
      );
      if (!token) {
        setReferencePopoverCaretLeft(null);
        return;
      }
      const tokenRect = token.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const nextLeft = Math.max(18, Math.min(tokenRect.left + tokenRect.width / 2 - menuRect.left, menuRect.width - 18));
      setReferencePopoverCaretLeft((current) => (current != null && Math.abs(current - nextLeft) < 0.5 ? current : nextLeft));
    };
    const schedule = () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateCaretPosition();
      });
    };
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [activeReferenceView, isEditingInput, isFormulaDraft]);

  useEffect(() => {
    if (!formatMenuOpen) return;
    let rafId: number | null = null;
    const updatePosition = () => {
      const button = formatButtonRef.current;
      const menu = formatMenuRef.current;
      if (!button || !menu) return;
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const margin = 12;
      const preferredTop = buttonRect.top - menuRect.height - 8;
      const fallbackTop = buttonRect.bottom + 8;
      const unclampedTop = preferredTop >= margin ? preferredTop : fallbackTop;
      const top = Math.max(margin, Math.min(unclampedTop, window.innerHeight - menuRect.height - margin));
      const preferredLeft = buttonRect.right - menuRect.width;
      const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - menuRect.width - margin));
      setFormatMenuPosition((current) => {
        if (Math.abs(current.top - top) < 0.5 && Math.abs(current.left - left) < 0.5) {
          return current;
        }
        return { top, left };
      });
    };
    const schedule = () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updatePosition();
      });
    };
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [formatMenuOpen]);

  useEffect(() => {
    if (!styleMenuOpen) return;
    let rafId: number | null = null;
    const updatePosition = () => {
      const button = styleButtonRef.current;
      const menu = styleMenuRef.current;
      if (!button || !menu) return;
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const margin = 12;
      const preferredTop = buttonRect.top - menuRect.height - 8;
      const fallbackTop = buttonRect.bottom + 8;
      const unclampedTop = preferredTop >= margin ? preferredTop : fallbackTop;
      const top = Math.max(margin, Math.min(unclampedTop, window.innerHeight - menuRect.height - margin));
      const preferredLeft = buttonRect.right - menuRect.width;
      const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - menuRect.width - margin));
      setStyleMenuPosition((current) => {
        if (Math.abs(current.top - top) < 0.5 && Math.abs(current.left - left) < 0.5) {
          return current;
        }
        return { top, left };
      });
    };
    const schedule = () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updatePosition();
      });
    };
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [styleMenuOpen]);

  useEffect(() => {
    if (!formatMenuOpen && !styleMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(".formula-format-control") ||
        target?.closest(".formula-format-menu") ||
        target?.closest(".formula-style-control") ||
        target?.closest(".formula-style-menu")
      ) {
        return;
      }
      setFormatMenuOpen(false);
      setStyleMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFormatMenuOpen(false);
        setStyleMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [formatMenuOpen, styleMenuOpen]);

  useEffect(() => {
    if (mode !== "table" || phase !== "visible" || !formulaBarSnapshot) {
      setFormatMenuOpen(false);
      setStyleMenuOpen(false);
      setDraftError(null);
      setIsComposingInput(false);
    }
  }, [mode, phase, formulaBarSnapshot]);

  const beginEditInput = () => {
    if (!isInputEditable || !formulaBarSnapshot) return;
    setFormatMenuOpen(false);
    setStyleMenuOpen(false);
    onRequestEdit();
    selectionDebugLog("formula beginEditInput");
  };

  const cancelEditInput = () => {
    setDraftInput(formulaBarSnapshot?.inputText ?? "");
    onDraftInputChange(formulaBarSnapshot?.inputText ?? "");
    setDraftError(null);
    onActiveReferenceTokenChange(null);
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    setIsComposingInput(false);
    onCancelEdit();
  };

  const commitEditInput = () => {
    if (!formulaBarSnapshot) return;
    if (!isInputEditable) {
      setIsComposingInput(false);
      onCancelEdit();
      return;
    }
    if (isComposingInput) return;
    if (draftInput === formulaBarSnapshot.inputText) {
      setIsComposingInput(false);
      onCancelEdit();
      selectionDebugLog("formula commitEditInput noop");
      return;
    }
    selectionDebugLog("formula commitEditInput apply", { draftInput });
    onCommitInput(draftInput);
    setDraftError(null);
    onActiveReferenceTokenChange(null);
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    setIsComposingInput(false);
  };

  const applyInputToSelection = () => {
    if (!formulaBarSnapshot || !isInputEditable || !canApplyToSelection || isComposingInput) return;
    selectionDebugLog("formula applyToSelection", { draftInput });
    onApplyToSelection(inputMode === "edit" ? draftInput : formulaBarSnapshot.inputText);
    setDraftError(null);
    onActiveReferenceTokenChange(null);
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    setIsComposingInput(false);
  };

  const syncActiveReferenceFromSelection = () => {
    const editor = sourceEditorRef.current;
    if (!editor) return;
    const selection = getEditableSelectionOffsets(editor);
    const explicitReferenceView = explicitReferenceViewRef.current;
    if (
      explicitReferenceView &&
      selection.start === selection.end &&
      (selection.start === explicitReferenceView.start || selection.start === explicitReferenceView.end)
    ) {
      pointTokenReplacementRef.current = {
        tokenId: explicitReferenceView.id,
        start: explicitReferenceView.start,
        end: explicitReferenceView.end,
      };
      if (activeReferenceTokenId !== explicitReferenceView.id) {
        syncedActiveReferenceTokenIdRef.current = explicitReferenceView.id;
        onActiveReferenceTokenChange(explicitReferenceView.id);
      }
      return;
    }
    const nextSelectionState = syncFormulaPointSelectionState(
      draftInput,
      selection.start,
      selection.end,
      activeReferenceTokenId,
      pointTokenReplacementRef.current,
    );
    pointTokenReplacementRef.current = nextSelectionState.armedToken;
    if (nextSelectionState.activeTokenId === activeReferenceTokenId) return;
    syncedActiveReferenceTokenIdRef.current = nextSelectionState.activeTokenId;
    if (!nextSelectionState.activeTokenId) {
      explicitReferenceViewRef.current = null;
    }
    onActiveReferenceTokenChange(nextSelectionState.activeTokenId);
  };

  const applyEditorTextReplacement = (start: number, end: number, text: string) => {
    const safeStart = Math.max(0, Math.min(start, end, draftInput.length));
    const safeEnd = Math.max(0, Math.min(Math.max(start, end), draftInput.length));
    const nextInput = `${draftInput.slice(0, safeStart)}${text}${draftInput.slice(safeEnd)}`;
    const nextCaret = safeStart + text.length;
    setDraftError(null);
    setDraftInput(nextInput);
    onDraftInputChange(nextInput);
    syncedActiveReferenceTokenIdRef.current = null;
    explicitReferenceViewRef.current = null;
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    onActiveReferenceTokenChange(null);
    window.requestAnimationFrame(() => {
      focusEditorAt(nextCaret);
    });
  };

  const handleEditorBeforeInput = (event: FormEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (isComposingInput || nativeEvent.isComposing) return;
    const editor = sourceEditorRef.current;
    if (!editor) return;
    const selection = getEditableSelectionOffsets(editor);
    if (nativeEvent.inputType === "insertText") {
      event.preventDefault();
      applyEditorTextReplacement(selection.start, selection.end, nativeEvent.data ?? "");
      return;
    }
    if (nativeEvent.inputType === "deleteContentBackward") {
      event.preventDefault();
      const start = selection.start === selection.end ? Math.max(0, selection.start - 1) : selection.start;
      applyEditorTextReplacement(start, selection.end, "");
      return;
    }
    if (nativeEvent.inputType === "deleteContentForward") {
      event.preventDefault();
      const end = selection.start === selection.end ? Math.min(draftInput.length, selection.end + 1) : selection.end;
      applyEditorTextReplacement(selection.start, end, "");
      return;
    }
  };

  const handleEditorInput = (event: FormEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    if (isComposingInput) return;
    const editor = sourceEditorRef.current;
    if (!editor) return;
    const nextInput = editor.value;
    if (nextInput === draftInput) return;
    const explicitReferenceView = explicitReferenceViewRef.current;
    if (explicitReferenceView && draftInput.length > 0 && nextInput.endsWith(draftInput)) {
      const insertedPrefix = nextInput.slice(0, nextInput.length - draftInput.length);
      if (insertedPrefix.length > 0) {
        const nextCaret = explicitReferenceView.end + insertedPrefix.length;
        const correctedInput = `${draftInput.slice(0, explicitReferenceView.end)}${insertedPrefix}${draftInput.slice(explicitReferenceView.end)}`;
        setDraftError(null);
        setDraftInput(correctedInput);
        onDraftInputChange(correctedInput);
        syncedActiveReferenceTokenIdRef.current = null;
        explicitReferenceViewRef.current = null;
        pointGestureReplacementRef.current = null;
        pointTokenReplacementRef.current = null;
        onActiveReferenceTokenChange(null);
        window.requestAnimationFrame(() => {
          focusEditorAt(nextCaret);
        });
        return;
      }
    }
    const selection = getEditableSelectionOffsets(editor);
    setDraftError(null);
    setDraftInput(nextInput);
    onDraftInputChange(nextInput);
    syncedActiveReferenceTokenIdRef.current = null;
    explicitReferenceViewRef.current = null;
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    onActiveReferenceTokenChange(null);
    window.requestAnimationFrame(() => {
      focusEditorAt(selection.start, selection.end);
    });
  };

  const selectReferenceToken = (tokenId: string) => {
    const token = referenceViews.find((view) => view.id === tokenId);
    if (!token) return;
    syncedActiveReferenceTokenIdRef.current = tokenId;
    explicitReferenceViewRef.current = token;
    pointTokenReplacementRef.current = {
      tokenId: token.id,
      start: token.start,
      end: token.end,
    };
    onActiveReferenceTokenChange(tokenId);
    focusEditorAt(token.end);
    window.requestAnimationFrame(() => {
      focusEditorAt(token.end);
    });
  };

  const applyReferenceOption = (optionText: string) => {
    if (!activeReferenceView) return;
    const edit = applyFormulaReferencePick(
      draftInput,
      activeReferenceView.start,
      activeReferenceView.end,
      optionText,
      activeReferenceView.id,
    );
    setDraftError(null);
    setDraftInput(edit.nextDraft);
    onDraftInputChange(edit.nextDraft);
    const nextTokenId = `ref-${edit.tokenStart}-${edit.tokenEnd}`;
    syncedActiveReferenceTokenIdRef.current = nextTokenId;
    pointTokenReplacementRef.current = {
      tokenId: nextTokenId,
      start: edit.tokenStart,
      end: edit.tokenEnd,
    };
    onActiveReferenceTokenChange(nextTokenId);
    window.requestAnimationFrame(() => {
      focusEditorAt(edit.tokenStart, edit.tokenEnd);
    });
  };

  if (mode !== "table" || phase === "hidden" || !formulaBarSnapshot) return null;

  return (
    <>
      <aside
        className={`formula-bar-shell formula-bar-shell--${phase}`}
        aria-live="polite"
        aria-hidden={formulaBarSnapshot ? undefined : true}
      >
        <div className="formula-bar">
          <div className="formula-meta-stack">
            <div className="formula-bar-meta">
              <span className="formula-address">{formulaBarSnapshot.primaryAddress}</span>
              <span className="formula-subaddress">{formulaBarSnapshot.secondaryAddress}</span>
            </div>
            <div className="formula-meta-lower">
              <span className="formula-chip-slot">
                <span className="formula-chip formula-chip--inline" title={chipText}>{chipText}</span>
              </span>
              <div className="formula-display-meta" aria-label="Display metadata">
                <div className="formula-format-control">
                  <button
                    ref={formatButtonRef}
                    className={[
                      "formula-format-button",
                      formatMenuOpen ? "active" : "",
                      hasFormatDisplayError ? "is-warning" : "",
                      !areDisplayControlsEditable ? "is-disabled" : "",
                    ].join(" ").trim()}
                    type="button"
                    aria-label="Format options"
                    aria-haspopup="menu"
                    aria-expanded={formatMenuOpen}
                    disabled={!areDisplayControlsEditable}
                    onMouseEnter={(event) => {
                      if (areDisplayControlsEditable && !formatMenuOpen) onTooltipEnter(hasFormatDisplayError ? getDisplayMetadataErrorLabel(locale, formatErrors[0]) : "Format options", event.currentTarget);
                    }}
                    onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                    onFocus={(event) => {
                      if (areDisplayControlsEditable && !formatMenuOpen) onTooltipEnter(hasFormatDisplayError ? getDisplayMetadataErrorLabel(locale, formatErrors[0]) : "Format options", event.currentTarget);
                    }}
                    onBlur={(event) => onTooltipRelease(event.currentTarget)}
                    onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                    onClick={() => {
                      if (!areDisplayControlsEditable) return;
                      setStyleMenuOpen(false);
                      setMenuPanelKey(localFormatKey);
                      setFormatMenuOpen((open) => !open);
                    }}
                  >
                    <span
                      className={[
                        "formula-format-icon",
                        hasCellFormatOverride ? "has-cell-format" : "",
                        hasFormatDisplayError ? "has-display-error" : "",
                      ].join(" ").trim()}
                    >
                      <FormatGlyph warning={hasFormatDisplayError} />
                    </span>
                  </button>
                </div>
                <div className="formula-style-control">
                  <button
                    ref={styleButtonRef}
                    className={[
                      "formula-style-button",
                      styleMenuOpen ? "active" : "",
                      hasStyleDisplayError ? "is-warning" : "",
                      !areDisplayControlsEditable ? "is-disabled" : "",
                    ].join(" ").trim()}
                    type="button"
                    aria-label="Style options"
                      aria-haspopup="menu"
                      aria-expanded={styleMenuOpen}
                      disabled={!areDisplayControlsEditable}
                      onMouseEnter={(event) => {
                      if (areDisplayControlsEditable && !styleMenuOpen) onTooltipEnter(hasStyleDisplayError ? getDisplayMetadataErrorLabel(locale, styleErrors[0]) : "Style options", event.currentTarget);
                    }}
                    onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                    onFocus={(event) => {
                      if (areDisplayControlsEditable && !styleMenuOpen) onTooltipEnter(hasStyleDisplayError ? getDisplayMetadataErrorLabel(locale, styleErrors[0]) : "Style options", event.currentTarget);
                    }}
                    onBlur={(event) => onTooltipRelease(event.currentTarget)}
                    onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                    onClick={() => {
                      if (!areDisplayControlsEditable) return;
                      setFormatMenuOpen(false);
                      setStyleMenuOpen((open) => !open);
                    }}
                  >
                    <span
                      className={[
                        "formula-style-icon",
                        hasCellStyleOverride ? "has-cell-style" : "",
                        hasStyleDisplayError ? "has-display-error" : "",
                      ].join(" ").trim()}
                    >
                      <StyleGlyph warning={hasStyleDisplayError} />
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="formula-source-row">
            {isEditingInput && isFormulaDraft ? (
              <div className="formula-editor-wrap">
                <div
                  className={draftError ? "formula-source formula-source-editor is-editing has-error" : "formula-source formula-source-editor is-editing"}
                >
                  <div ref={tokenBackdropRef} className="formula-token-backdrop" aria-hidden="true">
                    {renderFormulaDraftWithTokens(draftInput, referenceViews, activeReferenceTokenId, selectReferenceToken)}
                  </div>
                  <textarea
                    ref={sourceEditorRef}
                    className="formula-source-textarea"
                    value={draftInput}
                    rows={1}
                    wrap="off"
                    spellCheck={false}
                    onScroll={syncEditorBackdropScroll}
                    onBeforeInput={handleEditorBeforeInput}
                    onInput={handleEditorInput}
                    onPaste={(event) => {
                      event.preventDefault();
                      const editor = sourceEditorRef.current;
                      if (!editor) return;
                      const selection = getEditableSelectionOffsets(editor);
                      applyEditorTextReplacement(selection.start, selection.end, event.clipboardData.getData("text/plain"));
                    }}
                    onMouseUp={syncActiveReferenceFromSelection}
                    onSelect={syncActiveReferenceFromSelection}
                    onKeyUp={syncActiveReferenceFromSelection}
                    onCompositionStart={() => setIsComposingInput(true)}
                    onCompositionEnd={() => setIsComposingInput(false)}
                    onChange={(event) => {
                      setDraftError(null);
                      setDraftInput(event.currentTarget.value);
                      onDraftInputChange(event.currentTarget.value);
                      syncedActiveReferenceTokenIdRef.current = null;
                      explicitReferenceViewRef.current = null;
                      pointGestureReplacementRef.current = null;
                      onActiveReferenceTokenChange(null);
                    }}
                    onKeyDown={(event) => {
                  let selectedReferenceView: FormulaReferenceView | null = null;
                  if (
                    !event.shiftKey &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey &&
                    (event.key === "ArrowRight" || event.key === "ArrowLeft")
                  ) {
                    const editor = sourceEditorRef.current;
                    if (editor) {
                      const selection = getEditableSelectionOffsets(editor);
                      const selectedToken = findReferenceTokenForSelection(draftInput, selection.start, selection.end);
                      selectedReferenceView = selectedToken
                        ? referenceViews.find((view) => view.id === selectedToken.id) ?? null
                        : null;
                    }
                  }
                  const boundaryReferenceView = activeReferenceView ?? selectedReferenceView;
                  if (
                    boundaryReferenceView &&
                    !event.shiftKey &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey &&
                    (event.key === "ArrowRight" || event.key === "ArrowLeft")
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const nextCaret = event.key === "ArrowRight" ? boundaryReferenceView.end : boundaryReferenceView.start;
                    syncedActiveReferenceTokenIdRef.current = null;
                    onActiveReferenceTokenChange(null);
                    onCancelPointPick();
                    setDraftError(null);
                    focusEditorAt(nextCaret);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.metaKey || event.ctrlKey) {
                      applyInputToSelection();
                      return;
                    }
                    commitEditInput();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (activeReferenceView) {
                      onActiveReferenceTokenChange(null);
                      onCancelPointPick();
                      setDraftError(null);
                      focusEditorAt(activeReferenceView.end);
                      return;
                    }
                    cancelEditInput();
                  }
                }}
                    aria-label="Edit selected cell input"
                    aria-multiline={false}
                  />
                </div>
              {draftError ? <div className="formula-draft-error" role="alert">{draftError}</div> : null}
              {activeReferenceView && referenceOptionGroups.length > 0 ? (
                <div
                  ref={referenceMenuRef}
                  className="reference-options-popover"
                  role="menu"
                  aria-label="Reference options"
                  style={
                    referencePopoverCaretLeft == null
                      ? undefined
                      : ({ "--reference-popover-caret-left": `${referencePopoverCaretLeft}px` } as CSSProperties)
                  }
                >
                  {referenceOptionGroups.map((group) => (
                    <div key={group.key} className="reference-option-group" role="group" aria-label={group.label}>
                      <div className="reference-option-group-label">{group.label}</div>
                      <div className="reference-option-group-items">
                        {group.options.map((option) => (
                          <button
                            key={option.style}
                            className={option.text === activeReferenceView.text ? "reference-option active" : "reference-option"}
                            type="button"
                            role="menuitem"
                            disabled={!option.text}
                            title={option.disabledReason ?? option.text ?? undefined}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={() => {
                              if (!option.text) return;
                              applyReferenceOption(option.text);
                            }}
                          >
                            <span className="reference-option-label">{option.label}</span>
                            <span className="reference-option-preview">{option.text ?? option.disabledReason}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            ) : isEditingInput ? (
              <input
                ref={sourcePlainInputRef}
                className="formula-source formula-source-input is-editing"
                value={draftInput}
                spellCheck={false}
                aria-label="Edit selected cell input"
                onCompositionStart={() => setIsComposingInput(true)}
                onCompositionEnd={() => setIsComposingInput(false)}
                onChange={(event) => {
                  const nextInput = event.currentTarget.value;
                  setDraftError(null);
                  setDraftInput(nextInput);
                  onDraftInputChange(nextInput);
                  syncedActiveReferenceTokenIdRef.current = null;
                  explicitReferenceViewRef.current = null;
                  pointGestureReplacementRef.current = null;
                  pointTokenReplacementRef.current = null;
                  onActiveReferenceTokenChange(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.metaKey || event.ctrlKey) {
                      applyInputToSelection();
                      return;
                    }
                    commitEditInput();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelEditInput();
                  }
                }}
              />
            ) : (
              <button
                className={isInputEditable ? "formula-source formula-source-button is-editable is-read" : "formula-source formula-source-button is-read"}
                type="button"
                onClick={beginEditInput}
                onMouseEnter={(event) => {
                  if (isInputEditable) onTooltipEnter("Edit cell input", event.currentTarget);
                }}
                onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                onFocus={(event) => {
                  if (isInputEditable) onTooltipEnter("Edit cell input", event.currentTarget);
                }}
                onBlur={(event) => onTooltipRelease(event.currentTarget)}
                onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                aria-label={isInputEditable ? "Edit selected cell input" : "Cell input (read-only)"}
              >
                {formulaBarSnapshot.inputText}
              </button>
            )}
            <button
              className="formula-dismiss-button"
              type="button"
              aria-label={isEditingInput ? "Apply cell input" : "Done"}
              onMouseEnter={(event) => onTooltipEnter(isEditingInput ? "Apply cell input" : "Done", event.currentTarget)}
              onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
              onFocus={(event) => onTooltipEnter(isEditingInput ? "Apply cell input" : "Done", event.currentTarget)}
              onBlur={(event) => onTooltipRelease(event.currentTarget)}
              onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
              onClick={() => {
                setFormatMenuOpen(false);
                setStyleMenuOpen(false);
                if (isEditingInput) {
                  commitEditInput();
                  return;
                }
                onDismiss();
              }}
            >
              <span className="formula-dismiss-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M5 10.4 8.4 13.7 15 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                </svg>
              </span>
            </button>
            {canApplyToSelection ? (
              <button
                className="formula-apply-selection-button"
                type="button"
                aria-label="Apply to selection"
                onMouseEnter={(event) => onTooltipEnter("Apply to selection", event.currentTarget)}
                onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                onFocus={(event) => onTooltipEnter("Apply to selection", event.currentTarget)}
                onBlur={(event) => onTooltipRelease(event.currentTarget)}
                onMouseDown={(event) => onTooltipSuppress(event.currentTarget)}
                onClick={() => {
                  setFormatMenuOpen(false);
                  setStyleMenuOpen(false);
                  applyInputToSelection();
                }}
              >
                Apply to selection
              </button>
            ) : null}
          </div>
        </div>
      </aside>
      {createPortal(
        <div
          ref={formatMenuRef}
          className={[
            "formula-format-menu",
            formatMenuOpen ? "open" : "",
            localFormatKey !== "auto" ? "has-detail-panel" : "list-only",
          ].join(" ").trim()}
          role="menu"
          aria-hidden={!formatMenuOpen}
          style={{
            top: `${formatMenuPosition.top}px`,
            left: `${formatMenuPosition.left}px`,
          }}
        >
          {hasFormatDisplayError ? (
            <div className="formula-menu-error-banner formula-menu-error-banner--full" role="status" aria-live="polite">
                <span className="formula-menu-error-icon"><BannerWarningGlyph /></span>
                <span className="formula-menu-error-copy">
                <span className="formula-menu-error-title">{getDisplayMetadataErrorLabel(locale, formatErrors[0])}</span>
                <span className="formula-menu-error-detail">{formatDisplayMetadataErrorMessage(locale, formatErrors[0])}</span>
                {formatErrors.length > 1 ? (
                  <span className="formula-menu-error-more">{`+${formatErrors.length - 1} more`}</span>
                ) : null}
              </span>
            </div>
          ) : null}
          <FormatPreviewPanel
            localFormatKey={localFormatKey}
            localFormatOptions={localFormatOptions}
            inspectedKey={menuPanelKey}
            onInspectKey={setMenuPanelKey}
            onChange={areDisplayControlsEditable ? (key, options) => onSetLocalFormat(key, options) : undefined}
          />
        </div>,
        document.body,
      )}
      {createPortal(
        <div
          ref={styleMenuRef}
          className={styleMenuOpen ? "formula-style-menu open" : "formula-style-menu"}
          role="menu"
          aria-hidden={!styleMenuOpen}
          style={{
            top: `${styleMenuPosition.top}px`,
            left: `${styleMenuPosition.left}px`,
          }}
        >
          <>
            {hasStyleDisplayError ? (
              <div className="formula-menu-error-banner" role="status" aria-live="polite">
                <span className="formula-menu-error-icon"><BannerWarningGlyph /></span>
                <span className="formula-menu-error-copy">
                  <span className="formula-menu-error-title">{getDisplayMetadataErrorLabel(locale, styleErrors[0])}</span>
                  <span className="formula-menu-error-detail">{formatDisplayMetadataErrorMessage(locale, styleErrors[0])}</span>
                  {styleErrors.length > 1 ? (
                    <span className="formula-menu-error-more">{`+${styleErrors.length - 1} more`}</span>
                  ) : null}
                </span>
              </div>
            ) : null}
            <StylePreviewPanel
              styleLocal={localStyle}
              onChange={areDisplayControlsEditable ? onSetLocalStyle : undefined}
            />
          </>
        </div>,
        document.body,
      )}
    </>
  );
}
