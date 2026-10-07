import { DEFAULT_EXCEL_LIMITS, ExcelFailure, type ExcelLimits } from "./contracts";
import type { DecodedWorkbook, WorkbookCell, WorkbookSheet } from "./workbookCodec";
import type { ExcelExpression } from "./formulaAst";
import type { RefSelector } from "../runtime/types";
import { parseExcelFormula } from "./formulaParser";
import { nameResolver } from "./definedNames";
import { serializeSheetNote, type NoteBlock } from "../sheet_notes";
import { columnAddress } from "../runtime/spreadsheetAddress";

export interface ExcelNoteChoice { sheetName: string; beforeRows: number; afterRows: number }
export interface ExcelNoteCandidate {
  sheetName: string; position: "beforeTable" | "afterTable";
  rowCount: number; firstRow: number; lastRow: number; markdown: string;
  /** Remains previewable, but cannot be extracted without breaking a reference. */
  unavailableReason?: string;
}

function noteLine(row: WorkbookCell[], r: number, sheet: WorkbookSheet): WorkbookCell | null | false {
  const cells = row.map((cell,c)=>({cell,c})).filter(({cell})=>cell.formula !== undefined
    || (cell.value !== null && !(typeof cell.value === "string" && !cell.value.trim())));
  if (!cells.length) return null;
  if (cells.length !== 1 || cells[0].cell.formula !== undefined || typeof cells[0].cell.value !== "string") return false;
  const {cell,c} = cells[0];
  const merged = sheet.merges?.some(range=>{
    const m=/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
    return m && m[1] === columnAddress(c) && Number(m[2])===r+1 && Number(m[4])===r+1 && m[1]!==m[3];
  });
  return c === 0 || merged ? cell : false;
}
function markdown(cells: WorkbookCell[]): string {
  const blocks: NoteBlock[] = cells.flatMap(cell => String(cell.value).split(/\r?\n/).filter(line=>line.trim()).map(line=>{
    const text = {kind:"text" as const,text:line.trim()};
    return {kind:"paragraph" as const,children:cell.style?.weight === "bold" ? [{kind:"strong" as const,children:[text]}] : [text]};
  }));
  return serializeSheetNote({blocks});
}
/** Suggest only contiguous edge text, never interior section headings or numeric data. */
function edgeNoteCandidates(workbook: DecodedWorkbook): ExcelNoteCandidate[] {
  return workbook.sheets.flatMap(sheet=>{
    const lines = sheet.rows.map((row,r)=>noteLine(row,r,sheet));
    const firstData=lines.findIndex(line=>line===false), lastData=lines.length-1-[...lines].reverse().findIndex(line=>line===false);
    if (firstData<0) return [];
    return (["beforeTable","afterTable"] as const).flatMap(position=>{
      const start=position==="beforeTable"?0:lastData+1, end=position==="beforeTable"?firstData:lines.length;
      const cells=lines.slice(start,end).filter((cell): cell is WorkbookCell=>!!cell);
      return cells.length ? [{sheetName:sheet.name,position,rowCount:end-start,firstRow:start+1,lastRow:end,markdown:markdown(cells)}] : [];
    });
  });
}

type ExcelReference = Extract<ExcelExpression, {kind: "reference"}>;

/** The same traversal owns dependency inspection and reference rebasing. */
function mapReferences(node: ExcelExpression, visit: (reference: ExcelReference) => ExcelReference): ExcelExpression {
  switch (node.kind) {
    case "reference": return visit(node);
    case "binary": return {...node, left:mapReferences(node.left,visit), right:mapReferences(node.right,visit)};
    case "unary": return {...node, operand:mapReferences(node.operand,visit)};
    case "call": return {...node, args:node.args.map(arg=>mapReferences(arg,visit))};
    case "array": return {...node, rows:node.rows.map(row=>row.map(arg=>mapReferences(arg,visit)))};
    case "number": case "text": case "boolean": case "error": case "missing": case "name": return node;
  }
}

function referencedRows(selector: RefSelector): [number, number] {
  if (selector.kind === "all") return [0, Infinity];
  if (selector.kind === "range") {
    const [a,b] = (selector.value as RefSelector[]).map(referencedRows);
    return [Math.min(a[0],b[0]),Math.max(a[1],b[1])];
  }
  return [Number(selector.value),Number(selector.value)];
}

/** Plan once per operation, parsing each formula once regardless of candidate count. */
function planWorkbookNotes(workbook: DecodedWorkbook, limits: Readonly<ExcelLimits>) {
  const candidates = edgeNoteCandidates(workbook);
  const expressions = new Map<WorkbookCell, ExcelExpression>();
  const bySheet = new Map(workbook.sheets.map(sheet=>[sheet.name.toLowerCase(),candidates.filter(c=>c.sheetName===sheet.name)]));
  const expand = nameResolver(workbook.definedNames,limits);
  if (candidates.length) workbook.sheets.forEach((sheet,s)=>sheet.rows.forEach((row,r)=>row.forEach((cell,c)=>{
    if (cell.formula === undefined) return;
    let expression: ExcelExpression;
    try { expression = expand(parseExcelFormula(cell.formula,limits),s); }
    catch (error) {
      // The formula importer owns unsupported syntax/names: reject them, or
      // preserve them as inert text under the explicitly selected import policy.
      if (!(error instanceof ExcelFailure)) throw error;
      return;
    }
    expressions.set(cell,expression);
    mapReferences(expression,reference=>{
      const [first,last] = referencedRows(reference.reference.rowSelector);
      for (const candidate of bySheet.get((reference.sheet??sheet.name).toLowerCase())??[]) {
        if (first < candidate.lastRow && last >= candidate.firstRow-1 && !candidate.unavailableReason) {
          const address = `'${sheet.name.replace(/'/g,"''")}'!${columnAddress(c)}${r+1}`;
          candidate.unavailableReason = `Referenced by ${address}. Keep those rows in the table.`;
        }
      }
      return reference;
    });
  })));
  return {candidates,expressions};
}

export function analyzeNoteCandidates(workbook: DecodedWorkbook, limits: Readonly<ExcelLimits> = DEFAULT_EXCEL_LIMITS): ExcelNoteCandidate[] {
  return planWorkbookNotes(workbook,limits).candidates;
}

/** Extract approved rows before A1 translation. Every surviving reference keeps its target. */
export function extractWorkbookNotes(source: DecodedWorkbook, choices: readonly ExcelNoteChoice[], limits: Readonly<ExcelLimits>) {
  const notes = new Map<string, Partial<Record<"beforeTable"|"afterTable",string>>>();
  if (!Array.isArray(choices)) throw new ExcelFailure("invalid_options","Expected per-sheet note choices.");
  if (!choices.length) return {workbook:source,notes};
  const {candidates,expressions}=planWorkbookNotes(source,limits), trims=new Map<string,ExcelNoteChoice>();
  for(const choice of choices){
    if(!choice || Object.keys(choice).some(k=>!["sheetName","beforeRows","afterRows"].includes(k)) || trims.has(choice.sheetName)) throw new ExcelFailure("invalid_options","Invalid or duplicate note choice.");
    const sheet=source.sheets.find(s=>s.name===choice.sheetName);
    if(!sheet) throw new ExcelFailure("invalid_options","Note choice refers to an unknown sheet.");
    const entry: Partial<Record<"beforeTable"|"afterTable",string>>={};
    for(const [field,position] of [["beforeRows","beforeTable"],["afterRows","afterTable"]] as const){
      const n=choice[field], candidate=candidates.find(c=>c.sheetName===choice.sheetName && c.position===position);
      if(!Number.isInteger(n) || n<0 || (n!==0 && n!==candidate?.rowCount)) throw new ExcelFailure("invalid_options","Select the displayed note rows or keep them in the table.");
      if(n && candidate?.unavailableReason) throw new ExcelFailure("invalid_options",candidate.unavailableReason,{sheetName:choice.sheetName});
      if(n) entry[position]=candidate!.markdown;
    }
    trims.set(choice.sheetName,choice); notes.set(choice.sheetName,entry);
  }
  const transform=(expression:ExcelExpression,current:string):ExcelExpression=>mapReferences(expression,node=>{
      const target=source.sheets.find(s=>s.name.toLowerCase()===(node.sheet??current).toLowerCase());
      const trim=target && trims.get(target.name);
      if(!target || !trim || !(trim.beforeRows || trim.afterRows))return node;
      const rebase=(axis:RefSelector):RefSelector=>{
        if(axis.kind==="range")return {...axis,value:(axis.value as RefSelector[]).map(rebase)};
        const row=Number(axis.value);
        return {...axis,value:row-trim.beforeRows};
      };
      return {...node,reference:{...node.reference,rowSelector:rebase(node.reference.rowSelector)}};
  });
  const sheets=source.sheets.map(sheet=>{
    const trim=trims.get(sheet.name), before=trim?.beforeRows??0,after=trim?.afterRows??0;
    const rows=sheet.rows.slice(before,sheet.rows.length-after).map(row=>row.map(cell=>{
      const expression=expressions.get(cell);
      if(!expression)return cell;
      return {...cell,importExpression:transform(expression,sheet.name)};
    }));
    return {...sheet,rows,headers:{headerRows:Math.max(0,(sheet.headers?.headerRows??0)-before)}};
  });
  return {workbook:{...source,sheets},notes};
}
