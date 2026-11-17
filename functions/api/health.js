/** GET /api/health — status konfigurasi server (tanpa membocorkan rahasia). */
export function onRequestGet({ env }) {
  return new Response(JSON.stringify({ kv: Boolean(env.VOICE_NOTES), auth: Boolean(env.ACCESS_TOKEN) }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
