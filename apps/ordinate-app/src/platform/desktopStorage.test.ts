import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNativeStorage } from "../../desktop/fileStorage";
import { createDesktopStorageAdapter } from "./desktopStorage";
import { createFileSessionStore, createMemoryLocalDraftStore } from "../store/fileSessionStore";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const document = (value: number) => `# Desktop\n| Item || Value |\n| A || ${value} |\n`;

async function session() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ordinate-desktop-session-"));
  directories.push(directory);
  const file = path.join(directory, "session.ord");
  await writeFile(file, document(1));
  let text = document(0);
  const adapter = createDesktopStorageAdapter({
    agent: { connection: async () => ({ state: "signed-out" }), login: async () => {}, models: async () => [], send: async () => {}, stop: async () => {}, openDiagnosticsFolder: async () => {}, openLink: async () => {}, startSystemDictation: async () => {}, stopSystemDictation: async () => {}, resolveProposal: async () => {}, onEvent: () => () => {} },
    windowChrome: "native",
    sessionId: "test-session",
    systemLocale: "en-US",
    openDocument: async () => {},
    newDocument: async () => {},
    openImportedDocument: async () => { throw new Error("Not used by storage tests"); },
    interchange: { pickImport: async () => { throw new Error("Not used by storage tests"); }, saveExport: async () => { throw new Error("Not used by storage tests"); } },
    duplicateDocument: async () => {},
    watch: () => () => {},
    restoreDocument: async () => ({ snapshot: null, text: null }),
    readDocumentRequest: async () => { throw new Error("Not used by storage tests"); },
    updateWindow: async () => {},
    ...createNativeStorage({ open: async () => file, save: async () => path.join(directory, "copy.ord") }),
    onCommand: () => () => {}, nativeHistory: async () => {},
    print: async () => { throw new Error("Not used by storage tests"); },
    onDocumentRequest: () => () => {}, commitDocumentRequest: async () => { throw new Error("Not used by storage tests"); },
  });
  const store = createFileSessionStore({
    adapter, localDraftStore: createMemoryLocalDraftStore(),
    editor: {
      getPersistableText: () => ({ text, validity: "valid_document", source: "table" }),
      replaceDocumentText: (next) => { text = next; },
    },
  });
  await store.getState().open();
  return { file, store, edit: (value: number) => { text = document(value); store.getState().syncEditorSnapshot(); } };
}

it("reuses the existing file lifecycle for native open, autosave and Save As", async () => {
  const { file, store, edit } = await session();
  expect(store.getState().file?.adapterKind).toBe("electron");
  expect(store.getState().documentDirty).toBe("clean");
  edit(2);
  await store.getState().autosaveNow();
  expect(await readFile(file, "utf8")).toBe(document(2));
  expect(store.getState().backingFileState).toBe("clean");
  edit(3);
  await store.getState().saveAs();
  expect(store.getState().file?.displayName).toBe("copy.ord");
  expect(await readFile(file, "utf8")).toBe(document(2));
  expect(await readFile(path.join(path.dirname(file), "copy.ord"), "utf8")).toBe(document(3));
});

it("surfaces native disk conflicts through the existing conflict state", async () => {
  const { file, store, edit } = await session();
  edit(2);
  await writeFile(file, document(3));
  await store.getState().autosaveNow();
  expect(store.getState().backingFileState).toBe("conflict");
  expect(store.getState().conflict?.diskText).toBe(document(3));
  expect(await readFile(file, "utf8")).toBe(document(3));
});
