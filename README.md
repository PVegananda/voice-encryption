# 🎙️🔒 VoiceVault

Voice note yang **langsung dienkripsi di browser** (AES-256-GCM), di-host di **Cloudflare Pages**, dengan sinkronisasi opsional ke **Cloudflare KV**.
Audio mentah dan password **tidak pernah** meninggalkan perangkatmu.

```
🎤 Rekam (MediaRecorder) → 🔐 AES-256-GCM di RAM (Web Crypto) → 💾 IndexedDB (lokal) → ☁️ Cloudflare KV (opsional, sudah terenkripsi)
                                                                       ↘ ⬇️ file .vnc → 🐍 tools/decrypt.py (offline)
```

## Struktur

```
public/                 # di-deploy ke Cloudflare Pages
├── index.html
├── _headers            # CSP & header keamanan
├── css/style.css
└── js/
    ├── app.js          # alur UI
    ├── crypto.js       # AES-256-GCM + PBKDF2 (600k iterasi)
    ├── recorder.js     # MediaRecorder
    ├── visualizer.js   # gelombang suara
    ├── storage.js      # IndexedDB
    └── cloud.js        # klien API KV
functions/api/          # Cloudflare Pages Functions (backend KV)
├── _middleware.js      # auth Bearer token
├── health.js
└── notes/[[path]].js   # GET/PUT/DELETE note terenkripsi
tools/decrypt.py        # dekripsi .vnc offline (Python)
wrangler.toml
```

## Live Deployment (Cloudflare Pages + KV)

- **URL Aplikasi**: [https://encrypted-voice.pages.dev](https://encrypted-voice.pages.dev)
- **KV Namespace ID**: `490486a212de40238fe4921becaa7fe6`
- **Access Token**:
  ```text
  YKW7BzxMGPdNbArmX1-kdYqzS6jMcI9U6ZtbGPDJyaY
  ```
  *(Masukkan token ini di tombol "Lokal" pada web app untuk mengaktifkan sinkronisasi Cloudflare KV)*

## Jalankan lokal

```bash
cp .dev.vars.example .dev.vars        # isi ACCESS_TOKEN
npx wrangler pages dev                # http://localhost:8788
```
> Wrangler 4 butuh Node ≥ 22.12. Kalau masih Node 20, pakai `npx wrangler@3 pages dev`.
> Mikrofon hanya jalan di `https://` atau `localhost`.

## Deploy ke Cloudflare Pages + KV (gratis)

```bash
npx wrangler login
npx wrangler kv namespace create VOICE_NOTES        # salin id → wrangler.toml
npx wrangler pages project create encrypted-voice
npx wrangler pages secret put ACCESS_TOKEN --project-name encrypted-voice
npx wrangler pages deploy
```
Buat token acak: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`

Lalu buka situsmu → klik chip **Lokal** di kanan atas → masukkan `ACCESS_TOKEN` → **Simpan & uji**.

> Tanpa KV / token, aplikasi tetap jalan penuh dalam mode lokal (offline).

## Dekripsi offline dengan Python

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r tools/requirements.txt
python tools/decrypt.py vn_20261117_100000_ab12cd.vnc       # → .webm / .m4a
python tools/decrypt.py *.vnc -o hasil/
```

## Format file `.vnc`

| Bagian | Ukuran |
|---|---|
| Magic `VNC1` | 4 B |
| Iterasi PBKDF2 (u32 BE) | 4 B |
| Salt | 16 B |
| IV | 12 B |
| Panjang MIME | 1 B |
| MIME (mis. `audio/webm`) | n B |
| Ciphertext + tag GCM | sisa |

Kunci = PBKDF2-HMAC-SHA256(password, salt, iterasi) → AES-256-GCM. Seluruh header dipakai sebagai AAD.

## Catatan keamanan

- Password hanya di memori; brankas terkunci otomatis setelah 10 menit tidak aktif.
- Server/KV hanya menyimpan ciphertext dan menolak upload yang bukan `.vnc`.
- Metadata (waktu rekam, durasi, ukuran) **tidak** dienkripsi.
- **Password hilang = voice note tidak bisa dibuka.** Pakai password yang sama di semua perangkat.
- Kuota KV gratis: 1 GB, 1.000 tulis/hari, maks 25 MB per note (≈ 50 menit @64 kbps; app membatasi 30 menit).
