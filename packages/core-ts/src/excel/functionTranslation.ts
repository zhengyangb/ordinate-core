/** One signature manifest drives both directions. These are operation mappings,
 * not a promise to emulate Excel's coercions, errors or iterative solver. */
import { distributionExports } from "./distributionTranslation";
import { mathOperations } from "../runtime/functions/mathematics";
import { mathViewOperations } from "../runtime/functions/mathViews";
export type ArgumentKind = "scalar" | "view" | "vector" | "dates";
export interface FunctionTranslation {
  /** Actual XLSX function spelling, including required future-function prefixes. */
  excel: string;
  aliases: readonly string[];
  args: readonly ArgumentKind[];
  required: number;
  variadic?: number;
  financial?: boolean;
  defaults?: Readonly<Record<number, string>>;
  excelRequired?: number;
  solver?: "deterministic";
  /** Specialized inbound normalization is declared in the same family manifest. */
  inbound?: false;
  /** Source Excel slots: native argument index or a fixed literal. */
  argumentOrder?: readonly (number | string)[];
  /** Same operation/argument positions, but a source alias may expose fewer options. */
  importArities?: Readonly<Record<string, { required: number; maximum: number }>>;
}
const signature = (excel: string, args: readonly ArgumentKind[], required = args.length,
  aliases: readonly string[] = [], variadic?: number): FunctionTranslation => ({ excel, args, required, aliases, variadic });
const scalar = (excel: string, min: number, max = min) => signature(excel, Array<ArgumentKind>(max).fill("scalar"), min);
const finance = (definition: FunctionTranslation): FunctionTranslation => ({ ...definition, financial: true });
const solved = (definition: FunctionTranslation): FunctionTranslation => ({ ...finance(definition), solver: "deterministic" });
const future = (...args: Parameters<typeof signature>): FunctionTranslation => ({ ...signature(...args), excel: `_xlfn.${args[0]}` });

export const functionTranslations: Readonly<Record<string, FunctionTranslation>> = {
  ...Object.fromEntries(mathViewOperations.map(operation => [operation.name,
    signature(operation.excel, operation.parameters.map(p => p.type), operation.parameters.length, [], operation.variadic)])),
  ...distributionExports,
  ...Object.fromEntries(mathOperations.map(operation => [operation.name, {
    ...scalar(operation.excel, operation.parameters.filter(p => p.default === undefined && p.defaultFrom === undefined).length, operation.parameters.length),
    aliases: operation.aliases ?? [], argumentOrder: operation.argumentOrder,
    importArities: operation.importArities,
    defaults: Object.fromEntries(operation.parameters.flatMap((p, i) => p.default === undefined ? [] : [[i, String(p.default)]])),
  }])),
  exp: scalar("EXP", 1), ln: scalar("LN", 1), log10: scalar("LOG10", 1),
  log: { ...scalar("LOG", 1, 2), defaults: { 1: "10" } },
  gcd: signature("GCD", ["view"], 1, [], 0), lcm: signature("LCM", ["view"], 1, [], 0),
  median: signature("MEDIAN", ["view"], 1, [], 0),
  percentile: future("PERCENTILE.INC", ["view", "scalar"], 2, ["PERCENTILE"]),
  quartile: future("QUARTILE.INC", ["view", "scalar"], 2, ["QUARTILE"]),
  variance: future("VAR.S", ["view"], 1, ["VAR"], 0),
  variancep: future("VAR.P", ["view"], 1, ["VARP"], 0),
  stdev: future("STDEV.S", ["view"], 1, ["STDEV"], 0),
  stdevp: future("STDEV.P", ["view"], 1, ["STDEVP"], 0),
  avedev: signature("AVEDEV", ["view"], 1, [], 0),
  devsq: signature("DEVSQ", ["view"], 1, [], 0),
  geomean: signature("GEOMEAN", ["view"], 1, [], 0),
  harmean: signature("HARMEAN", ["view"], 1, [], 0),
  large: signature("LARGE", ["view", "scalar"]),
  small: signature("SMALL", ["view", "scalar"]),
  rank: future("RANK.EQ", ["scalar", "view", "scalar"], 2, ["RANK"]),
  mode: future("MODE.SNGL", ["view"], 1, ["MODE"], 0),
  correl: signature("CORREL", ["view", "view"]),
  covariance: future("COVARIANCE.S", ["view", "view"]),
  covariancep: future("COVARIANCE.P", ["view", "view"], 2, ["COVAR"]),
  slope: signature("SLOPE", ["view", "view"]),
  intercept: signature("INTERCEPT", ["view", "view"]),
  forecast: future("FORECAST.LINEAR", ["scalar", "view", "view"], 3, ["FORECAST"]),
  standardize: scalar("STANDARDIZE", 3),
  fv: finance(scalar("FV", 3, 5)), pv: finance(scalar("PV", 3, 5)),
  pmt: finance(scalar("PMT", 3, 5)), nper: finance(scalar("NPER", 3, 5)),
  rate: solved(scalar("RATE", 3, 5)),
  ipmt: finance(scalar("IPMT", 4, 6)), ppmt: finance(scalar("PPMT", 4, 6)),
  cumipmt: finance({ ...scalar("CUMIPMT", 5, 6), defaults: { 5: "0" }, excelRequired: 6 }),
  cumprinc: finance({ ...scalar("CUMPRINC", 5, 6), defaults: { 5: "0" }, excelRequired: 6 }),
  ispmt: finance(scalar("ISPMT", 4)),
  npv: finance(signature("NPV", ["scalar", "vector"], 2, [], 1)),
  irr: solved(signature("IRR", ["vector"])),
  mirr: finance(signature("MIRR", ["vector", "scalar", "scalar"])),
  xnpv: finance(signature("XNPV", ["scalar", "vector", "dates"])),
  xirr: solved(signature("XIRR", ["vector", "dates"])),
  effect: finance(scalar("EFFECT", 2)), nominal: finance(scalar("NOMINAL", 2)),
  sln: finance(scalar("SLN", 3)), syd: finance(scalar("SYD", 4)),
  db: finance({ ...scalar("DB", 4, 5), defaults: { 4: "12" } }),
  ddb: finance({ ...scalar("DDB", 4, 5), defaults: { 4: "2" } }),
};
export const importedFunctions: ReadonlyMap<string, readonly [string, FunctionTranslation]> = new Map(
  Object.entries(functionTranslations).filter(([, definition]) => definition.inbound !== false).flatMap(([native, definition]) =>
    [definition.excel.replace(/^_xlfn\./, ""), ...definition.aliases].map(excel => {
      const arity = definition.importArities?.[excel];
      return [excel, [native, arity ? { ...definition, required: arity.required, args: definition.args.slice(0, arity.maximum) } : definition] as const] as const;
    })));
