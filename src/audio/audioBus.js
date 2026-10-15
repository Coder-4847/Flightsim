// One shared Web Audio context for the whole game, with a bus per kind of sound so the volume
// settings (master, engine and wind, radio and call-outs, warnings, menu clicks) are real mixers.
// Browsers only allow audio after a click or key press, so the context is created lazily and
// resumed on the first gesture.

let shared = null;

export function getAudio(settings) {
  if (shared) return shared;
  shared = new AudioBus(settings);
  return shared;
}

class AudioBus {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.flying = false;
    this.buses = {};
    const wake = () => this.#create();
    for (const type of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(type, wake, { once: false, passive: true });
    settings.on('change', ({ key }) => { if (/Volume$|uiSounds/.test(key)) this.#applyVolumes(); });
  }

  get ready() { return !!this.ctx; }

  #create() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume?.().catch?.(() => {});
      return this.ctx;
    }
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return null;
    try { this.ctx = new Ctx({ latencyHint: 'interactive' }); } catch { return null; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    for (const name of ['fx', 'voice', 'alert', 'ui']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[name] = g;
    }
    this.#makeNoise();
    this.#applyVolumes();
    if (ctx.state === 'suspended') ctx.resume?.().catch?.(() => {});
    return ctx;
  }

  /** The context if audio is available, creating it when called from a user gesture handler. */
  context() {
    return this.#create();
  }

  #makeNoise() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }
    // Cross-fade the loop ends so the loop point cannot click.
    const fade = 512;
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      w[len - fade + i] = w[len - fade + i] * (1 - t) + w[i] * t;
      b[len - fade + i] = b[len - fade + i] * (1 - t) + b[i] * t;
    }
    this.noiseBuffers = { white, brown };
  }

  /** A looping noise source (`white` or `brown`), already started. */
  noise(kind = 'white') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffers[kind];
    src.loop = true;
    src.loopEnd = this.noiseBuffers[kind].duration - 0.01;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  #applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    const set = (node, v) => node.gain.setTargetAtTime(v, t, 0.05);
    set(this.master, s.get('masterVolume'));
    set(this.buses.fx, this.flying ? s.get('effectsVolume') : 0);
    set(this.buses.voice, s.get('voiceVolume'));
    set(this.buses.alert, s.get('alertVolume') * 0.5);
    set(this.buses.ui, s.get('uiSounds') ? 0.5 : 0);
  }

  /** Engine and wind sounds only play while a flight is running (not paused, not in menus). */
  setFlying(on) {
    this.flying = on;
    this.#applyVolumes();
  }

  /** RMS level of everything played, 0..1 (used by the automated tests). */
  level() {
    if (!this.ctx) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.sqrt(sum / data.length);
  }

  // ---- one-shot sounds ---------------------------------------------------------------------------------------
  #burst({ bus = 'ui', freq = 1000, q = 1, type = 'bandpass', duration = 0.1, gain = 0.5, attack = 0.005, kind = 'white' }) {
    const ctx = this.context();
    if (!ctx) return;
    const src = this.noise(kind);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const amp = ctx.createGain();
    const t0 = ctx.currentTime;
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + attack);
    amp.gain.exponentialRampToValueAtTime(0.0008, t0 + duration);
    src.connect(filter).connect(amp).connect(this.buses[bus]);
    src.stop(t0 + duration + 0.05);
  }

  #beep(bus, freq, start, duration, gain = 0.3, type = 'sine') {
    const ctx = this.context();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + start;
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    amp.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(amp).connect(this.buses[bus]);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  /** Soft menu tick. */
  click() { this.#burst({ bus: 'ui', freq: 2200, q: 2, duration: 0.04, gain: 0.35 }); }

  /** Radio transmission start: a short roger-beep chirp and a puff of static. */
  radioStart() {
    this.#burst({ bus: 'voice', freq: 1800, q: 0.8, duration: 0.14, gain: 0.35 });
    this.#beep('voice', 1250, 0, 0.05, 0.12, 'square');
  }

  /** Radio transmission end: the squelch tail. */
  radioEnd() {
    this.#burst({ bus: 'voice', freq: 2600, q: 0.7, duration: 0.18, gain: 0.3, attack: 0.002 });
  }

  /** Your own transmission: just a key click. */
  radioKey() { this.#burst({ bus: 'voice', freq: 1500, q: 1.5, duration: 0.05, gain: 0.3 }); }

  /** Tyre chirp and thump when the wheels touch down; `sink` in m/s. */
  touchdown(sink) {
    const k = Math.min(1, 0.25 + sink / 3);
    this.#burst({ bus: 'fx', freq: 900, q: 0.6, type: 'lowpass', duration: 0.35, gain: 0.7 * k, kind: 'white' });
    this.#burst({ bus: 'fx', freq: 120, q: 0.7, type: 'lowpass', duration: 0.5, gain: 0.9 * k, kind: 'brown' });
  }

  crash() {
    this.#burst({ bus: 'fx', freq: 1400, q: 0.5, type: 'lowpass', duration: 1.6, gain: 1, kind: 'white', attack: 0.01 });
    this.#burst({ bus: 'fx', freq: 90, q: 0.7, type: 'lowpass', duration: 2.2, gain: 1, kind: 'brown', attack: 0.01 });
  }
}
