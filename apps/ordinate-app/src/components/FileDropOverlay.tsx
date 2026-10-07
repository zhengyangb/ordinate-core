import { OpenIcon, SheetSetupIcon } from "../icons/uiIcons";
import { IMPORT_FORMATS } from "../interchange/contracts";
import type { FileDropCue } from "../platform/fileDrop";
import "./fileDropOverlay.css";

export function FileDropOverlay({ cue }: { cue: FileDropCue | null }) {
  if (!cue) return null;
  const blocked = cue.kind === "blocked";
  return <div className="file-drop-overlay" data-kind={cue.kind} role="status" aria-live="polite" aria-atomic="true">
    <div className="file-drop-message">
      <h2>{blocked ? cue.message : cue.kind === "document" ? "Drop to open document" : cue.kind === "import" ? "Drop to import spreadsheet" : "Drop a file to open or import"}</h2>
      {blocked ? <p>Your current document will stay unchanged.</p> : <>
        <div className="file-drop-routes">
          {cue.kind !== "import" && <span className="file-drop-route" data-route="document"><OpenIcon /><strong>Open</strong><span>.ord</span></span>}
          {cue.kind !== "document" && <span className="file-drop-route" data-route="import"><SheetSetupIcon /><strong>Import</strong><span>{IMPORT_FORMATS.map(format => `.${format}`).join(" · ")}</span></span>}
        </div>
        <p>{cue.kind === "document" ? "Open in Ordinate" : cue.kind === "import" ? "Review sheets and options before importing" : "Spreadsheets open in the import wizard"}</p>
      </>}
    </div>
  </div>;
}
