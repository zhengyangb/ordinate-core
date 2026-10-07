# Ordinate app

React + TypeScript + AG Grid editor, available in a browser or a local Electron desktop app.
Both hosts use the same editor, core evaluation, formatting, undo, and file-session state machine.

## Browser development

```bash
cd apps/ordinate-app
npm ci
npm run dev
```

## Desktop development

```sh
npm run desktop:dev
```

This compiles the desktop host, starts Vite at `http://127.0.0.1:5174`, and launches
an Electron window. React/CSS edits hot-reload; restart the command after changing
`desktop/` main/preload code. Port conflicts fail immediately. The initial Electron
runtime download requires network access.

- Renderer debugging: **View → Toggle Developer Tools** (`Cmd+Option+I` on macOS).
- Printing: **File → Print…** (`Cmd+P`) on macOS prints the complete current sheet
  and its before/after notes. There is no toolbar or web print action.
- Main-process debugging: `npm run desktop:debug`, then attach a Node debugger to
  `127.0.0.1:9229`. TypeScript source maps are emitted to `desktop-out/`.
- No `.app` rebuild is required for normal UI development.
- Quit the app (`Cmd+Q`) or stop the terminal command to stop the development server.
- Development, packaged desktop, and browser have separate local recovery storage.
- Desktop document names live in the actual system title bar, not an HTML
  imitation. On macOS, an `NSDocument` and `NSWindowController` supply the native
  title dropdown (name, location and tags). macOS owns the
  traffic-light spacing and title layout. Native appearance follows the editor's
  appearance setting. The toolbar retains Ordinate branding;
  browsers also retain the filename in its original toolbar position.
- macOS document save/move requests delegate to the shared file session, rather
  than maintaining another mutable document model or a second autosave timer.
  New and Duplicate create independent document sessions. Native Rename and Move
  actions adopt the new file location before autosave resumes. Revert To lists
  macOS file versions by timestamp; restoring also checkpoints the current file.
- The macOS title bar and toolbar share the CSS `--native-chrome-bg` token, an
  opaque version of the existing chrome color. A small Node-API/AppKit bridge
  makes the native title background transparent, removes its separator, and
  applies that color to the window. Native title, document proxy, dragging,
  traffic lights, and fullscreen remain system-owned. Browser chrome is unchanged.
- macOS desktop compilation needs Xcode Command Line Tools (`xcrun clang++`).
  The bridge is compiled for the host architecture by `desktop:compile` and
  explicitly unpacked from ASAR for packaged apps; missing tooling/build errors
  fail the build. Other platforms do not compile or load the AppKit module.

## Build and run a standalone app

Quit the existing Ordinate app before rebuilding it in place. From either the
repository root or this directory, the short command is:

```sh
npm run app
```

This delegates to `desktop:build` and uses the installed Electron distribution,
so packaging does not download another Electron runtime. Install this app's npm
dependencies first on a fresh checkout (`npm ci` in `apps/ordinate-app`).

Startup shows a theme-aware skeleton before the editor bundle loads. It disappears
when document restoration and initial grid layout complete, with no artificial
delay. Restore failures reveal the existing file error UI; bundle failures show
an explicit startup error and Reload button. The `ordinate:bootstrap` and
`ordinate:interactive` performance marks help measure renderer startup separately
from launching the native process.

On Apple Silicon macOS this creates `release/mac-arm64/Ordinate.app`; on Intel Macs
the output is `release/mac/Ordinate.app`. Open it in Finder. The packaged app loads
its bundled assets and needs neither Vite nor a network connection. `npm run
desktop:start` runs the existing local `dist/` and `desktop-out/` build in Electron
without packaging it again.

This is a local, unsigned development build, not a distribution-ready installer.
It still uses Electron's default icon. Signing, notarization, custom icons,
installers, auto-update, and Windows/Linux validation are separate release work.
Do not bypass Gatekeeper warnings; a distributable build needs proper signing.

## Local files

- **Export a copy** is available in the toolbar on both hosts; desktop also has
  **File → Import… / Export…**. There is no toolbar Import button. On the web,
  **Open file → Import spreadsheet…** is the import entry point.
- CSV/TSV export one selected sheet's calculated values; XLSX exports all sheets
  with supported executable formulas. Conversion notes and cell-level errors
  appear before confirmation. Unsupported formulas are not silently flattened.
- **Ordinate copy (.ord)** exports native source without switching the active
  file. **Save As** switches it. Desktop imports open a new untitled document tab;
  browser imports explicitly confirm replacement of the current document. The
  original spreadsheet is never an autosave target.
- Full frontend contract: [Spreadsheet interchange](docs/features/spreadsheet-interchange.md).
- Sheet Notes: [In-place editing and rail layout](docs/features/sheet-notes.md).
- Settings: [Regional date/time display and appearance](docs/features/display-preferences.md).

- **File → Open…** (`Cmd/Ctrl+O`) uses the operating system's file picker for `.ord`
  and `.txt` documents.
- Desktop edits automatically save after 750 ms (table) or 1500 ms (source).
  The desktop toolbar has no Save/Save As buttons; web keeps both. File-menu
  shortcuts remain available for assigning a location or making another copy.
- Untitled documents are kept as local recovery drafts and restored automatically.
  The last named file reopens on launch. In this single-window version, opening
  another file asks for a location if the current untitled draft contains work.
- Desktop autosaves source text exactly as typed, including unfinished/invalid
  expressions. Web retains its explicit confirmation before writing invalid source.
- Saves check the content hash before replacing the file. Writes are serialized
  in-process and use a flushed temporary file in the same directory followed by
  rename; file permissions are preserved. Atomic replacement is **not** an atomic
  cross-process compare-and-swap: another program can still write in the narrow
  interval between the final hash check and rename.
- Desktop watches the opened file's directory (including atomic replacements).
  External edits reload automatically when the editor is clean; identical local
  and disk contents are acknowledged without a reload. Actual divergent edits
  keep the conflict dialog; no last-writer-wins or automatic merge is attempted.
  Uncommitted cell edits defer reload until commit/cancel. Active sheet, source
  mode and unchanged grid scroll are preserved; obsolete undo history is cleared.
  Web does not subscribe to file changes and keeps save-time conflict checks.
- New (Cmd/Ctrl+N), Open, Save As and Duplicate support multiple document windows.
  macOS also provides Open Recent, New Tab (Cmd+Option+N), Rename, Move To and
  Revert To. Window offers native tab switching, detaching and merging. These
  document tabs are separate from the sheet tabs inside each document.
- Quit restores the open workspace next launch, including independent untitled
  drafts. Closing an individual untitled window asks whether to save it first.
  Dragging a file into the editor is not implemented.
- Closing/quitting flushes pending edits through the same save pipeline, including
  writes already in flight. Conflicts, failed writes or unresolved recovery keep
  the window open. Reload retains the unload guard. Untitled drafts use Chromium
  local storage; orderly close also flushes that storage. This is not a guarantee
  against OS/power failure before a debounced write has completed.
- Native movement is coordinated by AppKit and refuses to overwrite an existing
  destination. The shared session adopts its new file capability before autosave
  resumes. The macOS bridge is not loaded on Windows/Linux or in the browser.

## Architecture and security

The lowercase `ordinate` wordmark uses locally bundled DM Sans. Its font and
[OFL license](public/licenses/DM-Sans-OFL.txt) ship with
both builds; it does not depend on Google Fonts, installed fonts, or connectivity.
Routine save status is omitted from the toolbar. Web keeps its filename; desktop
uses the native title. Errors use an out-of-flow marker on Open, so status changes
never move the tools. Conflict and recovery dialogs remain available.

`App.tsx` coordinates selection, formula editing and shared grid geometry. Feature
boundaries now live in:

- `useSheetViewModel`: row/header projection, collapse state, inferred column layout.
- `useGridColumnDefs`: AG Grid definitions and cell renderers.
- `useSheetStructureCommands`: row/column edits, confirmation and focus transitions.
- `useDisplayFormatCommands`: cell/column/row format and style cascade commands.
- `useFileSessionController` / `FileSessionNotices`: persistence lifecycle and dialogs.
- `useTooltips` / `useAnchoredMenuPosition`: popup positioning and lifecycles.
- `useWindowAppearance`: shared web theme and native window presentation.

- `src/platform/storage.ts`: shared host-independent types.
- `src/platform/desktopStorage.ts`: renderer adapter for the existing file session.
- `desktop/fileStorage.ts`: filesystem capabilities issued for native dialog/title
  menu selections and the main-process session bookmark; renderer paths are rejected.
- `desktop/documentHost.ts` / `native/document.mm`: macOS document requests,
  coordinated movement and preservation of extended attributes (including tags).
- `src/platform/documentSession.ts`: shared flush and file-transition protocol.
- `desktop/workspaceSession.ts`: atomic workspace records and independent draft identities.
- `desktop/documentWindow.ts` / `windowIpc.ts`: isolated document windows and sender routing.
- `desktop/preload.cts`: narrow, typed bridge; raw IPC and Node are not exposed.
- `desktop/main.ts`: sandboxed window, native menus/dialogs, sender validation,
  blocked navigation/popups/permissions, and packaged `ordinate://app/` protocol
  with Content Security Policy. Development loads only the fixed loopback URL.

## Verification

```sh
npm test
npm run typecheck
npm run desktop:compile
npm run desktop:test-native # macOS only; hidden window and temporary fixtures
npm run desktop:test-interchange # real renderer + preload; isolated desktop/web file workflows
npm run desktop:build
```

Automated tests use isolated temporary files for native UTF-8 read/write, Save As,
cancellation, permissions preservation, stale/concurrent saves, deleted files,
symlinks, capability rejection, stable recovery identity, and full file-session
autosave/conflict integration. They never edit real user documents.

Native smoke test: open a disposable `.ord` via the menu, edit it, save, inspect
the disk contents, then Save As to a second file. Repeat in the packaged `.app`
to verify the preload bridge, custom protocol, and native OS dialogs together.

The current web development toolchain has npm audit advisories (including Vite 5).
The desktop setup does not silently upgrade that toolchain across major versions;
resolve those before exposing development servers or preparing a public release.

## Third-party

- See `THIRD_PARTY_NOTICES.md` for font attribution and license notices.
