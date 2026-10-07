import path from "node:path";
import type { DesktopWindowState, FileReference } from "../src/platform/storage.js";

/** Resolve presentation from a granted file, never a renderer-supplied title/path. */
export function windowPresentation(state: DesktopWindowState, documentPath: (file: FileReference) => string, draftName = "Untitled") {
  if (!state || typeof state.edited !== "boolean" || !["auto", "light", "dark"].includes(state.appearance)
      || typeof state.chromeColor !== "string" || !/^#[0-9a-f]{6}$/i.test(state.chromeColor)) {
    throw new TypeError("Invalid window state");
  }
  const filename = state.file === null ? "" : documentPath(state.file);
  return {
    title: filename ? path.basename(filename) : draftName,
    filename,
    edited: state.edited,
    chromeColor: state.chromeColor,
    themeSource: state.appearance === "auto" ? "system" as const : state.appearance,
  };
}
