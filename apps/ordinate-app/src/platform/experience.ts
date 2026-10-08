export function isOnlineExperience(): boolean {
  return typeof document !== "undefined" && document.documentElement?.dataset.experience === "online";
}

export type OnlineChrome = {
  showExamples: () => void;
  openFromLink: () => void;
  resetExample?: () => void;
  downloadMac: () => void;
  isMac: boolean;
};

export type OnlineEditorCommands = {
  replaceDocument: (text: string, name: string, origin: "new" | "content") => Promise<boolean>;
  openFile: () => void;
};
