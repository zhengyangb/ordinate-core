import ExcelJS from 'exceljs';
import { describe,expect,it } from 'vitest';
import { DocumentState,exportExcelWorkbook,importExcelWorkbook,getCellTextView,serializeDocumentState } from '../src';
import { distributionImports } from '../src/excel/distributionTranslation';
import { mathOperations } from '../src/runtime/functions/mathematics';
import { mathViewOperations } from '../src/runtime/functions/mathViews';
import { distributionFunctionDefinitions } from '../src/runtime/functions/distributions';
import { mathDistributionCases as cases, mathViewCases } from './fixtures/mathDistributionCases';

const expression=(name:string,args:readonly number[])=>`${name}(${args.join(',')})`;
const evaluate=(formula:string)=>DocumentState.fromText(`# Data\n| = ${formula} |`).evaluate().sheets[0].values[0][0];
async function importFormula(formula:string,inputs:unknown[][]=[],options?:Parameters<typeof importExcelWorkbook>[1]) {
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Data');sheet.addRows(inputs);
  sheet.getCell('J1').value={formula,result:-987654321};
  const result=await importExcelWorkbook(new Uint8Array(await book.xlsx.writeBuffer()),options);
  if(!result.ok)throw new Error(JSON.stringify(result.diagnostics));return result.value;
}
const actual=(doc:DocumentState)=>doc.evaluate().sheets[0].values[0][9];
describe('complete scalar math and distribution scope',()=>{
  it('requires a fixture for every numeric-view operation',()=>expect(mathViewCases.map(x=>x.name).sort()).toEqual(mathViewOperations.map(x=>x.name).sort()));
  it.each(mathViewCases)('round-trips numeric-view operation $name',async test=>{
    const doc=DocumentState.fromText(`# Data\n| = ${test.formula} |`);
    expect(doc.evaluate().sheets[0].values[0][0]).toMatchObject({kind:'number',value:expect.closeTo(test.expected,10)});
    const exported=await exportExcelWorkbook(doc);if(!exported.ok)throw new Error(JSON.stringify(exported.diagnostics));
    const imported=await importExcelWorkbook(exported.value);if(!imported.ok)throw new Error(JSON.stringify(imported.diagnostics));
    expect(imported.value.evaluate().sheets[0].values[0][0]).toMatchObject({kind:'number',value:expect.closeTo(test.expected,10)});
  });
  it.each(['multinomial([2,3.1])','seriesSum(2,0,1,["2"])','sumSquareSum([2,3],[4])','determinant([1,2,3])'])
    ('rejects invalid numeric-view input %s',formula=>expect(evaluate(formula).kind).toBe('error'));
  it('uses pivoting and handles a singular determinant',()=>{
    expect(evaluate('determinant([[1,2],[2,4]])')).toMatchObject({kind:'number',value:0});
    expect(evaluate('determinant([[1,2,3],[0,4,5],[1,0,6]])')).toMatchObject({kind:'number',value:22});
  });
  it('does not cancel large factorial logarithms in small counting results',()=>{
    expect(evaluate('combinations(1000000000000000,1)')).toMatchObject({kind:'number',value:1000000000000000});
    expect(evaluate('permutations(1000000000000000,1)')).toMatchObject({kind:'number',value:1000000000000000});
    expect(evaluate('multinomial([999999999999999,1])')).toMatchObject({kind:'number',value:1000000000000000});
  });
  it('requires an analytic fixture for every new function',()=>{
    const names=[...mathOperations.map(x=>x.name),...distributionFunctionDefinitions.map(x=>x.name)].sort();
    expect(cases.map(x=>x.name).sort()).toEqual(names);
  });
  it.each(cases)('evaluates and bidirectionally round-trips $name',async test=>{
    const doc=DocumentState.fromText(`# Data\n| = ${expression(test.name,test.args)} |`);
    expect(doc.evaluate().sheets[0].values[0][0]).toMatchObject({kind:'number',value:expect.closeTo(test.expected,10)});
    const exported=await exportExcelWorkbook(doc);if(!exported.ok)throw new Error(JSON.stringify(exported.diagnostics));
    const imported=await importExcelWorkbook(exported.value);if(!imported.ok)throw new Error(JSON.stringify(imported.diagnostics));
    expect(imported.value.evaluate().sheets[0].values[0][0]).toMatchObject({kind:'number',value:expect.closeTo(test.expected,10)});
    const reopened=DocumentState.fromText(serializeDocumentState(imported.value));
    expect(reopened.evaluate().sheets[0].values[0][0]).toMatchObject({kind:'number',value:expect.closeTo(test.expected,10)});
  });
  it.each([...distributionImports].flatMap(([name,profile])=>profile.operation==='direct'
    ? [{name,profile,native:profile.native,flag:undefined}]
    : [{name,profile,native:profile.cdf,flag:true},{name,profile,native:profile.pdf,flag:false}]))
  ('imports profile $name / $native, not its cache',async ({name,profile,native,flag})=>{
    const fixture=cases.find(test=>test.name===native);if(!fixture)throw new Error(`Missing fixture ${native}`);
    const source:string[]=[];
    profile.values.forEach((slot,i)=>{if(i<fixture.args.length)source[slot]=String(fixture.args[i]);});
    if(profile.operation==='distribution')source[profile.flag]=flag?'TRUE':'FALSE';
    const doc=await importFormula(`${name}(${source.join(',')})`);
    expect(actual(doc)).toMatchObject({kind:'number',value:expect.closeTo(fixture.expected,10)});
    expect(getCellTextView(doc.sheets[0].cells[0][9]).inputText).not.toMatch(/isNumber|isBlank|ifError/);
    const exported=await exportExcelWorkbook(doc);expect(exported.ok,JSON.stringify(exported.diagnostics)).toBe(true);
  });
  it.each([
    ['ATAN2(-1,1)',3*Math.PI/4],['FDIST(3,2,2)',0.25],['FINV(0.25,2,2)',3],
    ['CHIDIST(2,4)',2*Math.exp(-1)],['CHIINV(2*EXP(-1),4)',2],
    ['TDIST(1,1,1)',0.25],['TDIST(1,1,2)',0.5],['TINV(0.5,1)',1],
    ['CRITBINOM(10,0.5,0.5)',5],['BINOM.DIST.RANGE(10,0.5,2)',45/1024],
    ['BETA.DIST(0.5,2,2,TRUE,-1,2)',0.5],['BETA.DIST(0.5,2,2,FALSE,-1,2)',0.5],
    ['BETAINV(0.5,2,2,-1,2)',0.5], ['NEGBINOMDIST(2,2,0.5)',3/16],['HYPGEOMDIST(2,3,4,10)',0.3],
    ['GCD(6,9)',3],['LCM(6,9)',18],['GAMMALN(5)',Math.log(24)],
    ['FLOOR.PRECISE(-5,2)',-6],['CEILING.PRECISE(-5,-2)',-4],['ISO.CEILING(-5,2)',-4],['ERFC(1)',0.15729920705028513],
    ['FISHER(0.5)',Math.log(3)/2],['FISHERINV(0)',0],
    ['TRUNC(-12.987,2)',-12.98],['TRUNC(1234,-2)',1200],
  ])('honors independent Excel meaning of %s',async(formula,expected)=>
    expect(actual(await importFormula(formula as string))).toMatchObject({kind:'number',value:expect.closeTo(expected as number,10)}));
  it('handles a dynamic cumulative flag before optional beta bounds',async()=>{
    const doc=await importFormula('BETA.DIST(A1,2,2,B1,-1,2)',[[0.5,true]]);
    expect(getCellTextView(doc.sheets[0].cells[0][9]).inputText).toBe('= if(boolean(B1), betaCdf(A1, 2, 2, -1, 2), betaPdf(A1, 2, 2, -1, 2))');
    doc.setCellByIndex('Data',0,0,'0');doc.setCellByIndex('Data',0,1,'false');
    expect(actual(doc)).toMatchObject({kind:'number',value:expect.closeTo(4/9,10)});
  });
  it.each([
    ['FLOOR(12.7,1)',12,'= floor(12.7)'],
    ['CEILING(-12.7,1)',-12,'= ceil(-12.7)'],
    ['FLOOR(12.7,5)',10,'= floorMultiple(12.7, 5)'],
    ['CEILING(12.7,5)',15,'= ceilMultiple(12.7, 5)'],
    ['FLOOR(-2.5,-2)',-2,'= floorMultiple(-2.5, 2, 1)'],
    ['FLOOR(-2.5,2)',-4,'= floorMultiple(-2.5, 2)'],
    ['CEILING(-2.5,-2)',-4,'= ceilMultiple(-2.5, 2, 1)'],
    ['CEILING(-2.5,2)',-2,'= ceilMultiple(-2.5, 2)'],
  ])('normalizes Excel multiple rounding %s',async(formula,expected,source)=>{
    const doc=await importFormula(formula as string);
    expect(getCellTextView(doc.sheets[0].cells[0][9]).inputText).toBe(source);
    expect(actual(doc)).toMatchObject({kind:'number',value:expected});
    const reopened=DocumentState.fromText(serializeDocumentState(doc));
    expect(actual(reopened)).toMatchObject({kind:'number',value:expected});
    const exported=await exportExcelWorkbook(doc);if(!exported.ok)throw new Error(JSON.stringify(exported.diagnostics));
    const reimported=await importExcelWorkbook(exported.value);if(!reimported.ok)throw new Error(JSON.stringify(reimported.diagnostics));
    expect(actual(reimported.value)).toMatchObject({kind:'number',value:expected});
  });
  it.each(['FLOOR','CEILING'])('keeps %s sign selection live after edits',async name=>{
    const doc=await importFormula(`${name}(A1,B1)`,[[-2.5,2]]);
    expect(actual(doc)).toMatchObject({kind:'number',value:name==='FLOOR'?-4:-2});
    doc.setCellByIndex('Data',0,1,'-2');
    expect(actual(doc)).toMatchObject({kind:'number',value:name==='FLOOR'?-2:-4});
    doc.setCellByIndex('Data',0,0,'2.5');
    expect(actual(doc)).toMatchObject({kind:'error'});
    doc.setCellByIndex('Data',0,1,'2');
    expect(actual(doc)).toMatchObject({kind:'number',value:name==='FLOOR'?2:4});
    const exported=await exportExcelWorkbook(doc);if(!exported.ok)throw new Error(JSON.stringify(exported.diagnostics));
    const reimported=await importExcelWorkbook(exported.value);if(!reimported.ok)throw new Error(JSON.stringify(reimported.diagnostics));
    reimported.value.setCellByIndex('Data',0,0,'-2.5');
    reimported.value.setCellByIndex('Data',0,1,'-2');
    expect(actual(reimported.value)).toMatchObject({kind:'number',value:name==='FLOOR'?-2:-4});
    doc.setCellByIndex('Data',0,0,'"bad"');
    expect(actual(doc).kind).toBe('error');
    expect(getCellTextView(doc.sheets[0].cells[0][9]).inputText).not.toMatch(/isNumber|ifError|isBlank/);
  });
  it.each(['FLOOR','CEILING'])('retains the Excel %s invalid-sign domain rather than producing a number',async name=>{
    expect(actual(await importFormula(`${name}(2.5,-2)`)).kind).toBe('error');
    const doc=await importFormula(`${name}(A1,-2)`,[[-2.5]]);
    expect(actual(doc)).toMatchObject({kind:'number',value:name==='FLOOR'?-2:-4});
    doc.setCellByIndex('Data',0,0,'2.5');expect(actual(doc).kind).toBe('error');
  });
  it.each(['FLOOR','CEILING'])('honors the %s zero-significance domain after edits',async name=>{
    const doc=await importFormula(`${name}(A1,B1)`,[[2.5,2]]);
    doc.setCellByIndex('Data',0,1,'0');
    expect(actual(doc)).toMatchObject(name==='FLOOR'?{kind:'error',errorKind:'div_by_zero'}:{kind:'number',value:0});
    expect(actual(await importFormula(`${name}(2.5,0)`))).toMatchObject(name==='FLOOR'?{kind:'error',errorKind:'div_by_zero'}:{kind:'number',value:0});
  });
  it('round-trips the existing integer floor and ceil operations',async()=>{
    for(const name of ['floor','ceil']) {
      const doc=DocumentState.fromText(`# Data\n| = ${name}(-2.5) |`);
      const exported=await exportExcelWorkbook(doc);if(!exported.ok)throw new Error(JSON.stringify(exported.diagnostics));
      const imported=await importExcelWorkbook(exported.value);if(!imported.ok)throw new Error(JSON.stringify(imported.diagnostics));
      expect(getCellTextView(imported.value.sheets[0].cells[0][0]).inputText).toBe(`= ${name}(-2.5)`);
      expect(imported.value.evaluate().sheets[0].values[0][0]).toMatchObject({kind:'number',value:name==='floor'?-3:-2});
    }
  });
  it('preserves arithmetic argument grouping during dynamic rounding conversion',async()=>{
    const doc=await importFormula('10+CEILING(A1+B1,C1-D1)',[[-1,-1.5,1,3]]);
    expect(actual(doc)).toMatchObject({kind:'number',value:6});
    doc.setCellByIndex('Data',0,3,'-1');
    expect(actual(doc)).toMatchObject({kind:'number',value:8});
  });
  it.each(['FLOOR(2)','CEILING(2,1,0)','FLOOR({1,2},1)'])
    ('keeps unsupported source shape/arity %s as text, not its cache',async formula=>{
      await expect(importFormula(formula)).rejects.toThrow('unsupported_formula');
      const doc=await importFormula(formula,[],{unsupportedContent:'preserve-text'});
      expect(actual(doc)).toMatchObject({kind:'string',value:`=${formula}`});
    });
  it.each([
    ['chiSquareSf(80,4)',41*Math.exp(-40)],['fSf(10**100,2,2)',1e-100],['fCdf(10**(-100),2,2)',1e-100],
    ['studentTSf(10**100,1)',1e-100/Math.PI],['erfc(10)',2.088487583762545e-45],
    ['normalCenteredCdf(10**(-12))',1e-12/Math.sqrt(2*Math.PI)],
  ])('preserves small tails in %s',(formula,expected)=>{
    const result=evaluate(formula as string);expect(result.kind).toBe('number');
    expect(Math.abs((result.value as number)/(expected as number)-1)).toBeLessThan(1e-11);
  });
  it.each([
    ['betaCdf(0.25,0.5,0.5)',1/3],['betaInv(0.25,1,1)',0.25],
    ['gammaInv(0.000000000001,1,3)',-3*Math.log1p(-1e-12)],
    ['gammaInv(0.999999999999,1,3)',-3*Math.log1p(-0.999999999999)],
    ['chiSquareInv(0.000000000001,2)',-2*Math.log1p(-1e-12)],
    ['chiSquareIsf(0.000000000001,2)',-2*Math.log(1e-12)],
    ['fInv(0.000000000001,2,2)',1e-12/(1-1e-12)],
    ['fIsf(0.000000000001,2,2)',(1-1e-12)/1e-12],
    ['studentTInv(0.000000000001,1)',-1/Math.tan(Math.PI*1e-12)],
    ['studentTTwoTailInv(0.000000000001,1)',1/Math.tan(Math.PI*1e-12/2)],
    ['betaPdf(0,1,1)',1],['betaPdf(1,2,1)',2],['gammaPdf(0,1,2)',0.5],
    ['chiSquarePdf(0,2)',0.5],['fPdf(0,2,2)',1],['weibullPdf(0,1,3)',1/3],
    ['betaInv(0,2,3)',0],['betaInv(1,2,3)',1],['gammaInv(0,2,3)',0],
    ['binomialCdf(3,10,0)',1],['binomialPmf(10,10,1)',1],
    ['binomialInv(0.5,10,1)',10],['binomialInv(0.5,10,0)',0],['poissonPmf(0,0)',1],
    ['hypergeometricCdf(3,3,4,10)',1],
  ])('matches independent endpoint/tail identity %s',(formula,expected)=>{
    const result=evaluate(formula as string);expect(result.kind).toBe('number');
    if(expected===0)expect(result.value).toBe(0);
    else expect(Math.abs((result.value as number)/(expected as number)-1)).toBeLessThan(1e-10);
  });
  it('reports bounded numerical work as an error, without a substitute value',()=>{
    const result=evaluate('hypergeometricCdf(10001,30000,30000,60000)');
    expect(result.kind).toBe('error');
  });
  it.each(['asin(2)','acosh(0)','atan2(0,0)','factorial(3.2)','combinations(2,3)','factorial(171)',
    'gamma(0)','gamma(-2)','logGamma(-1)','betaCdf(0.5,0,2)','gammaCdf(2,1,-1)',
    'binomialCdf(2.2,10,0.5)','poissonPmf(-1,2)','studentTCdf(0,0)','chiSquareInv(1,4)',
    'studentTTail(1,2,3)','hypergeometricPmf(4,3,4,10)','normalPdf("1")'])
  ('fails at the native contract for %s',formula=>expect(evaluate(formula).kind).toBe('error'));
});
