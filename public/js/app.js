import {
  encrypt, decrypt, DecryptError, isVnc, parseHeader,
} from './crypto.js';
import { Recorder, isRecordingSupported } from './recorder.js';
import { Visualizer } from './visualizer.js';
import * as store from './storage.js';
import { cloud } from './cloud.js';

/* ---------- Elemen ---------- */
const $ = (s) => document.querySelector(s);
const els = {
  // Topbar
  lockBtn: $('#lock-btn'), cloudBtn: $('#cloud-btn'),
  // Stage 1: Input
  tabRecordBtn: $('#tab-record-btn'), tabUploadBtn: $('#tab-upload-btn'),
  inputRecordView: $('#input-record-view'), inputUploadView: $('#input-upload-view'),
  recordBtn: $('#record-btn'), timer: $('#timer'), hint: $('#record-hint'), canvas: $('#visualizer'),
  dropZone: $('#drop-zone'), audioFileInput: $('#audio-file-input'),
  originalPreview: $('#original-preview'), playerOriginal: $('#player-original'),
  originalFileInfo: $('#original-file-info'), pipelinePassword: $('#pipeline-password'),
  btnDoEncrypt: $('#btn-do-encrypt'),
  // Stage 2: Ciphertext
  cipherEmpty: $('#cipher-empty'), cipherContent: $('#cipher-content'),
  playerEncrypted: $('#player-encrypted'), cipherSize: $('#cipher-size'),
  cipherHexdump: $('#cipher-hexdump'), btnDownloadVnc: $('#btn-download-vnc'),
  // Stage 3: Decryption
  decryptEmpty: $('#decrypt-empty'), decryptContent: $('#decrypt-content'),
  decryptInputPw: $('#decrypt-input-pw'), btnTestDecrypt: $('#btn-test-decrypt'),
  btnTestWrongPw: $('#btn-test-wrong-pw'), decryptStatusBanner: $('#decrypt-status-banner'),
  decryptStatusIcon: $('#decrypt-status-icon'), decryptStatusTitle: $('#decrypt-status-title'),
  decryptStatusMsg: $('#decrypt-status-msg'), decryptedPreview: $('#decrypted-preview'),
  playerDecrypted: $('#player-decrypted'),
  // Vault
  list: $('#notes-list'), empty: $('#empty-state'), count: $('#notes-count'),
  importBtn: $('#import-btn'), importInput: $('#import-input'), syncBtn: $('#sync-btn'),
  // Dialogs & Toasts
  cloudDialog: $('#cloud-dialog'), cloudForm: $('#cloud-form'), cloudToken: $('#cloud-token'),
  cloudStatus: $('#cloud-status'), cloudError: $('#cloud-error'), cloudDisconnect: $('#cloud-disconnect'),
  confirmDialog: $('#confirm-dialog'), confirmTitle: $('#confirm-title'), confirmDesc: $('#confirm-desc'), confirmOk: $('#confirm-ok'),
  toasts: $('#toasts'),
};

/* ---------- Pipeline State ---------- */
const pipeline = {
  plainBytes: null,
  plainBlob: null,
  plainMime: 'audio/webm',
  plainDuration: 0,
  plainUrl: null,
  encryptedData: null,
  encryptedUrl: null,
  decryptedUrl: null,
  currentNoteId: null,
};

const state = {
  recorder: new Recorder(),
  timerId: 0,
  cloudOk: false,
  cloudError: '',
};

const visualizer = new Visualizer(els.canvas);

/* ---------- Util ---------- */
const fmtDuration = (s) => {
  if (s == null || !Number.isFinite(s)) return '—';
  const t = Math.round(s);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`);
const dateFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = (ms) => dateFmt.format(new Date(ms));
const fmtExt = (mime = '') => (mime.split('/')[1] || 'audio').replace('x-', '');

function toast(message, type = 'info', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  els.toasts.append(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

function toHexDump(bytes, max = 48) {
  const slice = bytes.subarray(0, max);
  let hex = '';
  for (let i = 0; i < slice.length; i++) {
    hex += slice[i].toString(16).padStart(2, '0').toUpperCase() + ' ';
    if ((i + 1) % 16 === 0) hex += '\n';
  }
  return hex.trim() + (bytes.length > max ? ' ...' : '');
}

/** Membungkus byte biner mentah menjadi file WAV (16-bit PCM mono, 24kHz) agar bisa diputar sebagai audio noise */
function createRawWavBlob(bytes, sampleRate = 24000) {
  const buffer = new ArrayBuffer(44 + bytes.length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + bytes.length, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, bytes.length, true);
  new Uint8Array(buffer, 44).set(bytes);
  return new Blob([buffer], { type: 'audio/wav' });
}

/* ---------- Tab Switcher: Mic vs Upload ---------- */
els.tabRecordBtn.addEventListener('click', () => {
  els.tabRecordBtn.classList.add('active');
  els.tabUploadBtn.classList.remove('active');
  els.inputRecordView.classList.add('active');
  els.inputUploadView.classList.remove('active');
});

els.tabUploadBtn.addEventListener('click', () => {
  els.tabUploadBtn.classList.add('active');
  els.tabRecordBtn.classList.remove('active');
  els.inputUploadView.classList.add('active');
  els.inputRecordView.classList.remove('active');
});

/* ---------- Mode 1: Rekam Mic ---------- */
els.recordBtn.addEventListener('click', toggleRecord);

async function toggleRecord() {
  if (state.recorder.isRecording) return stopRecording();

  try {
    await state.recorder.start();
  } catch (err) {
    const denied = err?.name === 'NotAllowedError';
    toast(denied ? 'Izin mikrofon ditolak di browser.' : `Gagal akses mic: ${err.message}`, 'error');
    return;
  }

  visualizer.attach(state.recorder.stream);
  document.body.classList.add('is-recording');
  els.recordBtn.setAttribute('aria-pressed', 'true');
  els.recordBtn.setAttribute('aria-label', 'Berhenti merekam');
  els.hint.textContent = 'Merekam audio asli… tekan tombol lagi untuk selesai';

  state.timerId = setInterval(() => {
    els.timer.textContent = fmtDuration(state.recorder.elapsed);
  }, 250);
}

async function stopRecording() {
  clearInterval(state.timerId);
  visualizer.detach();
  document.body.classList.remove('is-recording');
  els.recordBtn.setAttribute('aria-pressed', 'false');
  els.recordBtn.setAttribute('aria-label', 'Mulai merekam');
  els.hint.textContent = 'Rekaman suara siap. Masukkan password di bawah untuk mengenkripsi.';

  try {
    const { blob, mime, duration } = await state.recorder.stop();
    const arrayBuffer = await blob.arrayBuffer();
    setOriginalAudio(new Uint8Array(arrayBuffer), blob, mime, duration, 'Rekaman Mikrofon');
  } catch (err) {
    toast(`Gagal merekam: ${err.message}`, 'error');
  } finally {
    els.timer.textContent = '00:00';
  }
}

/* ---------- Mode 2: Upload File Audio ---------- */
els.dropZone.addEventListener('click', () => els.audioFileInput.click());
els.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropZone.classList.add('dragover');
});
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
els.dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  els.dropZone.classList.remove('dragover');
  if (e.dataTransfer.files?.length) {
    handleAudioFileUpload(e.dataTransfer.files[0]);
  }
});
els.audioFileInput.addEventListener('change', () => {
  if (els.audioFileInput.files?.length) {
    handleAudioFileUpload(els.audioFileInput.files[0]);
  }
});

async function handleAudioFileUpload(file) {
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|webm|ogg|aac|flac)$/i.test(file.name)) {
    toast('Harap masukkan file audio yang valid (.mp3, .wav, .m4a, dll)', 'warn');
    return;
  }
  const arrayBuffer = await file.arrayBuffer();
  const mime = file.type || 'audio/mpeg';
  setOriginalAudio(new Uint8Array(arrayBuffer), file, mime, null, file.name);
  toast(`File audio "${file.name}" berhasil dimasukkan!`);
}

/* ---------- Set Original Audio (Tahap 1) ---------- */
function setOriginalAudio(bytes, blob, mime, duration, name) {
  pipeline.plainBytes = bytes;
  pipeline.plainBlob = blob;
  pipeline.plainMime = mime;
  pipeline.plainDuration = duration;

  if (pipeline.plainUrl) URL.revokeObjectURL(pipeline.plainUrl);
  pipeline.plainUrl = URL.createObjectURL(blob);
  els.playerOriginal.src = pipeline.plainUrl;
  els.originalFileInfo.textContent = `${name} · ${fmtSize(bytes.length)} (${fmtExt(mime)})`;
  els.originalPreview.hidden = false;
  els.btnDoEncrypt.disabled = false;
  els.pipelinePassword.focus();

  // Reset stage 2 & 3
  resetEncryptedAndDecryptedStages();
}

function resetEncryptedAndDecryptedStages() {
  els.cipherContent.hidden = true;
  els.cipherEmpty.hidden = false;
  els.decryptContent.hidden = true;
  els.decryptEmpty.hidden = false;
  els.decryptStatusBanner.hidden = true;
  els.decryptedPreview.hidden = true;
  if (pipeline.encryptedUrl) URL.revokeObjectURL(pipeline.encryptedUrl);
  if (pipeline.decryptedUrl) URL.revokeObjectURL(pipeline.decryptedUrl);
  pipeline.encryptedData = null;
  pipeline.encryptedUrl = null;
  pipeline.decryptedUrl = null;
}

/* ---------- Tahap 2: Enkripsi Audio (AES-256-GCM) ---------- */
els.btnDoEncrypt.addEventListener('click', doEncrypt);
els.pipelinePassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doEncrypt();
});

async function doEncrypt() {
  if (!pipeline.plainBytes) {
    toast('Silakan rekam atau unggah audio terlebih dahulu.', 'warn');
    return;
  }
  const pw = els.pipelinePassword.value;
  if (!pw || pw.length < 8) {
    toast('Password enkripsi minimal 8 karakter!', 'error');
    els.pipelinePassword.focus();
    return;
  }

  els.btnDoEncrypt.disabled = true;
  els.btnDoEncrypt.textContent = 'Mengenkripsi dengan AES-256-GCM…';

  try {
    // 1. Enkripsi byte audio asli dengan AES-256-GCM & PBKDF2
    const vncBytes = await encrypt(pipeline.plainBytes, pw, pipeline.plainMime);
    pipeline.encryptedData = vncBytes;

    // 2. Buat WAV dari data terenkripsi untuk diputar (white noise)
    const noiseWav = createRawWavBlob(vncBytes);
    if (pipeline.encryptedUrl) URL.revokeObjectURL(pipeline.encryptedUrl);
    pipeline.encryptedUrl = URL.createObjectURL(noiseWav);
    els.playerEncrypted.src = pipeline.encryptedUrl;
    els.playerEncrypted.volume = 0.35; // volume derau aman

    // 3. Tampilkan info teknis
    els.cipherSize.textContent = `${vncBytes.length.toLocaleString()} Byte (${fmtSize(vncBytes.length)})`;
    els.cipherHexdump.textContent = toHexDump(vncBytes, 64);
    els.cipherEmpty.hidden = true;
    els.cipherContent.hidden = false;

    // 4. Siapkan Tahap 3 (Dekripsi)
    els.decryptEmpty.hidden = true;
    els.decryptContent.hidden = false;
    els.decryptInputPw.value = pw; // pre-fill agar mudah dites
    els.decryptStatusBanner.hidden = true;
    els.decryptedPreview.hidden = true;

    // 5. Simpan otomatis ke Brankas (IndexedDB & Cloudflare KV)
    const createdAt = Date.now();
    const id = store.newId(new Date(createdAt));
    pipeline.currentNoteId = id;
    const note = {
      id, createdAt, duration: pipeline.plainDuration,
      size: vncBytes.length, mime: pipeline.plainMime,
      data: vncBytes, synced: false,
    };
    await store.saveNote(note);
    await refreshNotes();
    if (state.cloudOk) uploadNote(id, { quiet: true });

    toast('✓ Berhasil dienkripsi! Audio terenkripsi siap diputar di Tahap 2 🔒');
  } catch (err) {
    console.error(err);
    toast(`Enkripsi gagal: ${err.message}`, 'error');
  } finally {
    els.btnDoEncrypt.disabled = false;
    els.btnDoEncrypt.textContent = '🔒 Enkripsi Audio Sekarang (AES-256)';
  }
}

// Download file .vnc dari Tahap 2
els.btnDownloadVnc.addEventListener('click', () => {
  if (!pipeline.encryptedData) return;
  const blob = new Blob([pipeline.encryptedData], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pipeline.currentNoteId || 'encrypted_audio'}.vnc`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------- Tahap 3: Uji Dekripsi Audio ---------- */
els.btnTestDecrypt.addEventListener('click', () => doTestDecrypt(els.decryptInputPw.value));
els.btnTestWrongPw.addEventListener('click', () => {
  els.decryptInputPw.value = 'password-palsu-12345';
  doTestDecrypt('password-palsu-12345');
});

async function doTestDecrypt(password) {
  if (!pipeline.encryptedData) {
    toast('Belum ada data terenkripsi untuk didekripsi.', 'warn');
    return;
  }
  if (!password) {
    toast('Masukkan password dekripsi terlebih dahulu!', 'warn');
    els.decryptInputPw.focus();
    return;
  }

  els.btnTestDecrypt.disabled = true;
  els.btnTestDecrypt.textContent = 'Memverifikasi GCM Tag & Mendekripsi…';

  try {
    const result = await decrypt(pipeline.encryptedData, password);

    // Sukses: Audio kembali utuh
    if (pipeline.decryptedUrl) URL.revokeObjectURL(pipeline.decryptedUrl);
    pipeline.decryptedUrl = URL.createObjectURL(new Blob([result.data], { type: result.mime }));
    els.playerDecrypted.src = pipeline.decryptedUrl;
    els.decryptedPreview.hidden = false;

    // Status banner sukses
    els.decryptStatusBanner.className = 'status-banner success';
    if (els.decryptStatusIcon) els.decryptStatusIcon.textContent = '✓';
    els.decryptStatusTitle.textContent = 'Kunci Terbuka';
    els.decryptStatusMsg.textContent = 'Kata sandi benar. File suara berhasil didekripsi.';
    els.decryptStatusBanner.hidden = false;

    els.playerDecrypted.play().catch(() => {});
    toast('Dekripsi berhasil', 'info');
  } catch (err) {
    // Gagal: Password salah atau tag rusak
    els.decryptedPreview.hidden = true;
    els.decryptStatusBanner.className = 'status-banner error';
    if (els.decryptStatusIcon) els.decryptStatusIcon.textContent = '✗';
    els.decryptStatusTitle.textContent = 'Kata Sandi Salah';
    els.decryptStatusMsg.textContent = 'File tidak dapat dibuka dengan kata sandi tersebut. Silakan coba lagi.';
    els.decryptStatusBanner.hidden = false;
    toast('✗ Dekripsi gagal: Password salah atau file rusak.', 'error');
  } finally {
    els.btnTestDecrypt.disabled = false;
    els.btnTestDecrypt.textContent = '🔓 Uji Dekripsi Sekarang';
  }
}

/* ---------- Brankas Riwayat Catatan ---------- */
async function refreshNotes() {
  const notes = await store.listNotes();
  els.empty.hidden = notes.length > 0;
  els.count.textContent = `${notes.length} voice note tersimpan dalam bentuk terenkripsi`;
  els.list.replaceChildren(...notes.map(createNoteItem));
}

function createNoteItem(n) {
  const li = document.createElement('li');
  li.className = 'note';
  li.dataset.id = n.id;

  li.innerHTML = `
    <div class="note-icon">
      <svg viewBox="0 0 24 24"><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/></svg>
    </div>
    <div class="note-body">
      <p class="note-title">Voice note · ${fmtDate(n.createdAt)}</p>
      <div class="note-meta">
        <span>${fmtDuration(n.duration)}</span><span class="dot"></span>
        <span>${fmtSize(n.size)}</span><span class="dot"></span>
        <span>${fmtExt(n.mime)}</span>
        <span class="badge enc">AES-256</span>
        ${n.synced ? '<span class="badge cloud">Cloud KV</span>' : '<span class="badge local">Lokal</span>'}
      </div>
    </div>
    <div class="note-actions">
      <button type="button" class="btn btn-ghost" data-action="load-to-lab" title="Muat rekaman ini ke Lab 3-Tahap di atas">
        🧪 Uji di Lab
      </button>
      <button type="button" class="icon-btn" data-action="download" title="Unduh file .vnc (terenkripsi)">
        <svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
      </button>
      <button type="button" class="icon-btn danger" data-action="delete" title="Hapus">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
      </button>
    </div>
  `;
  return li;
}

els.list.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.note').dataset.id;
  const action = btn.dataset.action;

  if (action === 'load-to-lab') {
    await loadNoteIntoLab(id);
  } else if (action === 'download') {
    await downloadNote(id);
  } else if (action === 'delete') {
    await deleteNoteAction(id);
  }
});

async function loadNoteIntoLab(id) {
  const note = await store.getNote(id);
  if (!note) return;

  pipeline.currentNoteId = note.id;
  pipeline.encryptedData = note.data;
  pipeline.plainDuration = note.duration;
  pipeline.plainMime = note.mime;

  // Siapkan Tahap 2
  const noiseWav = createRawWavBlob(note.data);
  if (pipeline.encryptedUrl) URL.revokeObjectURL(pipeline.encryptedUrl);
  pipeline.encryptedUrl = URL.createObjectURL(noiseWav);
  els.playerEncrypted.src = pipeline.encryptedUrl;
  els.cipherSize.textContent = `${note.size.toLocaleString()} Byte (${fmtSize(note.size)})`;
  els.cipherHexdump.textContent = toHexDump(note.data, 64);
  els.cipherEmpty.hidden = true;
  els.cipherContent.hidden = false;

  // Siapkan Tahap 3
  els.decryptEmpty.hidden = true;
  els.decryptContent.hidden = false;
  els.decryptInputPw.value = '';
  els.decryptStatusBanner.hidden = true;
  els.decryptedPreview.hidden = true;

  // Scroll ke atas dengan mulus
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(`Note ${id} dimuat ke Lab! Kamu bisa dengarkan audio terenkripsinya di Tahap 2 dan uji dekripsi di Tahap 3.`);
}

async function downloadNote(id) {
  const note = await store.getNote(id);
  if (!note) return;
  const blob = new Blob([note.data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${note.id}.vnc`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function deleteNoteAction(id) {
  const yes = await confirmDialog({
    title: 'Hapus Rekaman?',
    desc: 'Voice note terenkripsi ini akan dihapus permanen dari perangkat & Cloudflare KV.',
  });
  if (!yes) return;
  if (state.cloudOk) {
    try { await cloud.remove(id); } catch { /* ignore */ }
  }
  await store.deleteNote(id);
  if (pipeline.currentNoteId === id) resetEncryptedAndDecryptedStages();
  await refreshNotes();
  toast('Voice note berhasil dihapus.');
}

function confirmDialog({ title, desc }) {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmDesc.textContent = desc;
    els.confirmDialog.showModal();
    const handler = () => {
      els.confirmDialog.removeEventListener('close', handler);
      resolve(els.confirmDialog.returnValue === 'ok');
    };
    els.confirmDialog.addEventListener('close', handler);
  });
}

// Impor file .vnc eksternal
els.importBtn.addEventListener('click', () => els.importInput.click());
els.importInput.addEventListener('change', async () => {
  let ok = 0;
  for (const file of els.importInput.files) {
    const data = new Uint8Array(await file.arrayBuffer());
    if (!isVnc(data)) {
      toast(`${file.name} bukan file .vnc yang valid`, 'error');
      continue;
    }
    const id = file.name.replace(/\.vnc$/i, '') || store.newId();
    await store.saveNote({
      id, createdAt: file.lastModified || Date.now(),
      duration: null, size: data.length,
      mime: parseHeader(data).mime, data, synced: false,
    });
    ok++;
  }
  els.importInput.value = '';
  if (ok) {
    toast(`✓ ${ok} file .vnc berhasil diimpor ke brankas!`);
    await refreshNotes();
  }
});

/* ---------- Cloudflare KV Sync ---------- */
async function checkCloud() {
  if (!cloud.enabled) {
    state.cloudOk = false;
    els.cloudBtn.dataset.state = 'off';
    els.cloudBtn.querySelector('.chip-label').textContent = 'Lokal';
    els.syncBtn.disabled = true;
    return false;
  }
  try {
    await cloud.health();
    await cloud.list();
    state.cloudOk = true;
    state.cloudError = '';
    els.cloudBtn.dataset.state = 'on';
    els.cloudBtn.querySelector('.chip-label').textContent = 'Cloud KV';
    els.syncBtn.disabled = false;
    return true;
  } catch (err) {
    state.cloudOk = false;
    state.cloudError = err.message;
    els.cloudBtn.dataset.state = 'error';
    els.cloudBtn.querySelector('.chip-label').textContent = 'Cloud error';
    els.syncBtn.disabled = true;
    return false;
  }
}

async function uploadNote(id, { quiet = false } = {}) {
  const note = await store.getNote(id);
  if (!note || !state.cloudOk) return;
  try {
    await cloud.upload(note);
    await store.setSynced(id, true);
    if (!quiet) toast('Disinkronkan ke Cloudflare KV ☁️');
  } catch (err) {
    if (!quiet) toast(`Gagal sinkron KV: ${err.message}`, 'error');
  }
  await refreshNotes();
}

els.syncBtn.addEventListener('click', async () => {
  if (!state.cloudOk) return;
  els.syncBtn.disabled = true;
  try {
    const [remote, local] = await Promise.all([cloud.list(), store.listNotes()]);
    const remoteIds = new Set(remote.map((r) => r.id));
    const localIds = new Set(local.map((n) => n.id));

    let up = 0; let down = 0;
    for (const n of local) {
      if (!remoteIds.has(n.id)) { await cloud.upload(n); up++; }
      if (!n.synced) await store.setSynced(n.id, true);
    }
    for (const r of remote) {
      if (!localIds.has(r.id)) {
        const data = await cloud.download(r.id);
        if (isVnc(data)) {
          await store.saveNote({
            id: r.id, createdAt: r.createdAt || Date.now(),
            duration: r.duration || null, size: data.length,
            mime: parseHeader(data).mime, data, synced: true,
          });
          down++;
        }
      }
    }
    toast(`Sinkronisasi selesai · ${up} diunggah, ${down} diunduh`);
  } catch (err) {
    toast(`Sinkronisasi gagal: ${err.message}`, 'error');
  } finally {
    els.syncBtn.disabled = false;
    await refreshNotes();
  }
});

// Cloud settings dialog
els.cloudBtn.addEventListener('click', async () => {
  els.cloudToken.value = cloud.token;
  els.cloudError.textContent = state.cloudError;
  els.cloudDisconnect.hidden = !cloud.enabled;
  els.cloudDialog.showModal();
  try {
    const h = await cloud.health();
    els.cloudStatus.dataset.state = (h.kv && h.auth) ? 'ok' : 'error';
    els.cloudStatus.textContent = (h.kv && h.auth) ? 'Server siap · KV terhubung' : 'Server belum lengkap';
  } catch {
    els.cloudStatus.dataset.state = 'error';
    els.cloudStatus.textContent = 'Server tidak terhubung';
  }
});

els.cloudForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = els.cloudToken.value.trim();
  if (!t) return;
  cloud.setToken(t);
  const ok = await checkCloud();
  if (ok) {
    els.cloudDialog.close();
    toast('Terhubung ke Cloudflare KV ☁️');
  } else {
    els.cloudError.textContent = state.cloudError || 'Token tidak valid.';
  }
});

els.cloudDisconnect.addEventListener('click', () => {
  cloud.setToken('');
  checkCloud();
  els.cloudDialog.close();
  toast('Sinkronisasi cloud diputus.');
});

document.querySelectorAll('dialog [data-close]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});

/* ---------- Init ---------- */
(async function init() {
  if (!window.isSecureContext || !crypto?.subtle) {
    toast('Membutuhkan HTTPS atau localhost untuk Web Crypto API', 'error');
  }
  await refreshNotes();
  await checkCloud();
})();
