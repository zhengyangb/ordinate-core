import ExcelJS from "exceljs";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { describe, it, expect, vi } from "vitest";
import { importExcelWorkbook, exportExcelWorkbook, serializeDocumentState, DocumentState } from "../src";
import { DEFAULT_EXCEL_LIMITS } from "../src/excel/contracts";
import { ExcelReport } from "../src/excel/contracts";
import { inspectXlsxArchive } from "../src/excel/workbookCodec";
import { sanitizeXlsxImport } from "../src/excel/sanitizeImport";

const preserve = { unsupportedContent: "preserve-text" } as const;
async function book(formula = "TODAY()") {
  const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet("Data");
  sheet.getCell("A1").value = { formula, result: 99999 };
  sheet.getCell("B1").value = 4;
  sheet.getCell("C1").value = { formula: "B1*2", result: -1 };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
function rewrite(bytes: Uint8Array, edit: (files: Record<string, Uint8Array>) => void) {
  const files = unzipSync(bytes); edit(files); return zipSync(files);
}
async function imported(bytes: Uint8Array) {
  const result = await importExcelWorkbook(bytes, preserve);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

describe("explicit compatibility import", () => {
  it.each(["TODAY()", "XLOOKUP(B1,B1:B2,C1:C2,,1)", "SUM(Table1[Amount])", "MissingName+1", "'[1]Sheet1'!A1", "SUM(", 'FUTURE("quoted ""text""",B1)'])(
    "preserves %s as inert exact source without caches", async formula => {
      const bytes = await book(formula), original = bytes.slice();
      expect((await importExcelWorkbook(bytes)).ok).toBe(false);
      const result = await imported(bytes);
      expect(bytes).toEqual(original);
      expect(result.value.evaluate().sheets[0].values[0]).toEqual([
        {kind:"string", value:`=${formula}`}, {kind:"number",value:4}, {kind:"number",value:8},
      ]);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({code:"formula_preserved_as_text",formula,sheetName:"Data",rowIndex:0,colIndex:0}));
      const reopened = DocumentState.fromText(serializeDocumentState(result.value));
      expect(reopened.evaluate().sheets[0].values[0][0]).toEqual({kind:"string",value:`=${formula}`});
      const output = await exportExcelWorkbook(reopened);
      if (!output.ok) throw new Error(JSON.stringify(output.diagnostics));
      const checked = new ExcelJS.Workbook(); await checked.xlsx.load(output.value as never);
      expect(checked.worksheets[0].getCell("A1").value).toBe(`=${formula}`);
      expect(checked.worksheets[0].getCell("A1").formula).toBeUndefined();
      expect(checked.worksheets[0].getCell("C1").formula).toBe("B1*2");
    });

  it("does not apply numeric formatting to preserved formula text or suppress dependent errors", async () => {
    const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet("Data");
    sheet.getCell("A1").value = {formula:"TODAY()",result:45900}; sheet.getCell("A1").numFmt="yyyy-mm-dd";
    sheet.getCell("B1").value = {formula:"A1*2",result:91800};
    const result = await imported(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(result.value.sheets[0].cells[0][0].localDisplay?.format).toBeUndefined();
    expect(result.value.evaluate().sheets[0].values[0][1].kind).toBe("error");
  });

  it("resolves fixed named definitions without preserving their formulas as text", async () => {
    const bytes = rewrite(await book("InputRate+1"), files => {
      files["xl/workbook.xml"] = strToU8(strFromU8(files["xl/workbook.xml"]).replace("</workbook>", '<definedNames><definedName name="InputRate">Data!$B$1</definedName></definedNames></workbook>'));
    });
    const result = await imported(bytes);
    expect(result.diagnostics.some(d=>d.code==="formula_preserved_as_text")).toBe(false);
    expect(result.value.evaluate().sheets[0].values[0][0]).toEqual({kind:"number",value:5});
    expect(result.value.evaluate().sheets[0].values[0][2]).toEqual({kind:"number",value:8});
  });

  it("detaches external links before decoding without fetching their targets", async () => {
    const bytes = rewrite(await book("'[1]Sheet1'!A1"), files => {
      files["xl/externalLinks/externalLink1.xml"] = strToU8('<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><externalBook/></externalLink>');
      files["xl/externalLinks/_rels/externalLink1.xml.rels"] = strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="https://example.invalid/private.xlsx" TargetMode="External"/></Relationships>');
      files["xl/_rels/workbook.xml.rels"] = strToU8(strFromU8(files["xl/_rels/workbook.xml.rels"]).replace("</Relationships>", '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>'));
      files["[Content_Types].xml"] = strToU8(strFromU8(files["[Content_Types].xml"]).replace("</Types>", '<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/></Types>'));
      files["xl/workbook.xml"] = strToU8(strFromU8(files["xl/workbook.xml"]).replace("</workbook>", '<externalReferences><externalReference r:id="rId99"/></externalReferences></workbook>'));
    });
    const fetch = vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Network must not be used"));
    try {
      const result = await imported(bytes);
      expect(result.diagnostics.some(d=>d.code==="external_content_removed")).toBe(true);
      expect(result.value.evaluate().sheets[0].values[0][0]).toEqual({kind:"string",value:"='[1]Sheet1'!A1"});
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it.each(["xl/vbaProject.bin", "xl/activeX/activeX1.bin", "xl/embeddings/oleObject1.bin"])("removes executable content %s only in compatibility mode", async name => {
    const bytes = rewrite(await book("B1+1"),files=>{files[name]=new Uint8Array([1,2,3]);});
    expect((await importExcelWorkbook(bytes)).ok).toBe(false);
    const result=await imported(bytes);
    expect(result.diagnostics.some(d=>d.code==='import_content_omitted')).toBe(true);
    expect(result.value.evaluate().sheets[0].values[0][0]).toEqual({kind:'number',value:5});
  });

  it("cannot import a workbook with no local worksheets left", async () => {
    const bytes = rewrite(await book("B1+1"),files=>{
      files["xl/_rels/workbook.xml.rels"]=strToU8(strFromU8(files["xl/_rels/workbook.xml.rels"]).replace('Target="worksheets/sheet1.xml"','Target="https://example.invalid/sheet.xml" TargetMode="External"'));
    });
    expect((await importExcelWorkbook(bytes,preserve)).ok).toBe(false);
  });

  it.each([
    ['vbaProject', 'custom/project.bin', 'application/vnd.ms-office.vbaProject', ''],
    ['oleObject', 'embeddings/object.bin', 'application/vnd.openxmlformats-officedocument.oleObject', '<oleObjects><oleObject r:id="unsafe"/></oleObjects>'],
    ['control', 'activeX/control.xml', 'application/vnd.ms-office.activeX+xml', '<controls><control r:id="unsafe"/></controls>'],
  ])("detaches %s parts, declarations, relationships and worksheet references", async (kind, target, contentType, reference) => {
    const bytes = rewrite(await book('B1+1'), files => {
      files[`xl/${target}`] = target.endsWith('.xml') ? strToU8('<control/>') : new Uint8Array([1,2,3]);
      files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="unsafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="../${target}"/></Relationships>`);
      files['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace('</worksheet>',`${reference}</worksheet>`));
      files['[Content_Types].xml'] = strToU8(strFromU8(files['[Content_Types].xml'])
        .replace('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml','application/vnd.ms-excel.sheet.macroEnabled.main+xml')
        .replace('</Types>',`<Override PartName="/xl/${target}" ContentType="${contentType}"/></Types>`));
    });
    const original = bytes.slice();
    expect((await importExcelWorkbook(bytes)).ok).toBe(false);
    const metadata = await inspectXlsxArchive(bytes, DEFAULT_EXCEL_LIMITS, 'preserve-text');
    const sanitized = await sanitizeXlsxImport(bytes, metadata.sheetDimensions, new ExcelReport());
    const files = unzipSync(sanitized);
    expect(files[`xl/${target}`]).toBeUndefined();
    expect(strFromU8(files['[Content_Types].xml'])).not.toMatch(/macroEnabled|vbaProject|oleObject|activeX/);
    expect(strFromU8(files['xl/worksheets/_rels/sheet1.xml.rels'])).not.toContain('unsafe');
    expect(strFromU8(files['xl/worksheets/sheet1.xml'])).not.toContain('unsafe');
    await inspectXlsxArchive(sanitized, DEFAULT_EXCEL_LIMITS);
    const result = await imported(bytes);
    expect(result.diagnostics.some(d=>d.code==='import_content_omitted')).toBe(true);
    expect(result.value.evaluate().sheets[0].values[0][0]).toEqual({kind:'number',value:5});
    expect(bytes).toEqual(original);
  });

  it.each(['image', 'attachedTemplate', 'unknownExtension'])("omits external %s relationships without reading their target", async kind => {
    const bytes = rewrite(await book('B1+1'), files => {
      files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="linked" Type="urn:example/${kind}" Target="https://example.invalid/private" TargetMode="External"/></Relationships>`);
      files['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace('</worksheet>','<drawing r:id="linked"/></worksheet>'));
    });
    const fetch = vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No network'));
    try {
      expect((await importExcelWorkbook(bytes)).ok).toBe(false);
      const result = await imported(bytes);
      expect(result.diagnostics.some(d=>d.code==='external_content_removed')).toBe(true);
      expect(result.value.evaluate().sheets[0].values[0][0]).toEqual({kind:'number',value:5});
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it('keeps locally stored worksheets when another worksheet is external', async () => {
    const bytes = rewrite(await book('B1+1'), files => {
      files['xl/workbook.xml'] = strToU8(strFromU8(files['xl/workbook.xml']).replace('</sheets>','<sheet name="Remote" sheetId="2" r:id="remote"/></sheets>'));
      files['xl/_rels/workbook.xml.rels'] = strToU8(strFromU8(files['xl/_rels/workbook.xml.rels']).replace('</Relationships>','<Relationship Id="remote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="https://example.invalid/sheet.xml" TargetMode="External"/></Relationships>'));
    });
    const result = await imported(bytes);
    expect(result.value.sheets.map(sheet=>sheet.name)).toEqual(['Data']);
    expect(result.diagnostics.some(d=>d.code==='external_content_removed')).toBe(true);
  });

  it.each([
    '<row r="100000"><c r="XFD100000" s="1"/></row>',
    '<row r="1048576"/>',
  ])("trims empty trailing layout before allocating the dense grid: %s", async trailing => {
    const bytes=rewrite(await book("B1+1"),files=>{
      files["xl/worksheets/sheet1.xml"]=strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]).replace('</sheetData>',`${trailing}</sheetData>`));
    });
    expect((await importExcelWorkbook(bytes)).ok).toBe(false);
    const result=await imported(bytes);
    expect(result.value.sheets[0].rowCount).toBe(1);expect(result.value.sheets[0].colCount).toBe(3);
    expect(result.diagnostics.some(d=>d.code==="import_content_omitted")).toBe(true);
  });

  it("does not trim real distant data or bypass a genuine cell budget",async()=>{
    const bytes=rewrite(await book("B1+1"),files=>{
      files["xl/worksheets/sheet1.xml"]=strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]).replace('</sheetData>','<row r="100000"><c r="XFD100000"><v>7</v></c></row></sheetData>'));
    });
    const result=await importExcelWorkbook(bytes,preserve);
    expect(result.ok).toBe(false);expect(result.diagnostics.at(-1)?.code).toBe("limit_exceeded");
  });

  it("bounds trailing column spans and merges while preserving real cells",async()=>{
    const bytes=rewrite(await book("B1+1"),files=>{
      const name="xl/worksheets/sheet1.xml";
      files[name]=strToU8(strFromU8(files[name])
        .replace('<sheetData>','<cols><col min="1" max="16384" width="12"/><col min="100" max="120"/></cols><sheetData>')
        .replace('</worksheet>','<mergeCells><mergeCell ref="A2:XFD1048576"/></mergeCells></worksheet>'));
    });
    const result=await imported(bytes);
    expect(result.value.sheets[0].colCount).toBe(3);
    expect(result.value.sheets[0].rowCount).toBe(1);
    expect(result.value.evaluate().sheets[0].values[0][0]).toEqual({kind:'number',value:5});
  });

  it("preserves real blank strings, CDATA, Unicode and XML escapes during sanitization",async()=>{
    const wb=new ExcelJS.Workbook(), sheet=wb.addWorksheet('Data');
    sheet.getCell('A1').value='中文 <&> " \\n\r text';sheet.getCell('C2').value='';
    const bytes=rewrite(new Uint8Array(await wb.xlsx.writeBuffer()),files=>{
      files['xl/sharedStrings.xml']=strToU8(strFromU8(files['xl/sharedStrings.xml']).replace(/\r/g,'&#13;'));
      const name='xl/worksheets/sheet1.xml';
      files[name]=strToU8(strFromU8(files[name]).replace('</row></sheetData>','<c r="D2" t="inlineStr"><is><t><![CDATA[&<原文>]]></t></is></c></row></sheetData>'));
    });
    const result=await imported(bytes);
    expect(result.value.sheets[0].rowCount).toBe(2);expect(result.value.sheets[0].colCount).toBe(4);
    const values=result.value.evaluate().sheets[0].values;
    expect(values[0][0]).toEqual({kind:'string',value:'中文 <&> " \\n\r text'});
    expect(values[1][2]).toEqual({kind:'string',value:''});
    expect(values[1][3]).toEqual({kind:'string',value:'&<原文>'});
  });

  it("honors UTF-16 XML encoding when rebuilding the isolated package",async()=>{
    const bytes=rewrite(await book("B1+1"),files=>{
      const name='xl/worksheets/sheet1.xml';
      const xml=strFromU8(files[name]).replace('encoding="UTF-8"','encoding="UTF-16"');
      files[name]=new Uint8Array(Buffer.concat([Buffer.from([255,254]),Buffer.from(xml,'utf16le')]));
    });
    expect((await imported(bytes)).value.evaluate().sheets[0].values[0][0]).toEqual({kind:'number',value:5});
  });

  it.each([null,'ignore',true,{}])("rejects invalid compatibility policy %j",async unsupportedContent=>{
    const result=await importExcelWorkbook(await book(),{unsupportedContent} as never);
    expect(result.ok).toBe(false);expect(result.diagnostics.at(-1)?.code).toBe('invalid_options');
  });

  it("supports an explicit higher caller budget without changing the default",async()=>{
    const bytes=await book("B1+1");
    expect((await importExcelWorkbook(bytes,{...preserve,limits:{maxCells:2}})).ok).toBe(false);
    expect((await importExcelWorkbook(bytes,{...preserve,limits:{maxCells:3}})).ok).toBe(true);
    expect(DEFAULT_EXCEL_LIMITS.maxCells).toBe(1_000_000);
  });

  it.each([{maxFormulaLength:3},{maxFormulaDepth:1},{maxExpandedBytes:100},{maxArchiveEntries:1}])("does not turn resource violations into text: %j",async limits=>{
    const result=await importExcelWorkbook(await book("SUM((B1+2)*3)"),{...preserve,limits});
    expect(result.ok).toBe(false);expect(result.diagnostics.at(-1)?.code).toBe("limit_exceeded");
  });

  it("does not catch malformed ZIP/XML as unsupported content",async()=>{
    const bytes=rewrite(await book(),files=>{files["xl/worksheets/sheet1.xml"]=strToU8("<worksheet><broken>");});
    const result=await importExcelWorkbook(bytes,preserve);
    expect(result.ok).toBe(false);expect(result.diagnostics.at(-1)?.code).toBe("invalid_workbook");
  });
});
