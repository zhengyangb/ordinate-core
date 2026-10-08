# Ordinate app

React + TypeScript + AG Grid editor, available in a browser or a local Electron desktop app.
Both hosts use the same editor, core evaluation, formatting, undo, and file-session state machine.

## Browser development

```bash
cd apps/ordinate-app
npm ci
npm run dev
```

## Ordinate Online

The ordinary browser entry (`/`) remains the shared development editor. Visit
`/online.html` for the online experience: examples, blank/local documents and a
separate recoverable browser draft. Browser hosts also have a wordmark menu;
macOS desktop keeps its native menu.

```sh
npm run dev:online
npm run build:online
npm run preview:online
```

The online build outputs `dist-online/index.html`, assets and examples. Host that
directory statically over HTTPS; no backend or SPA rewrite is required. For a
subdirectory deployment, build with `npm run build:online -- --base /app/`.
Known template links use `?example=mortgage` (IDs are in `examples/catalog.json`).
External workbook links use `#url=${encodeURIComponent(fileUrl)}`. Online's
Open file → Open from link (also in File) accepts a public HTTPS `.ord` direct
link, or an HTTP/HTTPS file on the editor's own origin. Links without an `.ord`
suffix show a format reminder but may be opened; downloaded content must pass
Ordinate workbook validation, so an HTML sharing page is still rejected.
The first linked launch asks permission before fetching; an
explicit Open click records permission for that exact URL in this browser.
Unapproved fragment launches show an **Open from URL** confirmation with the full,
copyable URL and a quiet shield beside the trust/local-copy reminder. Manual
Open from link remains a form. The quiet trust reminder is not a safety certification.
Every link open is a one-shot import: fetch fresh input with `cache: "no-store"`,
even when the same URL was opened before or its earlier copy is still active.
The imported working copy retains its name and content, not a source association
or a URL-keyed draft archive. Approved launches never mount a consent dialog
while loading. Permission is independent of document identity: it does not reset
after editing, nor certify unchanged remote content; another path or query string
is a different approval. Replacing an edited document still requires the separate
replacement confirmation, and cancellation or failure preserves that copy.
Online recovery is tab-scoped: `sessionStorage` holds a UUID, and IndexedDB
stores drafts under `[sessionId, key]`. New base-URL tabs start a new document;
refresh restores that tab's work. Two tabs opening the same URL get independent
working copies. Preferences and exact-URL approvals remain shared in localStorage.
A Web Locks lease detects copied sessionStorage: duplicated/opener tabs clone
the snapshots into a new namespace before making any writes. There is no
cross-tab document syncing. IndexedDB/lease failures are explicit, never a
fallback to shared or memory-only recovery. Old global localStorage draft records
are left untouched, not automatically adopted by newly opened tabs.
There is no Reload from source, remote save or sync:
Save/Save as writes a local copy; browser recovery is not a saved remote file.
Launch fragments are consumed so refresh restores the latest local draft.
Requests omit credentials and referrers, require CORS, reject redirects, time
out after 30 seconds, and enforce the shared 16 MiB limit on actual bytes.
There is no server proxy or `no-cors` retry. On failure users can download the
file themselves and open it locally. Cross-origin literal local-network targets are rejected;
this is not a DNS firewall. Downloaded text goes through native workbook validation.

For local testing with Online at `http://127.0.0.1:5190/`, paste
`http://127.0.0.1:5190/examples/00-getting-started.ord` into Open from link, or visit:
`http://127.0.0.1:5190/#url=http%3A%2F%2F127.0.0.1%3A5190%2Fexamples%2F00-getting-started.ord`.
Use the actual server port and the same hostname in both URLs. A disk `file://`
path is not fetchable this way; use local Open or serve it from the editor's origin.

The spreadsheet appears first. Only an untouched default new document receives
the examples dialog after a visible spreadsheet paint and a 400ms pause, with a
240ms entrance. Background tabs wait for activation and get the full pause; starting to work cancels
that invitation.
Existing browser drafts resume directly, with no Continue screen. File → Examples
reopens the same dialog on demand. Getting started is a six-sheet guided workbook
above the eight full-scale models. The editor remains visible behind the dialog;
only the model list scrolls, leaving the title and file actions in place.
Selecting an example opens an editable copy, never writes to the template, and
asks before replacing edited content. An untouched default table is replaced
without confirmation. Reload recovers the browser draft rather than repeatedly
reopening a template link.
Failed draft recovery stops initialization and leaves the stored draft untouched.

Root `examples/` is the sole content source. Vite publishes those files and
generates miniature table previews using the core presentation engine. Catalog
and workbook mismatches fail the build. Add examples there, not under `src/`.

Set `VITE_MAC_DOWNLOAD_URL=https://…` at build time when a release is available.
Until then, the visible button opens a short unpublished-release notice. The
editor toolbar shortcut appears on macOS; Help has the action on all platforms.
This does not download an unsigned development build or publish a release.

```sh
npm run build
npx electron desktop/interchange-smoke.mjs --online-only
npx electron desktop/interchange-smoke.mjs --remote-only # consent, drafts and real CORS; isolated local HTTPS fixture
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
- Printing: **File → Print…** opens shared choices for the current sheet or all
  sheets, with independent before/after note toggles (included by default).
  All sheets print in workbook order, each starting on a new page. The browser's Ordinate menu has the same File command, plus
  `Cmd/Ctrl+P`; there is no toolbar print button. Both hosts share the print-only
  HTML layout. Mac uses the native print bridge; browsers use `window.print()`
  and retain the snapshot until `afterprint`, including cancellation. Browser
  printing needs no backend or pre-generated PDF.
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

The macOS icon source is `resources/Ordinate.icon`, an Icon Composer bundle.
Packaging uses Xcode 26 or newer to compile its layered artwork into `Assets.car`
and a traditional ICNS resource. The full Xcode toolchain must be selected;
Command Line Tools alone do not provide `actool`. To use the standard Xcode
installation for one build without changing the global toolchain selection:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npm run app
```

This is a local, unsigned development build, not a distribution-ready installer.
Signing, notarization, installers, auto-update, and Windows/Linux validation are
separate release work.
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
- Drop one `.xlsx`, `.csv` or `.tsv` file onto the editor or anywhere inside the
  import dialog (including **Choose file…**) to prepare the same import preview.
  A new drop replaces the preview, not the document. Confirmation is still required;
  parsing blocks repeat drops and invalid/multiple files are rejected before reading.
  Shared drop receivers route to the nearest registered region, so modal drops never
  reach the editor behind them. `.ord` uses the editor's Open flow, not Import.
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
npx electron desktop/interchange-smoke.mjs --browser-print-only # after building; ordinary web + Online print/PDF
npx electron desktop/interchange-smoke.mjs --double-click-only # after building; real pointer editing on desktop/web
npm run desktop:build
```

Automated tests use isolated temporary files for native UTF-8 read/write, Save As,
cancellation, permissions preservation, stale/concurrent saves, deleted files,
symlinks, capability rejection, stable recovery identity, and full file-session
autosave/conflict integration. They never edit real user documents.

Pointer editing tests hold the mouse down across rendering frames, verify that
selection preserves the pressed cell element, then check both clicks and the
double-click edit. Directly dispatching `dblclick` would miss renderer replacement
between down/up. Online smoke also exercises Getting started inputs, results and
immediate post-scroll editing. Live interaction commands are not column metadata:
their changing identity must not rebuild every cell renderer.

Native smoke test: open a disposable `.ord` via the menu, edit it, save, inspect
the disk contents, then Save As to a second file. Repeat in the packaged `.app`
to verify the preload bridge, custom protocol, and native OS dialogs together.

The current web development toolchain has npm audit advisories (including Vite 5).
The desktop setup does not silently upgrade that toolchain across major versions;
resolve those before exposing development servers or preparing a public release.

## Third-party

- See `THIRD_PARTY_NOTICES.md` for font attribution and license notices.
