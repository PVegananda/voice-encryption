/**
 * Middleware untuk semua /api/*: cek konfigurasi & autentikasi Bearer token.
 * /api/health dibiarkan publik agar UI bisa tahu apakah server siap.
 */
export async function onRequest({ request, env, next }) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/health') return next();

  if (!env.VOICE_NOTES) return json({ error: 'KV namespace VOICE_NOTES belum di-bind.' }, 503);
  if (!env.ACCESS_TOKEN) return json({ error: 'ACCESS_TOKEN belum diset.' }, 503);

  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(await safeEqual(token, env.ACCESS_TOKEN))) return json({ error: 'Token tidak valid.' }, 401);

  return next();
}

/** Perbandingan konstan-waktu lewat hash SHA-256 agar panjang token tidak bocor. */
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha); const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && a.length > 0;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
