// Optional synthesized voice for controller transmissions (Web Speech API). Text is always shown;
// speech is an extra and silently does nothing when the browser has no voices.

export class AtcVoice {
  constructor(settings) {
    this.settings = settings;
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  speak(text) {
    if (!this.supported || !this.settings.get('atcVoice')) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' '));
      u.rate = 1.12;
      u.pitch = 0.85;
      u.volume = Math.min(1, this.settings.get('masterVolume') ?? 0.8);
      const voices = window.speechSynthesis.getVoices();
      const en = voices.find((v) => v.lang?.startsWith('en')) ?? null;
      if (en) u.voice = en;
      window.speechSynthesis.speak(u);
    } catch {
      /* speech is optional */
    }
  }

  cancel() {
    if (this.supported) window.speechSynthesis.cancel();
  }
}
