/**
 * Perekam berbasis MediaRecorder. Potongan audio hanya disimpan di RAM
 * dan langsung dilepas setelah dienkripsi oleh pemanggil.
 */

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm',
];

export function isRecordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

function pickMime() {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

export class Recorder {
  #stream = null;
  #recorder = null;
  #chunks = [];
  #startedAt = 0;

  get stream() { return this.#stream; }
  get isRecording() { return this.#recorder?.state === 'recording'; }
  get elapsed() { return this.#startedAt ? (performance.now() - this.#startedAt) / 1000 : 0; }

  async start() {
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mimeType = pickMime();
    const options = mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : { audioBitsPerSecond: 64_000 };
    this.#recorder = new MediaRecorder(this.#stream, options);
    this.#chunks = [];
    this.#recorder.addEventListener('dataavailable', (e) => {
      if (e.data?.size) this.#chunks.push(e.data);
    });
    this.#recorder.start(1000);
    this.#startedAt = performance.now();
  }

  /** @returns {Promise<{ blob: Blob, mime: string, duration: number }>} */
  stop() {
    return new Promise((resolve, reject) => {
      const rec = this.#recorder;
      if (!rec || rec.state === 'inactive') return reject(new Error('Tidak sedang merekam'));
      rec.addEventListener('stop', () => {
        const mime = (rec.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(this.#chunks, { type: mime });
        const duration = this.elapsed;
        this.#cleanup();
        resolve({ blob, mime, duration });
      }, { once: true });
      rec.addEventListener('error', (e) => { this.#cleanup(); reject(e.error || e); }, { once: true });
      rec.stop();
    });
  }

  cancel() {
    if (this.#recorder && this.#recorder.state !== 'inactive') this.#recorder.stop();
    this.#cleanup();
  }

  #cleanup() {
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
    this.#recorder = null;
    this.#chunks = [];
    this.#startedAt = 0;
  }
}
