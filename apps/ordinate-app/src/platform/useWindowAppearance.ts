import { useEffect } from "react";
import { useFileSessionStore } from "../store/fileSessionStore";
import type { ThemeMode } from "../types/ui";
import { THEME_STORAGE_KEY } from "../utils/appHelpers";

/** Resolve the CSS design token to opaque sRGB, the native window's color space. */
export function readChromeColor(): string {
  const color = getComputedStyle(document.documentElement).getPropertyValue("--native-chrome-bg").trim();
  if (!color || !CSS.supports("color", color)) throw new Error("Missing or invalid --native-chrome-bg token");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
  if (!context) throw new Error("Cannot resolve the native chrome color");
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha !== 255) throw new Error("Native chrome requires an opaque background token");
  return `#${[r, g, b].map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function useWindowAppearance(themeMode: ThemeMode) {
  const file = useFileSessionStore(state => state.file);
  const dirty = useFileSessionStore(state => state.documentDirty);
  const draft = useFileSessionStore(state => state.localDraftState);
  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const desktop = window.ordinateDesktop;
    if (!desktop) return;
    const sync = () => void desktop.updateWindow({
      file, edited: dirty === "dirty" && (file !== null || draft !== "current"), appearance: themeMode, chromeColor: readChromeColor(),
    });
    sync();
    const systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");
    systemAppearance.addEventListener("change", sync);
    return () => systemAppearance.removeEventListener("change", sync);
  }, [file, dirty, draft, themeMode]);
}
