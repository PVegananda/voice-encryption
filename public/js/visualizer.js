/** Visualizer gelombang: animasi idle yang halus, dan bar frekuensi saat merekam. */
export class Visualizer {
  #canvas; #ctx; #raf = 0; #audioCtx = null; #analyser = null; #data = null; #t = 0;
  #reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    new ResizeObserver(() => this.#resize()).observe(canvas);
    this.#resize();
    this.#loop();
  }

  attach(stream) {
    this.#audioCtx = new AudioContext();
    const src = this.#audioCtx.createMediaStreamSource(stream);
    this.#analyser = this.#audioCtx.createAnalyser();
    this.#analyser.fftSize = 256;
    this.#analyser.smoothingTimeConstant = 0.8;
    src.connect(this.#analyser);
    this.#data = new Uint8Array(this.#analyser.frequencyBinCount);
  }

  detach() {
    this.#audioCtx?.close();
    this.#audioCtx = null;
    this.#analyser = null;
    this.#data = null;
  }

  #resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const { width, height } = this.#canvas.getBoundingClientRect();
    this.#canvas.width = Math.max(1, width * dpr);
    this.#canvas.height = Math.max(1, height * dpr);
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  #loop = () => {
    this.#draw();
    this.#raf = requestAnimationFrame(this.#loop);
  };

  #draw() {
    const ctx = this.#ctx;
    const { width: w, height: h } = this.#canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, w, h);

    const bars = Math.max(24, Math.floor(w / 9));
    const gap = 3;
    const bw = (w - gap * (bars - 1)) / bars;
    const live = Boolean(this.#analyser);
    if (live) this.#analyser.getByteFrequencyData(this.#data);
    if (!this.#reduced) this.#t += 0.035;

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    if (live) {
      grad.addColorStop(0, 'hsl(352 90% 62%)');
      grad.addColorStop(1, 'hsl(320 85% 64%)');
    } else {
      grad.addColorStop(0, 'hsl(168 76% 54% / .55)');
      grad.addColorStop(1, 'hsl(262 89% 66% / .55)');
    }
    ctx.fillStyle = grad;

    const mid = h / 2;
    for (let i = 0; i < bars; i++) {
      const x = i * (bw + gap);
      const center = 1 - Math.abs(i - bars / 2) / (bars / 2);
      let amp;
      if (live) {
        const idx = Math.floor(Math.abs(i - bars / 2) / (bars / 2) * this.#data.length * 0.7);
        amp = (this.#data[idx] / 255) * (0.35 + center * 0.65);
      } else {
        amp = 0.06 + 0.07 * (Math.sin(i * 0.35 + this.#t) + 1) * center;
      }
      const bh = Math.max(3, amp * h * 0.92);
      const r = Math.min(bw / 2, 3);
      ctx.beginPath();
      ctx.roundRect(x, mid - bh / 2, bw, bh, r);
      ctx.fill();
    }
  }
}
