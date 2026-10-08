import type { LocalDraftRecord, LocalDraftStore } from "../store/fileSessionStore";
import { openOnlineSession } from "./onlineSession";

const DATABASE = "ordinate-online-drafts";
const RECORDS = "drafts";
type StoredDraft = LocalDraftRecord & { sessionId: string };

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const records = request.result.createObjectStore(RECORDS, { keyPath: ["sessionId", "key"] });
      records.createIndex("session", "sessionId");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("Online draft storage is blocked by another page. Close it and reload.")); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

function transact<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDS, mode);
    let result: T;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error ?? new Error("Online draft transaction was aborted."));
    try {
      const request = run(transaction.objectStore(RECORDS));
      request.onsuccess = () => { result = request.result; };
    } catch (error) { transaction.abort(); reject(error); }
  });
}

/** The lease lives with the document; navigation/closing releases it in the browser. */
function claimSession(locks: LockManager, id: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    void locks.request("ordinate:online:session:" + id, { ifAvailable: true }, lock => {
      resolve(!!lock);
      if (lock) return new Promise<void>(() => {});
    }).catch(reject);
  });
}

/** Online-only adapter. Every key, including local files and untitled copies,
 * is scoped to this tab's lease. The generic file session owns save semantics. */
export function createOnlineDraftStore(win: Window): LocalDraftStore {
  let ready: Promise<{ db: IDBDatabase; sessionId: string }> | null = null;
  const prepare = () => ready ??= (async () => {
    if (!win.indexedDB || !win.navigator.locks) throw new Error("Online requires IndexedDB and Web Locks for independent tab recovery.");
    const db = await openDatabase(win.indexedDB);
    const sessionId = await openOnlineSession({
      storage: win.sessionStorage, createId: () => win.crypto.randomUUID(),
      claim: id => claimSession(win.navigator.locks, id),
      fork: async (source, target) => {
        const records = await transact<StoredDraft[]>(db, "readonly", store => store.index("session").getAll(source));
        if (!records.length) return;
        await transact(db, "readwrite", store => {
          let last!: IDBRequest<IDBValidKey>;
          for (const record of records) last = store.put({ ...record, sessionId: target });
          return last;
        });
      },
    });
    return { db, sessionId };
  })();
  return {
    get: async key => {
      const { db, sessionId } = await prepare();
      const record = await transact<StoredDraft | undefined>(db, "readonly", store => store.get([sessionId, key]));
      if (record === undefined) return null;
      if (record.sessionId !== sessionId || record.key !== key || typeof record.text !== "string" || typeof record.version !== "string" || !Number.isFinite(record.updatedAt)) {
        throw new Error("The Online recovery draft is invalid.");
      }
      const { sessionId: _owner, ...draft } = record;
      return draft;
    },
    set: async record => {
      const { db, sessionId } = await prepare();
      await transact(db, "readwrite", store => store.put({ ...record, sessionId }));
    },
    remove: async key => {
      const { db, sessionId } = await prepare();
      await transact(db, "readwrite", store => store.delete([sessionId, key]));
    },
  };
}
