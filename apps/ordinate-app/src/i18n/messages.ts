export type UiLocale = "en-US" | "zh-CN";

export type UiMessageKey =
  | "formula.category.aggregate"
  | "formula.category.numeric"
  | "formula.category.logical"
  | "formula.category.vector"
  | "formula.category.view"
  | "formula.category.statistical"
  | "formula.category.type"
  | "formula.category.text"
  | "formula.category.temporal"
  | "formula.category.financial"
  | "error.kind.generic"
  | "error.kind.parse_error"
  | "error.kind.type_error"
  | "error.kind.div_by_zero"
  | "error.kind.unresolved_reference"
  | "error.kind.ambiguous_reference"
  | "error.kind.cycle"
  | "error.message.div_by_zero"
  | "error.message.parse_missing_closing_paren"
  | "error.message.parse_function_missing_closing_paren"
  | "error.message.parse_generic"
  | "error.message.type_invalid_arithmetic"
  | "error.message.type_invalid_function_call"
  | "error.message.type_generic"
  | "error.message.unresolved_reference"
  | "error.message.ambiguous_reference"
  | "error.message.cycle"
  | "error.message.generic";

const MESSAGES: Record<UiLocale, Record<UiMessageKey, string>> = {
  "en-US": {
    "formula.category.aggregate": "Aggregate",
    "formula.category.numeric": "Math",
    "formula.category.logical": "Logic",
    "formula.category.vector": "Vector",
    "formula.category.view": "View",
    "formula.category.statistical": "Statistics",
    "formula.category.type": "Type",
    "formula.category.text": "Text",
    "formula.category.temporal": "Time",
    "formula.category.financial": "Financial",
    "error.kind.generic": "Generic Error",
    "error.kind.parse_error": "Parse Error",
    "error.kind.type_error": "Type Error",
    "error.kind.div_by_zero": "Divide by Zero",
    "error.kind.unresolved_reference": "Unresolved Reference",
    "error.kind.ambiguous_reference": "Ambiguous Reference",
    "error.kind.cycle": "Cycle",
    "error.message.div_by_zero": "Numbers can’t be divided by zero.",
    "error.message.parse_missing_closing_paren": "This formula is missing a closing parenthesis.",
    "error.message.parse_function_missing_closing_paren": "Function {name} is missing a closing parenthesis.",
    "error.message.parse_generic": "This formula has a parse error.",
    "error.message.type_invalid_arithmetic": "Operator {operator} can’t be applied to {leftKind} and {rightKind}.",
    "error.message.type_invalid_function_call": "Function {name} received an invalid argument type.",
    "error.message.type_generic": "This formula has a type error.",
    "error.message.unresolved_reference": "This formula references a row or column that doesn’t exist.",
    "error.message.ambiguous_reference": "This formula references a non-unique label.",
    "error.message.cycle": "This formula creates a circular reference.",
    "error.message.generic": "This cell contains an error.",
  },
  "zh-CN": {
    "formula.category.aggregate": "聚合",
    "formula.category.numeric": "数学",
    "formula.category.logical": "逻辑",
    "formula.category.vector": "向量",
    "formula.category.view": "视图",
    "formula.category.statistical": "统计",
    "formula.category.type": "类型",
    "formula.category.text": "文本",
    "formula.category.temporal": "时间",
    "formula.category.financial": "金融",
    "error.kind.generic": "通用错误",
    "error.kind.parse_error": "解析错误",
    "error.kind.type_error": "类型错误",
    "error.kind.div_by_zero": "除以零",
    "error.kind.unresolved_reference": "引用未解析",
    "error.kind.ambiguous_reference": "引用歧义",
    "error.kind.cycle": "循环依赖",
    "error.message.div_by_zero": "数字不能除以零。",
    "error.message.parse_missing_closing_paren": "这个公式缺少右括号。",
    "error.message.parse_function_missing_closing_paren": "函数 {name} 缺少右括号。",
    "error.message.parse_generic": "这个公式有解析错误。",
    "error.message.type_invalid_arithmetic": "运算符 {operator} 不能作用于 {leftKind} 和 {rightKind}。",
    "error.message.type_invalid_function_call": "函数 {name} 接收到了无效参数类型。",
    "error.message.type_generic": "这个公式有类型错误。",
    "error.message.unresolved_reference": "这个公式引用了不存在的行或列。",
    "error.message.ambiguous_reference": "这个公式引用了不唯一的标签。",
    "error.message.cycle": "这个公式形成了循环引用。",
    "error.message.generic": "这个单元格存在错误。",
  },
};

export function resolveUiLocale(rawLocale: string): UiLocale {
  const normalized = rawLocale.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en-US";
  throw new Error(`unsupported ui locale '${rawLocale}'`);
}

export function t(
  locale: UiLocale,
  key: UiMessageKey,
  values?: Record<string, string | number>,
): string {
  const template = MESSAGES[locale][key];
  if (!values) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, token: string) => {
    if (!(token in values)) {
      throw new Error(`missing i18n token '${token}' for key '${key}'`);
    }
    return String(values[token]);
  });
}
