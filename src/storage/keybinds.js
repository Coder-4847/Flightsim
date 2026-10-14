import { Emitter } from '../core/events.js';
import { loadJSON, saveJSON } from './store.js';

const STORAGE_KEY = 'keybinds';
const VERSION = 1;
const MAX_PER_DEVICE = 4;

export const DEVICES = ['keyboard', 'mouse', 'gamepad'];

// Every bindable action. Keyboard values are KeyboardEvent.code strings;
// gamepad values are standard-mapping button names (A, B, X, Y, LB, RB, LT, RT,
// Back, Start, L3, R3, DPadUp/Down/Left/Right). Analog axes (sticks/triggers)
// are fixed in the controller layer added in Phase 2 and are not rebindable here.
// W/S: W pushes the stick forward (nose down), S pulls back (nose up).
const a = (id, label, category, keyboard = [], gamepad = [], mouse = []) =>
  ({ id, label, category, defaults: { keyboard, mouse, gamepad } });

export const ACTIONS = [
  a('pitch_down', 'Pitch down', 'Flight', ['KeyW', 'ArrowUp']),
  a('pitch_up', 'Pitch up', 'Flight', ['KeyS', 'ArrowDown']),
  a('roll_left', 'Roll left', 'Flight', ['KeyA', 'ArrowLeft']),
  a('roll_right', 'Roll right', 'Flight', ['KeyD', 'ArrowRight']),
  a('yaw_left', 'Rudder left', 'Flight', ['KeyQ']),
  a('yaw_right', 'Rudder right', 'Flight', ['KeyE']),
  a('throttle_up', 'Throttle up', 'Flight', ['ShiftLeft']),
  a('throttle_down', 'Throttle down', 'Flight', ['ControlLeft']),
  a('brakes', 'Brakes', 'Flight', ['Space'], ['X']),
  a('parking_brake', 'Parking brake', 'Flight', ['KeyB']),

  a('gear', 'Landing gear', 'Systems', ['KeyG'], ['Y']),
  a('flaps_down', 'Flaps extend', 'Systems', ['KeyF'], ['DPadDown']),
  a('flaps_up', 'Flaps retract', 'Systems', ['KeyV'], ['DPadUp']),
  a('speedbrake', 'Speedbrake / spoilers', 'Systems', ['KeyX'], ['B']),
  a('lights', 'Lights', 'Systems', ['KeyL'], ['DPadRight']),

  a('camera_cycle', 'Cycle camera', 'Camera', ['KeyC'], ['RB']),
  a('camera_reset', 'Reset camera', 'Camera', ['Home'], ['R3']),

  a('radio_menu', 'Radio / ATC menu', 'HUD', ['KeyR'], ['LB']),
  a('hud_toggle', 'Toggle HUD', 'HUD', ['KeyH']),
  a('map_toggle', 'Toggle map', 'HUD', ['KeyM'], ['Back']),
  a('checklist_toggle', 'Toggle checklist', 'HUD', ['KeyK']),

  a('pause', 'Pause', 'Game', ['Escape', 'KeyP'], ['Start']),
];

const ACTION_IDS = new Set(ACTIONS.map((x) => x.id));
export const CATEGORIES = [...new Set(ACTIONS.map((x) => x.category))];

export function labelFor(actionId) {
  return ACTIONS.find((x) => x.id === actionId)?.label ?? actionId;
}

function defaultsMap() {
  const map = {};
  for (const act of ACTIONS) {
    map[act.id] = {};
    for (const d of DEVICES) map[act.id][d] = [...act.defaults[d]];
  }
  return map;
}

function cleanList(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const v of list) {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, MAX_PER_DEVICE);
}

// Overlay `source` (untrusted) onto a fresh defaults map; unknown actions and
// malformed entries are ignored.
function mergeBindings(source) {
  const map = defaultsMap();
  if (!source || typeof source !== 'object') return map;
  for (const [id, devices] of Object.entries(source)) {
    if (!ACTION_IDS.has(id) || !devices || typeof devices !== 'object') continue;
    for (const d of DEVICES) {
      const list = cleanList(devices[d]);
      if (list) map[id][d] = list;
    }
  }
  return map;
}

export class Keybinds extends Emitter {
  #map;

  constructor() {
    super();
    const saved = loadJSON(STORAGE_KEY);
    this.#map = mergeBindings(saved && saved.version === VERSION ? saved.bindings : null);
  }

  get(actionId, device = 'keyboard') {
    return this.#map[actionId]?.[device] ?? [];
  }

  /** Actions currently bound to `code` on `device`, optionally excluding one. */
  conflicts(device, code, exceptAction = null) {
    return ACTIONS.filter(
      (act) => act.id !== exceptAction && this.#map[act.id][device].includes(code),
    ).map((act) => act.id);
  }

  /**
   * Bind `code` to `actionId` in slot `slot` (0 = primary, 1 = secondary...).
   * Any other action using the same code on this device loses it.
   * Returns the ids of actions the key was taken from.
   */
  bind(actionId, device, slot, code) {
    const taken = this.conflicts(device, code, actionId);
    for (const id of taken) {
      this.#map[id][device] = this.#map[id][device].filter((c) => c !== code);
    }
    const list = this.#map[actionId][device].filter((c) => c !== code);
    list[Math.min(slot, list.length)] = code;
    this.#map[actionId][device] = list.slice(0, MAX_PER_DEVICE);
    this.#changed();
    return taken;
  }

  unbind(actionId, device, slot) {
    this.#map[actionId][device].splice(slot, 1);
    this.#changed();
  }

  resetAction(actionId) {
    const act = ACTIONS.find((x) => x.id === actionId);
    for (const d of DEVICES) this.#map[actionId][d] = [...act.defaults[d]];
    this.#changed();
  }

  resetAll() {
    this.#map = defaultsMap();
    this.#changed();
  }

  exportJSON() {
    return JSON.stringify({ app: 'flight-sim', version: VERSION, bindings: this.#map }, null, 2);
  }

  /** Returns true on success, false if the text isn't a valid bindings file. */
  importJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    if (!parsed || parsed.version !== VERSION || typeof parsed.bindings !== 'object') return false;
    this.#map = mergeBindings(parsed.bindings);
    this.#changed();
    return true;
  }

  #changed() {
    saveJSON(STORAGE_KEY, { version: VERSION, bindings: this.#map });
    this.emit('change');
  }
}

// Human-readable name for a KeyboardEvent.code value.
export function prettyKey(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5) + ' arrow';
  return code
    .replace('Left', ' L').replace('Right', ' R')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}
