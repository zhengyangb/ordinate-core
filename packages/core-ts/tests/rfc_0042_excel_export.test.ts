import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { DocumentState, exportExcelWorkbook, serializeDocumentState } from "../src";
import { formulaDocument, exportedFormula } from "./fixtures/excelExport";
import { exportFormula } from "../src/excel/exportFormula";
import { DEFAULT_EXCEL_LIMITS, ExcelReport } from "../src/excel/contracts";

describe("RFC-0042 readable target-native formula export", () => {
  it.each([
    ["A1+B1","A1+B1"], ["A1-B1","A1-B1"], ["A1*B1","A1*B1"], ["A1/B1","A1/B1"],
    ["A1+(B1+C1)","A1+(B1+C1)"], ["(A1+B1)*C1","(A1+B1)*C1"],
    ["A1/(B1*C1)","A1/(B1*C1)"], ["A1-(B1-C1)","A1-(B1-C1)"],
    ["A1**B1","A1^B1"], ["-(A1**B1)","-(A1^B1)"], ["(-A1)**B1","(-A1)^B1"],
    ["(A1**B1)**C1","(A1^B1)^C1"], ["A1**(B1**C1)","A1^(B1^C1)"],
    ["A1==B1","A1=B1"], ["A1!=B1","A1<>B1"], ["A1<B1","A1<B1"],
    ["A1>=B1","A1>=B1"], ["A1<=B1","A1<=B1"],
    ['if(A1>B1,"yes","no")','IF(A1>B1,"yes","no")'],
    ["if(false,1/0,7)","IF(FALSE,1/0,7)"], ["not(A1>B1)","NOT(A1>B1)"],
    ["and(A1>0,B1>0)","AND(A1>0,B1>0)"], ["or(A1>0,B1>0)","OR(A1>0,B1>0)"],
    ["sum(A1:B2)","SUM(A1:B2)"], ["product(A1:B2)","PRODUCT(A1:B2)"],
    ["average(A1:B2)","AVERAGE(A1:B2)"], ["min(A1:B2)","MIN(A1:B2)"],
    ["max(A1:B2)","MAX(A1:B2)"], ["sumsq(A1:B2)","SUMSQ(A1:B2)"],
    ["count(A1:B2)","COUNT(A1:B2)"], ["counta(A1:B2)","COUNTA(A1:B2)"],
    ["countblank(A1:B2)","COUNTBLANK(A1:B2)"],
    ["sum([1,2,3])","SUM({1,2,3})"], ["sum([@[#1,#1],@[#1,#2]])","SUM(CHOOSE({1,2},A1,B1))"],
    ["abs(-A1)","ABS(-A1)"], ["sign(-A1)","SIGN(-A1)"], ["sqrt(A1)","SQRT(A1)"],
    ["floor(A1/B1)","INT(A1/B1)"], ["ceil(A1/B1)","CEILING(A1/B1,1)"],
    ["power(A1,B1)","POWER(A1,B1)"], ["mod(-7,3)","MOD(-7,3)"],
    ["round(-1.5,0)","ROUND(-1.5,0)"], ["roundup(A1,2)","ROUNDUP(A1,2)"],
    ["rounddown(A1,2)","ROUNDDOWN(A1,2)"], ["trunc(A1)","TRUNC(A1)"], ["pi()","PI()"],
    ["isNumber(A1)","ISNUMBER(A1)"], ["isText(A1)","ISTEXT(A1)"],
    ["isBoolean(A1)","ISLOGICAL(A1)"], ["isBlank(A1)","ISBLANK(A1)"], ["isError(A1)","ISERROR(A1)"],
    ["upper(A1)","UPPER(A1)"], ["lower(A1)","LOWER(A1)"], ["len(A1)","LEN(A1)"],
    ['contains(A1,"a*")','ISNUMBER(FIND("a*",A1))'],
    ['startsWith(A1,"Hi")','EXACT(LEFT(A1,LEN("Hi")),"Hi")'],
    ['endsWith(A1,"Hi")','EXACT(RIGHT(A1,LEN("Hi")),"Hi")'],
    ['replace(A1,"a","b")','SUBSTITUTE(A1,"a","b")'],
    ["fv(A1,B1,C1)","FV(A1,B1,C1)"], ["pv(A1,B1,C1)","PV(A1,B1,C1)"],
    ["pmt(A1,B1,C1)","PMT(A1,B1,C1)"], ["nper(A1,B1,C1)","NPER(A1,B1,C1)"],
    ["sln(A1,B1,C1)","SLN(A1,B1,C1)"], ["syd(A1,B1,C1,2)","SYD(A1,B1,C1,2)"],
    ["effect(A1,B1)","EFFECT(A1,B1)"], ["nominal(A1,B1)","NOMINAL(A1,B1)"],
    ["index(A1:B2,0,1)","INDEX(A1:B2,1,2)"], ["index(A1:A2,0)","INDEX(A1:A2,1)"],
    ["index(A1:B1,-1)","INDEX(A1:B1,1,COLUMNS(A1:B1))"],
    ["index(A1:B2,-2,-1)","INDEX(A1:B2,ROWS(A1:B2)-1,COLUMNS(A1:B2))"],
    ["rowCount(A1:B2)","ROWS(A1:B2)"], ["columnCount(A1:B2)","COLUMNS(A1:B2)"],
    ["size(A1:B2)","ROWS(A1:B2)*COLUMNS(A1:B2)"],
    ['number(A1)', 'VALUE(A1)'], ['boolean(A1)', 'A1<>0'], ['text(A1)', 'A1&""'],
    ['text(A1)+text(B1)', 'A1&B1'], ['"Revenue: " + text(A1)', '"Revenue: "&A1'],
    ['text(A1+B1)', 'A1+B1&""'], ['boolean(A1==B1)', '(A1=B1)<>0'],
    ['number(text(A1))', 'VALUE(A1&"")'], ['text(boolean(A1))','(A1<>0)&""'],
    ['text(A1)+" "+text(B1)', 'A1&" "&B1'],
    ['number(text(A1))+"x"', 'VALUE(A1&"")&"x"'],
    ['boolean(text(A1))+"x"', '(A1&""<>0)&"x"'],
    ['"He said \\"yes\\"" + "!"', '"He said ""yes"""&"!"'],
  ])("%s → %s", async (source, target) => {
    const document = formulaDocument(source);
    const before = serializeDocumentState(document);
    const { cell, result } = await exportedFormula(document);
    expect(cell.formula).toBe(target);
    expect(cell.result).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code:"semantic_difference"}));
    expect(serializeDocumentState(document)).toBe(before);
  });
  it.each([[7, 2], ["hello", "world"], [null, true], ["3", "4"]] as const)(
    "never specializes reference addition using current values %j %j", async (a, b) => {
      const { cell } = await exportedFormula(formulaDocument("A1+B1", [[a, b]]));
      expect(cell.formula).toBe("A1+B1");
    });
  it("does not exhaust generated scopes for a simple series of conversions", async () => {
    const formula = Array.from({ length: 30 }, (_, i) => `number("${i}")`).join("+");
    const { cell } = await exportedFormula(formulaDocument(formula));
    expect(cell.formula).toBe(formula.replaceAll("number", "VALUE"));
    expect(cell.formula.length).toBeLessThan(400);
  });
  it("requests recalculation instead of presenting native caches as Excel answers", async () => {
    const document = formulaDocument('round(-1.5,0)');
    expect(document.evaluate().sheets[0].values[0][9]).toEqual({kind:"number",value:-1});
    const { cell, result } = await exportedFormula(document);
    expect(cell.formula).toBe("ROUND(-1.5,0)");
    expect(cell.result).toBeUndefined();
    const zip = unzipSync(result.value);
    expect(strFromU8(zip["xl/workbook.xml"])).toContain('fullCalcOnLoad="1"');
  });
  it("exports named references as copy-locked row addresses", async () => {
    const document = DocumentState.fromText('# Report\n| Item || H1 | H2 |\n| --- || --- | --- |\n| Product A || 120 | 140 |\n| Product B || 80 | 95 |\n| Total || = @["Product A",_]+@["Product B",_] | = @["Product A",_]+@["Product B",_] |');
    const { workbook } = await exportedFormula(document);
    expect(workbook.worksheets[0].getCell("B4").formula).toBe("B$2+B$3");
    expect(workbook.worksheets[0].getCell("C4").formula).toBe("C$2+C$3");
  });
  it("writes cross-sheet addresses, not an address-string interpreter", async () => {
    const document = DocumentState.fromText('# Inputs\n| 6 |\n# Output\n| = @[Inputs::[#1$,#1$]] * 2 |');
    const { workbook } = await exportedFormula(document);
    expect(workbook.getWorksheet("Output")!.getCell("A1").formula).toBe("'Inputs'!$A$1*2");
  });
  it.each(['len(trim("word"))', 'sum(A1:A2+A1:B1)', 'index(A1:B2,0)', 'index(2,0)', 'rowCount(2)',
    'sum(2)', 'sum()', 'abs(A1,B1)', 'shape(A1:B2)', 'A1:B2', 'len(A1:B2)', 'index(A1:B2,0:1,0)',
    'if(true,A1:B2,A1:B1)', 'unknown(A1)', 'index(A1:A2,-3)'])("fails explicitly for unsupported %s", async source => {
    const document = formulaDocument(source);
    const before = serializeDocumentState(document);
    const result = await exportExcelWorkbook(document);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({severity:"error",sheetName:"Data",rowIndex:0,colIndex:9}));
    expect(serializeDocumentState(document)).toBe(before);
  });
  it("still enforces formula length limits atomically", async () => {
    const result = await exportExcelWorkbook(formulaDocument('number("123456789")'), {limits:{maxFormulaLength:10}});
    expect(result).toMatchObject({ok:false,diagnostics:expect.arrayContaining([expect.objectContaining({code:"limit_exceeded"})])});
    expect(result).not.toHaveProperty("value");
  });

  it("keeps all 24 Management Report calculations readable with named-row locks", async () => {
    const entries: Array<[string, string | number[]]> = [
      ['Revenue', []], ['* Product A', [120,140,160,180]], ['* Product B',[80,95,105,120]],
      ['Revenue Total', '@[Revenue."Product A",_]+@[Revenue."Product B",_]'],
      ['Cost of Sales', []], ['* Materials',[60,70,82,90]], ['* Fulfillment',[20,25,28,35]],
      ['Cost of Sales Total','@["Cost of Sales".Materials,_]+@["Cost of Sales".Fulfillment,_]'],
      ['Gross Profit','@["Revenue Total",_]-@["Cost of Sales Total",_]'],
      ['Operating Expense',[]], ['* Marketing',[15,16,20,22]], ['* RND',[18,21,24,26]],
      ['Opex Total','@["Operating Expense".Marketing,_]+@["Operating Expense".RND,_]'],
      ['Operating Profit','@["Gross Profit",_]-@["Opex Total",_]'],
      ['Margin Ratio','@["Operating Profit",_]/@["Revenue Total",_]'],
    ];
    const document = DocumentState.fromText('# Management Report\n| || 2024 | 2024 | 2025 | 2025 |\n| Line Item || H1 | H2 | H1 | H2 |\n| --- || --- | --- | --- | --- |\n'+entries.map(([label,value]) =>
      `| ${label} || ${Array.from({length:4}, (_,i) => typeof value === 'string' ? '= '+value : value[i] ?? '').join(' | ')} |`).join('\n'));
    const { workbook } = await exportedFormula(document);
    const sheet = workbook.worksheets[0];
    for (const column of ['B','C','D','E']) {
      for (const [row,a,op,b] of [[6,4,'+',5],[10,8,'+',9],[11,6,'-',10],[15,13,'+',14],[16,11,'-',15],[17,16,'/',6]] as const) {
        expect(sheet.getCell(`${column}${row}`).formula).toBe(`${column}$${a}${op}${column}$${b}`);
        expect(sheet.getCell(`${column}${row}`).result).toBeUndefined();
      }
    }
  });

  it.each(['sum','countblank'])("%s retains exact sparse membership, not a bounding rectangle", async name => {
    const document = DocumentState.fromText(`# Data\n| Item || Amount |\n| --- || --- |\n| North || 1000 |\n| * One || 1 |\n| * Two || 2 |\n| South || 2000 |\n| * Three || 3 |\n| Total || = ${name}(@[:,Amount]) |`);
    document.evaluate();
    const sheet = document.sheets[0], body = sheet.cells[6][1].body;
    if (!body.valid || body.kind !== 'formula') throw new Error('Invalid fixture');
    // Selector-resolution fixture, not an assumption that ':' filters parents.
    sheet.dataRowIndices = [2,3,5];
    const result = exportFormula(body.expression, document, sheet, {sheetName:'Data',rowIndex:6,colIndex:1}, DEFAULT_EXCEL_LIMITS, new ExcelReport());
    expect(result.formula).toBe(name === 'sum' ? 'SUM($B$3:$B$4,$B$6)' : 'SUM(COUNTBLANK($B$3:$B$4),COUNTBLANK($B$6))');
  });

  it.each([
    ['index(A1:B2,C1,0)', 'INDEX(A1:B2,IF(C1<0,ROWS(A1:B2)+C1+1,C1+1),1)'],
    ['A1:B2[0,1]', 'INDEX(A1:B2,1,2)'],
    ['shape(A1:B2)[1]','INDEX(CHOOSE({1,2},ROWS(A1:B2),COLUMNS(A1:B2)),1,2)'],
  ])('keeps necessary index convention conversion in %s', async (source,target) => {
    expect((await exportedFormula(formulaDocument(source))).cell.formula).toBe(target);
  });
});
