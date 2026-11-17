import { decrypt, isVnc } from './crypto.js?v=2';
import { decodeAudioToPcm, descramblePcm, encodePcmToWav } from './scrambler.js?v=2';
import * as store from './storage.js?v=2';
import { cloud } from './cloud.js?v=2';

const $ = (s) => document.querySelector(s);
const els = {
  cloudBtn: $('#cloud-btn'),
  tabCloudBtn: $('#tab-cloud-btn'), tabVncBtn: $('#tab-vnc-btn'),
  viewCloudNotes: $('#view-cloud-notes'), viewVncUpload: $('#view-vnc-upload'),
  cloudNotesSelect: $('#cloud-notes-select'), btnFetchCloud: $('#btn-fetch-cloud'),
  dropZoneVnc: $('#drop-zone-vnc'), vncFileInput: $('#vnc-file-input'),
  vncLoadedInfo: $('#vnc-loaded-info'), vncFileSize: $('#vnc-file-size'), vncFileName: $('#vnc-file-name'),
  aesDecryptPassword: $('#aes-decrypt-password'), btnDoAesDecrypt: $('#btn-do-aes-decrypt'), btnTestWrong: $('#btn-test-wrong'),
  aesStatusBanner: $('#aes-status-banner'), aesStatusIcon: $('#aes-status-icon'),
  aesStatusTitle: $('#aes-status-title'), aesStatusMsg: $('#aes-status-msg'),
  aesDecryptedPreview: $('#aes-decrypted-preview'), aesDecryptedDuration: $('#aes-decrypted-duration'),
  playerAesScrambled: $('#player-aes-scrambled'),
  descramblePlaceholder: $('#descramble-placeholder'), descrambleContent: $('#descramble-content'),
  btnDoDescramble: $('#btn-do-descramble'), finalPreview: $('#final-preview'),
  finalDuration: $('#final-duration'), playerFinal: $('#player-final'), btnDownloadClean: $('#btn-download-clean'),
  cloudDialog: $('#cloud-dialog'), cloudForm: $('#cloud-form'), cloudToken: $('#cloud-token'),
  toasts: $('#toasts'),
};

const state = {
  encryptedVncBytes: null,
  decryptedScrambledWavBytes: null,
  scrambledPcm: null,
  restoredCleanWavBlob: null,
  usedPassword: '',
  cloudOk: false,
};

const fmtDuration = (s) => (s == null || !Number.isFinite(s) ? '0.0s' : `${s.toFixed(2)}s`);
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`);

function toast(msg, type = 'info', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  els.toasts.append(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

/* ---------- Tab Switcher ---------- */
els.tabCloudBtn.addEventListener('click', () => {
  els.tabCloudBtn.classList.add('active');
  els.tabVncBtn.classList.remove('active');
  els.viewCloudNotes.classList.add('active');
  els.viewVncUpload.classList.remove('active');
});

els.tabVncBtn.addEventListener('click', () => {
  els.tabVncBtn.classList.add('active');
  els.tabCloudBtn.classList.remove('active');
  els.viewVncUpload.classList.add('active');
  els.viewCloudNotes.classList.remove('active');
});

/* ---------- Mode 1: Ambil dari Cloudflare KV ---------- */
async function loadCloudNotesList(preselectId) {
  els.cloudNotesSelect.innerHTML = '<option value="">Memuat daftar...</option>';
  try {
    let notes = [];
    if (state.cloudOk) {
      notes = await cloud.list();
    } else {
      notes = await store.listNotes();
    }

    if (!notes.length) {
      els.cloudNotesSelect.innerHTML = '<option value="">(Belum ada note di Cloud / Lokal)</option>';
      return;
    }

    els.cloudNotesSelect.innerHTML = '<option value="">-- Pilih Voice Note --</option>' +
      notes.map((n) => `<option value="${n.id}" ${n.id === preselectId ? 'selected' : ''}>${n.id} (${fmtSize(n.size || 0)})</option>`).join('');

    if (preselectId) {
      await fetchSelectedCloudNote(preselectId);
    }
  } catch (err) {
    els.cloudNotesSelect.innerHTML = '<option value="">(Gagal memuat dari Cloud)</option>';
  }
}

els.btnFetchCloud.addEventListener('click', () => loadCloudNotesList());
els.cloudNotesSelect.addEventListener('change', () => {
  const id = els.cloudNotesSelect.value;
  if (id) fetchSelectedCloudNote(id);
});

async function fetchSelectedCloudNote(id) {
  try {
    toast(`Mengunduh ${id} dari cloud…`, 'info', 1500);
    let bytes;
    if (state.cloudOk) {
      bytes = await cloud.download(id);
    } else {
      const note = await store.getNote(id);
      bytes = note?.data;
    }

    if (!bytes || !isVnc(bytes)) {
      toast('File bukan format .vnc yang valid.', 'error');
      return;
    }
    loadEncryptedData(bytes, id);
  } catch (err) {
    toast(`Gagal mengambil note: ${err.message}`, 'error');
  }
}

/* ---------- Mode 2: Upload File .vnc ---------- */
els.dropZoneVnc.addEventListener('click', () => els.vncFileInput.click());
els.dropZoneVnc.addEventListener('dragover', (e) => { e.preventDefault(); els.dropZoneVnc.classList.add('dragover'); });
els.dropZoneVnc.addEventListener('dragleave', () => els.dropZoneVnc.classList.remove('dragover'));
els.dropZoneVnc.addEventListener('drop', async (e) => {
  e.preventDefault();
  els.dropZoneVnc.classList.remove('dragover');
  if (e.dataTransfer.files?.length) await handleVncFile(e.dataTransfer.files[0]);
});
els.vncFileInput.addEventListener('change', async () => {
  if (els.vncFileInput.files?.length) await handleVncFile(els.vncFileInput.files[0]);
});

async function handleVncFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isVnc(bytes)) {
    toast('File ini bukan file .vnc terenkripsi!', 'error');
    return;
  }
  loadEncryptedData(bytes, file.name);
}

function loadEncryptedData(bytes, name) {
  state.encryptedVncBytes = bytes;
  els.vncFileSize.textContent = fmtSize(bytes.length);
  els.vncFileName.textContent = name;
  els.vncLoadedInfo.hidden = false;
  els.btnDoAesDecrypt.disabled = false;
  els.aesDecryptPassword.focus();

  // Reset downstream
  els.aesStatusBanner.hidden = true;
  els.aesDecryptedPreview.hidden = true;
  els.descramblePlaceholder.hidden = false;
  els.descrambleContent.hidden = true;
  els.finalPreview.hidden = true;

  toast(`File ${name} dimuat`);
}

/* ---------- Langkah 2: Buka Kunci File ---------- */
els.btnDoAesDecrypt.addEventListener('click', () => doAesDecrypt(els.aesDecryptPassword.value));
els.btnTestWrong?.addEventListener('click', () => {
  els.aesDecryptPassword.value = 'password-salah-123';
  doAesDecrypt('password-salah-123');
});
els.aesDecryptPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAesDecrypt(els.aesDecryptPassword.value); });

async function doAesDecrypt(password) {
  if (!state.encryptedVncBytes) {
    toast('Pilih file terlebih dahulu.', 'warn');
    return;
  }
  if (!password) {
    toast('Masukkan kata sandi', 'warn');
    els.aesDecryptPassword.focus();
    return;
  }

  els.btnDoAesDecrypt.disabled = true;
  els.btnDoAesDecrypt.textContent = 'Membuka kunci...';

  try {
    // 1. Dekripsi data menggunakan AES-256-GCM
    const { data: scrambledWavArrayBuffer } = await decrypt(state.encryptedVncBytes, password);
    state.usedPassword = password;

    // 2. Decode WAV hasil dekripsi menjadi PCM
    const pcm = await decodeAudioToPcm(scrambledWavArrayBuffer);
    state.scrambledPcm = pcm;

    // 3. Encode kembali menjadi valid WAV Blob agar audio player selalu bisa memutar
    const scrambledBlob = encodePcmToWav(pcm.channels, pcm.sampleRate);
    state.decryptedScrambledWavBytes = new Uint8Array(await scrambledBlob.arrayBuffer());

    els.aesDecryptedDuration.textContent = fmtDuration(pcm.duration);
    els.aesDecryptedPreview.hidden = false;
    els.playerAesScrambled.src = URL.createObjectURL(scrambledBlob);
    els.playerAesScrambled.load();

    // 4. Update status banner sukses
    els.aesStatusBanner.className = 'colab-msg success';
    if (els.aesStatusIcon) els.aesStatusIcon.textContent = '✓';
    els.aesStatusTitle.textContent = 'Kunci Terbuka';
    els.aesStatusMsg.textContent = 'Kata sandi benar. Silakan lanjutkan untuk memulihkan audio.';
    els.aesStatusBanner.hidden = false;

    // 5. Buka Langkah 3 (Descrambling)
    els.descramblePlaceholder.hidden = true;
    els.descrambleContent.hidden = false;

    toast('Kunci file berhasil dibuka');
  } catch (err) {
    // Gagal: password salah atau tag rusak
    els.aesDecryptedPreview.hidden = true;
    els.descramblePlaceholder.hidden = false;
    els.descrambleContent.hidden = true;
    els.finalPreview.hidden = true;

    els.aesStatusBanner.className = 'colab-msg error';
    if (els.aesStatusIcon) els.aesStatusIcon.textContent = '✗';
    els.aesStatusTitle.textContent = 'Kata Sandi Salah';
    els.aesStatusMsg.textContent = 'File tidak dapat dibuka dengan kata sandi tersebut. Silakan coba lagi.';
    els.aesStatusBanner.hidden = false;

    toast('Kata sandi salah', 'error');
  } finally {
    els.btnDoAesDecrypt.disabled = false;
    els.btnDoAesDecrypt.textContent = 'Buka Kunci';
  }
}

/* ---------- Langkah 3: Pulihkan Suara Jernih ---------- */
els.btnDoDescramble.addEventListener('click', doDescramble);

async function doDescramble() {
  if (!state.scrambledPcm) return;

  els.btnDoDescramble.disabled = true;
  els.btnDoDescramble.textContent = 'Memulihkan suara...';

  try {
    const { channels, sampleRate, duration } = state.scrambledPcm;
    // Descramble tiap channel menggunakan password yang sama
    const restoredChannels = channels.map((ch) => descramblePcm(ch, state.usedPassword));

    // Encode kembali menjadi WAV jernih
    const cleanWavBlob = encodePcmToWav(restoredChannels, sampleRate);
    state.restoredCleanWavBlob = cleanWavBlob;

    els.finalDuration.textContent = fmtDuration(duration);
    els.finalPreview.hidden = false;
    els.playerFinal.src = URL.createObjectURL(cleanWavBlob);
    els.playerFinal.load();

    els.playerFinal.play().catch(() => {});
    toast('Suara berhasil dipulihkan');
  } catch (err) {
    console.error(err);
    toast(`Gagal memulihkan suara: ${err.message}`, 'error');
  } finally {
    els.btnDoDescramble.disabled = false;
    els.btnDoDescramble.textContent = 'Pulihkan Suara';
  }
}

els.btnDownloadClean.addEventListener('click', () => {
  if (!state.restoredCleanWavBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(state.restoredCleanWavBlob);
  a.download = 'suara_pulih.wav';
  document.body.append(a);
  a.click();
  a.remove();
});

/* ---------- Cloud Setup ---------- */
async function checkCloud() {
  const label = document.querySelector('#cloud-chip-label') || els.cloudBtn?.querySelector('.chip-label');
  if (!cloud.enabled) {
    state.cloudOk = false;
    if (els.cloudBtn) els.cloudBtn.dataset.state = 'off';
    if (label) label.textContent = 'Lokal';
    return false;
  }
  try {
    await cloud.health();
    state.cloudOk = true;
    if (els.cloudBtn) els.cloudBtn.dataset.state = 'on';
    if (label) label.textContent = 'Terhubung';
    return true;
  } catch {
    state.cloudOk = false;
    if (els.cloudBtn) els.cloudBtn.dataset.state = 'error';
    if (label) label.textContent = 'Offline';
    return false;
  }
}

els.cloudBtn.addEventListener('click', () => {
  els.cloudToken.value = cloud.token;
  els.cloudDialog.showModal();
});
els.cloudForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  cloud.setToken(els.cloudToken.value.trim());
  els.cloudDialog.close();
  await checkCloud();
  await loadCloudNotesList();
});
document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

/* ---------- Init ---------- */
(async function init() {
  await checkCloud();
  const urlParams = new URLSearchParams(window.location.search);
  const targetId = urlParams.get('id');
  await loadCloudNotesList(targetId);
})();
