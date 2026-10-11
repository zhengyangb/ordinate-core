import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { getPersistableText, defaultFileSessionStore } from "../store/fileSessionStore";
import { useEditorStore } from "../store/editorStore";
import { usePreferencesStore } from "../preferences/preferencesStore";
import { MicrophoneIcon, PlusIcon, SparklesIcon } from "../icons/uiIcons";
import { ChoiceMenu } from "../components/ChoiceMenu";
import { isUntouchedDefaultDocument } from "../platform/blankDocument";
import { AgentMarkdown } from "./AgentMarkdown";
import { AgentProcessSummary } from "./AgentProcessSummary";
import { AgentSessionMenu } from "./AgentSessionMenu";
import { AgentHeroMark } from "./AgentHeroMark";
import { AgentOverlayScrollbar } from "./AgentOverlayScrollbar";
import { AgentModelPicker } from "./AgentModelPicker";
import { createAgentConversation, groupAgentProcessUpdates, updateAgentConversation, type AgentChatMessage, type AgentConversation, type AgentProcessGroup } from "./agentConversations";
import { preferredAgentModel } from "./modelSelection";
import type { AgentBridge, AgentConnection, AgentModel, AgentPlanStep, AgentProposal, AgentTokenUsage } from "./contracts";
import { DEBUG_PROMPTS } from "./browserDebugAgent";
import { attachmentPickerAccept, checkAttachmentSelection, readAttachments } from "./attachments";
import { installFileDrop, type FileDropCue } from "../platform/fileDrop";
import { assistantWidthLimits, clampAssistantWidth } from "./agentPanelLayout";
import { formatAgentTaskTime } from "./agentTaskTime";
import { SystemDictationSession } from "./systemDictation";
import "./agentPanel.css";

type Conflict = { proposal: AgentProposal; reason: string };
type DraftSheet = { name: string; rowCount: number; columnCount: number };
type Activity = { itemId: string; label: string; status: "inProgress" | "completed" | "failed" };
const attachmentChoices = [
  { value: "image", label: "Add image…", detail: "PNG · JPEG · WebP" },
  { value: "document", label: "Add document…", detail: "PDF · text · data" },
] as const;

export function AgentPanel({ open, onClose, editingBlocked, bridge, onPreviewChange, debugMode = false }: { open: boolean; onClose: () => void; editingBlocked: boolean; bridge: AgentBridge; onPreviewChange: (preview: { text: string; initialSheet: string | null } | null) => void; debugMode?: boolean }) {
  const reasoningEffort = usePreferencesStore(state => state.preferences.agentReasoningEffort);
  const updatePreferences = usePreferencesStore(state => state.update);
  const dictation = useMemo(() => new SystemDictationSession(bridge), [bridge]);
  const [connection, setConnection] = useState<AgentConnection>(debugMode ? { state: "ready", email: null } : { state: "signed-out" });
  const [conversations, setConversations] = useState<AgentConversation[]>(() => [createAgentConversation()]);
  const [activeSessionId, setActiveSessionId] = useState(conversations[0].id);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const conversation = conversations.find(item => item.id === activeSessionId);
  if (!conversation) throw new Error(`Unknown active assistant conversation: ${activeSessionId}`);
  const { messages, draft, attachments, tokenUsage, hasStartedTurn } = conversation;
  const updateActive = (update: (item: AgentConversation) => AgentConversation) => {
    const id = activeSessionIdRef.current;
    setConversations(current => updateAgentConversation(current, id, update));
  };
  const resolve = <T,>(action: SetStateAction<T>, value: T): T => typeof action === "function" ? (action as (current: T) => T)(value) : action;
  const setMessages = (action: SetStateAction<AgentChatMessage[]>) => updateActive(item => ({ ...item, messages: resolve(action, item.messages) }));
  const setDraft = (action: SetStateAction<string>) => updateActive(item => ({ ...item, draft: resolve(action, item.draft) }));
  const setAttachments = (action: SetStateAction<File[]>) => updateActive(item => ({ ...item, attachments: resolve(action, item.attachments) }));
  const setTokenUsage = (usage: AgentTokenUsage | null) => updateActive(item => ({ ...item, tokenUsage: usage }));
  const setHasStartedTurn = (value: boolean) => updateActive(item => ({ ...item, hasStartedTurn: value }));
  const [dropCue, setDropCue] = useState<FileDropCue | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [notice, setNotice] = useState("");
  const [models, setModels] = useState<AgentModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [plan, setPlan] = useState<AgentPlanStep[] | null>(null);
  const [draftSheets, setDraftSheets] = useState<DraftSheet[] | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [panelWidth, setPanelWidth] = useState(360);
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const resizeSession = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const startedAt = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const addFilesRef = useRef<(files: readonly File[]) => void>(() => {});
  const followTranscript = useRef(true);
  const sendSnapshot = useRef<{ text: string; fileId: string | null } | null>(null);
  const previewInitialSheet = useRef<string | null>(null);
  const dropState = useRef({ open, busy, conflict, editingBlocked, connection });
  dropState.current = { open, busy, conflict, editingBlocked, connection };

  useEffect(() => {
    if (!open || connection.state !== "ready") {
      setAttachmentMenuOpen(false);
      setModelMenuOpen(false);
      setSessionMenuOpen(false);
    }
  }, [open, connection.state]);

  useLayoutEffect(() => {
    const workspace = panelRef.current?.parentElement;
    if (!workspace) throw new Error("Assistant panel requires a workspace.");
    const measure = () => setWorkspaceWidth(workspace.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (workspaceWidth !== null) setPanelWidth(current => clampAssistantWidth(current, workspaceWidth));
  }, [workspaceWidth]);

  useLayoutEffect(() => {
    if (connection.state !== "ready") { setComposerHeight(0); return; }
    const composer = composerRef.current;
    if (!composer) throw new Error("A ready assistant requires a composer.");
    const measure = () => setComposerHeight(Math.ceil(composer.getBoundingClientRect().height));
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    measure();
    return () => observer.disconnect();
  }, [connection.state]);

  function measuredWorkspaceWidth(): number {
    const workspace = panelRef.current?.parentElement;
    if (!workspace) throw new Error("Assistant panel requires a workspace.");
    return workspace.getBoundingClientRect().width;
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const panel = panelRef.current;
    if (!panel) throw new Error("Assistant resize requires a panel.");
    resizeSession.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: panel.getBoundingClientRect().width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    const session = resizeSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    setPanelWidth(clampAssistantWidth(session.startWidth + session.startX - event.clientX, measuredWorkspaceWidth()));
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const limits = assistantWidthLimits(measuredWorkspaceWidth());
    const step = event.shiftKey ? 48 : 16;
    const next = event.key === "ArrowLeft" ? panelWidth + step : event.key === "ArrowRight" ? panelWidth - step
      : event.key === "Home" ? limits.min : event.key === "End" ? limits.max : null;
    if (next === null) return;
    event.preventDefault();
    setPanelWidth(clampAssistantWidth(next, measuredWorkspaceWidth()));
  }

  function addFiles(files: readonly File[]) {
    try {
      const next = [...attachments, ...files];
      checkAttachmentSelection(next);
      setAttachments(next);
      setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }
  addFilesRef.current = addFiles;

  useEffect(() => {
    const target = panelRef.current;
    if (!target) throw new Error("Assistant panel requires a file drop region.");
    return installFileDrop(target, {
      scope: "assistant",
      canDrop: () => {
        const state = dropState.current;
        return state.open && !state.busy && !state.conflict && !state.editingBlocked && state.connection.state === "ready";
      },
      preview: setDropCue,
      receive: async file => { addFilesRef.current([file]); },
      report: async error => { setNotice(error instanceof Error ? error.message : String(error)); },
    });
  }, []);

  useEffect(() => {
    return bridge.onEvent(event => {
      if (event.type === "connection") { setConnection(event.connection); return; }
      if (event.type === "turn-started") { setBusy(true); setHasStartedTurn(true); return; }
      if (event.type === "token-usage") {
        setConversations(current => updateAgentConversation(current, event.sessionId, item => ({ ...item, tokenUsage: event.usage })));
        return;
      }
      if (event.type === "activity") {
        setActivities(previous => [...previous.map(item => item.itemId === "host-prep" ? { ...item, status: "completed" as const } : item),
          { itemId: event.itemId, label: event.label, status: "inProgress" as const }].slice(-4));
        return;
      }
      if (event.type === "activity-finished") {
        setActivities(previous => previous.map(item => item.itemId === event.itemId ? { ...item, status: event.status } : item));
        return;
      }
      if (event.type === "plan-updated") { setPlan(event.steps); return; }
      if (event.type === "draft-summary") { setDraftSheets(event.sheets); return; }
      if (event.type === "draft-preview") { onPreviewChange({ text: event.text, initialSheet: previewInitialSheet.current }); return; }
      if (event.type === "message-delta") {
        setMessages(previous => {
          const next = [...previous];
          const last = next.at(-1);
          if (last?.role === "assistant" && last.itemId === event.itemId) next[next.length - 1] = { ...last, text: last.text + event.text };
          else next.push({ role: "assistant", itemId: event.itemId, text: event.text, phase: event.phase });
          return next;
        });
        return;
      }
      const started = startedAt.current;
      if (started === null) throw new Error("A finished assistant task has no start time.");
      const finishedIn = `Finished in ${formatAgentTaskTime(performance.now() - started)}`;
      startedAt.current = null;
      setBusy(false);
      setStopping(false);
      if (event.type === "turn-stopped") {
        onPreviewChange(null);
        setMessages(previous => [...previous, { role: "status", text: `Stopped · ${finishedIn} · Workbook unchanged` }]);
        return;
      }
      if (event.error) {
        onPreviewChange(null);
        setMessages(previous => [...previous, { role: "status", text: `${event.error}\n${finishedIn}` }]);
        return;
      }
      if (!event.proposal) {
        onPreviewChange(null);
        setMessages(previous => [...previous, { role: "status", text: finishedIn }]);
        return;
      }
      const snapshot = sendSnapshot.current;
      const current = getPersistableText(useEditorStore.getState()).text;
      const fileId = defaultFileSessionStore.getState().file?.id ?? null;
      if (!snapshot || snapshot.text !== event.proposal.baseText || current !== snapshot.text || fileId !== snapshot.fileId) {
        onPreviewChange(null);
        setConflict({ proposal: event.proposal, reason: "The workbook changed while AI was working. Your edits were kept; the AI version was not applied." });
        setMessages(previous => [...previous, { role: "status", text: `${finishedIn} · Workbook not applied` }]);
        return;
      }
      try {
        useEditorStore.getState().applyDocumentTextChange("AI edit", event.proposal.text, event.proposal.focusSheet);
        onPreviewChange(null);
        void bridge.resolveProposal();
        setMessages(previous => [...previous, { role: "status", text: `Workbook updated · ${event.proposal!.validation} · ${finishedIn} · Undo available` }]);
      } catch (error) {
        onPreviewChange(null);
        setConflict({ proposal: event.proposal, reason: `The AI version was not applied: ${String(error)}` });
        setMessages(previous => [...previous, { role: "status", text: `${finishedIn} · Workbook not applied` }]);
      }
    });
  }, [bridge, onPreviewChange]);

  useEffect(() => {
    if (!open) return;
    void bridge.connection().then(setConnection, error => setConnection({ state: "unavailable", reason: String(error) }));
  }, [open, bridge]);

  useEffect(() => {
    if (!open || connection.state !== "ready") return;
    let current = true;
    setModelsLoading(true);
    setModelsError("");
    void bridge.models().then(choices => {
      if (!current) return;
      setModels(choices);
      setSelectedModel(previous => preferredAgentModel(choices, previous));
      setModelsLoading(false);
    }, error => {
      if (!current) return;
      setModels([]); setSelectedModel(null);
      setModelsError(String(error)); setModelsLoading(false);
    });
    return () => { current = false; };
  }, [open, bridge, connection.state, connection.state === "ready" ? connection.email : null]);

  useEffect(() => {
    if (!busy) return;
    const started = startedAt.current;
    if (started === null) throw new Error("A running assistant task has no start time.");
    const update = () => setElapsedSeconds(Math.floor((performance.now() - started) / 1000));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => { window.clearInterval(timer); setElapsedSeconds(0); };
  }, [busy]);

  useEffect(() => {
    if (followTranscript.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, conflict, activities, plan, draftSheets, busy]);

  useEffect(() => {
    if (followTranscript.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [composerHeight]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || conflict || editingBlocked || connection.state !== "ready" || modelsLoading || !selectedModel || (!draft.trim() && !attachments.length)) return;
    const sessionId = activeSessionIdRef.current;
    const snapshot = getPersistableText(useEditorStore.getState());
    if (snapshot.validity !== "valid_document") { setNotice("Resolve source issues before asking AI to edit this workbook."); return; }
    const message = draft.trim();
    try { await dictation.stop(); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return; }
    let prepared;
    try { prepared = await readAttachments(attachments); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return; }
    if (activeSessionIdRef.current !== sessionId) return;
    const current = { text: snapshot.text, fileId: defaultFileSessionStore.getState().file?.id ?? null };
    sendSnapshot.current = current;
    previewInitialSheet.current = useEditorStore.getState().activeSheet;
    startedAt.current = performance.now();
    onPreviewChange({ text: current.text, initialSheet: previewInitialSheet.current });
    followTranscript.current = true;
    setDraft(""); setAttachments([]); setNotice(""); setBusy(true); setHasStartedTurn(true); setTokenUsage(null); setAttachmentMenuOpen(false); setModelMenuOpen(false); setActivities([{ itemId: "host-prep", label: "Preparing the working copy", status: "inProgress" }]); setPlan(null); setDraftSheets(null);
    setStopping(false);
    setMessages(previous => [...previous, { role: "user", text: message, attachments: prepared.map(file => file.name) }]);
    try {
      await bridge.send({ sessionId, message, sourceText: current.text, activeSheet: useEditorStore.getState().activeSheet,
        untouchedDefault: isUntouchedDefaultDocument(defaultFileSessionStore.getState()), model: selectedModel, attachments: prepared,
        diagnosticLevel: usePreferencesStore.getState().preferences.agentDiagnosticLevel,
        reasoningEffort: usePreferencesStore.getState().preferences.agentReasoningEffort });
    } catch (error) {
      onPreviewChange(null);
      startedAt.current = null;
      setBusy(false);
      setStopping(false);
      setDraft(message);
      setAttachments(attachments);
      setNotice(error instanceof Error ? error.message : String(error));
      setMessages(previous => previous.at(-1)?.role === "user" ? previous.slice(0, -1) : previous);
    }
  }

  async function stop() {
    if (!busy || stopping) return;
    setStopping(true);
    try { await bridge.stop(); }
    catch (error) { setStopping(false); setNotice(error instanceof Error ? error.message : String(error)); }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function onComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  }

  function chooseAttachment(kind: (typeof attachmentChoices)[number]["value"]) {
    const input = fileInputRef.current;
    if (!input) throw new Error("Assistant file picker is unavailable.");
    input.accept = attachmentPickerAccept(kind);
    input.click();
  }

  async function startSystemDictation() {
    const prompt = promptRef.current;
    if (!prompt) throw new Error("Assistant input is unavailable.");
    prompt.focus();
    try { await dictation.start(); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }

  async function discardConflict() {
    await bridge.resolveProposal();
    setConflict(null);
    setMessages(previous => [...previous, { role: "status", text: "AI version discarded. Your workbook is unchanged." }]);
  }

  function activateConversation(id: string) {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
    setSessionMenuOpen(false);
    setNotice(""); setActivities([]); setPlan(null); setDraftSheets(null);
    followTranscript.current = true;
  }

  function showConversation(id: string) {
    if (busy || conflict) return;
    if (!conversations.some(item => item.id === id)) throw new Error(`Unknown assistant conversation: ${id}`);
    activateConversation(id);
  }

  function startConversation() {
    if (busy || conflict) return;
    const next = createAgentConversation();
    setConversations(current => [next, ...current]);
    activateConversation(next.id);
  }

  const widthLimits = workspaceWidth === null ? null : assistantWidthLimits(workspaceWidth);
  const displayedWidth = workspaceWidth === null ? undefined : clampAssistantWidth(panelWidth, workspaceWidth);
  const processGroups = useMemo(() => groupAgentProcessUpdates(messages), [messages]);
  const { processAtIndex, processAtStatus } = useMemo(() => {
    const processAtIndex = new Set<number>();
    const processAtStatus = new Map<number, AgentProcessGroup>();
    for (const group of processGroups.values()) {
      if (group.statusIndex === null) continue;
      processAtStatus.set(group.statusIndex, group);
      for (const update of group.updates) processAtIndex.add(update.index);
    }
    return { processAtIndex, processAtStatus };
  }, [processGroups]);
  const openAgentLink = (url: string) => { void bridge.openLink(url).catch(error => setNotice(`Could not open link: ${String(error)}`)); };
  const progress = busy && <section className="agent-working" aria-label="Assistant progress">
    <div className="agent-working-header"><span className="agent-working-dot" aria-hidden="true" /><strong>{stopping ? "Stopping…" : "Working on a copy"}</strong><time aria-label={`${elapsedSeconds} seconds elapsed`}>{elapsedSeconds}s</time></div>
    <div className="agent-working-content">
      {plan && plan.length > 0 && <ol className="agent-plan" aria-label="Plan">
        {plan.map((item, index) => <li className={`agent-plan-step agent-plan-step--${item.status}`} key={`${index}-${item.step}`}>
          <span className="agent-plan-marker" aria-hidden="true">{item.status === "completed" ? "✓" : ""}</span><span><span className="sr-only">{item.status === "inProgress" ? "In progress: " : `${item.status}: `}</span>{item.step}</span>
        </li>)}
      </ol>}
      <ol className="agent-activity" aria-label="Recent activity">{activities.map(item => <li className={`agent-activity-item agent-activity-item--${item.status}`} key={item.itemId}><span className="agent-activity-marker" aria-hidden="true">{item.status === "completed" ? "✓" : item.status === "failed" ? "!" : ""}</span><span><span className="sr-only">{item.status === "inProgress" ? "In progress: " : `${item.status}: `}</span>{item.label}</span></li>)}</ol>
      {draftSheets && <div className="agent-draft-summary">
        <span>Last validated preview · {draftSheets.length} {draftSheets.length === 1 ? "sheet" : "sheets"}</span>
        <ul>{draftSheets.slice(0, 4).map(sheet => <li key={sheet.name}>{sheet.name} <small>{sheet.rowCount} rows × {sheet.columnCount} columns</small></li>)}
          {draftSheets.length > 4 && <li>+{draftSheets.length - 4} more</li>}</ul>
        <small>Preview only · not applied to the editor</small>
      </div>}
    </div>
  </section>;
  const lastMessage = messages.at(-1);
  const streamingAnswer = busy && lastMessage?.role === "assistant" && lastMessage.phase !== "commentary";
  const selectedModelName = models.find(model => model.slug === selectedModel)?.displayName ?? (modelsLoading ? "Loading models…" : "Models unavailable");
  return <aside ref={panelRef} id="ordinate-agent-panel" className={open ? "agent-panel is-open" : "agent-panel"} style={{ "--agent-width": `${panelWidth}px`, "--agent-composer-height": `${composerHeight}px` } as CSSProperties} aria-label={debugMode ? "Assistant UI simulator" : "AI assistant"} aria-hidden={!open}>
    <div className="agent-resize-handle" role="separator" aria-label="Resize assistant" aria-orientation="vertical" aria-valuemin={widthLimits?.min} aria-valuemax={widthLimits?.max} aria-valuenow={displayedWidth} tabIndex={open ? 0 : -1}
      onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={() => { resizeSession.current = null; }} onPointerCancel={() => { resizeSession.current = null; }} onLostPointerCapture={() => { resizeSession.current = null; }} onKeyDown={resizeWithKeyboard} />
    {dropCue && <div className={`agent-attachment-drop agent-attachment-drop--${dropCue.kind}`} role="status">{dropCue.kind === "blocked" ? dropCue.message : "Drop to attach to this message"}</div>}
    <header className="agent-panel-header">
      <div className="agent-panel-title"><SparklesIcon /><span>Assistant</span><span className="agent-beta">Beta</span></div>
      <div className="agent-panel-header-actions">
        {connection.state === "ready" && <AgentSessionMenu open={sessionMenuOpen} onOpenChange={setSessionMenuOpen}
          conversations={conversations} activeSessionId={activeSessionId} onSelect={showConversation} onNew={startConversation}
          disabled={busy || Boolean(conflict)} tokenUsage={tokenUsage} usagePending={busy} hasStartedTurn={hasStartedTurn}
          accountEmail={debugMode ? null : connection.email} debugMode={debugMode} />}
        <button type="button" className="agent-close" onClick={onClose} aria-label="Close assistant" disabled={busy}>×</button>
      </div>
    </header>
    <div className={connection.state === "ready" ? "agent-transcript-frame has-composer" : "agent-transcript-frame"}>
    <div className={connection.state === "ready" ? "agent-transcript has-composer" : "agent-transcript"} ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions text" onScroll={event => {
      const element = event.currentTarget;
      followTranscript.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
    }}>
      <div ref={scrollContentRef} className="agent-transcript-content">
      {connection.state === "unavailable" ? <div className="agent-intro">
        <div className="agent-intro-glyph"><SparklesIcon /></div>
        <h2>Ask about your workbook</h2>
        <p>{connection.reason}</p>
        <button type="button" className="agent-connect" onClick={() => {
          void bridge.connection().then(setConnection);
        }}>Retry connection</button>
      </div> : connection.state === "signed-out" || connection.state === "signing-in" || connection.state === "sign-in-error" ? <div className="agent-intro">
        <AgentHeroMark />
        <h2>Work alongside your model</h2>
        <p>Connect ChatGPT to ask questions and make changes across this workbook.</p>
        {connection.state === "sign-in-error" && <p role="alert">{connection.reason}</p>}
        <button type="button" className="agent-connect" disabled={connection.state === "signing-in"} onClick={() => {
          void bridge.login().catch(error => setConnection({ state: "unavailable", reason: String(error) }));
        }}>{connection.state === "signing-in" ? "Finish signing in in your browser…" : "Continue with ChatGPT"}</button>
        <small>The assistant works on a temporary copy and syncs validated changes back to this document.</small>
      </div> : messages.length === 0 ? <div className="agent-intro">
        <AgentHeroMark />
        <h2>{debugMode ? "Try the assistant workflow" : "Ask about your workbook"}</h2>
        <p>{debugMode ? "Fixed scenarios exercise editing, progress, validation, and undo. No model is running. The first scenario replaces this workbook; Undo restores it." : "Explore a formula, check a model, or describe a change. Your current sheet is included as context."}</p>
        {debugMode && <div className="agent-debug-prompts" aria-label="Simulation scenarios">{DEBUG_PROMPTS.map(prompt => <button type="button" key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>)}</div>}
      </div> : messages.map((message, index) => {
        if (processAtIndex.has(index)) return null;
        const statusProcessGroup = processAtStatus.get(index);
        return <Fragment key={index}>
        {streamingAnswer && index === messages.length - 1 && progress}
        <div role="group" aria-label={message.role === "user" ? "Your message" : message.role === "status" ? "Assistant status" : message.phase === "commentary" ? "Assistant progress update" : "Assistant message"}
          className={`agent-message agent-message--${message.role}${message.role === "assistant" && message.phase === "commentary" ? ` agent-message--commentary${busy && index === messages.length - 1 ? " agent-message--commentary-active" : ""}` : ""}`}>
        {message.role === "status" ? <div>{message.text}{statusProcessGroup && <AgentProcessSummary group={statusProcessGroup} onOpenLink={openAgentLink} />}</div> : <AgentMarkdown text={message.text} onOpenLink={openAgentLink} />}
        {message.role === "user" && message.attachments.length > 0 && <div className="agent-message-files">{message.attachments.map((name, fileIndex) => <span key={`${fileIndex}-${name}`}>{name}</span>)}</div>}
        </div>
      </Fragment>; })}
      {busy && !streamingAnswer && progress}
      {conflict && <div className="agent-conflict" role="alert">
        <strong>Workbook changed during the request</strong>
        <p>{conflict.reason}</p>
        <button type="button" onClick={discardConflict}>Discard AI version</button>
      </div>}
      {debugMode && messages.length > 0 && !busy && !conflict && <div className="agent-debug-prompts agent-debug-prompts--followup" aria-label="Simulation scenarios">{DEBUG_PROMPTS.map(prompt => <button type="button" key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>)}</div>}
      </div>
    </div>
    <AgentOverlayScrollbar open={open} scrollRef={scrollRef} contentRef={scrollContentRef} />
    </div>
    {connection.state === "ready" && <form ref={composerRef} className="agent-composer" onSubmit={send}>
      {notice && <div className="agent-composer-notice" role="alert">{notice}</div>}
      {modelsError && <div className="agent-composer-notice" role="alert">{modelsError}</div>}
      <div className="agent-composer-field">
        {attachments.length > 0 && <div className="agent-attachment-list" aria-label="Attached files">{attachments.map((file, index) => <span className="agent-attachment-chip" key={`${index}-${file.name}`}><span title={file.name}>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments(current => current.filter((_, item) => item !== index))}>×</button></span>)}</div>}
        <label htmlFor="agent-prompt" className="agent-composer-visually-hidden">Message to assistant</label>
        <textarea ref={promptRef} id="agent-prompt" rows={1} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} onPaste={onComposerPaste}
          placeholder="Ask about this workbook…" disabled={busy || Boolean(conflict) || editingBlocked || modelsLoading || !selectedModel} />
        <div className="agent-composer-actions">
        <input ref={fileInputRef} hidden type="file" multiple onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <div className="agent-composer-options">
          <ChoiceMenu portal open={attachmentMenuOpen} onOpenChange={next => { setAttachmentMenuOpen(next); if (next) setModelMenuOpen(false); }}
            onChoose={chooseAttachment} label="Add attachment" options={attachmentChoices}
            buttonProps={{ className: "agent-attach-button", "aria-label": "Add attachment", title: "Attach or drop files",
              disabled: busy || Boolean(conflict) || editingBlocked, children: <PlusIcon /> }} />
          {!debugMode && <button type="button" className="agent-dictation-button" aria-label="Start macOS Dictation" title="Dictate with macOS" onMouseDown={event => event.preventDefault()} onClick={() => { void startSystemDictation(); }} disabled={busy || Boolean(conflict) || editingBlocked || modelsLoading || !selectedModel}><MicrophoneIcon /></button>}
          <AgentModelPicker open={modelMenuOpen} onOpenChange={next => { setModelMenuOpen(next); if (next) setAttachmentMenuOpen(false); }}
            models={models} selectedModel={selectedModel} selectedName={selectedModelName} onSelectModel={setSelectedModel}
            effort={reasoningEffort} onEffortChange={agentReasoningEffort => updatePreferences({ agentReasoningEffort })}
            disabled={busy || modelsLoading || models.length === 0} />
        </div>
        {busy ? <button type="button" className="agent-run-button agent-stop-button" aria-label={stopping ? "Stopping assistant" : "Stop assistant"} title={stopping ? "Stopping…" : "Stop"} disabled={stopping} onClick={() => { void stop(); }}>
          <svg aria-hidden="true" viewBox="0 0 20 20"><rect x="6" y="6" width="8" height="8" rx="1.4" fill="currentColor" /></svg>
        </button> : <button type="submit" className="agent-run-button" aria-label="Send message" disabled={Boolean(conflict) || editingBlocked || modelsLoading || !selectedModel || (!draft.trim() && !attachments.length)}>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M10 16V4m0 0L5.75 8.25M10 4l4.25 4.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>}
        </div>
      </div>
    </form>}
  </aside>;
}
