import { getExternalErrorLabel } from "../i18n/errorKinds";
import type { UiLocale } from "../i18n/messages";
import type { GridRow } from "../types/ui";
import { toColFieldId } from "./appHelpers";

/** Text visible to the user, including labels supplied by specialized renderers. */
export function gridCellText(row: GridRow, col: number, locale: UiLocale): string {
  if (row[`__kind_${col}`] === "error") {
    const externalKind = row[`__error_external_${col}`];
    if (typeof externalKind !== "string") throw new Error(`Missing external error kind for column ${col}`);
    return getExternalErrorLabel(locale, externalKind);
  }
  if (row[`__kind_${col}`] === "boolean" && row[`__boolean_interactive_${col}`] === true) {
    const value = row[`__boolean_value_${col}`];
    if (typeof value !== "boolean") throw new Error(`Missing boolean value for column ${col}`);
    return String(value);
  }
  return String(row[toColFieldId(col)] ?? "");
}
