import { Emitter } from '../core/events.js';
import { loadJSON, saveJSON } from './store.js';

const STORAGE_KEY = 'settings';

// First-run defaults follow the operating system's accessibility preferences.
const prefers = (query) => typeof matchMedia === 'function' && matchMedia(query).matches;
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
    hint: 'Arcade is easy to fly. Simulation adds per-engine throttle, manual flaps and gear, ATC, systems, checklists and failures. Changing any single system below switches this to Custom.',
  },
  sys_realism: {
    section: 'Game systems', label: 'Flight model realism', type: 'options',
    options: [['arcade', 'Arcade'], ['standard', 'Standard'], ['full', 'Full sim']], default: 'arcade',
    hint: 'Sets the flight assist at the start of a flight: Arcade holds attitude and protects the stall, Full sim gives raw control.',
  },
  sys_perEngine: {
    section: 'Game systems', label: 'Per-engine throttle', type: 'bool', default: false,
    hint: 'One lever per engine instead of a single throttle. [ ] selects an engine; drag the levers on the engine panel.',
  },
  sys_manualFlaps: { section: 'Game systems', label: 'Manual flaps', type: 'bool', default: false, hint: 'Off: flaps follow airspeed automatically.' },
  sys_manualGear: { section: 'Game systems', label: 'Manual landing gear', type: 'bool', default: false, hint: 'Off: the gear retracts after takeoff and extends on approach.' },
  sys_atc: { section: 'Game systems', label: 'ATC', type: 'bool', default: false, hint: 'Radio menu with clearances, vectors and landing instructions (R opens it).' },
  sys_fuel: { section: 'Game systems', label: 'Fuel management and APU', type: 'bool', default: false, hint: 'Tank pumps, crossfeed, fuel dump (airliners) and APU controls.' },
  sys_checklists: { section: 'Game systems', label: 'Checklists', type: 'bool', default: false },
  sys_failures: { section: 'Game systems', label: 'Random failures', type: 'bool', default: false, hint: 'Engine, hydraulic, electrical, flap, gear, pitot, control and fuel failures during flight.' },
  sys_fullWeather: { section: 'Game systems', label: 'Full weather effects', type: 'bool', default: false, hint: 'Off: turbulence, wind shear and wet runways are strongly reduced.' },
  sys_damage: { section: 'Game systems', label: 'Damage', type: 'bool', default: true, hint: 'Off: overspeed, over-g and hard landings no longer destroy the aircraft (terrain still does).' },
  quality: {
    section: 'Display',
    label: 'Graphics quality',
    type: 'options',
    options: [
      ['auto', 'Auto'],
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
    ],
    default: 'auto',
    hint: 'Auto lowers the render resolution when the frame rate drops and raises it again when there is headroom.',
  },
  showFps: { section: 'Display', label: 'FPS counter', type: 'bool', default: false },
  dashboard: {
    section: 'Display', label: 'Dashboard in outside views', type: 'bool', default: true,
    hint: 'A realistic instrument panel along the bottom of the screen with a throttle quadrant, flap and gear levers and switches. It gives way to the cockpit when you use the cockpit camera (F10 collapses it).',
  },
  hudScale: {
    section: 'Display', label: 'HUD scale', type: 'range',
    min: 0.6, max: 1.6, step: 0.05, default: 1, format: (v) => `${Math.round(v * 100)}%`,
  },
  hudOpacity: {
    section: 'Display', label: 'HUD opacity', type: 'range',
    min: 0.3, max: 1, step: 0.05, default: 1, format: (v) => `${Math.round(v * 100)}%`,
  },
  flightAssist: {
    section: 'Game',
    label: 'Flight assist',
    type: 'options',
    options: [
      ['off', 'Off'],
      ['light', 'Light'],
      ['full', 'Full'],
    ],
    default: 'light',
    hint: 'Light adds rate damping and turn coordination. Full holds bank and pitch when you release the stick, with stall protection. (J cycles it in flight.)',
  },
  weather: {
    section: 'Game',
    label: 'Wind',
    type: 'options',
    options: [
      ['calm', 'Calm'],
      ['breeze', 'Headwind'],
      ['crosswind', 'Crosswind'],
      ['gusty', 'Gusty'],
    ],
    default: 'calm',
    hint: 'Applies to the next flight. Sky (rain, storm, fog, snow) is chosen on the flight setup screen.',
  },
  timeScale: {
    section: 'Game',
    label: 'Time of day',
    type: 'options',
    options: [
      ['0', 'Frozen'],
      ['1', 'Real time'],
      ['60', 'Fast (60x)'],
    ],
    default: '1',
    hint: 'How fast the clock runs once you are flying. Dusk and night bring the airport and city lights.',
  },
  padDeadzone: {
    section: 'Controller', label: 'Stick dead zone', type: 'range',
    min: 0, max: 0.4, step: 0.01, default: 0.12, format: (v) => `${Math.round(v * 100)}%`,
  },
  padCurve: {
    section: 'Controller', label: 'Stick curve', type: 'range',
    min: 0, max: 0.9, step: 0.05, default: 0.35, format: (v) => (v < 0.05 ? 'Linear' : `${Math.round(v * 100)}% expo`),
    hint: 'Higher values soften small stick movements.',
  },
  padInvertPitch: { section: 'Controller', label: 'Invert pitch', type: 'bool', default: false },
  padInvertLook: { section: 'Controller', label: 'Invert camera look', type: 'bool', default: false },
  atcTraffic: {
    section: 'Game systems', label: 'ATC traffic', type: 'options',
    options: [['off', 'None'], ['light', 'Light'], ['moderate', 'Moderate'], ['busy', 'Busy']], default: 'moderate',
    hint: 'How many AI aircraft use the airport you are at (needs ATC).',
  },
  atcVoice: { section: 'Audio', label: 'ATC voice (speech synthesis)', type: 'bool', default: false, hint: 'Reads controller messages aloud when your browser supports it. Text is always shown.' },
  masterVolume: {
    section: 'Audio', label: 'Master volume', type: 'range',
    min: 0, max: 1, step: 0.05, default: 0.8, format: (v) => `${Math.round(v * 100)}%`,
  },
  effectsVolume: {
    section: 'Audio', label: 'Engine and wind volume', type: 'range',
    min: 0, max: 1, step: 0.05, default: 0.7, format: (v) => `${Math.round(v * 100)}%`,
    hint: 'Synthesized engines, airflow and tyre noise. Set to 0 to silence them.',
  },
  voiceVolume: {
    section: 'Audio', label: 'Radio and call-out volume', type: 'range',
    min: 0, max: 1, step: 0.05, default: 0.9, format: (v) => `${Math.round(v * 100)}%`,
    hint: 'Radio squelch, the ATC voice and ground-proximity call-outs.',
  },
  alertVolume: {
    section: 'Audio', label: 'Warning volume', type: 'range',
    min: 0, max: 1, step: 0.05, default: 0.9, format: (v) => `${Math.round(v * 100)}%`,
    hint: 'Master warning chime, caution beep and the stall horn.',
  },
  uiSounds: { section: 'Audio', label: 'Menu click sounds', type: 'bool', default: true },
  textSize: {
    section: 'Accessibility', label: 'Text and menu size', type: 'options',
    options: [['1', 'Normal'], ['1.2', 'Large'], ['1.4', 'Extra large']], default: '1',
    hint: 'Scales menus and the flight HUD (HUD scale in Display still applies on top).',
  },
  highContrast: {
    section: 'Accessibility', label: 'High contrast', type: 'bool', default: prefers('(prefers-contrast: more)'),
    hint: 'Black backgrounds, white text, strong borders and thicker focus outlines.',
  },
  colorblind: {
    section: 'Accessibility', label: 'Colour-blind friendly colours', type: 'bool', default: false,
    hint: 'Replaces red and green status colours with blue, yellow and orange. Warnings always carry text as well.',
  },
  subtitles: {
    section: 'Accessibility', label: 'Radio subtitles', type: 'bool', default: true,
    hint: 'Shows each ATC message on screen as it is spoken (the radio panel transcript is always available).',
  },
  reduceMotion: {
    section: 'Accessibility', label: 'Reduce motion', type: 'bool', default: prefers('(prefers-reduced-motion: reduce)'),
    hint: 'Disables the animated menu background, the auto-orbiting camera, blinking warnings and interface transitions.',
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
