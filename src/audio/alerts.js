// Cockpit alert sounds (master warning chime, caution beep, stall horn, ground-proximity
// call-outs, radio blips, menu clicks), played on the shared audio bus (see audioBus.js).

export class AlertAudio {
  constructor(settings, bus) {
    this.settings = settings;
    this.bus = bus;
    this.stallNode = null;
    this.lastAt = {};
  }

  get ctx() { return this.bus.context(); }

  #tone(freq, start, duration, type = 'sine', gain = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + start;
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    amp.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(amp).connect(this.bus.buses.alert);
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
  click() { this.bus.click(); }
  chime() { this.#tone(1046, 0, 0.12, 'sine', 0.6); this.#tone(1318, 0.12, 0.2, 'sine', 0.6); }

  /** A controller message: static and a chirp as it starts, a squelch tail once it should be over. */
  radio(msg) {
    this.bus.radioStart();
    const seconds = Math.min(9, 0.8 + (msg.text?.length ?? 40) * 0.055);
    setTimeout(() => this.bus.radioEnd(), seconds * 1000);
  }

  radioKey() { this.bus.radioKey(); }

  /** Pulsing horn while the aircraft is stalling. */
  stall(on) {
    if (!on) { this.stallNode?.stop?.(); this.stallNode = null; return; }
    if (this.stallNode) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = 520;
    lfo.type = 'square'; lfo.frequency.value = 4;
    lfoGain.gain.value = 0.45;
    amp.gain.value = 0.45;
    lfo.connect(lfoGain).connect(amp.gain);
    osc.connect(amp).connect(this.bus.buses.alert);
    osc.start(); lfo.start();
    this.stallNode = { stop: () => { try { osc.stop(); lfo.stop(); } catch { /* already stopped */ } } };
  }

  /** Ground-proximity call-outs by speech synthesis (also silent when unsupported). */
  speak(text) {
    const vol = (this.settings.get('masterVolume') ?? 0.8) * (this.settings.get('voiceVolume') ?? 0.9);
    if (!('speechSynthesis' in window) || vol <= 0 || !this.#throttle(`say:${text}`, 3.2)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.1; u.pitch = 0.7; u.volume = Math.min(1, vol);
      window.speechSynthesis.speak(u);
    } catch { /* optional */ }
  }

  dispose() { this.stall(false); }
}
