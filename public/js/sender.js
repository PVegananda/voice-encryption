import { encrypt } from './crypto.js?v=2';
import { decodeAudioToPcm, scramblePcm, encodePcmToWav } from './scrambler.js?v=2';
import { Recorder } from './recorder.js?v=2';
import * as store from './storage.js?v=2';
import { cloud } from './cloud.js?v=2';

const $ = (s) => document.querySelector(s);
const els = {
  cloudBtn: $('#cloud-btn'),
  tabRecordBtn: $('#tab-record-btn'), tabUploadBtn: $('#tab-upload-btn'),
  viewRecord: $('#view-record'), viewUpload: $('#view-upload'),
  recordBtn: $('#record-btn'), timer: $('#timer'), hint: $('#record-hint'),
  dropZone: $('#drop-zone'), fileInput: $('#file-input'),
  originalPreview: $('#original-preview'), originalDuration: $('#original-duration'), playerOriginal: $('#player-original'),
  scramblePassword: $('#scramble-password'), btnDoScramble: $('#btn-do-scramble'),
  scrambledPreview: $('#scrambled-preview'), scrambledDuration: $('#scrambled-duration'), playerScrambled: $('#player-scrambled'),
  encryptPlaceholder: $('#encrypt-placeholder'), encryptContent: $('#encrypt-content'),
  btnDoAes: $('#btn-do-aes'), aesResult: $('#aes-result'), cloudSendStatus: $('#cloud-send-status'),
  noteIdDisplay: $('#note-id-display'), cipherSize: $('#cipher-size'), cipherHexdump: $('#cipher-hexdump'),
  btnDownloadVnc: $('#btn-download-vnc'), navBanner: $('#nav-banner'),
  notesList: $('#notes-list'), notesCount: $('#notes-count'), syncBtn: $('#sync-btn'),
  cloudDialog: $('#cloud-dialog'), cloudForm: $('#cloud-form'), cloudToken: $('#cloud-token'),
  toasts: $('#toasts'),
};

const state = {
  recorder: new Recorder(),
  timerId: 0,
  originalPcm: null, // { channels, sampleRate, duration }
  scrambledPcm: null,
  scrambledWavBytes: null,
  encryptedVncBytes: null,
  currentNoteId: null,
  cloudOk: false,
};

/* ---------- Util ---------- */
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

function toHexDump(bytes, max = 48) {
  const slice = bytes.subarray(0, max);
  let hex = '';
  for (let i = 0; i < slice.length; i++) {
    hex += slice[i].toString(16).padStart(2, '0').toUpperCase() + ' ';
    if ((i + 1) % 16 === 0) hex += '\n';
  }
  return hex.trim() + (bytes.length > max ? ' ...' : '');
}

/* ---------- Tab Switcher ---------- */
els.tabRecordBtn.addEventListener('click', () => {
  els.tabRecordBtn.classList.add('active');
  els.tabUploadBtn.classList.remove('active');
  els.viewRecord.classList.add('active');
  els.viewUpload.classList.remove('active');
});

els.tabUploadBtn.addEventListener('click', () => {
  els.tabUploadBtn.classList.add('active');
  els.tabRecordBtn.classList.remove('active');
  els.viewUpload.classList.add('active');
  els.viewRecord.classList.remove('active');
});

/* ---------- Mode 1: Rekam Mic ---------- */
els.recordBtn.addEventListener('click', toggleRecord);

async function toggleRecord() {
  if (state.recorder.isRecording) return stopRecording();

  try {
    await state.recorder.start();
  } catch (err) {
    toast(`Gagal akses mic: ${err.message}`, 'error');
    return;
  }

  document.body.classList.add('is-recording');
  els.recordBtn.setAttribute('aria-pressed', 'true');
  els.recordBtn.setAttribute('aria-label', 'Berhenti merekam');
  els.hint.textContent = 'Merekam... Klik lagi untuk berhenti';

  state.timerId = setInterval(() => {
    els.timer.textContent = fmtDuration(state.recorder.elapsed);
  }, 100);
}

async function stopRecording() {
  clearInterval(state.timerId);
  document.body.classList.remove('is-recording');
  els.recordBtn.setAttribute('aria-pressed', 'false');
  els.recordBtn.setAttribute('aria-label', 'Mulai merekam');
  els.hint.textContent = 'Rekaman selesai.';

  try {
    const { blob } = await state.recorder.stop();
    await loadAudioSource(blob);
  } catch (err) {
    toast(`Gagal memproses rekaman: ${err.message}`, 'error');
  } finally {
    els.timer.textContent = '00:00';
  }
}

/* ---------- Mode 2: Upload File Audio ---------- */
els.dropZone.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); els.dropZone.classList.add('dragover'); });
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
els.dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  els.dropZone.classList.remove('dragover');
  if (e.dataTransfer.files?.length) await loadAudioSource(e.dataTransfer.files[0]);
});
els.fileInput.addEventListener('change', async () => {
  if (els.fileInput.files?.length) await loadAudioSource(els.fileInput.files[0]);
});

async function loadAudioSource(blobOrFile) {
  try {
    toast('Memproses audio...', 'info', 1500);
    const pcm = await decodeAudioToPcm(blobOrFile);
    state.originalPcm = pcm;

    const wavBlob = encodePcmToWav(pcm.channels, pcm.sampleRate);
    els.playerOriginal.src = URL.createObjectURL(wavBlob);
    els.originalDuration.textContent = fmtDuration(pcm.duration);
    els.originalPreview.hidden = false;
    els.btnDoScramble.disabled = false;
    els.scramblePassword.focus();

    // Reset downstream
    els.scrambledPreview.hidden = true;
    els.encryptContent.hidden = true;
    els.encryptPlaceholder.hidden = false;
    els.aesResult.hidden = true;
    els.navBanner.hidden = true;

    toast(`Audio berhasil dimuat (${fmtDuration(pcm.duration)})`);
  } catch (err) {
    console.error(err);
    toast(`Format file tidak didukung: ${err.message}`, 'error');
  }
}

/* ---------- Langkah 2: Audio Processing / Scrambling ---------- */
els.btnDoScramble.addEventListener('click', doScramble);
els.scramblePassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') doScramble(); });

async function doScramble() {
  if (!state.originalPcm) {
    toast('Masukkan audio terlebih dahulu pada langkah 1.', 'warn');
    return;
  }
  const pw = els.scramblePassword.value;
  if (!pw || pw.length < 8) {
    toast('Kata sandi minimal 8 karakter', 'error');
    els.scramblePassword.focus();
    return;
  }

  els.btnDoScramble.disabled = true;
  els.btnDoScramble.textContent = 'Mengacak audio...';

  try {
    const { channels, sampleRate, duration } = state.originalPcm;
    const scrambledChannels = channels.map((ch) => scramblePcm(ch, pw));
    state.scrambledPcm = { channels: scrambledChannels, sampleRate, duration };

    const scrambledWavBlob = encodePcmToWav(scrambledChannels, sampleRate);
    state.scrambledWavBytes = new Uint8Array(await scrambledWavBlob.arrayBuffer());

    els.playerScrambled.src = URL.createObjectURL(scrambledWavBlob);
    els.scrambledDuration.textContent = fmtDuration(duration);
    els.scrambledPreview.hidden = false;

    // Siapkan Langkah 3
    els.encryptPlaceholder.hidden = true;
    els.encryptContent.hidden = false;

    toast('Audio berhasil diacak');
  } catch (err) {
    console.error(err);
    toast(`Gagal mengacak audio: ${err.message}`, 'error');
  } finally {
    els.btnDoScramble.disabled = false;
    els.btnDoScramble.textContent = 'Acak Suara';
  }
}

/* ---------- Langkah 3: Kunci & Simpan ---------- */
els.btnDoAes.addEventListener('click', doAesEncrypt);

async function doAesEncrypt() {
  if (!state.scrambledWavBytes) return;
  const pw = els.scramblePassword.value;

  els.btnDoAes.disabled = true;
  els.btnDoAes.textContent = 'Mengunci file...';

  try {
    const vncBytes = await encrypt(state.scrambledWavBytes, pw, 'audio/wav');
    state.encryptedVncBytes = vncBytes;

    const createdAt = Date.now();
    const id = store.newId(new Date(createdAt));
    state.currentNoteId = id;

    // Simpan ke IndexedDB lokal
    await store.saveNote({
      id, createdAt, duration: state.originalPcm.duration,
      size: vncBytes.length, mime: 'audio/wav',
      data: vncBytes, synced: false,
    });

    // Tampilkan hasil
    if (els.noteIdDisplay) els.noteIdDisplay.textContent = id;
    if (els.cipherSize) els.cipherSize.textContent = `${vncBytes.length.toLocaleString()} Byte (${fmtSize(vncBytes.length)})`;
    if (els.cipherHexdump) els.cipherHexdump.textContent = toHexDump(vncBytes, 64);
    els.aesResult.hidden = false;
    els.navBanner.hidden = false;

    // Kirim ke Cloud jika terhubung
    if (state.cloudOk) {
      await cloud.upload({ id, data: vncBytes, createdAt, duration: state.originalPcm.duration, mime: 'audio/wav' });
      await store.setSynced(id, true);
      els.cloudSendStatus.textContent = 'File tersimpan di cloud & siap dibuka oleh penerima.';
      toast('File tersimpan di cloud');
    } else {
      els.cloudSendStatus.textContent = 'File tersimpan lokal. Anda dapat mengunduh atau membukanya di penerima.';
      toast('File tersimpan lokal');
    }

    await loadNotesList();
  } catch (err) {
    console.error(err);
    toast(`Gagal mengunci file: ${err.message}`, 'error');
  } finally {
    els.btnDoAes.disabled = false;
    els.btnDoAes.textContent = 'Kunci & Simpan File';
  }
}

els.btnDownloadVnc.addEventListener('click', () => {
  if (!state.encryptedVncBytes) return;
  const blob = new Blob([state.encryptedVncBytes], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.currentNoteId || 'suara_terkunci'}.vnc`;
  document.body.append(a);
  a.click();
  a.remove();
});

/* ---------- Daftar Note & Sync ---------- */
async function loadNotesList() {
  const notes = await store.listNotes();
  if (els.notesCount) els.notesCount.textContent = `${notes.length} file`;
  if (els.notesList) {
    els.notesList.replaceChildren(...notes.map((n) => {
      const li = document.createElement('li');
      li.className = 'note';
      li.innerHTML = `
        <div class="note-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
        </div>
        <div class="note-body">
          <p class="note-title">${n.id}</p>
          <div class="note-meta">
            <span>${fmtDuration(n.duration)}</span><span class="dot"></span>
            <span>${fmtSize(n.size)}</span><span class="dot"></span>
            <span class="badge enc">Terkunci</span>
            ${n.synced ? '<span class="badge cloud">Cloud</span>' : '<span class="badge local">Lokal</span>'}
          </div>
        </div>
        <div class="note-actions">
          <a href="/decrypt.html?id=${encodeURIComponent(n.id)}" class="btn-nav" title="Buka di halaman penerima" style="padding:0.25rem 0.6rem; font-size:0.78rem;">
            <span>Buka</span>
            <span style="font-size:0.7rem;">→</span>
          </a>
        </div>
      `;
      return li;
    }));
  }
}

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
});
document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

(async function init() {
  await loadNotesList();
  await checkCloud();
})();
