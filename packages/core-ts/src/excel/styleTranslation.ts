import type { Color, Style } from "exceljs";
import type { StyleSpec, TextColor } from "../runtime/types";
import type { ExcelLocation, ExcelReport } from "./contracts";

// Interchange colors are fixed, independent of the host's light/dark theme.
export const EXCEL_TEXT_COLORS = { red: "FFFF0000", green: "FF008000", blue: "FF0000FF" } as const;
export const THEME_COLOR_NAMES = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

// ExcelJS reads tint/indexed fields, but its public Color type omits them.
type CodecColor = Partial<Color> & { tint?: number; indexed?: number };
function fontColor(color: CodecColor, theme: ReadonlyMap<string, string>, report: ExcelReport, at: ExcelLocation): TextColor | null {
  const rgb = color.argb ?? (color.theme === undefined ? undefined : theme.get(THEME_COLOR_NAMES[color.theme]));
  const omit = () => { report.warn("presentation_omitted", "Text color is outside the supported palette; the default text color is used.", at); return null; };
  if (!rgb || !/^(?:[0-9a-f]{2})?[0-9a-f]{6}$/i.test(rgb)) return omit();
  const hex = rgb.slice(-6).toUpperCase();
  const tint = color.tint ?? 0;
  if (!Number.isFinite(tint) || tint < -1 || tint > 1) return omit();
  if (tint === 0) {
    for (const name of ["red", "green", "blue"] as const) if (hex === EXCEL_TEXT_COLORS[name].slice(2)) return name;
  }
  const channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels;
  const max = Math.max(...channels), min = Math.min(...channels), delta = max - min;
  const lightness = (max + min) / 2;
  // OOXML tint changes HSL lightness, not hue or saturation. Classification
  // needs no RGB round-trip; keep very pale/dark colors out of the accent set.
  const tintedLightness = tint < 0 ? lightness * (1 + tint) : lightness * (1 - tint) + tint;
  if (delta === 0 && (hex === "000000" || hex === "FFFFFF")) return null;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.2 || tintedLightness < 0.08 || tintedLightness > 0.92) return omit();
  const hue = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
  const mapped = hue <= 20 || hue >= 345 ? "red" : hue >= 80 && hue <= 165 ? "green" : hue >= 195 && hue <= 255 ? "blue" : null;
  if (!mapped) return omit();
  report.warn("presentation_approximated", "Text color was mapped to the nearest supported color family.", at);
  return mapped;
}

/** Only the native style subset crosses the codec boundary. */
export function importCellStyle(source: Partial<Style>, theme: ReadonlyMap<string, string>, report: ExcelReport, at: ExcelLocation): StyleSpec | null {
  const font = source.font;
  const horizontal = source.alignment?.horizontal;
  const style: StyleSpec = {
    weight: font?.bold === undefined ? null : font.bold ? "bold" : "normal",
    align: horizontal === "left" || horizontal === "center" || horizontal === "right" ? horizontal : null,
    color: font?.color ? fontColor(font.color, theme, report, at) : null,
  };
  const omitted = Object.keys(font ?? {}).some(key => !["bold", "color"].includes(key))
    || Object.keys(source.alignment ?? {}).some(key => key !== "horizontal")
    || (horizontal && !style.align)
    || (source.fill && !(source.fill.type === "pattern" && source.fill.pattern === "none"))
    || Object.keys(source.border ?? {}).length > 0 || Object.keys(source.protection ?? {}).length > 0;
  if (omitted) report.warn("presentation_omitted", "Additional Excel formatting is not retained; supported text styles are preserved.", at);
  return Object.values(style).some(value => value !== null) ? style : null;
}

export function exportCellStyle(style: StyleSpec): Partial<Style> {
  return {
    ...(style.align === null ? {} : { alignment: { horizontal: style.align } }),
    ...(style.weight === null && style.color === null ? {} : { font: {
      ...(style.weight === null ? {} : { bold: style.weight === "bold" }),
      ...(style.color === null ? {} : { color: { argb: EXCEL_TEXT_COLORS[style.color] } }),
    } }),
  };
}
