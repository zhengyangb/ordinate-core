import { describe, expect, it } from "vitest";
import { listStandardFunctionMetadata } from "../src/runtime/functions";
import { compatibilityDecisionNames, nativeFunctionCompatibility } from "../src/excel/compatibilityRegistry";
import { nativeImportDecisions, excelImportDecisionNames, excelImportRules } from "../src/excel/importRegistry";
import { importFormula } from "../src/excel/importFormula";
import { parseExcelFormula } from "../src/excel/formulaParser";
import { DEFAULT_EXCEL_LIMITS, ExcelReport } from "../src/excel/contracts";
import { parseCellText } from "../src/runtime/parse";
import { importedFunctions } from "../src/excel/functionTranslation";
import { importTextFunctions } from "../src/excel/textTranslation";
import { distributionImports } from "../src/excel/distributionTranslation";
import { DocumentState } from "../src/incremental";
import { exportFormula } from "../src/excel/exportFormula";
import { functionTranslations } from "../src/excel/functionTranslation";

const examples = {
  format: 'A1,"#,##0.00"',
  shape:'A1:B2', index:'A1:B2,1,1', calendar:'45000', signature:'', booleanLiteral:'',
  conditional:'TRUE,1,2', ifError:'A1,0', not:'TRUE', predicate:'A1', logical:'TRUE,FALSE',
  aggregate:'A1:B2', numericUnary:'2', pi:'', numericBinary:'2,3', rounding:'2.345,2', multipleRounding:'2.345,2',
  text:'', concatenate:'"ab","cd"', exact:'"ab","cd"',
  match:'2,A1:A3,0', switch:'A1,1,"one","other"', char:'10', dotProduct:'A1:A3,B1:B3',
  join:'",",FALSE,A1:A3', filter:'A1:A3,A1:A3>0', lookup:'2,A1:A3,B1:B3', selection:'A1:A3,2',
  verticalLookup:'2,A1:B3,2,FALSE',
  distribution:'2,0,1,TRUE',
};

describe("RFC-0042 explicit compatibility decisions", () => {
  // Registry equality alone catches missing decisions, not a forgotten adapter
  // branch. Exercise every actual function/alias through the exporter as well.
  // This checks wiring, independently of numerical parity/oracle fixtures.
  const exportExamples = listStandardFunctionMetadata().flatMap(metadata => {
    const policy = nativeFunctionCompatibility.get(metadata.name)!;
    const signature = metadata.signatures[0];
    let args = signature.parameters.map(parameter => {
      const type = parameter.type;
      if (/datetime/.test(type)) return "2025-06-29T12:34:56Z";
      if (/date/.test(type)) return "2025-06-29";
      if (/time/.test(type)) return "12:34:56";
      if (/Scalar\[string\]|text/.test(type)) return '"abcd"';
      if (/Scalar\[boolean\]/.test(type)) return "true";
      if (type === "view") return "[[1,2]]";
      if (/view/.test(type) && !/Scalar/.test(type)) return "[1,2]";
      return "2";
    });
    if (policy.status === "translated" && policy.rule === "signature") {
      const spec = functionTranslations[metadata.name];
      args = spec.args.slice(0, spec.required).map(type => type === "scalar" ? "2" : type === "dates" ? "[2025-01-01,2026-01-01]" : "[1,2]");
    }
    if (metadata.name === "date") args = ["2025","6","29"];
    if (metadata.name === "filter") args = ["[1,2]","[true,false]"];
    return [metadata.name, ...(metadata.aliases ?? [])].map(name => {
      const call = `${name}(${args.join(",")})`;
      const formula = /^(view|array)/.test(signature.returns) ? `${call}[0]` : call;
      return [name, formula, policy.status] as const;
    });
  });
  it.each(exportExamples)("exercises actual outbound wiring for %s", (_name, formula, status) => {
    const body = parseCellText("= " + formula).body;
    expect(body.valid).toBe(true);
    if (!body.valid || body.kind !== "formula") throw new Error("Invalid adapter test fixture: " + formula);
    const doc = DocumentState.fromText("# Data\n| 1 |"), sheet = doc.sheets[0];
    const translate = () => exportFormula(body.expression, doc, sheet, {sheetName:"Data",rowIndex:0,colIndex:0}, DEFAULT_EXCEL_LIMITS, new ExcelReport());
    if (status === "unsupported") expect(translate).toThrow(/not supported/);
    else expect(translate().formula).toBeTruthy();
  });
  it("requires a decision for every native function, including future additions", () => {
    const native = listStandardFunctionMetadata().map(item => item.name).sort();
    expect([...nativeFunctionCompatibility.keys()].sort()).toEqual(native);
    expect(new Set(compatibilityDecisionNames).size).toBe(compatibilityDecisionNames.length);
  });

  it("does not present unsupported functions as name-compatible", () => {
    expect(nativeFunctionCompatibility.get("trim")).toMatchObject({ status: "unsupported", reason: expect.stringContaining("Whitespace") });
    expect(nativeFunctionCompatibility.get("round")).toEqual({ status: "translated", rule: "rounding" });
    expect(nativeFunctionCompatibility.has("futureFunction")).toBe(false);
  });
  it("requires an inbound decision too when the native function registry changes", () => {
    const decisions = Object.values(nativeImportDecisions).flat();
    expect([...decisions].sort()).toEqual(listStandardFunctionMetadata().map(item => item.name).sort());
    expect(new Set(decisions).size).toBe(decisions.length);
    expect(new Set(excelImportDecisionNames).size).toBe(excelImportDecisionNames.length);
    expect(excelImportRules.has("TODAY")).toBe(false);
    expect(Object.keys(examples).sort()).toEqual([...new Set(excelImportRules.values())].sort());
  });
  it.each([...excelImportRules])("exercises the registered %s import rule", (name, rule) => {
    let args=examples[rule];
    if(name==='DATE')args='2025,1,1';
    if(rule==='distribution') {
      const profile=distributionImports.get(name)!;
      args=Array.from({length:profile.required},(_,i)=>profile.operation==='distribution'&&i===profile.flag?'TRUE':'2').join(',');
    }
    if(rule==='signature') {
      const spec=importedFunctions.get(name)![1];
      args=spec.args.slice(0,spec.required).map(kind=>kind==='scalar'?'2':kind==='dates'?'{45000,45001}':'A1:A2').join(',');
    }
    if(rule==='filter'||rule==='selection') {
      const formula=importFormula(parseExcelFormula(`SUM(${name}(${args}))`),['Data'],{sheetName:'Data',rowIndex:0,colIndex:0},DEFAULT_EXCEL_LIMITS,new ExcelReport(),1900,()=>null);
      expect(parseCellText(`= ${formula}`).body.valid).toBe(true);
      return;
    }
    if(rule==='text') {
      const definition=importTextFunctions[name as keyof typeof importTextFunctions];
      args=definition.arguments.slice(0,definition.required).map(type=>type==='text'?'"abcd"':'2').join(',');
    }
    const formula=importFormula(parseExcelFormula(`${name}(${args})`),['Data'],{sheetName:'Data',rowIndex:0,colIndex:0},DEFAULT_EXCEL_LIMITS,new ExcelReport(),1900,()=>null);
    expect(parseCellText(`= ${formula}`).body.valid).toBe(true);
    const nativeNames=new Set([...nativeImportDecisions.translated,...nativeImportDecisions.helperOnly]);
    for(const call of formula.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\(/g))expect(nativeNames.has(call[1])).toBe(true);
  });
});
