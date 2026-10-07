import { MenuOption } from "../components/MenuSurface";
import { NoteIcon } from "../icons/uiIcons";
import type { RowsToNoteAction } from "./useRowsToNoteCommand";

export function RowsToNoteMenuItem({action}: {action: RowsToNoteAction | null}) {
  if (!action) return null;
  return <>
    <MenuOption role="menuitem" icon={<NoteIcon />} disabled={!!action.disabledReason} title={action.disabledReason} onClick={action.run}>
      {action.label}
    </MenuOption>
    {action.disabledReason ? <p className="rows-to-note-reason">{action.disabledReason}</p> : null}
  </>;
}
