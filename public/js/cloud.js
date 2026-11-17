/**
 * Klien sinkronisasi ke Cloudflare Pages Functions + KV.
 * Hanya bytes .vnc (sudah terenkripsi) yang dikirim.
 */
const TOKEN_KEY = 'vnc.cloudToken';
const API = '/api';

export class CloudError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export const cloud = {
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); },
  get enabled() { return Boolean(this.token); },

  async health() {
    const res = await fetch(`${API}/health`, { cache: 'no-store' });
    if (!res.ok) throw new CloudError('Server Functions tidak tersedia', res.status);
    return res.json(); // { kv: boolean, auth: boolean }
  },

  async list() {
    const res = await call('/notes');
    return (await res.json()).notes; // [{ id, createdAt, duration, size, mime }]
  },

  async upload(note) {
    await call(`/notes/${encodeURIComponent(note.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Note-Meta': JSON.stringify({ createdAt: note.createdAt, duration: note.duration, mime: note.mime }),
      },
      body: note.data,
    });
  },

  async download(id) {
    const res = await call(`/notes/${encodeURIComponent(id)}`);
    return new Uint8Array(await res.arrayBuffer());
  },

  async remove(id) {
    await call(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${cloud.token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* abaikan */ }
    throw new CloudError(msg, res.status);
  }
  return res;
}
