import type { FunctionTranslation } from "./functionTranslation";
import { distributionFamilies } from "../runtime/functions/distributionFamilies";

export type DistributionImport = {
  required: number; maximum: number; values: readonly number[];
} & ({ operation: "direct"; native: string }
  | { operation: "distribution"; cdf: string; pdf: string; flag: number });
const exports: Record<string, FunctionTranslation> = {};
const imports = new Map<string, DistributionImport>();
const indices = (n: number) => Array.from({ length: n }, (_, i) => i);
function register(native: string, excel: string, count: number, required = count,
  order: readonly (number | string)[] = indices(count), aliases: string[] = [], defaults: Record<number, string> = {},
  excelRequired = required + order.filter(slot => typeof slot === "string").length): void {
  exports[native] = { excel, aliases: [], args: Array(count).fill("scalar"), required, inbound: false,
    argumentOrder: order, excelRequired, defaults };
  const slots = indices(count).map(i => order.indexOf(i));
  for (const name of [excel.replace(/^_xlfn\./, ""), ...aliases]) imports.set(name, {
    required: exports[native].excelRequired!, maximum: order.length, values: slots, operation: "direct", native,
  });
}
function distribution(native: string, excel: string, count: number, required: number,
  flag: number, density: "Pdf" | "Pmf", aliases: string[] = [], defaults: Record<number, string> = {},
  excelRequired = required + 1): void {
  for (const operation of [density, "Cdf"] as const) {
    const order: (number | string)[] = indices(count);
    order.splice(flag, 0, operation === "Cdf" ? "TRUE" : "FALSE");
    register(`${native}${operation}`, excel, count, required, order, [], defaults, excelRequired);
  }
  const values = indices(count).map(i => i >= flag ? i + 1 : i);
  for (const name of [excel.replace(/^_xlfn\./, ""), ...aliases]) imports.set(name, {
    required: excelRequired, maximum: count + 1, values, operation: "distribution",
    cdf: `${native}Cdf`, pdf: `${native}${density}`, flag,
  });
}

// Native location/scale defaults are real defaults. Excel's general normal
// calls require those arguments explicitly, so source arity is a separate
// declared contract consumed by both import validation and export filling.
distribution("normal", "_xlfn.NORM.DIST", 3, 1, 3, "Pdf", ["NORMDIST"], { 1: "0", 2: "1" }, 4);
register("normalInv", "_xlfn.NORM.INV", 3, 1, [0, 1, 2], ["NORMINV"], { 1: "0", 2: "1" }, 3);
imports.set("NORM.S.DIST", { required: 2, maximum: 2, values: [0], operation: "distribution", cdf: "normalCdf", pdf: "normalPdf", flag: 1 });
imports.set("NORMSDIST", { required: 1, maximum: 1, values: [0], operation: "direct", native: "normalCdf" });
for (const name of ["NORM.S.INV", "NORMSINV"]) imports.set(name, { required: 1, maximum: 1, values: [0], operation: "direct", native: "normalInv" });
distribution("lognormal", "_xlfn.LOGNORM.DIST", 3, 3, 3, "Pdf");
register("lognormalInv", "_xlfn.LOGNORM.INV", 3, 3, [0, 1, 2], ["LOGINV"]);
imports.set("LOGNORMDIST", { required: 3, maximum: 3, values: [0, 1, 2], operation: "direct", native: "lognormalCdf" });

const excelFamilies = [
  { native: "beta", excel: "BETA", legacyDist: "BETADIST", legacyInv: "BETAINV", flag: 3, cumulativeOnly: true },
  { native: "gamma", excel: "GAMMA", legacyDist: "GAMMADIST", legacyInv: "GAMMAINV" },
  { native: "exponential", excel: "EXPON", legacyDist: "EXPONDIST" },
  { native: "weibull", excel: "WEIBULL", legacyDist: "WEIBULL" },
  { native: "binomial", excel: "BINOM", legacyDist: "BINOMDIST", legacyInv: "CRITBINOM", density: "Pmf" },
  { native: "poisson", excel: "POISSON", legacyDist: "POISSON", density: "Pmf" },
  { native: "negativeBinomial", excel: "NEGBINOM", legacyDist: "NEGBINOMDIST", density: "Pmf", massOnly: true },
  { native: "hypergeometric", excel: "HYPGEOM", legacyDist: "HYPGEOMDIST", density: "Pmf", massOnly: true },
  { native: "chiSquare", excel: "CHISQ", legacyTail: "CHIDIST", legacyTailInv: "CHIINV" },
  { native: "studentT", excel: "T" },
  { native: "f", excel: "F", legacyTail: "FDIST", legacyTailInv: "FINV" },
] as const;
for (const item of excelFamilies) {
  const model = distributionFamilies.find(family => family.name === item.native);
  if (!model) throw new Error("Missing native distribution family.");
  const count = model.parameters.length + 1;
  const required = 1 + model.parameters.filter(p => p.default === undefined).length;
  const density = "density" in item ? item.density : "Pdf";
  const defaults = Object.fromEntries(model.parameters.flatMap((p, i) => p.default === undefined ? [] : [[i + 1, String(p.default)]]));
  distribution(item.native, `_xlfn.${item.excel}.DIST`, count, required, "flag" in item ? item.flag : count, density,
    "legacyDist" in item && !("cumulativeOnly" in item) && !("massOnly" in item) ? [item.legacyDist] : [], defaults);
  if ("legacyDist" in item && ("cumulativeOnly" in item || "massOnly" in item)) imports.set(item.legacyDist, {
    required, maximum: count, values: indices(count), operation: "direct", native: `${item.native}${"massOnly" in item ? density : "Cdf"}`,
  });
  if (model.operations.Inv) {
    const order = item.native === "binomial" ? [1, 2, 0] : indices(count);
    register(`${item.native}Inv`, `_xlfn.${item.excel}.INV`, count, required, order,
      "legacyInv" in item ? [item.legacyInv] : [], defaults);
  }
  for (const [operation, suffix, legacy] of [
    ["Sf", ".DIST.RT", "legacyTail" in item ? item.legacyTail : undefined],
    ["Isf", ".INV.RT", "legacyTailInv" in item ? item.legacyTailInv : undefined],
    ["TwoTail", ".DIST.2T", undefined], ["TwoTailInv", ".INV.2T", item.native === "studentT" ? "TINV" : undefined],
  ] as const) if (model.operations[operation]) register(`${item.native}${operation}`, `_xlfn.${item.excel}${suffix}`, count, count,
    indices(count), legacy ? [legacy] : []);
}
register("binomialRange", "_xlfn.BINOM.DIST.RANGE", 4, 3);
register("studentTTail", "TDIST", 3);
export const distributionExports: Readonly<Record<string, FunctionTranslation>> = exports;
export const distributionImports: ReadonlyMap<string, DistributionImport> = imports;
