import { Emitter } from '../core/events.js';
import { loadJSON, saveJSON } from './store.js';

const STORAGE_KEY = 'settings';
const VERSION = 1;

// Single source of truth for settings. The settings screen is generated from
// this schema, so adding a setting here is enough to expose it in the UI.
//   type: 'options' | 'range' | 'bool'
export const SETTINGS_SCHEMA = {
  preset: {
    section: 'Game',
    label: 'Game mode',
    type: 'options',
    options: [
      ['arcade', 'Arcade'],
      ['simulation', 'Simulation'],
      ['custom', 'Custom'],
    ],
    default: 'arcade',
    hint: 'Arcade is easy to fly; Simulation adds full systems and ATC. Takes effect from Phase 4.',
  },
  quality: {
    section: 'Display',
    label: 'Graphics quality',
    type: 'options',
    options: [
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
    ],
    default: 'medium',
  },
  showFps: { section: 'Display', label: 'FPS counter', type: 'bool', default: false },
  hudScale: {
    section: 'Display', label: 'HUD scale', type: 'range',
    min: 0.6, max: 1.6, step: 0.05, default: 1, format: (v) => `${Math.round(v * 100)}%`,
  },
  hudOpacity: {
    section: 'Display', label: 'HUD opacity', type: 'range',
    min: 0.3, max: 1, step: 0.05, default: 1, format: (v) => `${Math.round(v * 100)}%`,
  },
  masterVolume: {
    section: 'Audio', label: 'Master volume', type: 'range',
    min: 0, max: 1, step: 0.05, default: 0.8, format: (v) => `${Math.round(v * 100)}%`,
  },
  reduceMotion: {
    section: 'Accessibility', label: 'Reduce motion', type: 'bool', default: false,
    hint: 'Disables the auto-orbiting camera and interface animation.',
  },
};

function sanitize(spec, value) {
  switch (spec.type) {
    case 'bool':
      return typeof value === 'boolean' ? value : spec.default;
    case 'range': {
      if (typeof value !== 'number' || Number.isNaN(value)) return spec.default;
      return Math.min(spec.max, Math.max(spec.min, value));
    }
    case 'options':
      return spec.options.some(([id]) => id === value) ? value : spec.default;
    default:
      return spec.default;
  }
}

export class Settings extends Emitter {
  #values = {};

  constructor() {
    super();
    const saved = loadJSON(STORAGE_KEY);
    const stored = saved && saved.version === VERSION ? saved.values ?? {} : {};
    for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
      this.#values[key] = sanitize(spec, key in stored ? stored[key] : spec.default);
    }
  }

  get(key) {
    return this.#values[key];
  }

  set(key, value) {
    const spec = SETTINGS_SCHEMA[key];
    if (!spec) return;
    const clean = sanitize(spec, value);
    if (clean === this.#values[key]) return;
    this.#values[key] = clean;
    this.#persist();
    this.emit('change', { key, value: clean });
  }

  resetAll() {
    for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) this.set(key, spec.default);
  }

  #persist() {
    saveJSON(STORAGE_KEY, { version: VERSION, values: this.#values });
  }
}
