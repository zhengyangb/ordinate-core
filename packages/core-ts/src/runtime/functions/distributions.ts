import { standardNormalCdf, standardNormalDensity, standardNormalInverse } from "./normalKernel";
import { numericDomainError, scalarNumericFunction } from "./scalarNumeric";
import { additionalDistributionDefinitions, studentTTailDefinition } from "./distributionFamilies";

const families = [
  { name: "normal", log: false, defaults: true },
  { name: "lognormal", log: true, defaults: false },
] as const;
const operations = ["Pdf", "Cdf", "Inv"] as const;

export const distributionFunctionDefinitions = families.flatMap(family => operations.map(operation => {
  const name = `${family.name}${operation}`;
  return scalarNumericFunction({ name, category: "statistical",
    summary: `${operation === "Pdf" ? "Density" : operation === "Cdf" ? "Cumulative probability" : "Inverse cumulative probability"} of the ${family.name} distribution.`,
    parameters: [
      { name: operation === "Inv" ? "probability" : "x", summary: operation === "Inv" ? "Probability strictly between zero and one." : "Value at which to evaluate the distribution." },
      { name: family.log ? "logMean" : "mean", summary: family.log ? "Mean of ln(X), not the mean of X." : "Mean; defaults to zero.", ...(family.defaults ? { default: 0 } : {}) },
      { name: family.log ? "logSd" : "sd", summary: "Positive standard deviation" + (family.log ? " of ln(X)." : "; defaults to one."), ...(family.defaults ? { default: 1 } : {}) },
    ],
    examples: [{ expression: `${name}(${operation === "Inv" ? "0.5" : "1"}${family.defaults ? "" : ", 0, 1"})` }],
    calculate: ([x, mean, sd], functionName) => {
      if (sd <= 0) return numericDomainError(functionName, "non_positive_standard_deviation");
      if (operation === "Inv") {
        if (x <= 0 || x >= 1) return numericDomainError(functionName, "probability_out_of_range");
        const z = standardNormalInverse(x);
        if (z === null) return numericDomainError(functionName, "numerical_convergence");
        const quantile = mean + sd * z;
        return family.log ? Math.exp(quantile) : quantile;
      }
      if (family.log && x <= 0) return numericDomainError(functionName, "non_positive_argument");
      const z = ((family.log ? Math.log(x) : x) - mean) / sd;
      if (operation === "Pdf") return standardNormalDensity(z) / sd / (family.log ? x : 1);
      const probability = standardNormalCdf(z);
      return probability === null ? numericDomainError(functionName, "numerical_convergence") : probability;
    },
  });
})).concat(additionalDistributionDefinitions, studentTTailDefinition);
