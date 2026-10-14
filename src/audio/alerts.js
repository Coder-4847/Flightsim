// Small synthesized alert sounds (Web Audio): master warning chime, caution beep, stall horn, a
// click for panel buttons. Phase 6 adds engine/wind/ATC audio on top of this context.

export class AlertAudio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.stallNode = null;
    this.lastAt = {};
  }

  #context() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return null;
      try { this.ctx = new Ctx(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume?.();
    return this.ctx;
  }

  get volume() { return (this.settings.get('masterVolume') ?? 0.8) * 0.5; }

  #tone(freq, start, duration, type = 'sine', gain = 1) {
    const ctx = this.#context();
    if (!ctx || this.volume <= 0) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + start;
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(this.volume * gain, t0 + 0.02);
    amp.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  #throttle(key, seconds) {
    const now = performance.now() / 1000;
    if (now - (this.lastAt[key] ?? -1e9) < seconds) return false;
    this.lastAt[key] = now;
    return true;
  }

  master() { if (this.#throttle('master', 3)) { this.#tone(880, 0, 0.18, 'triangle'); this.#tone(1175, 0.2, 0.18, 'triangle'); this.#tone(880, 0.4, 0.18, 'triangle'); } }
  caution() { if (this.#throttle('caution', 4)) this.#tone(660, 0, 0.35, 'sine', 0.8); }
  click() { this.#tone(1400, 0, 0.04, 'square', 0.25); }
  chime() { this.#tone(1046, 0, 0.12, 'sine', 0.6); this.#tone(1318, 0.12, 0.2, 'sine', 0.6); }

  /** Pulsing horn while the aircraft is stalling. */
  stall(on) {
    if (!on) { this.stallNode?.stop?.(); this.stallNode = null; return; }
    if (this.stallNode || this.volume <= 0) return;
    const ctx = this.#context();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = 520;
    lfo.type = 'square'; lfo.frequency.value = 4;
    lfoGain.gain.value = this.volume * 0.45;
    amp.gain.value = this.volume * 0.45;
    lfo.connect(lfoGain).connect(amp.gain);
    osc.connect(amp).connect(ctx.destination);
    osc.start(); lfo.start();
    this.stallNode = { stop: () => { try { osc.stop(); lfo.stop(); } catch { /* already stopped */ } } };
  }

  /** Ground-proximity call-outs by speech synthesis (also silent when unsupported). */
  speak(text) {
    if (!('speechSynthesis' in window) || this.volume <= 0 || !this.#throttle(`say:${text}`, 3.2)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.1; u.pitch = 0.7; u.volume = Math.min(1, this.volume * 2);
      window.speechSynthesis.speak(u);
    } catch { /* optional */ }
  }

  dispose() { this.stall(false); }
}
