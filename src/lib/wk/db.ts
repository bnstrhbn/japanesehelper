import type { WkContent, WkProgress } from './types';

const DB_NAME = 'japanese_srs_wk';
const STORE = 'kv';

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open was blocked. Close other tabs and retry.'));
  });

const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result as T);
      t.onerror = t.onabort = () => reject(t.error ?? req.error);
    });
  } finally {
    db.close();
  }
};

export const loadWkContent = () => tx<WkContent | undefined>('readonly', (s) => s.get('content'));
export const saveWkContent = (c: WkContent) => tx<void>('readwrite', (s) => s.put(c, 'content'));
export const loadWkProgress = () => tx<WkProgress | undefined>('readonly', (s) => s.get('progress'));
export const saveWkProgress = (p: WkProgress) => tx<void>('readwrite', (s) => s.put(p, 'progress'));
export const clearWkProgress = () => tx<void>('readwrite', (s) => s.delete('progress'));
