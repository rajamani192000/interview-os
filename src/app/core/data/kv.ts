/** Tiny IndexedDB key-value store (client cache + on-device recordings). Falls back to memory. */
const DB = 'interview-os';
const STORE = 'kv';
let dbp: Promise<IDBDatabase | null> | null = null;
const mem = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise(res => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch {
      res(null);
    }
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return open().then(
    db =>
      new Promise(res => {
        if (!db) return res(undefined);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => res(req.result as T);
          req.onerror = () => res(undefined);
        } catch {
          res(undefined);
        }
      }),
  );
}

export const kv = {
  async get<T>(key: string): Promise<T | undefined> {
    const v = await tx<T>('readonly', s => s.get(key));
    return v === undefined ? (mem.get(key) as T | undefined) : v;
  },
  async set(key: string, value: unknown): Promise<void> {
    mem.set(key, value);
    await tx('readwrite', s => s.put(value, key));
  },
  async del(key: string): Promise<void> {
    mem.delete(key);
    await tx('readwrite', s => s.delete(key));
  },
  async keys(prefix = ''): Promise<string[]> {
    const all = ((await tx<IDBValidKey[]>('readonly', s => s.getAllKeys())) || [...mem.keys()]) as string[];
    return all.filter(k => typeof k === 'string' && k.startsWith(prefix));
  },
  async clearPrefix(prefix: string) {
    for (const k of await kv.keys(prefix)) await kv.del(k);
  },
};
