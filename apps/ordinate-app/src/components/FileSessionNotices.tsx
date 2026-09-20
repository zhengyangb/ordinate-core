import { useFileSessionStore } from "../store/fileSessionStore";

export default function FileSessionNotices() {
  const fileSessionConflict = useFileSessionStore((state) => state.conflict);
  const fileSessionRecoveryDraft = useFileSessionStore((state) => state.recoveryDraft);
  const fileSessionExternalSnapshot = useFileSessionStore((state) => state.externalSnapshot);
  const reloadFileFromDisk = useFileSessionStore((state) => state.reloadFromDisk);
  const overwriteFileConflict = useFileSessionStore((state) => state.overwriteConflict);
  const saveFileConflictAsNewFile = useFileSessionStore((state) => state.saveConflictAsNewFile);
  const cancelFileConflict = useFileSessionStore((state) => state.cancelConflict);
  const recoverFileDraft = useFileSessionStore((state) => state.recoverDraft);
  const openSavedFile = useFileSessionStore((state) => state.openSavedFile);
  const discardFileDraft = useFileSessionStore((state) => state.discardDraft);
  return (<>
        {fileSessionRecoveryDraft ? (
          <div className="file-session-modal-backdrop" role="presentation">
            <section className="file-session-modal" role="dialog" aria-modal="true" aria-labelledby="file-recovery-title">
              <div className="file-session-modal-copy">
                <h2 id="file-recovery-title">Recover local draft?</h2>
                <p>A newer local draft exists for this file. Choose which version to keep in the editor.</p>
              </div>
              <div className="file-session-modal-actions">
                <button className="file-session-action primary" type="button" onClick={recoverFileDraft}>
                  Recover Draft
                </button>
                <button className="file-session-action" type="button" onClick={() => void openSavedFile()}>
                  Open Saved File
                </button>
                <button className="file-session-action danger" type="button" onClick={() => void discardFileDraft()}>
                  Discard Draft
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {fileSessionConflict ? (
          <div className="file-session-modal-backdrop" role="presentation">
            <section className="file-session-modal" role="dialog" aria-modal="true" aria-labelledby="file-conflict-title">
              <div className="file-session-modal-copy">
                <h2 id="file-conflict-title">File changed on disk</h2>
                <p>The saved file changed while this window has local edits. Pick how to resolve the conflict.</p>
              </div>
              <div className="file-session-modal-actions">
                <button className="file-session-action primary" type="button" onClick={() => void reloadFileFromDisk()}>
                  Reload from Disk
                </button>
                <button className="file-session-action" type="button" onClick={() => void overwriteFileConflict()}>
                  Overwrite Disk
                </button>
                <button className="file-session-action" type="button" onClick={() => void saveFileConflictAsNewFile()}>
                  Save as New File
                </button>
                <button className="file-session-action" type="button" onClick={cancelFileConflict}>
                  Cancel
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {!fileSessionConflict && fileSessionExternalSnapshot ? (
          <div className="file-session-modal-backdrop" role="presentation">
            <section className="file-session-modal" role="dialog" aria-modal="true" aria-labelledby="file-external-title">
              <div className="file-session-modal-copy">
                <h2 id="file-external-title">Saved file changed</h2>
                <p>The file on disk has a newer version. Your editor is currently clean.</p>
              </div>
              <div className="file-session-modal-actions">
                <button className="file-session-action primary" type="button" onClick={() => void reloadFileFromDisk()}>
                  Reload from Disk
                </button>
                <button className="file-session-action" type="button" onClick={cancelFileConflict}>
                  Keep Current
                </button>
              </div>
            </section>
          </div>
        ) : null}

  </>);
}
