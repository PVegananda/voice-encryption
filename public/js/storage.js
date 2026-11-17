/**
 * Penyimpanan lokal (IndexedDB). Yang disimpan hanya bytes .vnc terenkripsi
 * plus metadata non-rahasia (waktu, durasi, ukuran).
 *
 * Bentuk note: { id, createdAt, duration, size, mime, data: Uint8Array, synced: boolean }
 */
const DB_NAME = 'voicevault';
const DB_VERSION = 1;
const STORE = 'notes';

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function newId(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `vn_${stamp}_${rand}`;
}

export const saveNote = (note) => tx('readwrite', (s) => s.put(note));
export const getNote = (id) => tx('readonly', (s) => s.get(id));
export const deleteNote = (id) => tx('readwrite', (s) => s.delete(id));

export async function listNotes() {
  const all = await tx('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function setSynced(id, synced) {
  const note = await getNote(id);
  if (note) await saveNote({ ...note, synced });
}
