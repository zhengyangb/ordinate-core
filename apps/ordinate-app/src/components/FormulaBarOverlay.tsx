import { type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getStandardFunctionMetadata, listStandardFunctionMetadata, type FunctionMetadata } from "@ordinate/core";
import { useFormulaBarLayout } from "../hooks/useFormulaBarLayout";
import { FormulaCellAddress } from "./FormulaCellAddress";
import { revealFormulaCaret } from "../utils/formulaEditorLayout";
import { canInsertTextLineBreak, plainTextPreview } from "../utils/plainTextEditing";

import type { UiLocale } from "../i18n/messages";
import { getFormulaFunctionCategoryLabel } from "../i18n/formulaAssistant";
import {
  classifyDisplayMetadataIssue,
  formatDisplayMetadataErrorMessage,
  getDisplayMetadataErrorLabel,
} from "../i18n/displayMetadata";
import { FormatPreviewPanel, StylePreviewPanel } from "./DisplayMetadataPreview";
import { EditorPopover } from "./EditorPopover";
import type { ChromeVisibilityPhase, FormatLocalKey, FormulaBarData, StyleLocalView, Rect } from "../types/ui";
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
import {
  MIN_FUNCTION_AUTOCOMPLETE_QUERY_LENGTH,
  activeParameterIndexForFormulaAssistant,
  applyFormulaAssistantTextReplacement,
  buildFunctionCallInsertion,
  buildFunctionSuggestions,
  correctFormulaAssistantInputChange,
  iconForFormulaAssistant,
  isEscapeKey,
  isFormulaAssistantImeEvent,
  nextFormulaAssistantSelectedIndex,
  normalizeFunctionSearchText,
  parameterLabelForFormulaAssistant,
  resolveFormulaAssistantContexts,
  returnLabelForFormulaAssistant,
  signatureForFormulaAssistant,
  type FormulaAssistantContext,
  type FormulaFunctionSuggestion,
  typeLabelForFormulaAssistant,
} from "../utils/formulaAssistant";

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

function FunctionGlyph() {
  return (
    <MenuIcon>
      <path d="M5.2 15.2c1.1-1.5 1.62-3.4 1.62-5.6V7.9c0-2.24 1.08-3.5 3.08-3.5.6 0 1.1.08 1.5.24" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      <path d="M4.15 8.15h6.05M10.7 10.25l3.95 4.25M14.65 10.25l-3.95 4.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </MenuIcon>
  );
}

function getEditableSelectionOffsets(editor: HTMLTextAreaElement): { start: number; end: number } {
  return {
    start: editor.selectionStart,
    end: editor.selectionEnd,
  };
}

function isImeKeyboardEvent(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const nativeEvent = event.nativeEvent as KeyboardEvent & { keyCode?: number };
  return isFormulaAssistantImeEvent(nativeEvent);
}

function isImeNativeKeyboardEvent(event: KeyboardEvent): boolean {
  return isFormulaAssistantImeEvent(event);
}

function summaryLabelForFormulaAssistant(locale: UiLocale, metadata: FunctionMetadata): string {
  const firstSentence = metadata.summary.split(/[.;]/, 1)[0]?.trim();
  return firstSentence || getFormulaFunctionCategoryLabel(locale, metadata.category);
}

function setEditableSelectionOffsets(editor: HTMLTextAreaElement, start: number, end: number) {
  const textLength = editor.value.length;
  const targetStart = Math.max(0, Math.min(start, textLength));
  const targetEnd = Math.max(0, Math.min(end, textLength));
  editor.setSelectionRange(targetStart, targetEnd);
}

function formatErrorMessageForFormulaBar(locale: UiLocale, issue: Parameters<typeof formatDisplayMetadataErrorMessage>[1], snapshot: FormulaBarData | null): string {
  if (issue.code !== "format_value_kind_mismatch" || snapshot?.formatLocalKey !== "auto") {
    return formatDisplayMetadataErrorMessage(locale, issue);
  }
  if (snapshot.formatSource === "column") {
    return "Column format is not compatible with this value.";
  }
  if (snapshot.formatSource === "row") {
    return "Row format is not compatible with this value.";
  }
  return formatDisplayMetadataErrorMessage(locale, issue);
}

function resolveEditorNavigationCaret(
  selection: { start: number; end: number },
  textLength: number,
  key: string,
): number | null {
  // Home/End and vertical arrows belong to the textarea's visual wrapped lines.
  if (key === "ArrowLeft") {
    return selection.start === selection.end ? Math.max(0, selection.start - 1) : selection.start;
  }
  if (key === "ArrowRight") {
    return selection.start === selection.end ? Math.min(textLength, selection.end + 1) : selection.end;
  }
  return null;
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
  const tokens = referenceViews;
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
  selectedRange: Rect | null;
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
  selectedRange,
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
  const [formatMenuPosition, setFormatMenuPosition] = useState({ bottom: 0, left: 0, maxHeight: 0 });
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
  const [functionAssistantPinned, setFunctionAssistantPinned] = useState(false);
  const [functionSignatureExpanded, setFunctionSignatureExpanded] = useState(false);
  const [functionAssistantSelectedIndex, setFunctionAssistantSelectedIndex] = useState(0);
  const [functionAssistantDismissedKey, setFunctionAssistantDismissedKey] = useState<string | null>(null);
  const [editorSelection, setEditorSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const sourcePlainInputRef = useRef<HTMLTextAreaElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const tokenBackdropRef = useRef<HTMLDivElement | null>(null);
  const functionAssistantListRef = useRef<HTMLDivElement | null>(null);
  const appliedPointReferenceRequestIdRef = useRef<number | null>(null);
  const pointGestureReplacementRef = useRef<FormulaPointGestureReplacement | null>(null);
  const pointTokenReplacementRef = useRef<FormulaPointReplacementTarget | null>(null);
  const syncedActiveReferenceTokenIdRef = useRef<string | null>(null);
  const draftInputRef = useRef(draftInput);
  const referenceViewsRef = useRef(referenceViews);
  const activeReferenceViewRef = useRef<FormulaReferenceView | null>(null);
  const explicitReferenceViewRef = useRef<FormulaReferenceView | null>(null);
  const editSessionAddressRef = useRef<string | null>(null);
  const focusedEditSessionRef = useRef<string | null>(null);
  const pendingEditorSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const pendingEditorSelectionTokenRef = useRef(0);
  const guardedFunctionCloseParenRef = useRef<number | null>(null);
  const ensureTextareaOffsetVisible = (editor: HTMLTextAreaElement, offset: number) => {
    const backdrop = tokenBackdropRef.current;
    if (!backdrop) throw new Error("Formula editor requires its token backdrop");
    revealFormulaCaret(editor, backdrop, offset);
  };
  const focusEditorAt = (start: number, end = start) => {
    const editor = sourceEditorRef.current;
    if (!editor) return false;
    editor.focus();
    setEditableSelectionOffsets(editor, start, end);
    setEditorSelection({ start, end });
    ensureTextareaOffsetVisible(editor, end);
    syncEditorBackdropScroll();
    window.requestAnimationFrame(() => {
      const nextEditor = sourceEditorRef.current;
      if (!nextEditor) return;
      nextEditor.focus();
      setEditableSelectionOffsets(nextEditor, start, end);
      setEditorSelection({ start, end });
      ensureTextareaOffsetVisible(nextEditor, end);
      syncEditorBackdropScroll();
    });
    return true;
  };
  const cancelPendingEditorSelectionRestore = () => {
    pendingEditorSelectionTokenRef.current += 1;
    pendingEditorSelectionRef.current = null;
  };
  const restorePendingEditorSelection = (remainingAttempts: number, token: number) => {
    window.requestAnimationFrame(() => {
      if (pendingEditorSelectionTokenRef.current !== token) return;
      const pendingSelection = pendingEditorSelectionRef.current;
      if (!pendingSelection) return;
      const restored = focusEditorAt(pendingSelection.start, pendingSelection.end);
      if (remainingAttempts <= 0) {
        if (restored) pendingEditorSelectionRef.current = null;
        return;
      }
      restorePendingEditorSelection(remainingAttempts - 1, token);
    });
  };
  const requestEditorSelectionRestore = (start: number, end = start) => {
    pendingEditorSelectionTokenRef.current += 1;
    const token = pendingEditorSelectionTokenRef.current;
    pendingEditorSelectionRef.current = { start, end };
    setEditorSelection({ start, end });
    restorePendingEditorSelection(2, token);
  };
  const focusSourceInputControl = (remainingAttempts = 4) => {
    window.requestAnimationFrame(() => {
      const formulaEditor = sourceEditorRef.current;
      if (formulaEditor) {
        formulaEditor.focus();
        setEditableSelectionOffsets(formulaEditor, editorSelection.start, editorSelection.end);
        ensureTextareaOffsetVisible(formulaEditor, editorSelection.end);
        syncEditorBackdropScroll();
        return;
      }
      const plainInput = sourcePlainInputRef.current;
      if (plainInput) {
        plainInput.focus();
        const caret = plainInput.value.length;
        plainInput.setSelectionRange(caret, caret);
        return;
      }
      if (remainingAttempts > 0) focusSourceInputControl(remainingAttempts - 1);
    });
  };
  const syncEditorBackdropScroll = () => {
    const editor = sourceEditorRef.current;
    const backdrop = tokenBackdropRef.current;
    if (!editor || !backdrop) return;
    backdrop.scrollLeft = editor.scrollLeft;
    backdrop.scrollTop = editor.scrollTop;
  };
  const isEditingInput = inputMode === "edit";
  const isFormulaDraft = draftInput.trimStart().startsWith("=");
  const canInsertLineBreak = Boolean(formulaBarSnapshot?.supportsMultilineText && canInsertTextLineBreak(draftInput));
  const acceptsLineBreakAtSelection = (editor: HTMLTextAreaElement) => Boolean(
    formulaBarSnapshot?.supportsMultilineText && canInsertTextLineBreak(editor.value, editor.selectionStart, editor.selectionEnd),
  );
  const multilineText = isEditingInput && !isFormulaDraft && draftInput.includes("\n");
  const inputPreview = plainTextPreview(formulaBarSnapshot?.inputText ?? "");
  useFormulaBarLayout(shellRef, isFormulaDraft ? sourceEditorRef : sourcePlainInputRef, draftInput, isEditingInput, isFormulaDraft,
    mode === "table" && phase !== "hidden" && Boolean(formulaBarSnapshot));
  const standardFunctions = useMemo(() => listStandardFunctionMetadata(), []);
  const activeReferenceView = useMemo(
    () => referenceViews.find((view) => view.id === activeReferenceTokenId) ?? null,
    [activeReferenceTokenId, referenceViews],
  );
  const functionAssistantContext = useMemo<FormulaAssistantContext>(() => {
    if (!isEditingInput || !isFormulaDraft || activeReferenceView) return null;
    const caret = editorSelection.end;
    const { name: nameContext, call: callContext } = resolveFormulaAssistantContexts(draftInput, caret);
    if (nameContext && (nameContext.query.length > 0 || !callContext)) return nameContext;
    return callContext ?? nameContext;
  }, [activeReferenceView, draftInput, editorSelection.end, isEditingInput, isFormulaDraft]);
  const functionNameContext = functionAssistantContext?.kind === "name" ? functionAssistantContext : null;
  const functionCallContext = functionAssistantContext?.kind === "call" ? functionAssistantContext : null;
  const functionSearchQuery = normalizeFunctionSearchText(functionNameContext?.query ?? "");
  const functionSuggestions = useMemo(() => {
    return buildFunctionSuggestions(standardFunctions, functionSearchQuery);
  }, [functionSearchQuery, standardFunctions]);
  const activeCallMetadata = functionCallContext ? getStandardFunctionMetadata(functionCallContext.name) : null;
  const functionAssistantContextKey = functionNameContext
    ? `name:${functionNameContext.start}:${functionNameContext.query}`
    : functionCallContext
      ? `call:${functionCallContext.name}:${functionCallContext.argumentIndex}`
      : null;
  const isFunctionAssistantAutoVisible =
    Boolean(functionNameContext && functionSearchQuery.length >= MIN_FUNCTION_AUTOCOMPLETE_QUERY_LENGTH && functionSuggestions.length > 0) ||
    Boolean(functionCallContext);
  const shouldShowFunctionList = functionAssistantPinned;
  const shouldShowFunctionCompact =
    Boolean(functionNameContext && functionSearchQuery.length >= MIN_FUNCTION_AUTOCOMPLETE_QUERY_LENGTH && functionSuggestions.length > 0) &&
    !functionAssistantPinned;
  const functionAssistantMode = shouldShowFunctionList ? "list" : shouldShowFunctionCompact ? "compact" : functionSignatureExpanded ? "signature-expanded" : "signature";
  const selectedSuggestion = functionSuggestions[Math.min(functionAssistantSelectedIndex, Math.max(0, functionSuggestions.length - 1))] ?? null;
  const selectedFunctionMetadata =
    shouldShowFunctionList ? selectedSuggestion?.metadata ?? null : activeCallMetadata ?? selectedSuggestion?.metadata ?? null;
  const selectedFunctionDisplayName = functionCallContext?.name ?? selectedSuggestion?.displayName ?? selectedFunctionMetadata?.name ?? "";
  const selectedFunctionSignature = selectedFunctionMetadata ? signatureForFormulaAssistant(selectedFunctionMetadata) : null;
  const activeFunctionParameterIndex =
    selectedFunctionMetadata && functionCallContext
      ? activeParameterIndexForFormulaAssistant(selectedFunctionMetadata, functionCallContext.argumentIndex)
      : -1;
  const activeFunctionParameter =
    selectedFunctionSignature && activeFunctionParameterIndex >= 0
      ? selectedFunctionSignature.parameters[activeFunctionParameterIndex]
      : null;
  const shouldShowFunctionAssistant =
    !isComposingInput &&
    !activeReferenceView &&
    (functionAssistantPinned ||
      (isFunctionAssistantAutoVisible && functionAssistantContextKey !== functionAssistantDismissedKey));
  const dismissFunctionAssistant = () => {
    setFunctionAssistantPinned(false);
    setFunctionSignatureExpanded(false);
    setFunctionAssistantDismissedKey(functionAssistantContextKey);
  };
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
    setFunctionAssistantSelectedIndex(0);
  }, [functionSearchQuery]);

  useEffect(() => {
    if (!functionCallContext) setFunctionSignatureExpanded(false);
  }, [functionCallContext]);

  useEffect(() => {
    if (!shouldShowFunctionAssistant) return;
    const handleFunctionAssistantEscape = (event: KeyboardEvent) => {
      if (isImeNativeKeyboardEvent(event) || !isEscapeKey(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      dismissFunctionAssistant();
    };
    document.addEventListener("keydown", handleFunctionAssistantEscape, true);
    return () => document.removeEventListener("keydown", handleFunctionAssistantEscape, true);
  }, [functionAssistantContextKey, shouldShowFunctionAssistant]);

  useEffect(() => {
    if (!shouldShowFunctionList) return;
    window.requestAnimationFrame(() => {
      const activeOption = functionAssistantListRef.current?.querySelector('[aria-selected="true"]');
      activeOption?.scrollIntoView({ block: "nearest" });
    });
  }, [functionAssistantSelectedIndex, functionSuggestions.length, shouldShowFunctionList]);

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
  const effectiveFormatKey = formulaBarSnapshot?.formatEffectiveKey ?? "auto";
  const effectiveFormatOptions = formulaBarSnapshot?.formatEffectiveOptions ?? null;
  const formatSource = formulaBarSnapshot?.formatSource ?? "default";
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
  const primaryFormatErrorMessage = hasFormatDisplayError
    ? formatErrorMessageForFormulaBar(locale, formatErrors[0], formulaBarSnapshot)
    : "";

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
      focusedEditSessionRef.current = null;
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

  useLayoutEffect(() => {
    const pendingSelection = pendingEditorSelectionRef.current;
    if (!pendingSelection || !isEditingInput || !isFormulaDraft) return;
    const token = pendingEditorSelectionTokenRef.current;
    restorePendingEditorSelection(1, token);
  }, [draftInput, isEditingInput, isFormulaDraft]);

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
    const primaryAddress = formulaBarSnapshot?.primaryAddress;
    if (!primaryAddress || !isEditingInput) {
      focusedEditSessionRef.current = null;
      return;
    }
    const sessionKey = `${primaryAddress}:${isFormulaDraft ? "formula" : "plain"}`;
    if (focusedEditSessionRef.current === sessionKey) return;
    focusedEditSessionRef.current = sessionKey;
    const cursor = draftInput.length;
    const raf = window.requestAnimationFrame(() => {
      if (isFormulaDraft) {
        focusEditorAt(cursor);
        return;
      }
      const input = sourcePlainInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(cursor, cursor);
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [draftInput.length, formulaBarSnapshot?.primaryAddress, isEditingInput, isFormulaDraft]);

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

  useLayoutEffect(() => {
    if (!formatMenuOpen) return;
    let rafId: number | null = null;
    const updatePosition = () => {
      const button = formatButtonRef.current;
      const menu = formatMenuRef.current;
      if (!button || !menu) return;
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const margin = 12;
      // Anchor the bottom edge; changing detail height must not move the type picker.
      const bottom = window.innerHeight - buttonRect.top + 8;
      const maxHeight = Math.max(0, buttonRect.top - 8 - margin);
      const preferredLeft = buttonRect.right - menuRect.width;
      const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - menuRect.width - margin));
      setFormatMenuPosition((current) => {
        if (Math.abs(current.bottom - bottom) < 0.5 && Math.abs(current.left - left) < 0.5 && Math.abs(current.maxHeight - maxHeight) < 0.5) {
          return current;
        }
        return { bottom, left, maxHeight };
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
    updatePosition();
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
    guardedFunctionCloseParenRef.current = null;
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
    guardedFunctionCloseParenRef.current = null;
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
    guardedFunctionCloseParenRef.current = null;
    setIsComposingInput(false);
  };

  const syncActiveReferenceFromSelection = () => {
    const editor = sourceEditorRef.current;
    if (!editor) return;
    const selection = getEditableSelectionOffsets(editor);
    setEditorSelection(selection);
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
    cancelPendingEditorSelectionRestore();
    setFunctionAssistantPinned(false);
    setFunctionSignatureExpanded(false);
    const edit = applyFormulaAssistantTextReplacement({
      draft: draftInput,
      start,
      end,
      text,
      guardedCloseParen: guardedFunctionCloseParenRef.current,
    });
    guardedFunctionCloseParenRef.current = edit.nextGuardedCloseParen;
    setDraftError(null);
    setDraftInput(edit.nextInput);
    onDraftInputChange(edit.nextInput);
    syncedActiveReferenceTokenIdRef.current = null;
    explicitReferenceViewRef.current = null;
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    onActiveReferenceTokenChange(null);
    requestEditorSelectionRestore(edit.nextCaret);
  };

  const insertFunctionCall = (suggestion: FormulaFunctionSuggestion) => {
    const replacementStart = functionNameContext?.start ?? editorSelection.start;
    const replacementEnd = functionNameContext?.end ?? editorSelection.end;
    const edit = buildFunctionCallInsertion({
      draft: draftInput,
      isFormulaDraft,
      suggestion,
      replacementStart,
      replacementEnd,
    });
    setDraftError(null);
    setDraftInput(edit.nextInput);
    onDraftInputChange(edit.nextInput);
    syncedActiveReferenceTokenIdRef.current = null;
    explicitReferenceViewRef.current = null;
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    onActiveReferenceTokenChange(null);
    setFunctionAssistantPinned(false);
    setFunctionSignatureExpanded(false);
    guardedFunctionCloseParenRef.current = edit.nextGuardedCloseParen;
    requestEditorSelectionRestore(edit.nextCaret);
  };

  const handleEditorBeforeInput = (event: FormEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (isComposingInput || nativeEvent.isComposing) return;
    if (nativeEvent.inputType === "insertLineBreak" || nativeEvent.inputType === "insertParagraph") {
      event.preventDefault();
      return;
    }
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
    cancelPendingEditorSelectionRestore();
    const correction = correctFormulaAssistantInputChange({
      draft: draftInput,
      nextInput,
      isFormulaDraft,
      guardedCloseParen: guardedFunctionCloseParenRef.current,
      explicitReferenceView: explicitReferenceViewRef.current,
    });
    if (correction) {
      guardedFunctionCloseParenRef.current = correction.nextGuardedCloseParen;
      setDraftError(null);
      setDraftInput(correction.nextInput);
      onDraftInputChange(correction.nextInput);
      setFunctionAssistantPinned(false);
      setFunctionSignatureExpanded(false);
      syncedActiveReferenceTokenIdRef.current = null;
      explicitReferenceViewRef.current = null;
      pointGestureReplacementRef.current = null;
      pointTokenReplacementRef.current = null;
      onActiveReferenceTokenChange(null);
      requestEditorSelectionRestore(correction.nextCaret);
      return;
    }
    const selection = getEditableSelectionOffsets(editor);
    setDraftError(null);
    setDraftInput(nextInput);
    onDraftInputChange(nextInput);
    setFunctionAssistantPinned(false);
    setFunctionSignatureExpanded(false);
    syncedActiveReferenceTokenIdRef.current = null;
    explicitReferenceViewRef.current = null;
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    onActiveReferenceTokenChange(null);
    requestEditorSelectionRestore(selection.start, selection.end);
  };

  const beginInputComposition = () => {
    cancelPendingEditorSelectionRestore();
    guardedFunctionCloseParenRef.current = null;
    setIsComposingInput(true);
    setFunctionAssistantPinned(false);
    setFunctionSignatureExpanded(false);
  };

  const endFormulaInputComposition = (editor: HTMLTextAreaElement) => {
    cancelPendingEditorSelectionRestore();
    const selection = getEditableSelectionOffsets(editor);
    setIsComposingInput(false);
    setDraftError(null);
    setDraftInput(editor.value);
    onDraftInputChange(editor.value);
    setEditorSelection(selection);
    syncedActiveReferenceTokenIdRef.current = null;
    explicitReferenceViewRef.current = null;
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    onActiveReferenceTokenChange(null);
  };

  const endPlainInputComposition = (input: HTMLTextAreaElement) => {
    cancelPendingEditorSelectionRestore();
    setIsComposingInput(false);
    setDraftError(null);
    setDraftInput(input.value);
    onDraftInputChange(input.value);
    syncedActiveReferenceTokenIdRef.current = null;
    explicitReferenceViewRef.current = null;
    pointGestureReplacementRef.current = null;
    pointTokenReplacementRef.current = null;
    onActiveReferenceTokenChange(null);
  };

  const handleFunctionAssistantKeyDown = (event: ReactKeyboardEvent<HTMLElement>): boolean => {
    if (!shouldShowFunctionAssistant) return false;
    if (functionCallContext && !functionAssistantPinned && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      event.stopPropagation();
      setFunctionSignatureExpanded(event.key === "ArrowDown");
      return true;
    }
    if (shouldShowFunctionCompact && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setFunctionAssistantPinned(true);
      setFunctionAssistantDismissedKey(null);
      return true;
    }
    if (shouldShowFunctionList && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp") && functionSuggestions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const navigationKey = event.key;
      setFunctionAssistantSelectedIndex((index) => nextFormulaAssistantSelectedIndex(index, functionSuggestions.length, navigationKey));
      return true;
    }
    if ((functionNameContext || functionAssistantPinned) && selectedSuggestion && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      event.stopPropagation();
      insertFunctionCall(selectedSuggestion);
      return true;
    }
    if (isEscapeKey(event.key) && !activeReferenceView) {
      event.preventDefault();
      event.stopPropagation();
      dismissFunctionAssistant();
      return true;
    }
    return false;
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
        ref={shellRef}
        className={`formula-bar-shell formula-bar-shell--${phase}${multilineText ? " is-multiline" : ""}`}
        aria-live="polite"
        aria-hidden={formulaBarSnapshot ? undefined : true}
      >
        <div className="formula-bar-surface" aria-hidden="true" />
        <div className="formula-bar">
          <div className="formula-meta-stack">
            <div className="formula-meta-top">
              <FormulaCellAddress key={formulaBarSnapshot.primaryAddress} cell={formulaBarSnapshot} selection={selectedRange} />
              <span className="formula-chip-slot">
                <span className="formula-chip formula-chip--inline" title={chipText}>{chipText}</span>
              </span>
            </div>
            <div className="formula-meta-lower">
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
                      if (areDisplayControlsEditable && !formatMenuOpen) onTooltipEnter(hasFormatDisplayError ? primaryFormatErrorMessage : "Format options", event.currentTarget);
                    }}
                    onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                    onFocus={(event) => {
                      if (areDisplayControlsEditable && !formatMenuOpen) onTooltipEnter(hasFormatDisplayError ? primaryFormatErrorMessage : "Format options", event.currentTarget);
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
                <div className="formula-function-control">
                  <button
                    className={[
                      "formula-function-button",
                      functionAssistantPinned ? "active" : "",
                      !isInputEditable ? "is-disabled" : "",
                    ].join(" ").trim()}
                    type="button"
                    aria-label="Function assistant"
                    aria-haspopup="dialog"
                    aria-expanded={shouldShowFunctionAssistant}
                    disabled={!isInputEditable}
                    onMouseEnter={(event) => {
                      if (isInputEditable && !functionAssistantPinned) onTooltipEnter("Function assistant", event.currentTarget);
                    }}
                    onMouseLeave={(event) => onTooltipRelease(event.currentTarget)}
                    onFocus={(event) => {
                      if (isInputEditable && !functionAssistantPinned) onTooltipEnter("Function assistant", event.currentTarget);
                    }}
                    onBlur={(event) => onTooltipRelease(event.currentTarget)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onTooltipSuppress(event.currentTarget);
                    }}
                    onClick={() => {
                      if (!isInputEditable) return;
                      setFormatMenuOpen(false);
                      setStyleMenuOpen(false);
                      if (!isEditingInput) {
                        onRequestEdit();
                      }
                      setFunctionAssistantSelectedIndex(0);
                      setFunctionAssistantDismissedKey(null);
                      setFunctionAssistantPinned((open) => !open);
                      focusSourceInputControl();
                    }}
                  >
                    <span className="formula-function-icon">
                      <FunctionGlyph />
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
                    wrap="soft"
                    spellCheck={false}
                    onScroll={syncEditorBackdropScroll}
                    onBeforeInput={handleEditorBeforeInput}
                    onInput={handleEditorInput}
                    onPaste={(event) => {
                      event.preventDefault();
                      cancelPendingEditorSelectionRestore();
                      const editor = sourceEditorRef.current;
                      if (!editor) return;
                      const selection = getEditableSelectionOffsets(editor);
                      applyEditorTextReplacement(selection.start, selection.end, event.clipboardData.getData("text/plain"));
                    }}
                    onMouseUp={syncActiveReferenceFromSelection}
                    onSelect={syncActiveReferenceFromSelection}
                    onKeyUp={syncActiveReferenceFromSelection}
                    onCompositionStart={beginInputComposition}
                    onCompositionEnd={(event) => endFormulaInputComposition(event.currentTarget)}
                    onChange={(event) => {
                      cancelPendingEditorSelectionRestore();
                      setFunctionAssistantPinned(false);
                      setFunctionSignatureExpanded(false);
                      setDraftError(null);
                      setDraftInput(event.currentTarget.value);
                      onDraftInputChange(event.currentTarget.value);
                      syncedActiveReferenceTokenIdRef.current = null;
                      explicitReferenceViewRef.current = null;
                      pointGestureReplacementRef.current = null;
                      onActiveReferenceTokenChange(null);
                    }}
                    onKeyDown={(event) => {
                  if (isComposingInput || isImeKeyboardEvent(event)) {
                    return;
                  }
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End") {
                    cancelPendingEditorSelectionRestore();
                    guardedFunctionCloseParenRef.current = null;
                  }
                  if (event.key === "Enter" && event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                  if (handleFunctionAssistantKeyDown(event)) {
                    return;
                  }
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
                  if (
                    !event.shiftKey &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey &&
                    (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End")
                  ) {
                    const editor = sourceEditorRef.current;
                    if (editor) {
                      const selection = getEditableSelectionOffsets(editor);
                      const nextCaret = resolveEditorNavigationCaret(selection, draftInput.length, event.key);
                      if (nextCaret !== null) {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraftError(null);
                        focusEditorAt(nextCaret);
                        return;
                      }
                    }
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
                  if (isEscapeKey(event.key)) {
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
              <div className="formula-editor-wrap">
              <textarea
                ref={sourcePlainInputRef}
                className={`formula-source formula-source-input formula-plain-textarea is-editing${multilineText ? " is-multiline" : ""}`}
                rows={1}
                wrap={canInsertLineBreak ? "soft" : "off"}
                aria-multiline={canInsertLineBreak}
                aria-description={canInsertLineBreak ? "Enter to apply; Shift+Enter for a new line" : "Enter to apply"}
                onBeforeInput={event => {
                  const native = event.nativeEvent as InputEvent;
                  if ((native.inputType === "insertLineBreak" || native.inputType === "insertParagraph") && !acceptsLineBreakAtSelection(event.currentTarget)) event.preventDefault();
                }}
                value={draftInput}
                spellCheck={false}
                aria-label="Edit selected cell input"
                onCompositionStart={beginInputComposition}
                onCompositionEnd={(event) => endPlainInputComposition(event.currentTarget)}
                onChange={(event) => {
                  cancelPendingEditorSelectionRestore();
                  setFunctionAssistantPinned(false);
                  setFunctionSignatureExpanded(false);
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
                  if (isComposingInput || isImeKeyboardEvent(event)) {
                    return;
                  }
                  if (event.key === "Enter" && event.shiftKey) {
                    event.stopPropagation();
                    if (!acceptsLineBreakAtSelection(event.currentTarget) || event.metaKey || event.ctrlKey || event.altKey) event.preventDefault();
                    return;
                  }
                  if (handleFunctionAssistantKeyDown(event)) {
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
                  if (isEscapeKey(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (shouldShowFunctionAssistant) {
                      dismissFunctionAssistant();
                      return;
                    }
                    cancelEditInput();
                  }
                }}
              />
              {draftError ? <div className="formula-draft-error" role="alert">{draftError}</div> : null}
              </div>
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
                <span className="formula-input-preview">{inputPreview.text}</span>
                {inputPreview.lineCount > 1 ? <span className="formula-input-line-count">{inputPreview.lineCount} lines</span> : null}
              </button>
            )}
            {shouldShowFunctionAssistant && selectedFunctionMetadata ? (
              <EditorPopover
                grow="up"
                className="formula-assistant-popover"
                data-mode={functionAssistantMode}
                role="dialog"
                aria-label="Formula assistant"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                {shouldShowFunctionList ? (
                  <div className="formula-assistant-list-panel">
                    <div ref={functionAssistantListRef} className="formula-assistant-list" role="listbox" aria-label="Functions">
                      {functionSuggestions.length > 0 ? (
                        functionSuggestions.map((suggestion, index) => (
                          <button
                            key={suggestion.key}
                            className={
                              index === functionAssistantSelectedIndex
                                ? "formula-assistant-option is-active"
                                : "formula-assistant-option"
                            }
                            type="button"
                            role="option"
                            aria-selected={index === functionAssistantSelectedIndex}
                            onMouseEnter={() => setFunctionAssistantSelectedIndex(index)}
                            onClick={() => insertFunctionCall(suggestion)}
                          >
                            <span className="formula-assistant-option-main">
                              <span className="formula-assistant-option-icon" aria-hidden="true">
                                {iconForFormulaAssistant(suggestion.metadata.category)}
                              </span>
                              <span className="formula-assistant-option-name">{suggestion.displayName}</span>
                            </span>
                            <span className="formula-assistant-option-summary">{summaryLabelForFormulaAssistant(locale, suggestion.metadata)}</span>
                            <span className="formula-assistant-option-category">{getFormulaFunctionCategoryLabel(locale, suggestion.metadata.category)}</span>
                          </button>
                        ))
                      ) : (
                        <div className="formula-assistant-empty">No matching functions</div>
                      )}
                    </div>
                    <div className="formula-assistant-footer" aria-hidden="true">
                      <span>↑↓ Select</span>
                      <span>↵ Insert</span>
                      <span>esc Close</span>
                    </div>
                  </div>
                ) : shouldShowFunctionCompact ? (
                  <div className="formula-assistant-compact">
                    <span className="formula-assistant-compact-main">
                      <span className="formula-assistant-option-icon" aria-hidden="true">
                        {iconForFormulaAssistant(selectedFunctionMetadata.category)}
                      </span>
                      <span className="formula-assistant-compact-signature">
                        <span className="formula-assistant-compact-name">{selectedFunctionDisplayName}</span>
                        <span>(</span>
                        <span>{typeLabelForFormulaAssistant(selectedFunctionMetadata.signatures[0]?.parameters[0]?.type ?? "value")}</span>
                        <span>)</span>
                      </span>
                    </span>
                    <span className="formula-assistant-compact-action">
                      <kbd>Tab</kbd>
                      <span>Insert</span>
                    </span>
                    <button
                      className="formula-assistant-expand-button"
                      type="button"
                      aria-label="Expand function suggestions"
                      onClick={() => {
                        setFunctionAssistantPinned(true);
                        setFunctionAssistantDismissedKey(null);
                      }}
                    >
                      <kbd>↓</kbd>
                      <span>Expand</span>
                    </button>
                  </div>
                ) : (
                  <div className={functionSignatureExpanded ? "formula-assistant-signature-panel is-expanded" : "formula-assistant-signature-panel"}>
                    <div className="formula-assistant-signature-head">
                      <div className="formula-assistant-signature-line">
                        <span className="formula-assistant-signature-name">{selectedFunctionDisplayName}</span>
                        <span>(</span>
                        {selectedFunctionSignature?.parameters.map((parameter, index) => (
                          <span key={parameter.name} className="formula-assistant-signature-param-wrap">
                            {index > 0 ? <span className="formula-assistant-punctuation">, </span> : null}
                            <span className={index === activeFunctionParameterIndex ? "formula-assistant-param is-active" : "formula-assistant-param"}>
                              {parameter.name}
                            </span>
                          </span>
                        ))}
                        <span>)</span>
                        <span className="formula-assistant-return">{` -> ${selectedFunctionSignature?.returns ?? "value"}`}</span>
                      </div>
                      <button
                        className="formula-assistant-signature-toggle"
                        type="button"
                        aria-label={functionSignatureExpanded ? "Collapse function help" : "Expand function help"}
                        onClick={() => setFunctionSignatureExpanded((expanded) => !expanded)}
                      >
                        <kbd>{functionSignatureExpanded ? "↑" : "↓"}</kbd>
                        {functionSignatureExpanded ? <span>Collapse</span> : null}
                      </button>
                    </div>
                    {functionSignatureExpanded ? (
                      <div className="formula-assistant-signature-grid">
                        <div className="formula-assistant-signature-column">
                          <span className="formula-assistant-signature-column-label">Parameter</span>
                          {selectedFunctionSignature?.parameters.map((parameter, index) => (
                            <div key={parameter.name} className={index === activeFunctionParameterIndex ? "formula-assistant-param-detail is-active" : "formula-assistant-param-detail"}>
                              <span className="formula-assistant-param-name">{parameterLabelForFormulaAssistant(parameter)}</span>
                              <span className="formula-assistant-param-type">{parameter.summary}</span>
                            </div>
                          ))}
                        </div>
                        <div className="formula-assistant-signature-column">
                          <span className="formula-assistant-signature-column-label">Description</span>
                          <span className="formula-assistant-signature-description">{selectedFunctionMetadata.summary}</span>
                        </div>
                        <div className="formula-assistant-signature-column">
                          <span className="formula-assistant-signature-column-label">Example</span>
                          {selectedFunctionMetadata.examples[0] ? (
                            <span className="formula-assistant-signature-example">{selectedFunctionMetadata.examples[0].expression}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : activeFunctionParameter ? (
                      <div className="formula-assistant-active-param">
                        <div className="formula-assistant-active-param-name">{parameterLabelForFormulaAssistant(activeFunctionParameter)}</div>
                        <div className="formula-assistant-active-param-summary">{activeFunctionParameter.summary}</div>
                      </div>
                    ) : (
                      <div className="formula-assistant-active-param">
                        <div className="formula-assistant-active-param-name">{selectedFunctionDisplayName}</div>
                        <div className="formula-assistant-active-param-summary">{selectedFunctionMetadata.summary}</div>
                      </div>
                    )}
                    <div className="formula-assistant-signature-footer">
                      <span>{`${Math.max(activeFunctionParameterIndex + 1, 0)} / ${selectedFunctionSignature?.parameters.length ?? 0} parameters`}</span>
                      <span>returns {returnLabelForFormulaAssistant(selectedFunctionMetadata)}</span>
                    </div>
                  </div>
                )}
              </EditorPopover>
            ) : null}
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
          </div>
        </div>
      </aside>
      {formatMenuOpen ? createPortal(
        <EditorPopover
          grow="up"
          ref={formatMenuRef}
          className="formula-format-menu open"
          role="menu"
          style={{
            bottom: `${formatMenuPosition.bottom}px`,
            maxHeight: `${formatMenuPosition.maxHeight}px`,
            left: `${formatMenuPosition.left}px`,
          }}
        >
          {hasFormatDisplayError ? (
            <div className="formula-menu-error-banner" role="status" aria-live="polite">
              <span className="formula-menu-error-icon"><BannerWarningGlyph /></span>
              <span className="formula-format-error-message">
                {primaryFormatErrorMessage}
                {formatErrors.length > 1 ? ` +${formatErrors.length - 1} more` : ""}
              </span>
            </div>
          ) : null}
          <FormatPreviewPanel
            grow="up"
            localFormatKey={localFormatKey}
            localFormatOptions={localFormatOptions}
            effectiveFormatKey={effectiveFormatKey}
            effectiveFormatOptions={effectiveFormatOptions}
            formatSource={formatSource}
            inspectedKey={menuPanelKey}
            previewContext={formulaBarSnapshot?.formatPreviewContext ?? null}
            onInspectKey={setMenuPanelKey}
            onChange={areDisplayControlsEditable ? (key, options) => onSetLocalFormat(key, options) : undefined}
            onRequestClose={() => {
              setFormatMenuOpen(false);
              setStyleMenuOpen(false);
            }}
          />
        </EditorPopover>,
        document.body,
      ) : null}
      {styleMenuOpen ? createPortal(
        <EditorPopover
          grow="up"
          ref={styleMenuRef}
          className="formula-style-menu open"
          role="menu"
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
        </EditorPopover>,
        document.body,
      ) : null}
    </>
  );
}
