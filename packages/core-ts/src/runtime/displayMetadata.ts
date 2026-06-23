import { type Diagnostic, type FormatSpec, type NumericFormatType } from "./types";

type FormatField = "precision" | "grouping" | "sign" | "padWidth";
type FormatCompatibilityType = NumericFormatType | "default";
type FormatCompatibilityReason = "disallowed_for_type";

type FormatCompatibilityRule = Record<FormatField, boolean>;

const FORMAT_COMPATIBILITY: Record<FormatCompatibilityType, FormatCompatibilityRule> = {
  default: { precision: true, grouping: true, sign: true, padWidth: true },
  d: { precision: false, grouping: true, sign: true, padWidth: true },
  f: { precision: true, grouping: true, sign: true, padWidth: true },
  e: { precision: true, grouping: false, sign: true, padWidth: true },
  "%": { precision: true, grouping: true, sign: true, padWidth: true },
};

export function validateFormatSpec(spec: FormatSpec): Diagnostic | null {
  if (spec.kind === "temporal") {
    return null;
  }

  const type = toCompatibilityType(spec.type);
  const rule = FORMAT_COMPATIBILITY[type];

  if (spec.precision !== null && !rule.precision) {
    return makeFormatCompatibilityDiagnostic(type, "precision", "disallowed_for_type");
  }
  if (spec.grouping && !rule.grouping) {
    return makeFormatCompatibilityDiagnostic(type, "grouping", "disallowed_for_type");
  }
  if (spec.sign !== "default" && !rule.sign) {
    return makeFormatCompatibilityDiagnostic(type, "sign", "disallowed_for_type");
  }
  if (spec.padWidth !== null && !rule.padWidth) {
    return makeFormatCompatibilityDiagnostic(type, "padWidth", "disallowed_for_type");
  }

  return null;
}

export function describeDisplayMetadataDiagnostic(issue: Diagnostic): string {
  if (issue.code === "invalid_format_combination") {
    return describeFormatCompatibilityDiagnostic(issue.context);
  }
  if (issue.code === "format_spec_contains_whitespace") {
    return "format spec contains whitespace";
  }
  if (issue.code === "precision_requires_digits") {
    return "precision requires digits";
  }
  if (issue.code === "invalid_format_spec_trailing_chars") {
    return "format spec has trailing characters";
  }
  if (issue.code === "unsupported_temporal_format_directive") {
    const directive = typeof issue.context.directive === "string" ? issue.context.directive : "";
    return directive ? `unsupported temporal format directive '${directive}'` : "unsupported temporal format directive";
  }
  if (issue.code === "invalid_temporal_format_trailing_percent") {
    return "temporal format has trailing percent";
  }
  if (issue.code === "format_value_kind_mismatch") {
    return "format is not compatible with value kind";
  }
  if (issue.code === "temporal_format_directive_value_mismatch") {
    return "temporal format directive is not compatible with value kind";
  }
  if (issue.code === "temporal_format_offset_requires_offset_qualified_value") {
    return "temporal offset format requires an offset-qualified value";
  }
  if (issue.code === "duration_format_requires_fixed_duration") {
    return "duration format requires a fixed duration without year or month components";
  }
  if (issue.code === "empty_format_spec") {
    return "format spec is empty";
  }
  if (issue.code === "empty_style_spec") {
    return "style spec is empty";
  }
  if (issue.code === "empty_display_metadata") {
    return "display metadata block is empty";
  }
  if (issue.code === "duplicate_format_metadata") {
    return "format metadata is duplicated";
  }
  if (issue.code === "duplicate_style_metadata") {
    return "style metadata is duplicated";
  }
  if (issue.code === "duplicate_align_style") {
    return "align style is duplicated";
  }
  if (issue.code === "duplicate_weight_style") {
    return "weight style is duplicated";
  }
  if (issue.code === "duplicate_color_style") {
    return "color style is duplicated";
  }
  if (issue.code.startsWith("unsupported_format_type:")) {
    const value = issue.code.slice("unsupported_format_type:".length);
    return `unsupported format type '${value}'`;
  }
  if (issue.code.startsWith("unsupported_style_item:")) {
    const value = issue.code.slice("unsupported_style_item:".length);
    return `unsupported style item '${value}'`;
  }
  return issue.code.replaceAll("_", " ");
}

function toCompatibilityType(type: NumericFormatType | null): FormatCompatibilityType {
  return type ?? "default";
}

function makeFormatCompatibilityDiagnostic(
  type: FormatCompatibilityType,
  field: FormatField,
  reason: FormatCompatibilityReason,
): Diagnostic {
  return {
    code: "invalid_format_combination",
    context: { type, field, reason },
  };
}

function describeFormatCompatibilityDiagnostic(context: Record<string, unknown>): string {
  const type = typeof context.type === "string" ? context.type : "default";
  const field = typeof context.field === "string" ? context.field : "format";
  const reason = typeof context.reason === "string" ? context.reason : "disallowed_for_type";

  if (reason === "disallowed_for_type") {
    return `${formatFieldLabel(field)} is not allowed for ${formatTypeLabel(type)} format`;
  }
  return "invalid format combination";
}

function formatFieldLabel(field: string): string {
  if (field === "padWidth") return "width";
  return field;
}

function formatTypeLabel(type: string): string {
  if (type === "d") return "integer";
  if (type === "f") return "decimal";
  if (type === "e") return "scientific";
  if (type === "%") return "percent";
  return "default";
}
