import { describe, expect, it } from "vitest";
import {
  DocumentState, applyBatchWithUndo, applyCoreEditMemento, previewRowsToNote,
  serializeDocumentState, serializeSheetNote, validateDocument, type CoreEdit,
} from "../src";

const text = '# Data\nExisting intro.\n\n| "Title" {::bold} | |\n| "Details [literal]" | "More" |\n| 4 | 6 |\n| = A3 + B3 | 10 |\n| "Source note" | |\n\nExisting footer.\n\n# Other\n| = @["Data"::A4] |';
function move(document: DocumentState, rows: number[]) {
  const edit: CoreEdit = {op:"convert_rows_to_note",sheet:"Data",rowIds:rows.map(index => document.sheets[0].rowIds[index])};
  const result = applyBatchWithUndo(document,[edit],{recalculate:true});
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result;
}
const note = (document: DocumentState, position: "beforeTable"|"afterTable") => serializeSheetNote(document.sheets[0].getSheetNote(position));

describe("manual edge rows to notes", () => {
  it("extracts the prefix, retains bold/literal punctuation, appends in order and rebases surviving references", () => {
    const document = DocumentState.fromText(text);
    const values = document.evaluate().sheets.map(sheet => sheet.values);
    const before = serializeDocumentState(document);
    const plan = previewRowsToNote(document,"Data",document.sheets[0].rowIds.slice(0,2).reverse());
    expect(plan).toMatchObject({position:"beforeTable",append:true,rowIndices:[0,1]});
    expect(serializeDocumentState(document)).toBe(before);
    const result = move(document,[0,1]);
    const next = result.nextDocument;
    expect(note(next,"beforeTable")).toBe('Existing intro.\n\n**Title**\n\nDetails \\[literal\\] More');
    expect(next.sheets[0].rowIds).toEqual(document.sheets[0].rowIds.slice(2));
    expect(next.sheets[0].colIds).toEqual(document.sheets[0].colIds);
    expect(next.evaluate().sheets[0].values).toEqual(values[0].slice(2));
    expect(next.evaluate().sheets[1].values).toEqual(values[1]);
    expect(next.sheets[0].cells[1][0].body).toMatchObject({inputText:"= A1 + B1"});
    const source = serializeDocumentState(next);
    expect(validateDocument(source).ok).toBe(true);
    expect(DocumentState.fromText(source).evaluate().sheets.map(sheet => sheet.values)).toEqual(next.evaluate().sheets.map(sheet => sheet.values));
    const undone = applyCoreEditMemento(next,result.memento,"undo",{recalculate:true});
    if (!undone.ok) throw new Error(JSON.stringify(undone.error));
    expect(serializeDocumentState(undone.nextDocument)).toBe(before);
    const redone = applyCoreEditMemento(undone.nextDocument,result.memento,"redo",{recalculate:true});
    if (!redone.ok) throw new Error(JSON.stringify(redone.error));
    expect(serializeDocumentState(redone.nextDocument)).toBe(source);
  });

  it("puts extracted suffix text before the existing footer", () => {
    const result = move(DocumentState.fromText(text),[4]);
    expect(note(result.nextDocument,"afterTable")).toBe("Source note\n\nExisting footer.");
    expect(result.nextDocument.sheets[0].rowCount).toBe(4);
    expect(result.nextDocument.evaluate().sheets[1].values[0][0]).toEqual({kind:"number",value:10});
  });

  it("creates a missing note, includes blank layout rows, escapes formula-like text", () => {
    const document = DocumentState.fromText('# Data\n| "=SUM(A1:A3)" | |\n| | |\n| 2 | 3 |');
    const result = move(document,[0,1]);
    expect(note(result.nextDocument,"beforeTable")).toBe('=SUM(A1:A3)');
    expect(result.nextDocument.sheets[0].rowCount).toBe(1);
  });

  it("converts multiple header rows and keeps remaining headers/body coordinates", () => {
    const document = DocumentState.fromText('# Data\n| Title || |\n| Description || |\n| Item || Amount |\n| --- || --- |\n| Sales || 4 |\n| Total || = B4 |');
    expect(document.sheets[0].headerRowCount).toBe(3);
    const result = move(document,[0,1]);
    expect(result.nextDocument.sheets[0].headerRowCount).toBe(1);
    expect(result.nextDocument.sheets[0].headerColCount).toBe(1);
    expect(note(result.nextDocument,"beforeTable")).toBe('Title\n\nDescription');
    expect(result.nextDocument.evaluate().sheets[0].values[1][1]).toEqual({kind:"number",value:4});
  });

  it("retains cascading row and column bold without adding metadata to note text", () => {
    const document = DocumentState.fromText('# Data\n| Title | Second |\n| 2 | 3 |');
    const sheet = document.sheets[0];
    sheet.setRowDefaultStyleByIndex(0,{weight:"bold"});
    expect(previewRowsToNote(document,"Data",[sheet.rowIds[0]]).markdown).toBe('**Title** **Second**');
  });

  it.each([
    ['interior',[1],'Only the first or last'],
    ['discontinuous',[0,2],'consecutive'],
    ['all',[0,1,2,3,4],'at least one'],
    ['numeric',[0,1,2],'Only text'],
    ['formula',[3,4],'Only text'],
  ] as const)("rejects %s selections atomically", (_label,indices,message) => {
    const document = DocumentState.fromText(text), before = serializeDocumentState(document);
    const result = applyBatchWithUndo(document,[{op:"convert_rows_to_note",sheet:"Data",rowIds:indices.map(index => document.sheets[0].rowIds[index])}]);
    expect(result).toMatchObject({ok:false,error:{message:expect.stringContaining(message)}});
    expect(serializeDocumentState(document)).toBe(before);
  });

  it.each(['A1','$A$1','sum(A1:A2)','@[#1,#1]','@[#1:#2,#1]'])("protects a same-sheet dependency %s", reference => {
    const document = DocumentState.fromText(`# Data\n| "Title" |\n| = ${reference} |`);
    expect(() => previewRowsToNote(document,"Data",[document.sheets[0].rowIds[0]])).toThrow('Referenced by');
  });
  it.each(['@["Data"::A1]','@["Data"::$A$1]','sum(@["Data"::A1:A2])'])("protects cross-sheet dependency %s", reference => {
    const document = DocumentState.fromText(`# Data\n| "Title" |\n| 2 |\n# Other\n| = ${reference} |`);
    expect(() => previewRowsToNote(document,"Data",[document.sheets[0].rowIds[0]])).toThrow("Referenced by 'Other'");
  });

  it("protects semantic label dependencies and whole-data views", () => {
    const document = DocumentState.fromText('# Data\n| Item || Value |\n| --- || --- |\n| Title || "note" |\n| Total || = @[Title,Value] |');
    expect(() => previewRowsToNote(document,"Data",[document.sheets[0].rowIds[0],document.sheets[0].rowIds[1]])).toThrow('Referenced by');
    const all = DocumentState.fromText('# Data\n| "note" |\n| = sum(@[:,:]) |');
    expect(() => previewRowsToNote(all,"Data",[all.sheets[0].rowIds[0]])).toThrow('Referenced by');
  });

  it("rejects invalid selections, blank-only notes and incomplete hierarchy prefixes", () => {
    const document = DocumentState.fromText('# Data\n| |\n| 2 |');
    const id = document.sheets[0].rowIds[0];
    for (const ids of [[],[id,id],[-99],[NaN]]) expect(() => previewRowsToNote(document,"Data",ids)).toThrow();
    expect(() => previewRowsToNote(document,"Data",[id])).toThrow('no note text');
    const grouped = DocumentState.fromText('# Data\n| Item || Value |\n| --- || --- |\n| Parent || |\n| * Child || "Text" |\n| Last || 2 |');
    expect(() => previewRowsToNote(grouped,"Data",grouped.sheets[0].rowIds.slice(0,2))).toThrow('children');
  });
});
