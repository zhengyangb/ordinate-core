import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ImportSheetHeaders, ExcelNoteCandidate, ExcelNoteChoice, SheetNotePosition } from "@ordinate/core";
import {parseSheetNote} from "@ordinate/core";
import {NoteContent} from "../notes/NoteContent";
import { ChoiceMenu } from "../components/ChoiceMenu";
import { IntegerStepper } from "../components/IntegerStepper";
import { toColumnLetters } from "../utils/appHelpers";
import type { ImportSheetPreview } from "./conversion";
import { ImportNoteChoice, importNoteLabel, importNoteSource } from "./ImportNoteChoice";

export function ImportPreview({sheets, choices, onChange, disabled, noteCandidates, notes, onNotesChange}: {
  sheets: ImportSheetPreview[]; choices: ImportSheetHeaders[];
  onChange: (choices: ImportSheetHeaders[]) => void; disabled: boolean;
  noteCandidates:ExcelNoteCandidate[]; notes:ExcelNoteChoice[]; onNotesChange:(choices:ExcelNoteChoice[])=>void;
}) {
  const [active, setActive] = useState(sheets[0].sheetName), [open,setOpen] = useState(false);
  const [previewPosition, setPreviewPosition] = useState<SheetNotePosition | null>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null), closePreviewButton = useRef<HTMLButtonElement>(null);
  const candidates = useMemo(() => noteCandidates.filter(candidate => candidate.sheetName === active)
    .map(candidate => ({ candidate, note: parseSheetNote(candidate.markdown) })), [noteCandidates, active]);
  const preview = candidates.find(({candidate}) => candidate.position === previewPosition);
  useEffect(() => { if (previewPosition) closePreviewButton.current?.focus({preventScroll:true}); }, [previewPosition]);
  const closePreview = () => {
    setPreviewPosition(null);
    previewTrigger.current?.focus({preventScroll:true});
  };
  const id=useId();
  const sheet=sheets.find(sheet=>sheet.sheetName===active)!;
  const choice=choices.find(choice=>choice.sheetName===active)!;
  const change=(field:"headerRows"|"headerColumns", value:number) => {
    setPreviewPosition(null);
    onChange(choices.map(item=>item.sheetName===active?{...item,[field]:value}:item));
  };
  return <section className="import-preview" aria-label="Import preview">
    <div className="import-preview-controls">
      <div className="interchange-field import-preview-sheet"><span>Sheet</span>
        <ChoiceMenu portal open={open} onOpenChange={setOpen} label="Preview sheet" selected={active}
          onChoose={name=>{setActive(name);setPreviewPosition(null);}}
          options={sheets.map(sheet=>({value:sheet.sheetName,label:sheet.sheetName}))}
          buttonProps={{className:"interchange-select","aria-label":"Preview sheet",children:<><span>{active}</span><span aria-hidden="true">⌄</span></>}} />
      </div>
      <div className="interchange-field">
        <label htmlFor={id+'-rows'}>Header rows</label>
        <IntegerStepper key={active+'-rows'} id={id+'-rows'} label="Header rows" value={choice.headerRows}
          maximum={Math.max(0,sheet.rows-1)} disabled={disabled} onChange={value=>change('headerRows',value)} />
      </div>
      <div className="interchange-field">
        <label htmlFor={id+'-columns'}>Header columns</label>
        <IntegerStepper key={active+'-columns'} id={id+'-columns'} label="Header columns" value={choice.headerColumns}
          maximum={Math.max(0,sheet.columns-1)} disabled={disabled} onChange={value=>change('headerColumns',value)} />
      </div>
    </div>
    {candidates.length > 0 && <div className="import-note-choices" role="group" aria-label="Import sheet notes">
    {candidates.map(({candidate,note:parsedNote})=>{
      const field=candidate.position==="beforeTable"?"beforeRows":"afterRows";
      const note=notes.find(item=>item.sheetName===active)??{sheetName:active,beforeRows:0,afterRows:0};
      return <ImportNoteChoice key={candidate.position} candidate={candidate} note={parsedNote} selected={note[field]>0}
        disabled={disabled} previewing={previewPosition===candidate.position}
        onToggle={()=>onNotesChange([...notes.filter(item=>item.sheetName!==active),{...note,[field]:note[field]>0?0:candidate.rowCount}])}
        onPreview={button=>{previewTrigger.current=button;setPreviewPosition(current=>current===candidate.position?null:candidate.position);}} />;
    })}</div>}
    <div className="import-preview-stage">
    <div className="import-preview-grid" tabIndex={preview ? -1 : 0} aria-hidden={preview ? true : undefined}
      role="region" aria-label={`${active} preview`}>
      <table><thead><tr><th aria-label="Row" />{sheet.cells[0]?.map((_,c)=><th key={c} scope="col">{toColumnLetters(c+1)}</th>)}</tr></thead>
        <tbody>{sheet.cells.map((row,r)=><tr key={r}><th scope="row">{r+1}</th>{row.map((text,c)=><td key={c}
          data-header={r<choice.headerRows||c<choice.headerColumns} title={text}>{text}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {preview && <section className="import-note-reader" role="region" aria-label={`${importNoteLabel(preview.candidate)} preview`}
      data-escape-owner onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePreview();}
      }}>
      <header><div><strong>{importNoteLabel(preview.candidate)}</strong><small>{importNoteSource(preview.candidate)}</small></div>
        <button ref={closePreviewButton} type="button" className="import-note-preview-button" onClick={closePreview}>Back to table</button>
      </header>
      <div className="import-note-reader-content selectable-text" tabIndex={0}>
        <NoteContent note={preview.note}/>
      </div>
    </section>}
    </div>
    <small>{sheet.rows} rows · {sheet.columns} columns{sheet.rows>12||sheet.columns>8?' · Preview limited to 12 rows × 8 columns':''}</small>
  </section>;
}
