import { describeDisplayMetadataDiagnostic, type Diagnostic } from "@ordinate/core";

import type { UiLocale } from "./messages";

export type DisplayMetadataIssueKind = "format" | "style" | "generic";

function fieldLabel(field: string): string {
  if (field === "padWidth") return "Width";
  if (field === "precision") return "Precision";
  if (field === "grouping") return "Grouping";
  if (field === "sign") return "Sign";
  return "Format";
}

function typeLabel(type: string): string {
  if (type === "d") return "integer";
  if (type === "f") return "decimal";
  if (type === "e") return "scientific";
  if (type === "%") return "percent";
  return "default";
}

export function formatDisplayMetadataErrorMessage(locale: UiLocale, issue: Diagnostic): string {
  if (locale !== "en-US") {
    return describeDisplayMetadataDiagnostic(issue);
  }

  if (issue.code === "invalid_format_combination") {
    const type = typeof issue.context.type === "string" ? issue.context.type : "default";
    const field = typeof issue.context.field === "string" ? issue.context.field : "format";
    const reason = typeof issue.context.reason === "string" ? issue.context.reason : "disallowed_for_type";
    return `${fieldLabel(field)} is not allowed for ${typeLabel(type)} format.`;
  }
  if (issue.code === "format_spec_contains_whitespace") return "Format spec contains whitespace.";
  if (issue.code === "invalid_format_spec_trailing_chars") return "Format spec has trailing characters.";
  if (issue.code === "unsupported_temporal_format_directive") {
    const directive = typeof issue.context.directive === "string" ? issue.context.directive : "";
    return directive ? `Unsupported temporal format directive '${directive}'.` : "Unsupported temporal format directive.";
  }
  if (issue.code === "invalid_temporal_format_trailing_percent") return "Temporal format has trailing percent.";
  if (issue.code === "format_value_kind_mismatch") return "Format is not compatible with this value.";
  if (issue.code === "temporal_format_directive_value_mismatch") return "Temporal format directive is not compatible with this value.";
  if (issue.code === "temporal_format_offset_requires_offset_qualified_value") {
    return "Temporal offset format requires an offset-qualified value.";
  }
  if (issue.code === "duration_format_requires_fixed_duration") {
    return "Duration format requires a fixed duration without year or month components.";
  }
  if (issue.code === "empty_format_spec") return "Format spec is empty.";
  if (issue.code === "empty_style_spec") return "Style spec is empty.";
  if (issue.code === "empty_display_metadata") return "Display metadata block is empty.";
  if (issue.code === "duplicate_format_metadata") return "Format metadata is duplicated.";
  if (issue.code === "duplicate_style_metadata") return "Style metadata is duplicated.";
  if (issue.code === "duplicate_align_style") return "Align style is duplicated.";
  if (issue.code === "duplicate_weight_style") return "Weight style is duplicated.";
  if (issue.code === "duplicate_color_style") return "Color style is duplicated.";
  if (issue.code.startsWith("unsupported_format_type:")) {
    return `Unsupported format type '${issue.code.slice("unsupported_format_type:".length)}'.`;
  }
  if (issue.code.startsWith("unsupported_style_item:")) {
    return `Unsupported style item '${issue.code.slice("unsupported_style_item:".length)}'.`;
  }
  return describeDisplayMetadataDiagnostic(issue);
}

export function classifyDisplayMetadataIssue(issue: Diagnostic): DisplayMetadataIssueKind {
  if (
    issue.code === "invalid_format_combination"
    || issue.code.startsWith("format_")
    || issue.code === "format_value_kind_mismatch"
    || issue.code === "empty_format_spec"
    || issue.code === "duplicate_format_metadata"
    || issue.code === "unsupported_temporal_format_directive"
    || issue.code === "invalid_temporal_format_trailing_percent"
    || issue.code === "temporal_format_directive_value_mismatch"
    || issue.code === "temporal_format_offset_requires_offset_qualified_value"
    || issue.code === "duration_format_requires_fixed_duration"
  ) {
    return "format";
  }
  if (
    issue.code.startsWith("unsupported_style_item:")
    || issue.code === "duplicate_style_metadata"
    || issue.code === "duplicate_align_style"
    || issue.code === "duplicate_weight_style"
    || issue.code === "duplicate_color_style"
    || issue.code === "empty_style_spec"
  ) {
    return "style";
  }
  return "generic";
}

export function getDisplayMetadataErrorLabel(_locale: UiLocale, issue: Diagnostic): string {
  const kind = classifyDisplayMetadataIssue(issue);
  if (kind === "format") return "Format metadata error";
  if (kind === "style") return "Style metadata error";
  return "Display metadata error";
}
