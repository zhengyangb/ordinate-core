import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocumentState, exportExcelWorkbook, importExcelWorkbook, serializeDocumentState } from "../src";
import { escapeCellText } from "../src/parser";
import { mathDistributionCases, mathViewCases } from "../tests/fixtures/mathDistributionCases";
import { nativeDateToSerial, serialToNativeDate } from "../src/excel/temporalValues";

const run = promisify(execFile);
type Scalar = number | string | boolean | null;
type Expected = Exclude<Scalar, null> | { error: string };
interface Case {
  nativeDocument?: string;
  name: string;
  formula: string;
  inputs: Scalar[][];
  expected: Expected;
  /** Explicit target-native result where source-engine rules intentionally differ. */
  importedExpected?: Expected | null;
  /** Observed oracle limitation, not an Excel/native contract change. */
  oracleExpected?: { value: Expected; reason: string };
  edits?: Array<{ row: number; col: number; value: Scalar }>;
  array?: boolean;
}
const numeric = [[2, 3], [null, 4]];
// Expected values follow the target engine, deliberately not native parity.
const exportedCases: Case[] = [
  ...([1900, 1904] as const).flatMap(system => [0, 0.5].map(fraction => ({
    name: `dynamic calendar hour units ${system} ${fraction}`,
    formula: "", inputs: [], expected: fraction * 24,
    nativeDocument: `# Data\n| 2026-03-04 | 0 | = ${serialToNativeDate(`${nativeDateToSerial("A1", "date", system)}+B1`, "date", system)} | | | | | | | = (${nativeDateToSerial("C1", "date-or-datetime", system)}-${nativeDateToSerial("A1", "date", system)})*24 |`,
    edits: [{row: 0, col: 1, value: fraction}],
  }))),
  {name: "exact date predicate", formula: "isDate(2026-03-04)", inputs: [], expected: true},
  {name: "midnight datetime is not date", formula: "isDate(2026-03-04T00:00)", inputs: [], expected: false},
  {name: "date predicate inspects error", formula: "isDate(date(error[type_error]))", inputs: [], expected: false},
  {name: "date predicate conditional branch", formula: "isDate(if(A1,2026-03-04,2026-03-04T00:00))", inputs: [[true]], expected: false,
    edits: [{row: 0, col: 0, value: false}]},
  {name:"postfix text character",formula:'"abcdef"[1]',inputs:[],expected:"b"},
  {name:"postfix text negative character",formula:'"abcdef"[-2]',inputs:[],expected:"e"},
  {name:"postfix text slice",formula:'"abcdef"[1:4]',inputs:[],expected:"bcd"},
  {name:"postfix text negative slice",formula:'"abcdef"[-3:-1]',inputs:[],expected:"de"},
  {name:"postfix text clipped slice",formula:'"abc"[99:]',inputs:[],expected:""},
  {name:"postfix text reversed slice",formula:'"abc"[2:1]',inputs:[],expected:""},
  {name:"postfix computed text",formula:'upper("abcdef")[1:3][-1]',inputs:[],expected:"C"},
  {name:"text take negative",formula:'take("abcdef",-2)',inputs:[],expected:"ef"},
  {name:"text drop negative",formula:'drop("abcdef",-2)',inputs:[],expected:"abcd"},
  {name:"text take clipped",formula:'take("abc",99)',inputs:[],expected:"abc"},
  {name:"text drop clipped",formula:'drop("abc",99)',inputs:[],expected:""},
  {name:"f-string numeric",formula:'f"Total {2+3:.2f}"',inputs:[],expected:"Total 5.00"},
  {name:"f-string date",formula:'f"Date {date(2025,6,29):%F}"',inputs:[],expected:"Date 2025-06-29"},
  {name:"f-string time",formula:'f"Time {time(12,34,56.789):%T}"',inputs:[],expected:"Time 12:34:56"},
  {name:"datetime constructor calendar format",formula:'format(datetime(2025-06-29,12:34:56.789+08:00),"%FT%T")',inputs:[],expected:"2025-06-29T12:34:56"},
  {name:"date extraction",formula:'format(date(2025-06-29T12:34:56),"%F")',inputs:[],expected:"2025-06-29"},
  {name:"time extraction",formula:'format(time(2025-06-29T12:34:56),"%T")',inputs:[],expected:"12:34:56"},
  {name:"temporal year",formula:"year(2025-06-29)",inputs:[],expected:2025},
  {name:"temporal month",formula:"month(2025-06-29)",inputs:[],expected:6},
  {name:"temporal day",formula:"day(2025-06-29)",inputs:[],expected:29},
  {name:"temporal hour",formula:"hour(time(12,34,56.789))",inputs:[],expected:12},
  {name:"temporal minute",formula:"minute(time(12,34,56.789))",inputs:[],expected:34},
  {name:"temporal whole second",formula:"second(time(12,34,56.789))",inputs:[],expected:56},
  {name:"temporal millisecond",formula:"millisecond(time(12,34,56.789))",inputs:[],expected:789},
  {name:"temporal unix UTC",formula:"unixMillis(1970-01-01T00:00Z)",inputs:[],expected:0},
  {name:"temporal unix fixed offset",formula:"unixMillis(1970-01-01T08:00+08:00)",inputs:[],expected:0},
  {name:"temporal unix early calendar",formula:"unixMillis(1900-01-01T00:00Z)",inputs:[],expected:Date.parse("1900-01-01T00:00Z")},
  {name:"temporal from unix",formula:"unixMillis(datetimeFromUnixMillis(123456789))",inputs:[],expected:123456789},
  {name:"temporal from unix early calendar",formula:'format(datetimeFromUnixMillis(-2208988800000),"%F")',inputs:[],expected:"1900-01-01",
    oracleExpected:{value:"1899-12-31",reason:"Calc's calendar epoch is 1899-12-30; it does not emulate Excel's pre-March-1900 fictitious leap-day serials. Excel serial 1 is 1900-01-01."}},
  {name:"temporal fixed duration addition",formula:'format(2025-06-29+duration(1),"%F")',inputs:[],expected:"2025-06-30"},
  {name:"temporal same instant equality",formula:"1970-01-01T00:00Z==1970-01-01T08:00+08:00",inputs:[],expected:true},
  {name:"temporal unix after fixed duration",formula:"unixMillis(1970-01-01T00:00Z+duration(0,1))",inputs:[],expected:3600000},
  {name:"temporal unix after same-offset conditional",formula:"unixMillis(if(true,1970-01-01T00:00Z,1970-01-02T00:00Z))",inputs:[],expected:0},
  {name:"temporal time minus duration",formula:"hour(time(12,34)-duration(0,1))",inputs:[],expected:11},
  {name:"temporal millisecond day boundary",formula:"millisecond(time(23,59,59.999))",inputs:[],expected:999},
  {name:"temporal second day boundary",formula:"second(time(23,59,59.999))",inputs:[],expected:59},
  {name:"implicit date text",formula:'f"Date {date(2025,6,29)}"',inputs:[],expected:"Date 2025-06-29"},
  {name:"implicit literal ISO datetime text",formula:'f"At {2025-06-29T12:34:56Z}"',inputs:[],expected:"At 2025-06-29T12:34:56Z"},
  ...mathViewCases.map(test => ({name:`numeric-view mathematics ${test.name}`,formula:test.formula,inputs:[],expected:test.expected})),
  ...mathDistributionCases.map(test => ({
    name: `scalar mathematics/distribution ${test.name}`,
    formula: `${test.name}(${test.args.join(",")})`, inputs: [], expected: test.expected,
    ...(test.name === "binomialRange" ? { oracleExpected: { value: { error: "#NAME?" }, reason: "Calc registers BINOM.DIST.RANGE as an unimplemented macro call (NOID)." } } : {}),
  })),
  {name:"natural exponential",formula:"exp(A1)",inputs:[[1]],expected:Math.E},
  {name:"natural logarithm",formula:"ln(A1)",inputs:[[Math.E]],expected:1},
  {name:"logarithm default base",formula:"log(A1)",inputs:[[100]],expected:2},
  {name:"logarithm explicit base",formula:"log(A1,2)",inputs:[[8]],expected:3},
  {name:"base ten logarithm",formula:"log10(A1)",inputs:[[1000]],expected:3},
  {name:"normal cumulative",formula:"normalCdf(A1)",inputs:[[1]],expected:0.8413447460685429},
  {name:"normal density",formula:"normalPdf(A1)",inputs:[[0]],expected:0.3989422804014327},
  {name:"normal inverse location scale",formula:"normalInv(A1,10,2)",inputs:[[0.5]],expected:10},
  {name:"normal negative tail",formula:"normalCdf(A1)",inputs:[[-8]],expected:6.22096057427182e-16},
  {name:"lognormal cumulative",formula:"lognormalCdf(A1,0,1)",inputs:[[1]],expected:0.5},
  {name:"lognormal density",formula:"lognormalPdf(A1,0,1)",inputs:[[1]],expected:0.3989422804014327},
  {name:"lognormal inverse",formula:"lognormalInv(A1,2,1)",inputs:[[0.5]],expected:Math.exp(2)},
  {name:"readable addition",formula:"A1+B1",inputs:[[7,2]],expected:9},
  {name:"explicit concatenation",formula:"text(A1)+text(B1)",inputs:[[7,2]],expected:"72"},
  {name:"literal concatenation",formula:'"Hello "+text(A1)',inputs:[["Ada"]],expected:"Hello Ada"},
  {name:"numeric text follows Excel coercion",formula:"A1+B1",inputs:[[7,"2"]],expected:9},
  {name:"target rounding",formula:"round(-1.5,0)",inputs:[],expected:-2},
  {name:"target modulo",formula:"mod(-7,3)",inputs:[],expected:2},
  {name:"negation outside power",formula:"-(2**2)",inputs:[],expected:-4},
  {name:"negative base power",formula:"(-2)**2",inputs:[],expected:4},
  {name:"power right grouping",formula:"2**(3**2)",inputs:[],expected:512},
  {name:"power left grouping",formula:"(2**3)**2",inputs:[],expected:64},
  {name:"direct IF",formula:'if(A1>0,"yes","no")',inputs:[[7]],expected:"yes"},
  {name:"SUM ignores text",formula:"sum(A1:B2)",inputs:[[2,"3"],[null,4]],expected:6},
  {name:"static vertical slice",formula:"sum(A1:A3[0:2])",inputs:[[2],[3],[99]],expected:5},
  {name:"static negative slice",formula:"sum(A1:C1[-2:])",inputs:[[99,2,3]],expected:5},
  {name:"static matrix slice",formula:"sum(A1:C2[:,1:])",inputs:[[99,2,3],[99,4,5]],expected:14},
  {name:"PRODUCT ignores blanks",formula:"product(A1:B2)",inputs:numeric,expected:24},
  {name:"AVERAGE",formula:"average(A1:B2)",inputs:numeric,expected:3},
  {name:"COUNTBLANK",formula:"countblank(A1:B2)",inputs:numeric,expected:1},
  {name:"array arithmetic",formula:"sum(A1:A2+B1:B2)",inputs:[[2,3],[4,5]],expected:14},
  {name:"array constants",formula:"sum([2,3,4])",inputs:[],expected:9},
  {name:"array expressions",formula:"sum([@[#1,#1],@[#1,#1]+1])",inputs:[[3]],expected:7},
  {name:"text contains literal wildcard",formula:'contains(A1,"*")',inputs:[["a*b"]],expected:true},
  {name:"text replace",formula:'replace(A1,"a","X")',inputs:[["abaca"]],expected:"XbXcX"},
  {name:"text slice",formula:"slice(A1,1,4)",inputs:[["abcdef"]],expected:"bcd"},
  {name:"text negative slice",formula:"slice(A1,-2)",inputs:[["abcdef"]],expected:"ef"},
  {name:"text slice beyond end",formula:"slice(A1,99)",inputs:[["abc"]],expected:""},
  {name:"VALUE uses target conversion",formula:"number(A1)",inputs:[["12"]],expected:12},
  {name:"boolean conversion",formula:"if(boolean(A1),7,9)",inputs:[[2]],expected:7},
  {name:"FV",formula:"fv(0.1,2,-100,-1000,1)",inputs:[],expected:1441},
  {name:"PV",formula:"pv(0.1,2,-100,-1000)",inputs:[],expected:1000},
  {name:"PMT",formula:"pmt(0,2,1000)",inputs:[],expected:-500},
  {name:"NPER",formula:"nper(0,-100,1000)",inputs:[],expected:10},
  {name:"SLN",formula:"sln(100,20,4)",inputs:[],expected:20},
  {name:"SYD",formula:"syd(100,20,4,2)",inputs:[],expected:24},
  {name:"EFFECT",formula:"effect(0.2,2)",inputs:[],expected:0.21},
  {name:"NOMINAL",formula:"nominal(0.21,2)",inputs:[],expected:0.2},
  {name:"RATE deterministic simple root",formula:"rate(2,-60,100)",inputs:[],expected:Math.sqrt(2.76)/2-0.7},
  {name:"IPMT",formula:"ipmt(0.1,1,2,100)",inputs:[],expected:-10},
  {name:"PPMT",formula:"ppmt(0.1,1,2,100)",inputs:[],expected:-100/2.1},
  {name:"CUMIPMT default type",formula:"cumipmt(0.1,2,100,1,2)",inputs:[],expected:-10-110/21},
  {name:"CUMPRINC",formula:"cumprinc(0.1,2,100,1,2,0)",inputs:[],expected:-100},
  {name:"ISPMT",formula:"ispmt(0.1,1,2,100)",inputs:[],expected:-5},
  {name:"NPV",formula:"npv(0.1,[100,121])",inputs:[],expected:100/1.1+100},
  {name:"IRR",formula:"irr([-100,110])",inputs:[],expected:0.1},
  {name:"MIRR",formula:"mirr([-100,110],0.1,0.1)",inputs:[],expected:0.1},
  {name:"XNPV native date literals",formula:"xnpv(0.1,[-100,110],[2023-01-01,2024-01-01])",inputs:[],expected:0},
  {name:"XIRR native date literals",formula:"xirr([-100,110],[2023-01-01,2024-01-01])",inputs:[],expected:0.1},
  {name:"DB",formula:"db(100,0,4,1)",inputs:[],expected:100},
  {name:"DDB",formula:"ddb(100,0,4,1)",inputs:[],expected:50},
  {name:"MEDIAN",formula:"median(A1:A3)",inputs:[[2],[4],[8]],expected:4},
  {name:"inclusive PERCENTILE",formula:"percentile(A1:A3,0.25)",inputs:[[2],[4],[8]],expected:3},
  {name:"sample VAR",formula:"variance(A1:A3)",inputs:[[2],[4],[8]],expected:28/3},
  {name:"population STDEV",formula:"stdevp(A1:A3)",inputs:[[2],[4],[8]],expected:Math.sqrt(56/9)},
  {name:"MODE",formula:"mode([2,4,4])",inputs:[],expected:4},
  {name:"CORREL",formula:"correl(A1:A3,B1:B3)",inputs:[[2,4],[4,8],[8,16]],expected:1},
  {name:"FORECAST",formula:"forecast(6,B1:B3,A1:A3)",inputs:[[2,4],[4,8],[8,16]],expected:12},
  {name:"TEXTJOIN preserves empty strings",formula:'join(",",["a","","b"])',inputs:[],expected:"a,,b"},
  {name:"MATCH zero-based result",formula:"match(4,A1:A3)",inputs:[[2],[4],[8]],expected:1},
  {name:"INDEX MATCH composition",formula:"index(B1:B3,match(4,A1:A3))",inputs:[[2,4],[4,8],[8,16]],expected:8},
  {name:"INDEX conditional MATCH remains conditional",formula:"index(B1:B3,if(false,match(4,A1:A3),0))",inputs:[[2,4],[4,8],[8,16]],expected:4},
  {name:"NPV single cash flow",formula:"npv(0.1,A1)",inputs:[[100]],expected:100/1.1},
  {name:"SUMPRODUCT",formula:"dotProduct(A1:A3,B1:B3)",inputs:[[2,4],[4,8],[8,16]],expected:168},
  {name:"XLOOKUP exact",formula:"lookup(4,A1:A3,B1:B3)",inputs:[[2,4],[4,8],[8,16]],expected:8},
  {name:"FILTER scalar consumer",formula:"sum(filter(A1:A3,A1:A3>2))",inputs:[[2],[4],[8]],expected:12},
  {name:"TAKE rows",formula:"sum(take(A1:A3,2))",inputs:[[2],[4],[8]],expected:6},
  {name:"DROP row-vector columns",formula:"sum(drop(A1:C1,-1))",inputs:[[2,4,8]],expected:6},
  {name:"negative INDEX",formula:"index(A1:A2,-1)",inputs:numeric,expected:0},
  {name:"matrix INDEX",formula:"index(A1:B2,1,1)",inputs:numeric,expected:4},
  {name:"dynamic INDEX",formula:"index(A1:B2,C1,D1)",inputs:[[2,3,0,0],[4,5]],edits:[{row:0,col:2,value:-1},{row:0,col:3,value:-1}],expected:5},
  {name:"shape",formula:"shape(A1:B2)[1]",inputs:numeric,expected:2},
  {name:"edited formula remains arithmetic",formula:"A1+B1",inputs:[[2,3]],edits:[{row:0,col:1,value:"4"}],expected:6},
];

const importedCases: Case[] = [
  {name:"import legacy FLOOR positive",formula:"FLOOR(12.7,5)",inputs:[],expected:10},
  {name:"import legacy FLOOR negative positive multiple",formula:"FLOOR(-2.5,2)",inputs:[],expected:-4},
  {name:"import legacy FLOOR both negative",formula:"FLOOR(-2.5,-2)",inputs:[],expected:-2},
  {name:"import legacy FLOOR invalid signs",formula:"FLOOR(2.5,-2)",inputs:[],expected:{error:"#NUM!"},importedExpected:{error:"type_error"},
    oracleExpected:{value:{error:"#VALUE!"},reason:"Calc reports a different error code for invalid legacy FLOOR signs."}},
  {name:"import legacy FLOOR unit",formula:"FLOOR(-2.5,1)",inputs:[],expected:-3},
  {name:"import legacy CEILING positive",formula:"CEILING(12.7,5)",inputs:[],expected:15},
  {name:"import legacy CEILING negative positive multiple",formula:"CEILING(-2.5,2)",inputs:[],expected:-2},
  {name:"import legacy CEILING both negative",formula:"CEILING(-2.5,-2)",inputs:[],expected:-4},
  {name:"import legacy CEILING invalid signs",formula:"CEILING(2.5,-2)",inputs:[],expected:{error:"#NUM!"},importedExpected:{error:"type_error"},
    oracleExpected:{value:{error:"#VALUE!"},reason:"Calc reports a different error code for invalid legacy CEILING signs."}},
  {name:"import legacy CEILING unit",formula:"CEILING(-2.5,1)",inputs:[],expected:-2},
  {name:"import legacy FLOOR dynamic negative multiple",formula:"FLOOR(A1,B1)",inputs:[[-2.5,2]],edits:[{row:0,col:1,value:-2}],expected:-2},
  {name:"import legacy CEILING dynamic negative multiple",formula:"CEILING(A1,B1)",inputs:[[-2.5,2]],edits:[{row:0,col:1,value:-2}],expected:-4},
  {name:"import legacy FLOOR zero multiple",formula:"FLOOR(2.5,0)",inputs:[],expected:{error:"#DIV/0!"},importedExpected:{error:"div_by_zero"},
    oracleExpected:{value:{error:"#VALUE!"},reason:"Calc reports a different error code for zero legacy FLOOR significance."}},
  {name:"import legacy CEILING zero multiple",formula:"CEILING(2.5,0)",inputs:[],expected:0},
  {name:"import existing TRUNC optional digits",formula:"TRUNC(-12.987,2)",inputs:[],expected:-12.98},
  {name:"import existing TRUNC negative digits",formula:"TRUNC(1234,-2)",inputs:[],expected:1200},
  {name:"import Fisher transformation",formula:"FISHER(0.5)",inputs:[],expected:Math.log(3)/2},
  {name:"import inverse Fisher transformation",formula:"FISHERINV(0)",inputs:[],expected:0},
  {name:"import precise floor",formula:"_xlfn.FLOOR.PRECISE(-5,2)",inputs:[],expected:-6},
  {name:"import precise ceiling",formula:"_xlfn.CEILING.PRECISE(-5,-2)",inputs:[],expected:-4},
  {name:"import ISO ceiling",formula:"ISO.CEILING(-5,2)",inputs:[],expected:-4},
  {name:"import ATAN2 Excel x/y order",formula:"ATAN2(-1,1)",inputs:[],expected:3*Math.PI/4},
  {name:"import legacy F right tail",formula:"FDIST(3,2,2)",inputs:[],expected:0.25},
  {name:"import legacy F inverse right tail",formula:"FINV(0.25,2,2)",inputs:[],expected:3},
  {name:"import legacy chi-square right tail",formula:"CHIDIST(2,4)",inputs:[],expected:2*Math.exp(-1)},
  {name:"import legacy chi-square inverse right tail",formula:"CHIINV(2*EXP(-1),4)",inputs:[],expected:2},
  {name:"import legacy T one tail",formula:"TDIST(1,1,1)",inputs:[],expected:0.25},
  {name:"import legacy T two tails",formula:"TDIST(1,1,2)",inputs:[],expected:0.5},
  {name:"import legacy T inverse two tails",formula:"TINV(0.5,1)",inputs:[],expected:1},
  {name:"import legacy binomial inverse order",formula:"CRITBINOM(10,0.5,0.5)",inputs:[],expected:5},
  {name:"import beta cumulative scaled bounds",formula:"_xlfn.BETA.DIST(0.5,2,2,TRUE,-1,2)",inputs:[],expected:0.5},
  {name:"import beta density scaled bounds",formula:"_xlfn.BETA.DIST(0.5,2,2,FALSE,-1,2)",inputs:[],expected:0.5},
  {name:"import binomial range optional upper (Calc unavailable)",formula:"_xlfn.BINOM.DIST.RANGE(10,0.5,2)",inputs:[],expected:45/1024,
    oracleExpected:{value:{error:"#NAME?"},reason:"Calc has no implementation of BINOM.DIST.RANGE; the source contract is independently checked analytically."}},
  {name:"import exact VLOOKUP",formula:"VLOOKUP(4,A1:B3,2,FALSE)",inputs:[[2,4],[4,8],[8,16]],expected:8},
  {name:"import exact VLOOKUP duplicate",formula:"VLOOKUP(4,A1:B3,2,0)",inputs:[[4,8],[4,99],[8,16]],expected:8},
  {name:"import natural exponential",formula:"EXP(A1)",inputs:[[1]],expected:Math.E},
  {name:"import natural log",formula:"LN(A1)",inputs:[[Math.E]],expected:1},
  {name:"import LOG default",formula:"LOG(A1)",inputs:[[100]],expected:2},
  // Calc treats an explicit empty slot differently from an absent optional
  // argument. Record that oracle difference; do not call it Excel agreement.
  {name:"import LOG explicit empty slot (Calc difference)",formula:"LOG(A1,)",inputs:[[100]],expected:{error:"#VALUE!"},importedExpected:2},
  {name:"import LOG10",formula:"LOG10(A1)",inputs:[[1000]],expected:3},
  {name:"import legacy normal cumulative",formula:"NORMSDIST(A1)",inputs:[[1]],expected:0.8413447460685429},
  {name:"import standard normal PDF",formula:"_xlfn.NORM.S.DIST(A1,FALSE)",inputs:[[0]],expected:0.3989422804014327},
  {name:"import normal dynamic cumulative",formula:"_xlfn.NORM.DIST(A1,0,1,B1)",inputs:[[0,true]],expected:0.5},
  {name:"import normal numeric cumulative",formula:"_xlfn.NORM.DIST(A1,0,1,0)",inputs:[[0]],expected:0.3989422804014327},
  {name:"import legacy normal inverse",formula:"NORMSINV(A1)",inputs:[[0.9]],expected:1.2815515655446006},
  {name:"import normal inverse",formula:"_xlfn.NORM.INV(A1,10,2)",inputs:[[0.5]],expected:10},
  {name:"import legacy lognormal cumulative",formula:"LOGNORMDIST(A1,0,1)",inputs:[[1]],expected:0.5},
  {name:"import lognormal density",formula:"_xlfn.LOGNORM.DIST(A1,0,1,FALSE)",inputs:[[1]],expected:0.3989422804014327},
  {name:"import legacy lognormal inverse",formula:"LOGINV(A1,2,1)",inputs:[[0.5]],expected:Math.exp(2)},
  { name: "import MEDIAN variadic", formula: "MEDIAN(2,4,8)", inputs: [], expected: 4 },
  { name: "import legacy VAR", formula: "VAR(A1:A3)", inputs: [[2],[4],[8]], expected: 28/3 },
  { name: "import NPV", formula: "NPV(0.1,100,121)", inputs: [], expected: 100/1.1+100 },
  { name: "import MIRR", formula: "MIRR({-100,110},0.1,0.1)", inputs: [], expected: 0.1 },
  { name: "import XNPV serial array", formula: "XNPV(0.1,{-100,110},{44927,45292})", inputs: [], expected: 0 },
  { name: "import TEXTJOIN ignore empty", formula: '_xlfn.TEXTJOIN(",",TRUE,{"a","","b"})', inputs: [], expected: "a,b" },
  { name: "IF blank result", formula: "IF(TRUE,A1,7)", inputs: [[null]], expected: 0, importedExpected: null },
  { name: "IFERROR empty text", formula: 'IFERROR("",7)', inputs: [], expected: "" },
  { name: "fractional SYD", formula: "SYD(100,20,4,0.5)", inputs: [], expected: 36, importedExpected: { error: "type_error" } },
  { name: "INDEX Excel matrix", formula: "INDEX(A1:B2,2,2)", inputs: numeric, expected: 4 },
  { name: "INDEX Excel row vector", formula: "INDEX(A1:B1,2)", inputs: numeric, expected: 3 },
  { name: "INDEX Excel omitted column", formula: "SUM(INDEX(A1:B2,2))", inputs: numeric, expected: 4 },
  { name: "INDEX Excel all rows", formula: "SUM(INDEX(A1:B2,0,2))", inputs: numeric, expected: 7 },
  { name: "INDEX Excel both zero", formula: "SUM(INDEX(A1:B2,0,0))", inputs: numeric, expected: 9 },
  { name: "INDEX Excel blank result", formula: "INDEX(A1:B2,2,1)", inputs: numeric, expected: 0, importedExpected: null },
  { name: "INDEX Excel blank identity", formula: "ISBLANK(INDEX(A1:B2,2,1))", inputs: numeric, expected: true },
  { name: "INDEX Excel reference ignores text", formula: "SUM(INDEX(A1:B2,1,2))", inputs: [[2, "3"], [4, 5]], expected: 0, importedExpected: { error: "type_error" } },
  { name: "INDEX Excel nested references", formula: "INDEX(INDEX(A1:B2,0,2),2)", inputs: numeric, expected: 4 },
  { name: "INDEX Excel row count", formula: "ROWS(INDEX(A1:B2,0,2))", inputs: numeric, expected: 2 },
  { name: "INDEX Excel column count", formula: "COLUMNS(INDEX(A1:B2,2,0))", inputs: numeric, expected: 2 },
  { name: "INDEX Excel failed reference COUNT", formula: "COUNT(INDEX(A1:B2,99,1))", inputs: numeric, expected: 0, importedExpected: { error: "unresolved_reference" } },
  { name: "INDEX Excel failed reference COUNTA", formula: "COUNTA(INDEX(A1:B2,99,1))", inputs: numeric, expected: 1, importedExpected: { error: "unresolved_reference" } },
];

// Oracle calibration, NOT proof of Excel compatibility. These observed Calc
// results differ from Excel's type model or need an actual Excel boundary check.
// Keep them separate instead of weakening the production contract to pass Calc.
const oracleCases: Case[] = [
  { name: "Calc INDEX fractional indices", formula: "INDEX(A1:B2,1.9,1.9)", inputs: numeric, expected: 2 },
  { name: "Calc nested LET binding", formula: "_xlfn.LET(ordResult,_xlfn.LET(ordValue,2,ordValue+1),ordResult+1)", inputs: [], expected: { error: "#NAME?" } },
  { name: "Calc separate LET scopes", formula: "_xlfn.LET(ordValue,2,ordValue)+_xlfn.LET(ordValue,3,ordValue)", inputs: [], expected: 5 },
  { name: "Calc nested prefixed LET binding", formula: "_xlfn.LET(_xlpm.ordResult,_xlfn.LET(_xlpm.ordValue,2,_xlpm.ordValue+1),_xlpm.ordResult+1)", inputs: [], expected: { error: "#NAME?" } },
  { name: "Calc unused LET error", formula: "_xlfn.LET(_xlpm.unused,1/0,7)", inputs: [], expected: 7 },
  { name: "Calc LET Boolean cache", formula: "_xlfn.LET(_xlpm.result,TRUE,IF(_xlpm.result,TRUE,FALSE))", inputs: [], expected: 1 },
  { name: "Calc tab substitute before line break", formula: 'SUBSTITUTE(A1,_xlfn.UNICHAR(9)," ")', inputs: [["\t\n12\u00a0"]], expected: "_x0001_12\u00a0" },
  { name: "Calc numeric Boolean cell", formula: "ISNUMBER(A1)", inputs: [[true]], expected: true },
  { name: "Calc same Boolean cell also logical", formula: "ISLOGICAL(A1)", inputs: [[true]], expected: true },
  { name: "Calc Boolean array predicate", formula: "SUM(IF(ISLOGICAL(A1:B2),1,0))", inputs: [[true, false], [true, false]], array: true, expected: 0 },
  { name: "Calc blank IFERROR value", formula: "IFERROR(A1,7)", inputs: [[null]], expected: 0 },
  { name: "Calc blank IFERROR predicate", formula: "ISBLANK(IFERROR(A1,7))", inputs: [[null]], expected: true },
  { name: "Calc blank IFERROR length", formula: "LEN(IFERROR(A1,7))", inputs: [[null]], expected: 0 },
  { name: "Calc huge MID endpoints", formula: 'MID("abc",1E308,1E308)', inputs: [], expected: { error: "#VALUE!" } },
  { name: "Calc INDEX CSE Boolean result cache", formula: "IF(INDEX(ISBLANK(A1:B2),2,1),TRUE,FALSE)", inputs: numeric, array: true, expected: 1 },
];
const allCases = [
  ...exportedCases.map(test => ({ ...test, route: "export" as const })),
  ...[...importedCases, ...oracleCases].map(test => ({ ...test, route: "import" as const })),
];

function native(test: Case): DocumentState {
  if (test.nativeDocument) return DocumentState.fromText(test.nativeDocument);
  const rows = Array.from({ length: Math.max(1, test.inputs.length) }, (_, r) => {
    const cells = Array.from({ length: 10 }, (_, c) => r === 0 && c === 9 ? `= ${test.formula}` :
      test.inputs[r]?.[c] == null ? "" : escapeCellText(JSON.stringify(test.inputs[r][c])));
    return `| ${cells.join(" | ")} |`;
  });
  return DocumentState.fromText(`# Data\n${rows.join("\n")}`);
}

function assertNative(document: DocumentState, expected: Expected | null): void {
  const value = document.evaluate().sheets[0].values[0][9];
  if (expected === null) expect(value.kind).toBe("blank");
  else if (typeof expected === "object") expect(value).toMatchObject({ kind: "error", errorKind: expected.error });
  else if (typeof expected === "number") {
    expect(value.kind).toBe("number");
    if (value.kind !== "number") throw new Error(JSON.stringify(value));
    expect(value.value).toBeCloseTo(expected, 10);
  } else expect(value).toEqual({ kind: typeof expected === "string" ? "string" : "boolean", value: expected });
}

let scratch: string;
const recalculated = new Map<string, ExcelJS.Workbook>();
const archives = new Map<string, Uint8Array>();
const imports = new Map<string, Uint8Array>();

beforeAll(async () => {
  // Do not use or alter the user's running office session or profile.
  const engine = await run("soffice", ["--version"], { timeout: 30_000 });
  console.info(`Independent recalculation engine: ${engine.stdout.trim()}`);
  scratch = await mkdtemp(join(tmpdir(), "ordinate-excel-recalc-"));
  const input = join(scratch, "input"), output = join(scratch, "output");
  const profileUser = join(scratch, "profile", "user");
  await Promise.all([mkdir(input), mkdir(output), mkdir(profileUser, { recursive: true })]);
  await writeFile(join(profileUser, "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Calc/Formula/Load">
    <prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop>
  </item>
</oor:items>`);
  const files: string[] = [];
  for (const [index, test] of allCases.entries()) {
    const workbook = new ExcelJS.Workbook();
    if (test.route === "export") {
      const result = await exportExcelWorkbook(native(test));
      expect(result.ok, `${test.name}: ${JSON.stringify(result.diagnostics)}`).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      await workbook.xlsx.load(result.value.slice().buffer);
    } else {
      const sheet = workbook.addWorksheet("Data");
      test.inputs.forEach((row, r) => row.forEach((value, c) => { sheet.getCell(r + 1, c + 1).value = value; }));
      sheet.getCell("J1").value = { formula: test.formula, ...("array" in test && test.array ? { shareType: "array", ref: "J1" } : {}) };

    }
    for (const edit of test.edits ?? []) workbook.getWorksheet("Data")!.getCell(edit.row + 1, edit.col + 1).value = edit.value;
    const cell = workbook.getWorksheet("Data")!.getCell("J1");
    expect(cell.type).toBe(ExcelJS.ValueType.Formula);
    // Deliberately wrong cache proves the independent application recalculated.
    cell.value = { ...cell.value as ExcelJS.CellFormulaValue, result: 987654321 };
    workbook.calcProperties.fullCalcOnLoad = true;
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    if (test.route === "import") imports.set(test.name, bytes);
    const file = join(input, `case-${index}.xlsx`);
    await writeFile(file, bytes);
    files.push(file);
  }
  await run("soffice", [`-env:UserInstallation=${pathToFileURL(join(scratch, "profile")).href}`,
    "--headless", "--convert-to", "xlsx", "--outdir", output, ...files], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  for (const [index, test] of allCases.entries()) {
    const bytes = new Uint8Array(await readFile(join(output, `case-${index}.xlsx`)));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.slice().buffer);
    recalculated.set(test.name, workbook);
    archives.set(test.name, bytes);
  }
});

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

function assertRecalculated(test: Case): void {
  const expected = test.oracleExpected?.value ?? test.expected;
  const cell = recalculated.get(test.name)!.getWorksheet("Data")!.getCell("J1");
  expect(cell.formula).toBeTruthy();
  if (expected === "") {
    // ExcelJS discards empty-string caches. Check the independent application's
    // actual typed cache in the file, not our own reader or an expected fallback.
    const xml = strFromU8(unzipSync(archives.get(test.name)!)["xl/worksheets/sheet1.xml"]);
    const cachedCell = xml.match(/<c\b[^>]*\br="J1"[^>]*>[\s\S]*?<\/c>/)?.[0];
    expect(cachedCell).toBeDefined();
    expect(cachedCell).toMatch(/\bt="str"/);
    expect(cachedCell).toMatch(/<v(?:\s*\/>|><\/v>)/);
  } else if (typeof expected === "number") expect(cell.result).toBeCloseTo(expected, 10);
  else expect(cell.result).toEqual(expected);
}

describe("RFC-0042 independent desktop-engine export recalculation", () => {
  it.each(exportedCases)("recalculates $name from formula source instead of the poisoned cache", test => {
    assertRecalculated(test);
  });
});

describe("RFC-0042 independent desktop-engine import comparison", () => {
  it.each(importedCases)("checks $name against source results and declared native differences", async test => {
    assertRecalculated(test);
    const result = await importExcelWorkbook(imports.get(test.name)!);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const expected = test.importedExpected === undefined ? test.expected : test.importedExpected;
    assertNative(result.value, expected);
    assertNative(DocumentState.fromText(serializeDocumentState(result.value)), expected);
  });
});

describe("Calc oracle limits — these do not assert Excel or native semantics", () => {
  it.each(oracleCases)("records $name without changing our translator to imitate it", assertRecalculated);
});
