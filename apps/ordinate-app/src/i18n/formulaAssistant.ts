import type { FunctionCategory } from "@ordinate/core";

import { t, type UiLocale, type UiMessageKey } from "./messages";

const FUNCTION_CATEGORY_MESSAGE_KEYS = {
  aggregate: "formula.category.aggregate",
  numeric: "formula.category.numeric",
  logical: "formula.category.logical",
  vector: "formula.category.vector",
  view: "formula.category.view",
  statistical: "formula.category.statistical",
  type: "formula.category.type",
  text: "formula.category.text",
  temporal: "formula.category.temporal",
  financial: "formula.category.financial",
} satisfies Record<FunctionCategory, UiMessageKey>;

export function getFormulaFunctionCategoryLabel(locale: UiLocale, category: FunctionCategory): string {
  return t(locale, FUNCTION_CATEGORY_MESSAGE_KEYS[category]);
}
