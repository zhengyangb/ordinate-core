export function isOnlineExperience(): boolean {
  return typeof document !== "undefined" && document.documentElement?.dataset.experience === "online";
}

export type OnlineChrome = {
  openFromLink: () => void;
  resetExample?: () => void;
  showDesktopAvailability: () => void;
  showAssistantAvailability: () => void;
  desktopPlatform: "mac" | "windows" | "linux" | "other";
};

export type OnlineEditorCommands = {
  replaceDocument: (text: string, name: string, origin: "new" | "content") => Promise<boolean>;
  openFile: () => void;
};
