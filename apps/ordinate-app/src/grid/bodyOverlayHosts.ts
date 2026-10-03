export type GridBodyOverlayHosts = { center: HTMLElement; pinned: HTMLElement };

// Keep AG Grid's DOM contract at the integration boundary. Both containers
// live inside the native vertical scroller; the center also scrolls horizontally.
export function readGridBodyOverlayHosts(root: HTMLElement): GridBodyOverlayHosts {
  const center = root.querySelector<HTMLElement>(".ag-center-cols-container");
  const pinned = root.querySelector<HTMLElement>(".ag-pinned-left-cols-container");
  if (!center || !pinned) throw new Error("ready grid is missing native body overlay containers");
  return { center, pinned };
}
