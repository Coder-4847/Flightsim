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
  sys_cockpitCam: { section: 'Game systems', label: 'Cockpit camera', type: 'bool', default: true },
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
