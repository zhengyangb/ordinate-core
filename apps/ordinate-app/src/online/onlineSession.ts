export const ONLINE_SESSION_KEY = "ordinate:online:session";

/** A session owns its recovery records, not a shared global "last document". */
export async function openOnlineSession({ storage, claim, fork, createId }: {
  storage: Pick<Storage, "getItem" | "setItem">;
  claim: (id: string) => Promise<boolean>;
  fork: (source: string, target: string) => Promise<void>;
  createId: () => string;
}): Promise<string> {
  const previous = storage.getItem(ONLINE_SESSION_KEY);
  if (previous !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previous)) {
    throw new Error("The Online tab session is invalid.");
  }
  if (previous && await claim(previous)) return previous;
  const id = createId();
  if (!await claim(id)) throw new Error("Could not acquire a unique Online tab session.");
  // An opener/duplicated tab can inherit sessionStorage. Copy its snapshots,
  // never its ownership: all subsequent writes belong to the new session.
  if (previous) await fork(previous, id);
  storage.setItem(ONLINE_SESSION_KEY, id);
  return id;
}
