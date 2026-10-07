import { decomposeDurationValue, decomposeTemporalValue, type PresentedCell, type RuntimeValue } from "@ordinate/core";
import { autoNumberDisplay } from "../utils/autoNumberDisplay";
import { runtimeValueToText } from "../utils/sheetView";
import type { DateTimeDisplay } from "./preferences";

// TypeScript's current ES2022 library predates this standard browser API.
// No polyfill or silent ISO fallback: the host must provide Intl.DurationFormat.
declare global {
  namespace Intl {
    class DurationFormat {
      constructor(locale: string, options: { style: "short"; secondsDisplay: "always" | "auto" });
      format(value: Record<string, number>): string;
    }
  }
}
export type CellDisplayFormatter = (value: RuntimeValue | null | undefined, presented: PresentedCell | null) => string;

/** Application display policy only. Explicit cascade formats and diagnostics
 * remain authoritative; core values, editing/source and interchange stay ISO. */
export function createCellDisplayFormatter(mode: DateTimeDisplay, locale: string): CellDisplayFormatter {
  const dateFormats = new Map<string, Intl.DateTimeFormat>();
  const durationFormats = new Map<boolean, Intl.DurationFormat>();
  return (value, presented) => {
    if (presented?.formatLayer.effective || presented?.errors.length) return presented.displayText;
    if (value?.kind === "number") return autoNumberDisplay(value.value);
    if (mode === "locale" && value && (value.kind === "date" || value.kind === "datetime" || value.kind === "time" || value.kind === "duration")) {
      if (value.kind === "duration") {
        const parts = decomposeDurationValue(value);
        if (!parts) throw new Error(`Invalid duration value: ${value.value}`);
        const { sign, ...units } = parts;
        // Zero is a real duration, not an empty cell. Intl hides zero units
        // by default, so explicitly display seconds for that value.
        const zero = Object.values(units).every(amount => amount === 0);
        let durationFormat = durationFormats.get(zero);
        if (!durationFormat) {
          durationFormat = new Intl.DurationFormat(locale, { style: "short", secondsDisplay: zero ? "always" : "auto" });
          durationFormats.set(zero, durationFormat);
        }
        return durationFormat.format(Object.fromEntries(Object.entries(units).map(([unit, amount]) => [unit, sign * amount])));
      }
      const parts = decomposeTemporalValue(value);
      if (!parts) throw new Error(`Invalid temporal value: ${value.value}`);
      // Format the original wall-clock components in UTC. Locale changes
      // date order and clock convention, never the day/time or source offset.
      const date = new Date(0);
      if (parts.date) date.setUTCFullYear(parts.date.year, parts.date.month - 1, parts.date.day);
      if (parts.time) date.setUTCHours(parts.time.hour, parts.time.minute, parts.time.second, parts.time.millisecond);
      const fractionalDigits = parts.time?.millisecond ? 3 : 0;
      const key = `${value.kind}:${fractionalDigits}`;
      let formatter = dateFormats.get(key);
      if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, {
          calendar: "gregory", timeZone: "UTC",
          ...(parts.date ? { year: "numeric", month: "numeric", day: "numeric" } as const : {}),
          ...(parts.time ? { hour: "numeric", minute: "2-digit", second: "2-digit", ...(fractionalDigits ? { fractionalSecondDigits: 3 } as const : {}) } as const : {}),
        });
        dateFormats.set(key, formatter);
      }
      const offset = parts.time?.offsetText;
      return formatter.format(date) + (offset ? ` ${offset}` : "");
    }
    return presented?.displayText ?? runtimeValueToText(value ?? { kind: "blank", value: null });
  };
}
