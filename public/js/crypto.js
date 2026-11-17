/**
 * VoiceVault crypto — AES-256-GCM dengan kunci dari PBKDF2-SHA256.
 *
 * Format file .vnc (big-endian):
 *   [ "VNC1" 4B ][ iterasi u32 4B ][ salt 16B ][ iv 12B ][ panjang mime u8 1B ][ mime ][ ciphertext + tag GCM 16B ]
 *
 * Seluruh header (sebelum ciphertext) dipakai sebagai Additional Authenticated Data,
 * jadi mengubah satu byte header pun akan membuat dekripsi gagal.
 * Format ini identik dengan tools/decrypt.py.
 */

export const MAGIC = new Uint8Array([0x56, 0x4e, 0x43, 0x31]); // "VNC1"
export const PBKDF2_ITERATIONS = 600_000; // rekomendasi OWASP untuk PBKDF2-HMAC-SHA256
const MAX_ITERATIONS = 10_000_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const FIXED_HEADER = MAGIC.length + 4 + SALT_LEN + IV_LEN + 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

export class DecryptError extends Error {
  constructor(message = 'Password salah atau file rusak.') {
    super(message);
    this.name = 'DecryptError';
  }
}

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('Data harus ArrayBuffer atau Uint8Array');
}

/**
 * Enkripsi data biner.
 * @param {ArrayBuffer|Uint8Array} plain
 * @param {string} password
 * @param {string} [mime]
 * @returns {Promise<Uint8Array>} isi file .vnc
 */
export async function encrypt(plain, password, mime = 'application/octet-stream') {
  const mimeBytes = enc.encode(mime);
  if (mimeBytes.length > 255) throw new Error('MIME type terlalu panjang');

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));

  const header = new Uint8Array(FIXED_HEADER + mimeBytes.length);
  const view = new DataView(header.buffer);
  let o = 0;
  header.set(MAGIC, o); o += MAGIC.length;
  view.setUint32(o, PBKDF2_ITERATIONS); o += 4;
  header.set(salt, o); o += SALT_LEN;
  header.set(iv, o); o += IV_LEN;
  header[o++] = mimeBytes.length;
  header.set(mimeBytes, o);

  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, toBytes(plain)),
  );

  const out = new Uint8Array(header.length + ct.length);
  out.set(header, 0);
  out.set(ct, header.length);
  return out;
}

/** Baca header tanpa mendekripsi. Melempar Error jika bukan file .vnc. */
export function parseHeader(data) {
  const bytes = toBytes(data);
  if (bytes.length < FIXED_HEADER + 16) throw new DecryptError('File terlalu kecil / bukan .vnc.');
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new DecryptError('Bukan file VoiceVault (.vnc).');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = MAGIC.length;
  const iterations = view.getUint32(o); o += 4;
  if (iterations < 1 || iterations > MAX_ITERATIONS) throw new DecryptError('Parameter iterasi tidak valid.');
  const salt = bytes.slice(o, o + SALT_LEN); o += SALT_LEN;
  const iv = bytes.slice(o, o + IV_LEN); o += IV_LEN;
  const mimeLen = bytes[o++];
  if (o + mimeLen + 16 > bytes.length) throw new DecryptError('Header rusak.');
  const mime = dec.decode(bytes.subarray(o, o + mimeLen)); o += mimeLen;
  return { iterations, salt, iv, mime, headerLength: o };
}

export function isVnc(data) {
  try { parseHeader(data); return true; } catch { return false; }
}

/**
 * Dekripsi isi file .vnc.
 * @returns {Promise<{ data: ArrayBuffer, mime: string }>}
 */
export async function decrypt(data, password) {
  const bytes = toBytes(data);
  const { iterations, salt, iv, mime, headerLength } = parseHeader(bytes);
  const key = await deriveKey(password, salt, iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: bytes.subarray(0, headerLength) },
      key,
      bytes.subarray(headerLength),
    );
    return { data: plain, mime };
  } catch {
    throw new DecryptError();
  }
}

/* ---------- Verifier: memastikan password sesi konsisten ---------- */
const VERIFIER_KEY = 'vnc.verifier';
const VERIFIER_TEXT = 'voicevault-verifier-v1';

const b64 = {
  encode: (bytes) => btoa(String.fromCharCode(...bytes)),
  decode: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
};

export function hasVerifier() {
  return Boolean(localStorage.getItem(VERIFIER_KEY));
}

export async function createVerifier(password) {
  const blob = await encrypt(enc.encode(VERIFIER_TEXT), password, 'text/plain');
  localStorage.setItem(VERIFIER_KEY, b64.encode(blob));
}

export async function checkVerifier(password) {
  const stored = localStorage.getItem(VERIFIER_KEY);
  if (!stored) return false;
  try {
    const { data } = await decrypt(b64.decode(stored), password);
    return dec.decode(data) === VERIFIER_TEXT;
  } catch {
    return false;
  }
}

export function resetVerifier() {
  localStorage.removeItem(VERIFIER_KEY);
}
