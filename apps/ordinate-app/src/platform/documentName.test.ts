import { expect, it } from "vitest";
import { documentName, documentSaveName, validateDocumentName } from "./documentName";
import { importedDocumentName } from "../interchange/contracts";

it.each([['Report.xlsx','Report'], ['季度报告.CSV','季度报告'], ['report.v2.tsv','report.v2'], ['budget.ord.xlsx','budget.ord'], ['.csv','.csv']])('names imported %s', (source, name) => {
  expect(importedDocumentName(source)).toBe(name);
});
it('uses the actual backing filename once saved', () => {
  const state = {file: {id:'1',displayName:'Renamed.ord',adapterKind:'memory' as const},draftName:'Report'};
  expect(documentName(state)).toBe('Renamed.ord');
  expect(documentSaveName(state)).toBe('Renamed.ord');
  expect(documentName({file:null,draftName:'Report'})).toBe('Report');
  expect(documentSaveName({file:null,draftName:'Report'})).toBe('Report.ord');
  expect(documentSaveName({file:null,draftName:null})).toBe('Untitled.ord');
});
it.each(['', '  ', '../Report', 'folder/report', 'a\\b', 'a\u0000b', 'a\nb'])('rejects invalid draft name %j', name => {
  expect(() => validateDocumentName(name)).toThrow();
});
