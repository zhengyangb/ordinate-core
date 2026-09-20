import type { DesktopBridge, StorageAdapter } from "./storage";

export function createDesktopStorageAdapter(bridge: DesktopBridge): StorageAdapter {
  return {
    kind: "electron",
    capabilities: () => ({
      canAutosaveToBackingFile: true,
      canReadCurrentBackingFile: true,
      canWatchBackingFile: true,
      // Atomic replacement is not an atomic filesystem compare-and-swap.
      canAtomicCompareAndWrite: false,
    }),
    availability: bridge.availability,
    open: bridge.open,
    save: bridge.save,
    saveAs: bridge.saveAs,
    readCurrent: bridge.readCurrent,
    watch: bridge.watch,
  };
}
