import { useCallback, useEffect, useId, useRef, useState } from "react";
import ModalShell from "../components/ModalShell";
import { ChoiceMenu } from "../components/ChoiceMenu";
import type { ImportSheetHeaders, ExcelNoteChoice } from "@ordinate/core";
import { ImportClient } from "./importClient";
import { ImportPreview } from "./ImportPreview";
import { ExcelExportOptions, ExportSummary } from "./ExcelExportOptions";
import { SelectionRow } from "../components/SelectionRow";
import { BrowserOpenDialog } from "./BrowserOpenDialog";
import { useEditorStore } from "../store/editorStore";
import { defaultFileSessionStore, getPersistableText } from "../store/fileSessionStore";
import { createBrowserInterchange, readImportFile } from "./browserTransport";
import { installFileDrop, type FileDropCue } from "../platform/fileDrop";
import { delimitedExportName, FORMATS, importFormat, importedDocumentName, type ExportFile, type ExportFormat, type ImportFile } from "./contracts";
import { documentName } from "../platform/documentName";
import { convertExport, describeExcelExport, diagnosticLocation, groupDiagnostics, requiresImportConsent, type PreparedImport, type ConversionDiagnostic } from "./conversion";
import "./interchange.css";

type Request = {
  source: string; name: string;
  fileId: string | null; sheets: string[]; activeSheet: string | null;
} & ({ kind: "import"; file?: ImportFile } | { kind: "export"; format: ExportFormat });

function InterchangeDialog({ request, onClose }: { request: Request; onClose: () => void }) {
  const titleId = useId(), helpId = useId();
  const importing = request.kind === "import";
  const dropTarget = useRef<HTMLDivElement>(null);
  const [dropCue, setDropCue] = useState<FileDropCue | null>(null);
  const format = request.kind === "export" ? request.format : null;
  const delimited = format === "csv" || format === "tsv";
  const [excelSummary] = useState(() => format === "xlsx" ? describeExcelExport(request.source, request.name) : null);
  const [freezeHeaders, setFreezeHeaders] = useState(false);
  const [keepResults, setKeepResults] = useState(true);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState(request.activeSheet ?? request.sheets[0] ?? "");
  const [sheetMenuOpen, setSheetMenuOpen] = useState(false);
  const [valueMenuOpen, setValueMenuOpen] = useState(false);
  const [valueMode, setValueMode] = useState<"text" | "infer">("text");
  const [preserve, setPreserve] = useState(false);
  const [file, setFile] = useState<ImportFile | null>(request.kind === "import" ? request.file ?? null : null);
  const [reading, setReading] = useState(!!file);
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [headers, setHeaders] = useState<ImportSheetHeaders[]>([]);
  const [notes,setNotes]=useState<ExcelNoteChoice[]>([]);
  const importer=useRef<ImportClient|null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [preparedExport, setPreparedExport] = useState<ExportFile | null>(null);
  const [diagnostics, setDiagnostics] = useState<ConversionDiagnostic[]>([]);
  const [hasExportNotes, setHasExportNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(delimited || format === "xlsx");
  const busyRef = useRef(false), mounted = useRef(true), generation = useRef(0);
  const [transport] = useState(() => window.ordinateDesktop ? window.ordinateDesktop.interchange : createBrowserInterchange());
  const exportSummary = excelSummary ?? (delimited ? {name:delimitedExportName(request.name,format,sheet),sheetCount:1} : null);
  const desktop = !!window.ordinateDesktop;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; importer.current?.dispose(); importer.current=null; }; }, []);
  const close = useCallback(() => { if (!busyRef.current) onClose(); }, [onClose]);
  const reset = () => { generation.current++; setConfiguring(false); setPrepared(null); setHeaders([]); setNotes([]); setPreparedExport(null); setDiagnostics([]); setError(null); importer.current?.dispose(); importer.current=null; };
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { await action(); }
    catch (issue) { if (mounted.current) setError(issue instanceof Error ? issue.message : String(issue)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const selectFile = (chosen: ImportFile) => { reset(); setReading(true); setFile(chosen); };
  const pick = () => run(async () => {
    const chosen = await transport.pickImport();
    if (chosen && mounted.current) selectFile(chosen);
  });
  useEffect(() => {
    if (!importing) return;
    const target = dropTarget.current;
    if (!target) throw new Error("import dialog requires a file drop region");
    return installFileDrop(target, {
      scope: "import",
      canDrop: () => !busyRef.current && !reading && !configuring,
      preview: setDropCue,
      receive: async dropped => {
        await run(async () => {
          const chosen = await readImportFile(dropped);
          if (mounted.current) selectFile(chosen);
        });
      },
      report: async issue => { if (mounted.current) setError(issue instanceof Error ? issue.message : String(issue)); },
    });
  }, [importing, reading, configuring]);
  // A selected file is the request to prepare a preview, not an extra wizard
  // step. CSV value-mode edits keep the user's header choices. Choosing another
  // file resets them before this effect runs. Cleanup also cancels stale work.
  useEffect(() => {
    if (!file) return;
    const currentGeneration = ++generation.current;
    const client = new ImportClient();
    importer.current = client;
    setReading(true); setPrepared(null); setDiagnostics([]); setError(null);
    void client.request({kind:"prepare",file,valueMode,headers}).then(result => {
      if (!mounted.current || currentGeneration !== generation.current) return;
      setDiagnostics(result.diagnostics);
      if (result.ok) {
        setPrepared(result.value); setNotes(result.value.notes);
        setHeaders(result.value.preview.map(({sheetName,headerRows,headerColumns})=>({sheetName,headerRows,headerColumns})));
      } else setError("Could not import this file.");
    }).catch(issue => {
      if (mounted.current && currentGeneration === generation.current) setError(issue instanceof Error ? issue.message : String(issue));
    }).finally(() => {
      if (mounted.current && currentGeneration === generation.current) setReading(false);
    });
    return () => { generation.current++; client.dispose(); if (importer.current === client) importer.current = null; };
  }, [file, valueMode]);
  const configure = async (choices: ImportSheetHeaders[], noteChoices:ExcelNoteChoice[]) => {
    if (!importer.current) return;
    const currentGeneration = ++generation.current;
    setHeaders(choices); setNotes(noteChoices); setConfiguring(true); setError(null);
    try {
      const result=await importer.current.request({kind:"configure",headers:choices,notes:noteChoices});
      if (!mounted.current || generation.current!==currentGeneration) return;
      if (result.ok) { setPrepared(result.value); setDiagnostics(result.diagnostics); }
      else setError(result.diagnostics.find(item=>item.severity==='error')?.message ?? 'Could not apply header settings.');
    } catch (issue) {
      if (mounted.current && generation.current===currentGeneration) setError(issue instanceof Error?issue.message:String(issue));
    } finally {
      if (mounted.current && generation.current===currentGeneration) setConfiguring(false);
    }
  };
  // Preparing is read-only. Changing an option invalidates the previous bytes;
  // a slower, older conversion must never replace the current selection.
  // Keep the last review visible until replacement for every export format.
  // Its bounded region stays mounted even if a new result has no warnings.
  const invalidateExport = () => { generation.current++; setPreparedExport(null); setAnalyzing(true); };
  useEffect(() => {
    if (!format || format === "ord") return;
    const currentGeneration = ++generation.current;
    setPreparedExport(null);
    setAnalyzing(true);
    void convertExport(request.source, format, request.name, sheet, preserve, { freezeHeaders, unsupportedFormulas:keepResults ? "value" : "reject" }).then(result => {
      if (!mounted.current || generation.current !== currentGeneration) return;
      setDiagnostics(result.diagnostics);
      if (result.diagnostics.length) setHasExportNotes(true);
      setError(null);
      if (result.ok) setPreparedExport(result.value);
    }).catch(issue => {
      if (mounted.current && generation.current === currentGeneration) setError(issue instanceof Error ? issue.message : String(issue));
    }).finally(() => {
      if (mounted.current && generation.current === currentGeneration) setAnalyzing(false);
    });
    return () => { generation.current++; };
  }, [format, request.source, request.name, sheet, preserve, freezeHeaders, keepResults]);
  const exportFile = () => run(async () => {
    if (!format) throw new Error("Choose an export format.");
    if (preparedExport) {
      const outcome = await transport.saveExport(preparedExport);
      if (mounted.current && outcome) onClose();
      return;
    }
    if (format !== "ord") throw new Error("Wait for export preparation to finish.");
    reset();
    const result = await convertExport(request.source, format, request.name, sheet, preserve);
    if (!mounted.current) return;
    if (!result.ok) { setDiagnostics(result.diagnostics); setError("Could not export this file."); return; }
    if (result.diagnostics.length) {
      setPreparedExport(result.value);
      setDiagnostics(result.diagnostics);
      return;
    }
    const outcome = await transport.saveExport(result.value);
    if (!mounted.current) return;
    if (!outcome) { onClose(); return; }
    onClose();
  });
  const automaticExport = useRef(false);
  useEffect(() => {
    if (format === "ord" && !automaticExport.current) { automaticExport.current = true; void exportFile(); }
  }, [format]);
  const accept = () => run(async () => {
    if (!prepared) throw new Error("Review the conversion first.");
    if (!file) throw new Error("No import file selected.");
    const name = importedDocumentName(file.name);
    if (configuring || error) throw new Error("Resolve the header settings before importing.");
    // Clicking the explicitly labelled final action acknowledges this exact
    // prepared result. No separately latched consent can outlive a settings edit.
    if (window.ordinateDesktop) await window.ordinateDesktop.openImportedDocument(prepared.text, name);
    else {
      const state = defaultFileSessionStore.getState();
      if ((state.file?.id ?? null) !== request.fileId || getPersistableText(useEditorStore.getState()).text !== request.source) {
        throw new Error("Your document changed while reviewing. Close this dialog and start Import again.");
      }
      state.importUntitled(prepared.text, name);
      await defaultFileSessionStore.getState().autosaveNow();
    }
    onClose();
  });
  const conversionNotes = !!diagnostics.length && <ul className="interchange-diagnostics selectable-text" aria-label="Conversion notes" tabIndex={importing ? 0 : undefined}>
    {groupDiagnostics(diagnostics).map(({ item, title, count, messages, sheets }, index) => <li key={index} data-severity={item.severity}>
      <strong className="interchange-diagnostic-label" data-loss={item.code === "cell_omitted" || item.severity === "error"}>{title}</strong>
      <span>{messages.join(" ")}</span>
      <small>{count > 1 ? `${count} notices${sheets.length > 1 ? ` across ${sheets.length} sheets` : ""} · First: ` : ""}{diagnosticLocation(item) || "Workbook"}</small>
    </li>)}
  </ul>;
  return <ModalShell open className={`interchange-dialog${importing && file ? ' interchange-dialog--preview' : ''}${!importing ? ' interchange-dialog--export' : ' interchange-dialog--import'}`} titleId={titleId} descriptionId={importing ? helpId : undefined} initialFocusRef={exportSummary ? cancelButton : undefined} onClose={close}>
    <div ref={dropTarget} className={`app-modal-content${importing ? ' interchange-import-drop-target' : ''}`}>
      {importing && dropCue && <div className="interchange-import-drop-cue" data-kind={dropCue.kind} role="status">
        <span>{dropCue.kind === "blocked" ? dropCue.message : "Drop spreadsheet"}</span>
      </div>}
      <header className="app-modal-header"><h2 id={titleId}>{importing ? "Import spreadsheet" : excelSummary ? "Export Excel" : `Export ${FORMATS[format!].label}`}</h2>
        {exportSummary && <ExportSummary summary={exportSummary} />}
        {importing && file && <span className="interchange-filename" title={file.name}>{file.name}</span>}
      </header>
      <div className="app-modal-body interchange-body" aria-busy={busy || reading || analyzing || configuring}>
        {importing && <p id={helpId}>{desktop ? "Import into a new tab." : "Import as a new document in this window."}</p>}
        {excelSummary && <ExcelExportOptions summary={excelSummary} freezeHeaders={freezeHeaders} keepResults={keepResults} disabled={busy}
          onKeepResultsToggle={() => { invalidateExport(); setKeepResults(value=>!value); }}
          onToggle={() => { invalidateExport(); setFreezeHeaders(value => !value); }} />}
        {((importing && (!file || importFormat(file.name) !== "xlsx")) || delimited) && <fieldset disabled={busy || reading || configuring} className="interchange-fields">
          {importing ? <>
            {!file && <>
              <button type="button" className="app-modal-action secondary" onClick={pick}>Choose file…</button>
              <small className="interchange-import-types">Excel (.xlsx), CSV, TSV · or drop a file here</small>
            </>}
            {file && importFormat(file.name) !== "xlsx" && <div className="interchange-field"><span>Read values as</span>
              <ChoiceMenu portal open={valueMenuOpen} onOpenChange={setValueMenuOpen} label="Read values as" selected={valueMode}
                onChoose={value => { if (value !== valueMode) { setPrepared(null); setReading(true); setValueMode(value); } }} options={[{value:"text", label:"Text"}, {value:"infer", label:"Detect numbers and booleans"}]}
                buttonProps={{className:"interchange-select", "aria-label":"Read values as", children:<>{valueMode === "text" ? "Text" : "Detect numbers and booleans"}<span aria-hidden="true">⌄</span></>}} />
              <small>Text preserves leading zeros.</small>
            </div>}
          </> : <>
            {delimited && <>
              <div className="interchange-field"><span>Sheet</span>
                <ChoiceMenu portal open={sheetMenuOpen} onOpenChange={setSheetMenuOpen} label="Sheet" selected={sheet}
                  onChoose={value => { if (value !== sheet) { invalidateExport(); setSheet(value); } }} options={request.sheets.map(name => ({value:name, label:name}))}
                  buttonProps={{className:"interchange-select", "aria-label":"Sheet", children:<><span>{sheet}</span><span aria-hidden="true">⌄</span></>}} />
              </div>
              <SelectionRow label="Allow formula-like text" description="May run as formulas in other apps."
                selected={preserve} disabled={busy} onToggle={() => { invalidateExport(); setPreserve(value => !value); }} />
            </>}
          </>}
        </fieldset>}
        {importing && error && <p className="interchange-error" role="alert">{error}</p>}
        {prepared && <section className="interchange-review" aria-label="Conversion review">
          <ImportPreview sheets={prepared.preview} choices={headers} onChange={choices=>void configure(choices,notes)} disabled={busy || configuring}
            noteCandidates={prepared.noteCandidates} notes={notes} onNotesChange={choices=>void configure(headers,choices)} />
          {!desktop && <p className="interchange-warning">Replaces this document and its undo history. Save your work first.</p>}
        </section>}
        {importing ? conversionNotes : (hasExportNotes || error) && <section className="interchange-export-notes" aria-label="Export notes" tabIndex={0}>
          {error && <p className="interchange-error" role="alert">{error}</p>}
          {conversionNotes}
        </section>}
        {busy && importing && <p role="status">Working…</p>}
        {reading && <p role="status">Reading spreadsheet…</p>}
        {configuring && <p role="status">Updating preview…</p>}
      </div>
      <footer className="app-modal-actions">
        {!importing && <span className="interchange-export-status" role="status">{busy ? "Saving…" : ""}</span>}
        <button ref={cancelButton} type="button" className="app-modal-action secondary" onClick={close} disabled={busy}>Cancel</button>
        {importing && file && <button type="button" className="app-modal-action secondary" disabled={busy} onClick={pick}>Change file…</button>}
        {(!importing || file) && <button type="button" className="app-modal-action primary" disabled={busy || reading || analyzing || configuring || (importing ? !prepared || !!error : !preparedExport)} onClick={importing ? accept : exportFile}>
          {importing ? requiresImportConsent(diagnostics) ? "Acknowledge and continue" : desktop ? "Open in new tab" : "Replace & import" : "Export"}
        </button>}
      </footer>
    </div>
  </ModalShell>;
}

export function useInterchangeController(prepare: () => void, openFromLink?: () => void) {
  const [request, setRequest] = useState<Request | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [openDocument, setOpenDocument] = useState<(() => void) | null>(null);
  const close = useCallback(() => { setRequest(null); setOpenDocument(null); }, []);
  const start = useCallback((target: { kind: "import"; file?: ImportFile } | { kind: "export"; format: ExportFormat }) => {
    if (request) return;
    prepare();
    setExportMenuOpen(false);
    setOpenDocument(null);
    const state = useEditorStore.getState(), session = defaultFileSessionStore.getState();
    const snapshot = getPersistableText(state);
    setRequest({ ...target, source: snapshot.text, name: documentName(session),
      fileId: session.file?.id ?? null, sheets: state.docState?.sheets.map(s => s.name) ?? [], activeSheet: state.activeSheet });
  }, [prepare, request]);
  return { openImport: useCallback((file?: ImportFile) => start({kind: "import", file}), [start]),
    openExport: useCallback(() => { if (!request) setExportMenuOpen(true); }, [request]), exportMenuOpen, setExportMenuOpen,
    selectExportFormat: useCallback((format: ExportFormat) => start({kind: "export", format}), [start]),
    openBrowserFile: useCallback((open: () => void) => { if (!request) setOpenDocument(() => open); }, [request]),
    dialog: request ? <InterchangeDialog request={request} onClose={close} /> : openDocument ?
      <BrowserOpenDialog onClose={close} onOpenDocument={() => { close(); openDocument(); }}
        onOpenLink={openFromLink ? () => { close(); openFromLink(); } : undefined}
        onImport={() => start({kind: "import"})} /> : null };
}
