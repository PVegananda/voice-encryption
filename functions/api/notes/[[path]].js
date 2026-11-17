import { json } from '../_middleware.js';

/**
 * /api/notes        GET    → daftar note (metadata saja)
 * /api/notes/:id    GET    → bytes .vnc
 *                   PUT    → simpan bytes .vnc (wajib terenkripsi, dicek magic "VNC1")
 *                   DELETE → hapus
 *
 * Server tidak pernah melihat password ataupun audio mentah.
 */
const PREFIX = 'note:';
const ID_RE = /^vn_[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 25 * 1024 * 1024; // batas nilai Cloudflare KV
const MAGIC = [0x56, 0x4e, 0x43, 0x31];

export async function onRequest({ request, env, params }) {
  const kv = env.VOICE_NOTES;
  const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  if (parts.length > 1) return json({ error: 'Not found' }, 404);
  const id = parts[0];
  if (id && !ID_RE.test(id)) return json({ error: 'ID tidak valid.' }, 400);

  switch (request.method) {
    case 'GET':
      return id ? getNote(kv, id) : listNotes(kv);
    case 'PUT':
      return id ? putNote(kv, id, request) : json({ error: 'ID wajib.' }, 400);
    case 'DELETE':
      if (!id) return json({ error: 'ID wajib.' }, 400);
      await kv.delete(PREFIX + id);
      return json({ ok: true });
    default:
      return json({ error: 'Method not allowed' }, 405);
  }
}

async function listNotes(kv) {
  const notes = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: PREFIX, cursor });
    for (const k of page.keys) notes.push({ id: k.name.slice(PREFIX.length), ...(k.metadata || {}) });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  notes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ notes });
}

async function getNote(kv, id) {
  const data = await kv.get(PREFIX + id, 'arrayBuffer');
  if (!data) return json({ error: 'Note tidak ditemukan.' }, 404);
  return new Response(data, {
    headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
  });
}

async function putNote(kv, id, request) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES) return json({ error: 'File melebihi 25 MB.' }, 413);

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_BYTES) return json({ error: 'File melebihi 25 MB.' }, 413);
  if (body.length < 64 || MAGIC.some((b, i) => body[i] !== b)) {
    return json({ error: 'Hanya file .vnc terenkripsi yang diterima.' }, 400);
  }

  const meta = sanitizeMeta(request.headers.get('X-Note-Meta'));
  meta.size = body.length;
  await kv.put(PREFIX + id, body, { metadata: meta });
  return json({ ok: true, id }, 201);
}

function sanitizeMeta(raw) {
  let m = {};
  try { m = JSON.parse(raw || '{}'); } catch { /* abaikan */ }
  const num = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  return {
    createdAt: num(m.createdAt) ?? Date.now(),
    duration: num(m.duration),
    mime: typeof m.mime === 'string' ? m.mime.slice(0, 64) : null,
  };
}
